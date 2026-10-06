import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { seededRandom } from "../../shared/rng.js";
import { PointGrid, RoadGrid } from "../../shared/spatial.js";
import type { Barrier, Building, Jam, Place, Footbridge, GraphEdge, GraphNode, MapData, Point, Pothole, Road, Tree, Waterway } from "../../shared/types.js";
import { MAJOR_HIGHWAYS } from "../../shared/types.js";
import { stageMaps } from "./stage-maps.js";

type OsmPoint = { lat: number; lon: number };
type OsmWay = { id: number; geometry?: OsmPoint[]; tags?: Record<string, string> };
type OsmNode = OsmPoint & { id: number; tags?: Record<string, string> };
type Area = {
  name: string;
  seed: string;
  query: { kind: "bbox"; south: number; west: number; north: number; east: number };
};

const root = resolve(import.meta.dirname, "..");
const areasPath = resolve(root, "areas.json");
const outputDir = resolve(root, "data");
const rawDir = resolve(outputDir, "raw");
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
// Overpass rejects requests without an identifying User-Agent (HTTP 406).
const USER_AGENT = "LagosRoadRacer/0.2 (OSM map pipeline; https://www.openstreetmap.org/copyright)";

/** Two-way width by road type (game-sized: a little generous so racing at speed feels right). */
const WIDTH_METRES: Record<string, number> = {
  motorway: 26, trunk: 22, primary: 17, secondary: 13.5, tertiary: 10,
  motorway_link: 9, trunk_link: 9, primary_link: 8.5, secondary_link: 8, tertiary_link: 7,
  unclassified: 7, residential: 6, living_street: 5.5, service: 4.8, track: 3.8, road: 6
};
const LANE_METRES = 3.6;

/** Width from OSM `width` or `lanes` when mapped, else by type; one carriageway of a dual road gets ~60%. */
function roadWidth(tags: Record<string, string>, highway: string) {
  const base = WIDTH_METRES[highway] || WIDTH_METRES.road;
  const oneway = tags.oneway === "yes" || tags.oneway === "1" || highway.startsWith("motorway");
  const byType = oneway && MAJOR_HIGHWAYS.has(highway) && !highway.endsWith("_link") ? base * 0.6 : base;
  const tagged = parseFloat(tags.width), lanes = parseInt(tags.lanes, 10);
  if (Number.isFinite(tagged) && tagged >= 3 && tagged <= 40) return round(Math.max(tagged, byType * 0.8), 1);
  if (Number.isFinite(lanes) && lanes > 0 && lanes <= 10) return round(Math.max(lanes * LANE_METRES + 1.4, byType * 0.8), 1);
  return byType;
}
/** Every `highway=*` way is fetched; only these are turned into drivable roads. */
const DRIVABLE = new Set(Object.keys(WIDTH_METRES));
const UNPAVED_SURFACES = new Set(["dirt", "earth", "ground", "gravel", "fine_gravel", "sand", "unpaved", "compacted", "mud", "grass", "laterite", "pebblestone"]);

function usage() {
  console.log("Usage: npm run map:build -- <area-slug> [--seed custom-seed] [--refresh]");
  console.log("       npm run map:build -- ikorodu-west+ijede   (combined map for races between LCDAs)");
  console.log("       npm run map:list");
}

function localProject(point: OsmPoint, centre: OsmPoint): Point {
  const metresPerDegree = 111_320;
  return {
    x: +((point.lon - centre.lon) * metresPerDegree * Math.cos(centre.lat * Math.PI / 180)).toFixed(2),
    y: +((point.lat - centre.lat) * metresPerDegree).toFixed(2)
  };
}

const pointKey = (point: OsmPoint) => `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const round = (v: number, places = 2) => +v.toFixed(places);

function pointAt(points: Point[], target: number) {
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1], points[i]);
    if (segment > 0 && travelled + segment >= target) {
      const t = (target - travelled) / segment;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
        dx: (points[i].x - points[i - 1].x) / segment,
        dy: (points[i].y - points[i - 1].y) / segment
      };
    }
    travelled += segment;
  }
  return undefined;
}

const isPaved = (surface: string, highway: string) =>
  UNPAVED_SURFACES.has(surface.toLowerCase()) ? false : surface === "unknown" ? highway !== "track" : true;

function potholeRate(highway: string, paved: boolean) {
  if (!paved) return 1 / 40;
  if (MAJOR_HIGHWAYS.has(highway)) return 1 / 450;
  if (["tertiary", "tertiary_link", "unclassified"].includes(highway)) return 1 / 160;
  if (["residential", "living_street", "service"].includes(highway)) return 1 / 70;
  return 1 / 110;
}

async function fetchWays(area: Area, cacheName: string, filter: string, refresh: boolean): Promise<OsmWay[]> {
  const ways = await overpass<OsmWay>(area, cacheName, `way${filter}`, "out tags geom;", refresh);
  return ways.filter((way) => way.geometry && way.geometry.length > 1);
}

/** Barrier nodes (gates, lift gates, bollards…). The ones that sit on a drivable road become road blocks. */
function fetchBarriers(area: Area, cacheName: string, refresh: boolean) {
  return overpass<OsmNode>(area, cacheName, "node[barrier]", "out body;", refresh);
}

type OsmPlace = { type: string; lat?: number; lon?: number; center?: OsmPoint; tags?: Record<string, string> };
/** Named bus stops, landmarks and neighbourhoods: how Lagosians actually name places. */
export const PLACES_QUERY = '(node[highway=bus_stop][name]({{bbox}});node[public_transport=platform][name]({{bbox}});nwr[amenity~"^(marketplace|university|hospital|bus_station|fuel|place_of_worship|school|bank)$"][name]({{bbox}});nwr[tourism~"^(attraction|museum)$"][name]({{bbox}});nwr[shop=mall][name]({{bbox}});nwr[leisure=stadium][name]({{bbox}});node[place~"^(suburb|neighbourhood|quarter)$"][name]({{bbox}}););';
function fetchPlaces(area: Area, cacheName: string, refresh: boolean) {
  return overpass<OsmPlace>(area, cacheName, PLACES_QUERY, "out center tags;", refresh);
}

/** Famous go-slow spots, matched against bus stop and area names. */
const HOTSPOTS = ["ojota", "oshodi", "mile 12", "mile12", "berger", "ojuelegba", "obalende", "cms", "maryland", "ikeja along", "iyana ipaja", "iyana-ipaja", "ikotun", "agege", "costain", "jibowu", "fadeyi", "anthony", "ketu", "ikorodu garage", "toll gate", "ajah", "abule egba", "ijora", "mile 2", "ojodu", "alausa", "allen", "sabo", "idumota", "otedola", "ogba", "ogolonto", "agric", "owode", "festac", "cele", "ilupeju", "jakande", "obanikoro", "ikorodu roundabout", "itire", "lawanson", "tejuosho", "ebute"];

async function overpass<T>(area: Area, cacheName: string, selector: string, out: string, refresh: boolean): Promise<T[]> {
  const cachePath = resolve(rawDir, `${cacheName}.json`);
  if (!refresh && existsSync(cachePath)) {
    console.log(`Using cached OSM download (${cachePath}). Pass --refresh to re-download.`);
    return JSON.parse(await readFile(cachePath, "utf8"));
  }
  const q = area.query;
  const bbox = `${q.south},${q.west},${q.north},${q.east}`;
  // A selector with {{bbox}} placeholders is a full union query; otherwise the bbox goes on the end.
  const query = selector.includes("{{bbox}}") ? `[out:json][timeout:180];${selector.replaceAll("{{bbox}}", bbox)}${out}` : `[out:json][timeout:180];${selector}(${bbox});${out}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        console.log(`  → ${endpoint}`);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT, accept: "application/json" },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(200_000)
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const { elements } = await response.json() as { elements: T[] };
        await mkdir(rawDir, { recursive: true });
        await writeFile(cachePath, JSON.stringify(elements));
        return elements;
      } catch (error) {
        lastError = error;
        console.warn(`    failed: ${String(error)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Overpass request failed on every endpoint: ${String(lastError)}`);
}

/** Label connected components so races are only set up between reachable junctions. */
function labelComponents(nodes: GraphNode[], edges: GraphEdge[]) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of edges) parent[find(index.get(e.from)!)] = find(index.get(e.to)!);
  const sizes = new Map<number, number>();
  const ids = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) sizes.set(find(i), (sizes.get(find(i)) || 0) + 1);
  [...sizes.entries()].sort((a, b) => b[1] - a[1]).forEach(([rootId], order) => ids.set(rootId, order));
  nodes.forEach((n, i) => { n.component = ids.get(find(i))!; });
  return 0; // components are numbered by size, so the largest is always 0
}

const WALL_COLOURS = 8;
const ROOF_COLOURS = 4;

/** Low-poly roadside buildings and trees. Seeded, so the town looks the same every visit. */
function generateScenery(roads: Road[], obstacles: Road[], seed: string) {
  const random = seededRandom(`${seed}:scenery`);
  const roadGrid = new RoadGrid(obstacles);
  const occupied = new PointGrid<{ x: number; y: number; r: number }>([], (o) => o, (o) => o.r);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const free = (x: number, y: number, r: number) => {
    const road = roadGrid.nearest({ x, y }, r + 20);
    if (road && road.edge < r + 1.5) return false;
    for (const o of occupied.near({ x, y }, true)) if (Math.hypot(o.x - x, o.y - y) < o.r + r) return false;
    return true;
  };
  for (const road of roads) {
    const major = MAJOR_HIGHWAYS.has(road.highway);
    const density = road.highway === "track" ? 0.25 : road.highway === "service" ? 0.45 : major ? 0.85 : 0.7;
    const length = road.points.slice(1).reduce((sum, p, i) => sum + distance(road.points[i], p), 0);
    for (let along = 6 + random() * 10; along < length - 4; along += 11 + random() * 9) {
      const at = pointAt(road.points, along);
      if (!at) break;
      for (const side of [-1, 1]) {
        const roll = random();
        if (roll > density) continue;
        const nx = at.dy * side, ny = -at.dx * side; // right-hand normal * side
        if (roll < density * 0.78) {
          const w = major ? 8 + random() * 10 : 6 + random() * 7;
          const d = 6 + random() * 7;
          const tall = random();
          const h = tall > 0.93 ? 11 + random() * 6 : tall > 0.7 ? 6.5 + random() * 3 : 3.2 + random() * 2.2;
          const setback = road.width / 2 + (major ? 3 : 2) + random() * 3 + d / 2;
          const x = at.x + nx * setback, y = at.y + ny * setback, r = Math.hypot(w, d) / 2;
          if (!free(x, y, r)) continue;
          occupied.add({ x, y, r }, { x, y }, r);
          buildings.push({
            x: round(x, 1), y: round(y, 1), w: round(w, 1), d: round(d, 1), h: round(h, 1),
            angle: round(Math.atan2(at.dy, at.dx), 3),
            wall: Math.floor(random() * WALL_COLOURS), roof: Math.floor(random() * ROOF_COLOURS)
          });
        } else {
          const setback = road.width / 2 + 2 + random() * 5;
          const x = at.x + nx * setback, y = at.y + ny * setback;
          if (!free(x, y, 1.6)) continue;
          occupied.add({ x, y, r: 1.6 }, { x, y }, 1.6);
          trees.push({ x: round(x, 1), y: round(y, 1), h: round(5 + random() * 6, 1), kind: random() < 0.4 ? 1 : 0 });
        }
      }
    }
  }
  return { buildings, trees };
}

async function main() {
  const args = process.argv.slice(2);
  const areas = JSON.parse(await readFile(areasPath, "utf8")) as Record<string, Area>;
  if (args.includes("--list")) {
    for (const [slug, area] of Object.entries(areas)) console.log(`${slug}\t${area.name}`);
    return;
  }
  const seedIndex = args.indexOf("--seed");
  const requested = args.find((arg, i) => !arg.startsWith("--") && (seedIndex < 0 || i !== seedIndex + 1));
  // "a+b" builds one combined map spanning several LCDAs, for races from one LCDA to another.
  const parts = requested?.split("+") || [];
  if (!parts.length || parts.some((p) => !areas[p])) { usage(); process.exitCode = 1; return; }
  const slug = parts.join("--");
  const members = parts.map((p) => areas[p]);
  const union = {
    kind: "bbox" as const,
    south: Math.min(...members.map((m) => m.query.south)), west: Math.min(...members.map((m) => m.query.west)),
    north: Math.max(...members.map((m) => m.query.north)), east: Math.max(...members.map((m) => m.query.east))
  };
  const baseSeed = members.map((m) => m.seed).join("+");
  const area: Area = { name: members.map((m) => m.name.replace(/ LCDA$/, "")).join(" ↔ ") + (parts.length > 1 ? "" : " LCDA"), query: union, seed: seedIndex >= 0 ? args[seedIndex + 1] || baseSeed : baseSeed };
  if (parts.length === 1) area.name = members[0].name;
  const centre = { lat: (area.query.south + area.query.north) / 2, lon: (area.query.west + area.query.east) / 2 };
  console.log(`Fetching ${area.name} from OpenStreetMap…`);
  const allWays = await fetchWays(area, slug, "[highway]", args.includes("--refresh"));
  console.log("Fetching rivers and streams…");
  const waterWays = await fetchWays(area, `${slug}-water`, '[waterway~"^(river|stream|canal|drain|ditch)$"]', args.includes("--refresh"));
  console.log("Fetching gates and barriers…");
  const barrierNodes = await fetchBarriers(area, `${slug}-barriers`, args.includes("--refresh"));
  console.log("Fetching bus stops and landmarks…");
  const placeNodes = await fetchPlaces(area, `${slug}-places`, args.includes("--refresh")).catch((e) => { console.warn(`  no places: ${String(e)}`); return [] as OsmPlace[]; });
  const drivable = allWays.filter((way) => {
    const t = way.tags || {};
    return DRIVABLE.has(t.highway || "") && t.area !== "yes" && t.service !== "parking_aisle" && t.access !== "no";
  });
  // Overpass returns whole ways, and some (e.g. the Sagamu road) run 30 km past the LCDA.
  // Clip every way to the area box (plus a small margin) so the map stays the size of the LCDA.
  const q = area.query, margin = 0.002;
  const inside = (p: OsmPoint) => p.lat >= q.south - margin && p.lat <= q.north + margin && p.lon >= q.west - margin && p.lon <= q.east + margin;
  const clip = (list: OsmWay[]) => {
    const out: OsmWay[] = [];
    for (const way of list) {
      let run: OsmPoint[] = [], part = 0;
      const flush = () => { if (run.length > 1) out.push({ ...way, id: part++ ? Number(`${way.id}${part}`) : way.id, geometry: run }); run = []; };
      for (const point of way.geometry!) { if (inside(point)) run.push(point); else flush(); }
      flush();
    }
    return out;
  };
  const ways = clip(drivable);
  const isBridge = (t: Record<string, string>) => !!t.bridge && t.bridge !== "no";
  // Pedestrian overhead bridges: the iconic Lagos footbridges over the expressways.
  const footbridges: Footbridge[] = clip(allWays.filter((w) => ["footway", "path", "pedestrian", "steps"].includes(w.tags?.highway || "") && isBridge(w.tags || {})))
    .map((w) => ({ points: w.geometry!.map((p) => localProject(p, centre)), layer: Number(w.tags?.layer) || 1 }));
  const WATER_WIDTH: Record<string, number> = { river: 18, canal: 8, stream: 4, drain: 2.5, ditch: 2 };
  const water: Waterway[] = clip(waterWays).filter((w) => w.tags?.tunnel !== "culvert")
    .map((w) => ({ kind: w.tags!.waterway, width: Number(w.tags?.width) || WATER_WIDTH[w.tags!.waterway] || 3, points: w.geometry!.map((p) => localProject(p, centre)) }));
  console.log(`Fetched ${allWays.length} highway ways; ${drivable.length} are drivable (${ways.length} pieces after clipping to the LCDA).`);

  // A shared OSM node splits ways into graph edges (a junction).
  const counts = new Map<string, number>();
  for (const way of ways) for (const point of way.geometry!) counts.set(pointKey(point), (counts.get(pointKey(point)) || 0) + 1);
  const graphNodes = new Map<string, GraphNode>();
  const roads: Road[] = [];
  const edges: GraphEdge[] = [];
  const random = seededRandom(area.seed);
  const potholes: Pothole[] = [];
  // Which road (and direction) passes through each OSM point, so barrier nodes can be placed on their road.
  const roadAtPoint = new Map<string, { roadId: string; dx: number; dy: number; width: number }>();

  for (const way of ways) {
    const geometry = way.geometry!;
    const tags = way.tags || {};
    const highway = tags.highway || "road";
    const surface = tags.surface || "unknown";
    const paved = isPaved(surface, highway);
    const width = roadWidth(tags, highway);
    const splitAt = [0, ...geometry.slice(1, -1).map((p, i) => counts.get(pointKey(p))! > 1 ? i + 1 : -1).filter((i) => i >= 0), geometry.length - 1];
    for (let segment = 0; segment < splitAt.length - 1; segment++) {
      const osmPoints = geometry.slice(splitAt[segment], splitAt[segment + 1] + 1);
      if (osmPoints.length < 2) continue;
      const id = `w${way.id}-${segment}`;
      const startKey = pointKey(osmPoints[0]), endKey = pointKey(osmPoints.at(-1)!);
      for (const [key, osm] of [[startKey, osmPoints[0]], [endKey, osmPoints.at(-1)!]] as const) {
        if (!graphNodes.has(key)) graphNodes.set(key, { id: `n${graphNodes.size}`, position: localProject(osm, centre), component: 0 });
      }
      const points = osmPoints.map((point) => localProject(point, centre));
      const length = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
      if (length < 0.5) continue;
      // roads[i] and graph.edges[i] always describe the same stretch of road.
      const bridge = isBridge(tags);
      osmPoints.forEach((osm, i) => {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], len = distance(a, b) || 1;
        if (!roadAtPoint.has(pointKey(osm))) roadAtPoint.set(pointKey(osm), { roadId: id, dx: round((b.x - a.x) / len, 3), dy: round((b.y - a.y) / len, 3), width });
      });
      roads.push({ id, name: tags.name || tags.ref || "Unnamed road", highway, surface, paved, width, points, ...(bridge ? { bridge, layer: Number(tags.layer) || 1 } : {}) });
      edges.push({ id, from: graphNodes.get(startKey)!.id, to: graphNodes.get(endKey)!.id, roadId: id, length: round(length, 1) });
      const expected = bridge ? 0 : length * potholeRate(highway, paved); // no potholes on bridge decks
      const holeCount = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
      for (let i = 0; i < holeCount; i++) {
        const sample = pointAt(points, 8 + random() * Math.max(1, length - 16));
        if (!sample) continue;
        const lateral = (random() - 0.5) * width * 0.6;
        potholes.push({
          id: `p${potholes.length}`, roadId: id,
          position: { x: round(sample.x - sample.dy * lateral), y: round(sample.y + sample.dx * lateral) },
          radius: round(0.3 + random() * 0.75),
          depth: round(0.035 + random() * 0.11, 3)
        });
      }
    }
  }

  // Kerbs, entrances and cattle grids don't stop cars, so they're skipped.
  const BLOCKING = new Set(["gate", "lift_gate", "swing_gate", "sliding_gate", "bollard", "block", "jersey_barrier", "chain", "barrier_board", "toll_booth", "border_control", "spikes", "log", "rope", "planter", "yes"]);
  const barriers: Barrier[] = [];
  for (const node of barrierNodes) {
    const kind = node.tags?.barrier || "";
    const road = roadAtPoint.get(pointKey(node));
    if (!road || !BLOCKING.has(kind)) continue;
    barriers.push({ id: `b${barriers.length}`, roadId: road.roadId, kind, position: localProject(node, centre), dx: road.dx, dy: road.dy, width: road.width });
  }

  // Places: bus stops, landmarks and neighbourhoods (deduplicated by name within 150 m).
  const places: Place[] = [];
  for (const el of placeNodes) {
    const t = el.tags || {}, at = el.center || (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : undefined);
    const name = (t.name || "").trim();
    if (!at || !name || name.length > 40 || !inside(at)) continue;
    const kind: Place["kind"] = t.highway === "bus_stop" || t.public_transport === "platform" || t.amenity === "bus_station" ? "bus_stop"
      : t.place ? "area" : ["fuel", "place_of_worship", "school", "bank"].includes(t.amenity) ? "spot" : "landmark";
    const position = localProject(at, centre);
    if (places.some((p) => p.name.toLowerCase() === name.toLowerCase() && Math.hypot(p.x - position.x, p.y - position.y) < 150)) continue;
    places.push({ name, kind, x: position.x, y: position.y });
  }
  // Go-slow hotspots: famous names first, then the busiest major junctions if none matched.
  const busy = new RoadGrid(roads.filter((rd) => MAJOR_HIGHWAYS.has(rd.highway) || rd.highway.startsWith("tertiary")));
  const jams: Jam[] = [];
  for (const p of places) {
    if (p.kind === "landmark" || p.kind === "spot" || !HOTSPOTS.some((h) => p.name.toLowerCase().includes(h))) continue;
    const hit = busy.nearest(p, 80);
    if (!hit || jams.some((j) => Math.hypot(j.x - hit.px, j.y - hit.py) < 400)) continue;
    jams.push({ name: p.name, x: round(hit.px), y: round(hit.py), radius: 160 });
    if (jams.length >= 12) break;
  }
  if (!jams.length) {
    const degree = new Map<string, number>();
    edges.forEach((e, i) => { if (MAJOR_HIGHWAYS.has(roads[i].highway)) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) || 0) + 1); });
    for (const n of [...graphNodes.values()].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))) {
      if ((degree.get(n.id) || 0) < 3 || jams.some((j) => Math.hypot(j.x - n.position.x, j.y - n.position.y) < 600)) continue;
      jams.push({ name: "Junction", x: n.position.x, y: n.position.y, radius: 140 });
      if (jams.length >= 4) break;
    }
  }

  const nodes = [...graphNodes.values()];
  const mainComponent = labelComponents(nodes, edges);
  // Scenery keeps clear of rivers too, so treat them as extra "roads" when placing buildings.
  const obstacles = [...roads, ...water.map((w) => ({ ...roads[0], width: w.width + 4, points: w.points }))];
  const { buildings, trees } = generateScenery(roads, obstacles, area.seed);
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const road of roads) for (const p of road.points) {
    extent.minX = Math.min(extent.minX, p.x); extent.maxX = Math.max(extent.maxX, p.x);
    extent.minY = Math.min(extent.minY, p.y); extent.maxY = Math.max(extent.maxY, p.y);
  }
  const output: MapData = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: { attribution: "© OpenStreetMap contributors", licence: "ODbL", provider: "Overpass API" },
    area: { slug, name: area.name, seed: area.seed },
    regions: parts.map((p) => {
      const b = areas[p].query, sw = localProject({ lat: b.south, lon: b.west }, centre), ne = localProject({ lat: b.north, lon: b.east }, centre);
      return { slug: p, name: areas[p].name, bounds: { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y } };
    }),
    extent,
    mainComponent,
    graph: { nodes, edges },
    roads,
    potholes,
    barriers,
    places,
    jams,
    buildings,
    trees,
    footbridges,
    water
  };
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${slug}.json`);
  await writeFile(outputPath, JSON.stringify(output) + "\n");
  const mainSize = nodes.filter((n) => n.component === mainComponent).length;
  console.log(`Bridges: ${roads.filter((r) => r.bridge).length} road, ${footbridges.length} pedestrian. Waterways: ${water.length}. Gates/barriers on roads: ${barriers.length} (of ${barrierNodes.length} in OSM). Places: ${places.length}. Go-slow spots: ${jams.map((j) => j.name).join(", ") || "none"}.`);
  console.log(`Wrote ${roads.length} road segments, ${nodes.length} junctions (${mainSize} in the main network), ${potholes.length} potholes, ${buildings.length} buildings and ${trees.length} trees to ${outputPath}`);
  await stageMaps();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
