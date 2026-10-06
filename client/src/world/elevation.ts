import type { MapIndex } from "../../../shared/spatial.js";
import { bridgeElevation, type Point } from "../../../shared/types.js";

const hasBridges = new WeakMap<MapIndex, boolean>();

/**
 * Visual height of something driving at `p`: on a bridge deck it rides the deck, otherwise it's on
 * the ground. `previous` keeps a car that's driving *under* a flyover from popping up onto it.
 * (The driving simulation itself is flat; bridges are purely visual.)
 */
export function elevationAt(index: MapIndex, p: Point, previous = 0): number {
  const roads = index.map.roads;
  let has = hasBridges.get(index);
  if (has === undefined) { has = roads.some((r) => r.bridge); hasBridges.set(index, has); }
  if (!has) return 0;
  const hit = index.roads.nearest(p, 12, (r) => !!roads[r].bridge);
  if (!hit || hit.edge > 0.5) return 0;
  const length = index.roads.roadLengths[hit.road];
  const elev = bridgeElevation(roads[hit.road], hit.t * length, length);
  // Only climb onto a high deck from its ramp (or if we were already up there).
  return elev < 1.5 || previous > 0.5 ? elev : 0;
}
