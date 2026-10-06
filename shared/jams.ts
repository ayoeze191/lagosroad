import { TRAFFIC_RADIUS, type TrafficKind } from "./traffic.js";
import { MAJOR_HIGHWAYS, type MapData } from "./types.js";

/** One stopped vehicle in a go-slow. `heading`: 0 = north, clockwise. */
export type JamCar = { id: string; x: number; y: number; heading: number; kind: TrafficKind; colour: number; radius: number };

const SPACING = 7.5, LANE = 3.4, MAX_PER_JAM = 420;
const JAMMED_ROADS = new Set([...MAJOR_HIGHWAYS, "tertiary", "tertiary_link"]);

/** Integer hash of a position (no trig), so browser and server place exactly the same cars. */
function hash(x: number, y: number, salt: number) {
  let h = (Math.round(x * 10) * 73856093) ^ (Math.round(y * 10) * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const cache = new WeakMap<MapData, JamCar[]>();

/**
 * Go-slow traffic: the main roads around each hotspot (Ojota, Oshodi, Mile 12…) fill with stopped
 * danfos, cars and kekes, lane by lane in both directions, thinning out towards the edge of the jam,
 * with the odd gap to squeeze through. Pure function of the map.
 */
export function jamCars(map: MapData): JamCar[] {
  let cars = cache.get(map);
  if (cars) return cars;
  cars = [];
  for (const [j, jam] of (map.jams || []).entries()) {
    const start = cars.length;
    for (const road of map.roads) {
      if (!JAMMED_ROADS.has(road.highway) || road.bridge || cars.length - start >= MAX_PER_JAM) continue;
      if (!road.points.some((p) => Math.abs(p.x - jam.x) < jam.radius + 60 && Math.abs(p.y - jam.y) < jam.radius + 60)) continue;
      const perSide = Math.max(1, Math.floor(road.width / 2 / LANE));
      let carry = 0;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) continue;
        const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, heading = Math.atan2(dx, dy);
        for (let t = carry; t < len; t += SPACING) {
          const cx = a.x + dx * t, cy = a.y + dy * t, d = Math.hypot(cx - jam.x, cy - jam.y);
          if (d > jam.radius || d < 9) continue; // the junction box itself stays (just about) passable
          for (const side of [1, -1]) for (let lane = 0; lane < perSide; lane++) {
            const off = (lane + 0.5) * (road.width / 2) / perSide;
            const x = cx + dy * off * side, y = cy - dx * off * side;
            const r = hash(x, y, j);
            if (r < 0.16 + 0.55 * (d / jam.radius) ** 2) continue; // gaps, thinning out at the edges
            const k = hash(x, y, j + 101);
            const kind: TrafficKind = k < 0.36 ? "danfo" : k < 0.82 ? "car" : k < 0.93 ? "keke" : "okada";
            cars.push({ id: `jam${j}-${cars.length}`, x: +x.toFixed(2), y: +y.toFixed(2), heading: side > 0 ? heading : heading + Math.PI, kind, colour: Math.floor(hash(x, y, j + 202) * 16), radius: TRAFFIC_RADIUS[kind] });
          }
        }
        carry = (carry - len) % SPACING;
        if (carry < 0) carry += SPACING;
      }
    }
  }
  cache.set(map, cars);
  return cars;
}
