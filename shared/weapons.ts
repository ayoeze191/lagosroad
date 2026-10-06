import type { CarSpec } from "./cars.js";
import { buildingRadius, type MapIndex } from "./spatial.js";
import type { Point } from "./types.js";

/**
 * Multiplayer car combat. Only some cars can carry weapons (CarSpec.weapon); the player chooses
 * armed/unarmed in the garage and the race host can switch weapons off. Shots are hit-scan along
 * the car's heading: the server decides every hit with `findTarget`, and the client uses the same
 * function to draw its lock-on crosshair, so what you see locked is what the server will hit.
 */
export type WeaponKind = "turret" | "conductor" | "escort";
export type WeaponStats = {
  label: string;
  /** Metres. */
  range: number;
  /** Half-angle of the aim cone, radians. */
  cone: number;
  /** Seconds between shots. */
  cooldown: number;
  magazine: number;
  /** Seconds to get one round back. */
  reload: number;
  damage: number;
  /** Share of the target's speed lost per hit. */
  speedLoss: number;
};

export const WEAPONS: Record<WeaponKind, WeaponStats> = {
  turret: { label: "Roof turret", range: 85, cone: 0.32, cooldown: 0.22, magazine: 12, reload: 0.9, damage: 12, speedLoss: 0.18 },
  conductor: { label: "Conductor's gun", range: 55, cone: 0.45, cooldown: 0.6, magazine: 6, reload: 1.6, damage: 25, speedLoss: 0.35 },
  escort: { label: "Escort's gun", range: 70, cone: 0.26, cooldown: 0.4, magazine: 8, reload: 1.2, damage: 18, speedLoss: 0.28 }
};

export const MAX_HEALTH = 100, WRECK_SECONDS = 3;

export const weaponOf = (spec: Pick<CarSpec, "weapon">) => (spec.weapon ? WEAPONS[spec.weapon] : undefined);

export type Shooter = Point & { heading: number };
export type Target = Point & { id: string };

/** True if no building stands between a and b (sampled every 3 m). */
export function lineOfSight(index: MapIndex, a: Point, b: Point) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(d / 3);
  for (let i = 1; i < steps; i++) {
    const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
    for (const bld of index.buildings.near(p)) {
      if (Math.hypot(p.x - bld.x, p.y - bld.y) > buildingRadius(bld)) continue;
      const c = Math.cos(bld.angle), s = Math.sin(bld.angle);
      const lx = (p.x - bld.x) * c + (p.y - bld.y) * s, ly = -(p.x - bld.x) * s + (p.y - bld.y) * c;
      if (Math.abs(lx) < bld.w / 2 && Math.abs(ly) < bld.d / 2) return false;
    }
  }
  return true;
}

/** The target the shooter's sights are on: inside the aim cone and range, in clear view, best aligned. */
export function findTarget(index: MapIndex, shooter: Shooter, weapon: WeaponStats, targets: Target[]): Target | undefined {
  let best: Target | undefined, bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - shooter.x, dy = t.y - shooter.y, d = Math.hypot(dx, dy);
    if (d > weapon.range || d < 1) continue;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dy) - shooter.heading), Math.cos(Math.atan2(dx, dy) - shooter.heading)));
    if (off > weapon.cone) continue;
    const score = off / weapon.cone + d / weapon.range;
    if (score < bestScore && lineOfSight(index, shooter, t)) { bestScore = score; best = t; }
  }
  return best;
}
