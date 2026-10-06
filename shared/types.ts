// Map contract produced by /tools and consumed by /client and /server.
// All coordinates are local metres: +x east, +y north, origin at the area centre.

export type Point = { x: number; y: number };

export type Road = {
  id: string;
  name: string;
  highway: string;
  surface: string;
  paved: boolean;
  width: number;
  points: Point[];
  /** OSM bridge=* (anything but "no"), and its layer (1 = one level up). */
  bridge?: boolean;
  layer?: number;
};

/** Pedestrian overhead bridge (not drivable); `points` is the elevated span. */
export type Footbridge = { points: Point[]; layer: number };
/** River, stream, canal or drain centreline. */
export type Waterway = { kind: string; width: number; points: Point[] };

export type Region = { slug: string; name: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } };

export type GraphNode = { id: string; position: Point; component: number };
export type GraphEdge = { id: string; from: string; to: string; roadId: string; length: number };
export type Pothole = { id: string; roadId: string; position: Point; radius: number; depth: number };
/** A real OSM barrier (estate gate, lift gate, bollards…) sitting on a road. `dx,dy` is the road's unit direction. */
export type Barrier = { id: string; roadId: string; kind: string; position: Point; dx: number; dy: number; width: number };
/** Named place from OSM: a bus stop, a landmark (market, mall, stadium…), a neighbourhood, or a local
 * "spot" people give directions by (filling station, church/mosque, school, bank). */
export type Place = { name: string; kind: "bus_stop" | "landmark" | "area" | "spot"; x: number; y: number };
/** A go-slow hotspot: stopped traffic fills the main roads within `radius` metres when go-slow is on. */
export type Jam = { name: string; x: number; y: number; radius: number };
/** Estate-style gates get a boom and a gateman's hut; everything else is drawn as striped road blocks. */
export const GATE_KINDS = new Set(["gate", "lift_gate", "swing_gate", "sliding_gate", "toll_booth", "border_control"]);

/** Axis-aligned in its own frame, rotated by `angle` (radians, counter-clockwise from +x). */
export type Building = { x: number; y: number; w: number; d: number; h: number; angle: number; wall: number; roof: number };
/** kind 0 = broadleaf, 1 = palm */
export type Tree = { x: number; y: number; h: number; kind: number };

export type MapData = {
  schemaVersion: 2;
  generatedAt: string;
  source: { attribution: string; licence: string; provider: string };
  area: { slug: string; name: string; seed: string };
  /** The LCDA(s) this map covers; a combined map lists each, for races between LCDAs. */
  regions?: Region[];
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  mainComponent: number;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  roads: Road[];
  potholes: Pothole[];
  /** Missing on maps built before barriers were added. */
  barriers?: Barrier[];
  /** Missing on older maps. */
  places?: Place[];
  jams?: Jam[];
  buildings: Building[];
  trees: Tree[];
  footbridges: Footbridge[];
  water: Waterway[];
};

export const MAJOR_HIGHWAYS = new Set(["motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link", "primary_link", "secondary_link"]);

/** Deck height of a road bridge at `d` metres along a bridge `length` long: long bridges/flyovers
 * rise on ramps; short creek bridges get a gentle hump. Visual only: the driving sim is 2D. */
export function bridgeElevation(road: Pick<Road, "bridge" | "layer">, d: number, length: number) {
  if (!road.bridge) return 0;
  const long = length > 60;
  const height = long ? 6 * Math.max(1, road.layer || 1) : 0.8;
  const ramp = long ? Math.min(70, length * 0.35) : length / 2;
  const k = Math.max(0, Math.min(1, Math.min(d, length - d) / (ramp || 1)));
  return height * k * k * (3 - 2 * k);
}

/** Which LCDA a point falls in (first match; boxes can overlap slightly at borders). */
export function regionAt(map: Pick<MapData, "regions">, p: Point) {
  return map.regions?.findIndex((r) => p.x >= r.bounds.minX && p.x <= r.bounds.maxX && p.y >= r.bounds.minY && p.y <= r.bounds.maxY) ?? -1;
}
