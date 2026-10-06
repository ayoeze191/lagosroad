import type { MapData } from "../../../shared/types.js";

/** A spot to show a street's name: roadside position plus the road's direction. */
export type LabelAnchor = { name: string; x: number; y: number; angle: number; major: boolean };

const SPACING = 180; // metres between repeated labels of the same street
const MIN_GAP = 140; // never two labels of the same street closer than this

const cache = new WeakMap<MapData, LabelAnchor[]>();

/** Evenly spaced name anchors along every named road, de-duplicated per street. */
export function labelAnchors(map: MapData): LabelAnchor[] {
  const cached = cache.get(map);
  if (cached) return cached;
  const anchors: LabelAnchor[] = [];
  const byName = new Map<string, LabelAnchor[]>();
  for (const road of map.roads) {
    if (!road.name || road.name === "Unnamed road") continue;
    const pts = road.points;
    const length = pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    if (length < 25) continue;
    const targets: number[] = [];
    if (length < SPACING) targets.push(length / 2);
    else for (let t = 40; t < length - 20; t += SPACING) targets.push(t);
    let travelled = 0, target = 0;
    for (let i = 1; i < pts.length && target < targets.length; i++) {
      const a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (target < targets.length && travelled + seg >= targets[target]) {
        const k = seg ? (targets[target] - travelled) / seg : 0;
        const dx = seg ? (b.x - a.x) / seg : 1, dy = seg ? (b.y - a.y) / seg : 0;
        const side = road.width / 2 + 1.4; // stand on the right-hand verge
        const anchor = { name: road.name, x: a.x + (b.x - a.x) * k + dy * side, y: a.y + (b.y - a.y) * k - dx * side, angle: Math.atan2(dy, dx), major: road.width >= 10 };
        const same = byName.get(road.name) || [];
        if (!same.some((o) => Math.hypot(o.x - anchor.x, o.y - anchor.y) < MIN_GAP)) {
          same.push(anchor);
          byName.set(road.name, same);
          anchors.push(anchor);
        }
        target++;
      }
      travelled += seg;
    }
  }
  cache.set(map, anchors);
  return anchors;
}
