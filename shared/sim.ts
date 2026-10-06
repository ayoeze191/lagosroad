import type { CarSpec } from "./cars.js";
import { buildingRadius, type MapIndex } from "./spatial.js";
import type { Traffic } from "./traffic.js";
import type { Barrier, Point, Pothole } from "./types.js";

/** Fixed simulation step shared by client prediction and the server. */
export const STEP = 1 / 60;
/** Each network input message drives this many steps (60 Hz / 3 = 20 inputs per second). */
export const STEPS_PER_INPUT = 3;

export type Controls = { throttle: number; steer: number };
export type CarState = {
  x: number;
  y: number;
  /** Radians; 0 faces north (+y), positive turns clockwise (towards +x). */
  heading: number;
  /** Signed forward speed in m/s. */
  speed: number;
  /** Smoothed steering input. */
  steer: number;
  offRoad: boolean;
  lastHole: string;
};
/** traffic / nearMiss carry the id of the vehicle hit or pedestrian scared. */
/** `pedestrian` is the id of someone you knocked down (the police come straight for you). */
export type StepEvents = { pothole?: Pothole; barrier?: Barrier; wall?: boolean; traffic?: string; nearMiss?: string; pedestrian?: string };
/** Hitting a pedestrian faster than this (m/s, ~15 km/h) knocks them down. */
export const PEDESTRIAN_HIT_SPEED = 4;

/** Below this speed (m/s, about 25 km/h) the gateman lifts the boom for you; faster and you smash through it. */
export const GATE_SAFE_SPEED = 7;
/** Moving things the car can interact with; `time` is the racer's own sim clock in seconds. */
export type Surroundings = { traffic: Traffic; time: number };

export const CAR_RADIUS = 1.1;

export function createCarState(position: Point, heading: number): CarState {
  return { x: position.x, y: position.y, heading, speed: 0, steer: 0, offRoad: false, lastHole: "" };
}

export function copyCarState(s: CarState): CarState {
  return { ...s };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Advance one fixed step. Pure arcade model: no tyre physics, tuned to feel good on a phone. */
export function stepCar(s: CarState, input: Controls, car: CarSpec, index: MapIndex, events?: StepEvents, world?: Surroundings) {
  const dt = STEP;
  const throttle = clamp(input.throttle, -1, 1);
  const steerInput = clamp(input.steer, -1, 1);

  // Steering eases in so keyboard taps don't snap the car around.
  const steerRate = 5 + car.handling * 0.5;
  s.steer += clamp(steerInput - s.steer, -steerRate * dt, steerRate * dt);

  const road = index.roads.nearest(s, 25);
  s.offRoad = !road || road.edge > 0.4;
  const paved = road ? index.map.roads[road.road].paved : false;
  let top = car.topSpeed * (s.offRoad ? 0.32 : paved ? 1 : 0.82);

  // Throttle / brake / reverse.
  const abs = Math.abs(s.speed);
  if (throttle > 0) {
    if (s.speed < -0.5) s.speed += 16 * dt;
    else s.speed += car.acceleration * throttle * Math.max(0, 1 - (s.speed / top) ** 2) * dt;
  } else if (throttle < 0) {
    if (s.speed > 0.5) s.speed -= 15 * dt;
    else s.speed = Math.max(-8, s.speed - 4 * dt);
  } else {
    const drag = (1.1 + 0.012 * abs * abs) * dt;
    s.speed = abs <= drag ? 0 : s.speed - Math.sign(s.speed) * drag;
  }
  // Leaving the road (or cruising faster than the surface allows) bleeds speed quickly.
  if (s.speed > top) s.speed = Math.max(top, s.speed - (s.speed - top) * 2.6 * dt - (s.offRoad ? 6 * dt : 0));

  // Yaw: needs some speed to turn, and tightens less at high speed.
  const speedFactor = Math.min(1, Math.abs(s.speed) / 5) * (1 - 0.45 * Math.min(1, Math.abs(s.speed) / car.topSpeed));
  const maxYaw = 1.5 + car.handling * 0.13;
  s.heading += s.steer * maxYaw * speedFactor * Math.sign(s.speed || 1) * dt;
  if (s.heading > Math.PI) s.heading -= Math.PI * 2;
  else if (s.heading < -Math.PI) s.heading += Math.PI * 2;

  s.x += Math.sin(s.heading) * s.speed * dt;
  s.y += Math.cos(s.heading) * s.speed * dt;

  // Barriers (estate gates, bollards): crawl through and the gateman lets you pass; ram them and you
  // lose a lot of speed and the police notice. `lastHole` also remembers the barrier, so it only hits once.
  let inHole = "";
  for (const b of index.barriers.near(s)) {
    const rx = s.x - b.position.x, ry = s.y - b.position.y;
    const along = rx * b.dx + ry * b.dy, across = -rx * b.dy + ry * b.dx;
    if (Math.abs(along) > CAR_RADIUS + 0.5 || Math.abs(across) > b.width / 2 + 0.6) continue;
    inHole = b.id;
    if (b.id !== s.lastHole && Math.abs(s.speed) > GATE_SAFE_SPEED) {
      s.speed *= 1 - clamp(0.62 - 0.03 * car.potholeResistance, 0.3, 0.6);
      if (events) { events.barrier = b; events.wall = true; }
    }
    break;
  }

  // Potholes: a sharp speed cut, scaled by depth and the car's suspension.
  if (!inHole) for (const hole of index.potholes.near(s)) {
    if (Math.hypot(s.x - hole.position.x, s.y - hole.position.y) > hole.radius + CAR_RADIUS * 0.7) continue;
    inHole = hole.id;
    if (hole.id !== s.lastHole && Math.abs(s.speed) > 3) {
      const depthFactor = 0.7 + (hole.depth - 0.035) / 0.11 * 0.6;
      const cut = clamp((0.58 - 0.045 * car.potholeResistance) * depthFactor, 0.08, 0.7);
      s.speed *= 1 - cut;
      if (events) events.pothole = hole;
    }
    break;
  }
  s.lastHole = inHole;

  // Buildings are solid: push the car out and scrub most of its speed.
  for (const b of index.buildings.near(s)) {
    if (Math.hypot(s.x - b.x, s.y - b.y) > buildingRadius(b) + CAR_RADIUS) continue;
    const c = Math.cos(b.angle), sn = Math.sin(b.angle);
    const lx = (s.x - b.x) * c + (s.y - b.y) * sn, ly = -(s.x - b.x) * sn + (s.y - b.y) * c;
    const px = b.w / 2 + CAR_RADIUS - Math.abs(lx), py = b.d / 2 + CAR_RADIUS - Math.abs(ly);
    if (px <= 0 || py <= 0) continue;
    let ox = 0, oy = 0;
    if (px < py) ox = Math.sign(lx || 1) * px; else oy = Math.sign(ly || 1) * py;
    s.x += ox * c - oy * sn;
    s.y += ox * sn + oy * c;
    if (Math.abs(s.speed) > 2) { s.speed *= 0.35; if (events) events.wall = true; }
  }

  // Traffic is solid: bounce off and lose most of your speed. Pedestrians always jump clear,
  // but tearing past them counts as a near miss (and the police notice).
  if (world) {
    world.traffic.vehiclesNear(s, world.time, 4, (v, pose) => {
      const dx = s.x - pose.x, dy = s.y - pose.y, d = Math.hypot(dx, dy), min = v.radius + CAR_RADIUS;
      if (d >= min) return;
      const nx = d > 0.01 ? dx / d : Math.sin(pose.heading + Math.PI / 2), ny = d > 0.01 ? dy / d : Math.cos(pose.heading + Math.PI / 2);
      s.x += nx * (min - d);
      s.y += ny * (min - d);
      if (Math.abs(s.speed) > 3) { s.speed *= 0.4; if (events) events.traffic = v.id; }
    });
    if (Math.abs(s.speed) > PEDESTRIAN_HIT_SPEED) world.traffic.walkersNear(s, world.time, 3, (w, pose) => {
      const d = Math.hypot(s.x - pose.x, s.y - pose.y);
      if (d < CAR_RADIUS + 0.35) {
        if (events && !events.pedestrian) { events.pedestrian = w.id; s.speed *= 0.82; }
      } else if (d < 2.6 && Math.abs(s.speed) > 9 && events) events.nearMiss = w.id;
    });
  }

  // Go-slow: stopped cars are solid. Nudge through the gaps or find another road.
  for (const c of index.jams.near(s)) {
    const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy), min = c.radius + CAR_RADIUS;
    if (d >= min) continue;
    const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
    s.x += nx * (min - d);
    s.y += ny * (min - d);
    if (Math.abs(s.speed) > 3) { s.speed *= 0.45; if (events) events.wall = true; }
  }

  const e = index.map.extent;
  s.x = clamp(s.x, e.minX - 50, e.maxX + 50);
  s.y = clamp(s.y, e.minY - 50, e.maxY + 50);
}

/** Heading that faces from `a` towards `b`. */
export const headingTowards = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.y - a.y);
