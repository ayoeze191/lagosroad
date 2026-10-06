import { seededRandom } from "./rng.js";
import type { Graph } from "./route.js";
import { MAJOR_HIGHWAYS, type MapData, type Point } from "./types.js";

/**
 * Background traffic and pedestrians. Everything moves on fixed looping routes generated from the
 * map seed, and its position is a pure function of time. The client and server therefore agree on
 * where every danfo and okada is without sending any of it over the network.
 */
export type TrafficKind = "danfo" | "car" | "keke" | "okada";
export const TRAFFIC_RADIUS: Record<TrafficKind, number> = { danfo: 1.3, car: 1.1, keke: 0.9, okada: 0.6 };
const SPEED: Record<TrafficKind, number> = { danfo: 11, car: 13, keke: 8, okada: 14 };

type Route = { pts: Point[]; cum: number[]; length: number; minX: number; minY: number; maxX: number; maxY: number };
export type Vehicle = { id: string; kind: TrafficKind; colour: number; route: Route; offset: number; speed: number; lane: number; radius: number };
export type Walker = { id: string; shirt: number; route: Route; offset: number; speed: number; lane: number };
export type Pose = { x: number; y: number; heading: number };

/** Per road segment in the map, so bigger maps get proportionally more traffic. */
const VEHICLES_PER_ROAD = 0.25, WALKERS_PER_ROAD = 0.3, MAX_VEHICLES = 2500, MAX_WALKERS = 3000;

function makeRoute(pts: Point[]): Route {
  const cum = [0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
  }
  return { pts, cum, length: cum[cum.length - 1], minX, minY, maxX, maxY };
}

/** Position `d` metres along a route, shifted `lane` metres to the right of travel. */
function along(route: Route, d: number, lane: number, out: Pose): Pose {
  const { pts, cum, length } = route;
  let s = d % length;
  if (s < 0) s += length;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi], seg = cum[hi] - cum[lo] || 1, k = (s - cum[lo]) / seg;
  const dx = (b.x - a.x) / seg, dy = (b.y - a.y) / seg;
  out.x = a.x + (b.x - a.x) * k + dy * lane;
  out.y = a.y + (b.y - a.y) * k - dx * lane;
  out.heading = Math.atan2(dx, dy);
  return out;
}

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  readonly walkers: Walker[] = [];
  /** Bus stops where an agbero (tout) waits to collect money from danfo drivers. */
  readonly agberoPosts: (Point & { id: string; heading: number })[] = [];

  constructor(map: MapData, graph: Graph) {
    const random = seededRandom(`${map.area.seed}:traffic`);
    const nodes = map.graph.nodes;
    const main = nodes.map((n, i) => i).filter((i) => nodes[i].component === map.mainComponent && graph.adjacency[i].length > 0);
    if (!main.length) return;
    // Busier on major roads: bias start points to junctions that touch one.
    const majorStarts = main.filter((i) => graph.adjacency[i].some((l) => MAJOR_HIGHWAYS.has(map.roads[l.edge].highway)));
    const kinds: TrafficKind[] = ["danfo", "danfo", "car", "car", "car", "keke", "okada", "okada", "okada"];

    const vehicleCount = Math.min(MAX_VEHICLES, Math.max(6, Math.round(map.roads.length * VEHICLES_PER_ROAD))), walkerCount = Math.min(MAX_WALKERS, Math.max(6, Math.round(map.roads.length * WALKERS_PER_ROAD)));
    for (let v = 0; v < vehicleCount; v++) {
      const kind = kinds[Math.floor(random() * kinds.length)];
      const onMajor = (kind === "danfo" || kind === "car") && majorStarts.length && random() < 0.75;
      let node = onMajor ? majorStarts[Math.floor(random() * majorStarts.length)] : main[Math.floor(random() * main.length)];
      let prevEdge = -1;
      const pts: Point[] = [{ ...nodes[node].position }];
      for (let step = 0; step < 18; step++) {
        const links = graph.adjacency[node].filter((l) => l.edge !== prevEdge);
        if (!links.length) break;
        // Prefer staying on bigger roads, like real traffic does.
        const weights = links.map((l) => (MAJOR_HIGHWAYS.has(map.roads[l.edge].highway) ? (onMajor ? 8 : 2) : 1));
        let pick = random() * weights.reduce((a, b) => a + b, 0), chosen = links[0];
        for (let i = 0; i < links.length; i++) { pick -= weights[i]; if (pick <= 0) { chosen = links[i]; break; } }
        const edge = map.graph.edges[chosen.edge], road = map.roads[chosen.edge];
        const line = edge.from === nodes[node].id ? road.points : [...road.points].reverse();
        pts.push(...line.slice(1));
        prevEdge = chosen.edge;
        node = chosen.to;
      }
      if (pts.length < 2) continue;
      // Out and back: the return leg uses the other lane, so the loop is seamless.
      const route = makeRoute([...pts, ...pts.slice(0, -1).reverse()]);
      if (route.length < 60) continue;
      const width = 6;
      this.vehicles.push({
        id: `v${v}`, kind, colour: Math.floor(random() * 8), route,
        offset: random() * route.length, speed: SPEED[kind] * (0.85 + random() * 0.3),
        lane: kind === "okada" ? width / 2 - 0.6 : Math.min(1.8, width / 4),
        radius: TRAFFIC_RADIUS[kind]
      });
    }

    // Agbero posts: roadside at busy junctions on major roads, spaced out across the map.
    for (const i of majorStarts) {
      if (random() > 0.35) continue;
      const n = nodes[i].position;
      if (this.agberoPosts.some((a) => Math.hypot(a.x - n.x, a.y - n.y) < 450)) continue;
      const link = graph.adjacency[i].find((l) => MAJOR_HIGHWAYS.has(map.roads[l.edge].highway)) || graph.adjacency[i][0];
      const road = map.roads[link.edge], edge = map.graph.edges[link.edge];
      const pts = edge.from === nodes[i].id ? road.points : [...road.points].reverse();
      const next = pts[1] || pts[0], len = Math.hypot(next.x - n.x, next.y - n.y) || 1;
      const dx = (next.x - n.x) / len, dy = (next.y - n.y) / len, off = road.width / 2 + 1.5;
      this.agberoPosts.push({ id: `a${i}`, x: n.x + dx * 12 + dy * off, y: n.y + dy * 12 - dx * off, heading: Math.atan2(dx, dy) });
    }

    // Pedestrians stroll along the verges of busy streets and turn back at the end.
    const named = map.roads.filter((r) => r.paved && !r.bridge && r.points.length > 1);
    const busy = named.filter((r) => MAJOR_HIGHWAYS.has(r.highway));
    for (let w = 0; w < walkerCount && named.length; w++) {
      const pool = random() < 0.6 && busy.length ? busy : named;
      const road = pool[Math.floor(random() * pool.length)];
      const route = makeRoute([...road.points, ...road.points.slice(0, -1).reverse()]);
      if (route.length < 30) continue;
      this.walkers.push({ id: `w${w}`, shirt: Math.floor(random() * 8), route, offset: random() * route.length, speed: 1 + random() * 0.6, lane: road.width / 2 + 0.9 });
    }
  }

  vehiclePose(v: Vehicle, time: number, out: Pose = { x: 0, y: 0, heading: 0 }) {
    return along(v.route, v.offset + v.speed * time, v.lane, out);
  }
  walkerPose(w: Walker, time: number, out: Pose = { x: 0, y: 0, heading: 0 }) {
    return along(w.route, w.offset + w.speed * time, w.lane, out);
  }

  /** Vehicles within `radius` of p at `time` (cheap bounding-box rejection first). */
  vehiclesNear(p: Point, time: number, radius: number, visit: (v: Vehicle, pose: Pose) => void) {
    const pose: Pose = { x: 0, y: 0, heading: 0 };
    for (const v of this.vehicles) {
      const r = v.route;
      if (p.x < r.minX - radius - 3 || p.x > r.maxX + radius + 3 || p.y < r.minY - radius - 3 || p.y > r.maxY + radius + 3) continue;
      this.vehiclePose(v, time, pose);
      if (Math.abs(pose.x - p.x) < radius && Math.abs(pose.y - p.y) < radius) visit(v, pose);
    }
  }
  walkersNear(p: Point, time: number, radius: number, visit: (w: Walker, pose: Pose) => void) {
    const pose: Pose = { x: 0, y: 0, heading: 0 };
    for (const w of this.walkers) {
      const r = w.route;
      if (p.x < r.minX - radius - 6 || p.x > r.maxX + radius + 6 || p.y < r.minY - radius - 6 || p.y > r.maxY + radius + 6) continue;
      this.walkerPose(w, time, pose);
      if (Math.abs(pose.x - p.x) < radius && Math.abs(pose.y - p.y) < radius) visit(w, pose);
    }
  }
}
