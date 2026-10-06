import { jamCars, type JamCar } from "./jams.js";
import type { Barrier, Building, MapData, Point, Pothole, Road } from "./types.js";

const CELL = 40;
const cellOf = (v: number) => Math.floor(v / CELL);
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

type Segment = { ax: number; ay: number; bx: number; by: number; half: number; road: number; along: number; length: number };
export type RoadHit = {
  road: number;
  /** Distance from the centreline. */
  distance: number;
  /** Distance outside the road edge (negative = on the tarmac). */
  edge: number;
  /** Fraction (0..1) along the whole road polyline. */
  t: number;
  /** Unit direction of the nearest segment. */
  dx: number;
  dy: number;
  /** Closest point on the centreline. */
  px: number;
  py: number;
};

/** Uniform grid over road segments for fast nearest-road queries. */
export class RoadGrid {
  private cells = new Map<number, number[]>();
  private segments: Segment[] = [];
  readonly roadLengths: number[] = [];

  constructor(roads: Pick<Road, "points" | "width">[]) {
    roads.forEach((road, r) => {
      let along = 0;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const seg: Segment = { ax: a.x, ay: a.y, bx: b.x, by: b.y, half: road.width / 2, road: r, along, length };
        along += length;
        const id = this.segments.push(seg) - 1;
        const pad = seg.half + 1;
        for (let cx = cellOf(Math.min(a.x, b.x) - pad); cx <= cellOf(Math.max(a.x, b.x) + pad); cx++)
          for (let cy = cellOf(Math.min(a.y, b.y) - pad); cy <= cellOf(Math.max(a.y, b.y) + pad); cy++) {
            const k = key(cx, cy);
            const list = this.cells.get(k);
            if (list) list.push(id); else this.cells.set(k, [id]);
          }
      }
      this.roadLengths[r] = along;
    });
  }

  /** Nearest road (by edge distance) within `radius` metres, or undefined. */
  nearest(p: Point, radius = 30, accept?: (road: number) => boolean): RoadHit | undefined {
    let best: RoadHit | undefined;
    const r = Math.ceil(radius / CELL), pcx = cellOf(p.x), pcy = cellOf(p.y);
    const seen = new Set<number>();
    for (let cx = pcx - r; cx <= pcx + r; cx++)
      for (let cy = pcy - r; cy <= pcy + r; cy++) {
        const list = this.cells.get(key(cx, cy));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          const s = this.segments[id];
          if (accept && !accept(s.road)) continue;
          const dx = s.bx - s.ax, dy = s.by - s.ay, len2 = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len2));
          const distance = Math.hypot(p.x - (s.ax + u * dx), p.y - (s.ay + u * dy));
          const edge = distance - s.half;
          if (distance > radius || (best && edge >= best.edge)) continue;
          const total = this.roadLengths[s.road] || 1;
          const len = s.length || 1;
          best = { road: s.road, distance, edge, t: (s.along + u * s.length) / total, dx: dx / len, dy: dy / len, px: s.ax + u * dx, py: s.ay + u * dy };
        }
      }
    return best;
  }
}

/** Grid of items with a centre and a bounding radius. */
export class PointGrid<T> {
  private cells = new Map<number, T[]>();
  constructor(items: T[], centre: (item: T) => Point, radius: (item: T) => number) {
    for (const item of items) {
      const c = centre(item), rad = radius(item);
      for (let cx = cellOf(c.x - rad); cx <= cellOf(c.x + rad); cx++)
        for (let cy = cellOf(c.y - rad); cy <= cellOf(c.y + rad); cy++) {
          const k = key(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(item); else this.cells.set(k, [item]);
        }
    }
  }
  /** Items whose bounding region may overlap the cell containing `p` (and neighbours when `wide`). */
  near(p: Point, wide = false): T[] {
    const cx = cellOf(p.x), cy = cellOf(p.y);
    if (!wide) return this.cells.get(key(cx, cy)) || [];
    const out: T[] = [];
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      const list = this.cells.get(key(x, y));
      if (list) for (const item of list) out.push(item);
    }
    return out;
  }
  add(item: T, c: Point, rad: number) {
    for (let cx = cellOf(c.x - rad); cx <= cellOf(c.x + rad); cx++)
      for (let cy = cellOf(c.y - rad); cy <= cellOf(c.y + rad); cy++) {
        const k = key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(item); else this.cells.set(k, [item]);
      }
  }
}

export const buildingRadius = (b: Building) => Math.hypot(b.w, b.d) / 2;

/** Everything the driving simulation needs to query a map quickly. Build once per map. */
export class MapIndex {
  readonly roads: RoadGrid;
  readonly potholes: PointGrid<Pothole>;
  readonly barriers: PointGrid<Barrier>;
  readonly buildings: PointGrid<Building>;
  /** Stopped go-slow traffic (empty unless `goSlow`). */
  readonly jams: PointGrid<JamCar>;
  /** `potholes: false` gives smooth roads; `goSlow: true` fills the hotspots with stopped traffic. */
  constructor(readonly map: MapData, options: { potholes?: boolean; goSlow?: boolean } = {}) {
    this.jams = new PointGrid(options.goSlow ? jamCars(map) : [], (c) => c, (c) => c.radius + 0.5);
    this.roads = new RoadGrid(map.roads);
    this.potholes = new PointGrid(options.potholes === false ? [] : map.potholes, (p) => p.position, (p) => p.radius + 1);
    this.barriers = new PointGrid(map.barriers || [], (b) => b.position, (b) => b.width / 2 + 2);
    this.buildings = new PointGrid(map.buildings, (b) => b, buildingRadius);
  }
}
