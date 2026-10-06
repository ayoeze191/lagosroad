import { POLICE_CAR, type CarSpec } from "./cars.js";
import { distancesFrom, type Graph } from "./route.js";
import { createCarState, headingTowards, stepCar, STEP, type CarState, type StepEvents } from "./sim.js";
import type { MapIndex } from "./spatial.js";
import type { Traffic } from "./traffic.js";
import type { Point } from "./types.js";

/**
 * Street law, Lagos style. Runs on the server in races and in the browser in free drive.
 *
 * Police: rough driving (crashing into traffic, scaring pedestrians, hitting walls) builds heat, and
 * knocking someone down maxes it out. Enough heat and a police interceptor (faster than any car in the
 * garage) chases you along the roads and rams you; stay close to it while slow and you're BUSTED (held
 * for a few seconds). Dodge it and get far enough away for long enough and they give up.
 *
 * Agbero: danfo drivers passing a bus stop must stop and pay the agbero. Drive off without paying
 * and he jumps on an okada and chases you; if he catches you, you're held while you "pay double".
 */
export const HEAT = { crash: 30, nearMiss: 18, wall: 8, pedestrian: 100, wanted: 60, max: 100, decay: 4 };
export const BUSTED_SECONDS = 5, AGBERO_HOLD_SECONDS = 5;
const CATCH_RADIUS = 7, CATCH_SECONDS = 1.2, ESCAPE_DISTANCE = 320, ESCAPE_SECONDS = 6, SPAWN_DISTANCE = 130;
/** A police car that touches you rams you: you lose this share of your speed (once per RAM_COOLDOWN). */
const RAM_RADIUS = 2.6, RAM_LOSS = 0.5, RAM_COOLDOWN = 1.5;
const DEMAND_RADIUS = 16, PAY_SECONDS = 1, SKIP_RADIUS = 35;

const AGBERO_BIKE: CarSpec = { ...POLICE_CAR, id: "agbero", name: "Agbero", body: "bike", topSpeed: 34, acceleration: 10, handling: 10, potholeResistance: 8, length: 2.1, width: 0.8 };

export type ChaserKind = "police" | "agbero";
export type Chaser = { kind: ChaserKind; car: CarState; spec: CarSpec; waypoint?: Point; replanIn: number; stuckFor: number; catching: number; escaping: number; rammedAt?: number };
/** Who is holding you: "" when free. */
export type Holder = "" | ChaserKind;

export class Law {
  heat = 0;
  /** Seconds left being held (busted by police or caught by the agbero). */
  held = 0;
  heldBy: Holder = "";
  police?: Chaser;
  agbero?: Chaser;
  /** Bus stop currently demanding money (danfo only). */
  demand?: { id: string; x: number; y: number; paying: number };
  /** One-off happenings for sound and HUD ("chase", "escaped", "busted", "paid", "agbero", "agbero-caught", "agbero-gone"); the caller clears it. */
  news: string[] = [];
  private recent = new Map<string, number>();
  private paid = new Map<string, number>();
  private clock = 0;

  constructor(private index: MapIndex, private graph: Graph, private traffic?: Traffic) {}

  /** Feed the events from one simulation step. */
  record(events: StepEvents, time: number) {
    if (this.recent.size > 64) for (const [k, t] of this.recent) if (t < time - 10) this.recent.delete(k);
    const bump = (id: string, amount: number) => {
      if ((this.recent.get(id) ?? -99) > time - 3) return; // count each incident once
      this.recent.set(id, time);
      this.heat = Math.min(HEAT.max, this.heat + amount);
    };
    if (events.traffic) bump(events.traffic, HEAT.crash);
    if (events.nearMiss) bump(events.nearMiss, HEAT.nearMiss);
    if (events.wall) bump(`wall${Math.floor(time)}`, HEAT.wall);
    if (events.pedestrian) bump(events.pedestrian, HEAT.pedestrian);
  }

  /** Advance chasers and heat by `dt` seconds (call once per network input: 3 sim steps). */
  update(dt: number, player: CarState, isDanfo: boolean) {
    this.clock += dt;
    if (this.held > 0) {
      this.held = Math.max(0, this.held - dt);
      if (!this.held) this.heldBy = "";
      return;
    }
    // Police.
    if (!this.police) {
      if (this.heat >= HEAT.wanted) { this.police = this.spawnChaser("police", POLICE_CAR, this.behind(player, SPAWN_DISTANCE), player); this.news.push("chase"); }
      else this.heat = Math.max(0, this.heat - HEAT.decay * dt);
    } else {
      this.ram(this.police, player);
      const outcome = this.chase(this.police, player, dt, 9);
      if (outcome === "caught") { this.hold("police", BUSTED_SECONDS); this.heat = 0; this.police = undefined; this.news.push("busted"); return; }
      if (outcome === "escaped") { this.police = undefined; this.heat = 25; this.news.push("escaped"); }
    }
    // Agbero.
    if (isDanfo) this.agberoCheck(player, dt);
    if (this.agbero) {
      const outcome = this.chase(this.agbero, player, dt, 12);
      if (outcome === "caught") { this.hold("agbero", AGBERO_HOLD_SECONDS); this.agbero = undefined; this.news.push("agbero-caught"); }
      else if (outcome === "escaped") { this.agbero = undefined; this.news.push("agbero-gone"); }
    }
  }

  /** Police contact: both cars bounce apart and you lose half your speed ("rammed" news for sound/shake). */
  private ram(c: Chaser, player: CarState) {
    const dx = player.x - c.car.x, dy = player.y - c.car.y, d = Math.hypot(dx, dy);
    if (d > RAM_RADIUS || d < 0.01 || (c.rammedAt ?? -99) > this.clock - RAM_COOLDOWN) return;
    c.rammedAt = this.clock;
    player.speed *= 1 - RAM_LOSS;
    player.x += dx / d * (RAM_RADIUS - d);
    player.y += dy / d * (RAM_RADIUS - d);
    c.car.speed *= 0.7;
    this.news.push("rammed");
  }

  private hold(by: ChaserKind, seconds: number) {
    this.held = seconds;
    this.heldBy = by;
  }

  private agberoCheck(player: CarState, dt: number) {
    if (!this.traffic || this.agbero) return;
    if (this.demand) {
      const d = Math.hypot(player.x - this.demand.x, player.y - this.demand.y);
      this.demand.paying = d < DEMAND_RADIUS && Math.abs(player.speed) < 3 ? this.demand.paying + dt : 0;
      if (this.demand.paying >= PAY_SECONDS) {
        this.paid.set(this.demand.id, this.clock);
        this.demand = undefined;
        this.news.push("paid");
      } else if (d > SKIP_RADIUS) {
        // Drove off without paying: here he comes on an okada.
        const post = this.demand;
        this.paid.set(post.id, this.clock); // he won't ask twice; he'll chase instead
        this.demand = undefined;
        this.agbero = this.spawnChaser("agbero", AGBERO_BIKE, post, player);
        this.news.push("agbero");
      }
      return;
    }
    for (const post of this.traffic.agberoPosts) {
      if (Math.abs(post.x - player.x) > DEMAND_RADIUS || Math.abs(post.y - player.y) > DEMAND_RADIUS) continue;
      if ((this.paid.get(post.id) ?? -999) > this.clock - 90) continue;
      if (Math.hypot(post.x - player.x, post.y - player.y) < DEMAND_RADIUS) { this.demand = { id: post.id, x: post.x, y: post.y, paying: 0 }; return; }
    }
  }

  private behind(player: CarState, distance: number): Point {
    // A junction roughly behind the player, on the main network.
    const behind = { x: player.x - Math.sin(player.heading) * distance, y: player.y - Math.cos(player.heading) * distance };
    const nodes = this.index.map.graph.nodes;
    let best: Point = behind, bestD = Infinity;
    for (const n of nodes) {
      if (n.component !== this.index.map.mainComponent) continue;
      const d = Math.hypot(n.position.x - behind.x, n.position.y - behind.y);
      if (d < bestD) { bestD = d; best = n.position; }
    }
    return best;
  }

  private spawnChaser(kind: ChaserKind, spec: CarSpec, at: Point, player: CarState): Chaser {
    return { kind, spec, car: createCarState(at, headingTowards(at, player)), replanIn: 0, stuckFor: 0, catching: 0, escaping: 0 };
  }

  /** Drive a chaser and report whether it caught the player or lost them. */
  private chase(c: Chaser, player: CarState, dt: number, catchSpeed: number): "caught" | "escaped" | undefined {
    this.drive(c, player, dt);
    const d = Math.hypot(c.car.x - player.x, c.car.y - player.y);
    c.catching = d < CATCH_RADIUS && Math.abs(player.speed) < catchSpeed ? c.catching + dt : Math.max(0, c.catching - dt);
    if (c.catching >= CATCH_SECONDS) return "caught";
    c.escaping = d > ESCAPE_DISTANCE ? c.escaping + dt : 0;
    return c.escaping >= ESCAPE_SECONDS ? "escaped" : undefined;
  }

  /** Follow the road network towards the player, and go straight for them when close. */
  private drive(c: Chaser, player: CarState, dt: number) {
    const d = Math.hypot(c.car.x - player.x, c.car.y - player.y);
    c.replanIn -= dt;
    if (d < 45) {
      c.waypoint = { x: player.x + Math.sin(player.heading) * player.speed * 0.4, y: player.y + Math.cos(player.heading) * player.speed * 0.4 };
    } else if (c.replanIn <= 0 || !c.waypoint || Math.hypot(c.waypoint.x - c.car.x, c.waypoint.y - c.car.y) < 10) {
      c.replanIn = 1;
      c.waypoint = this.nextWaypoint(c.car, player);
    }
    const target = c.waypoint || player;
    let diff = headingTowards(c.car, target) - c.car.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // Unstick: reverse briefly if pinned against something.
    c.stuckFor = Math.abs(c.car.speed) < 1.5 ? c.stuckFor + dt : 0;
    const reversing = c.stuckFor > 1.5 && c.stuckFor < 2.6;
    if (c.stuckFor >= 2.6) c.stuckFor = 0;
    const controls = reversing
      ? { throttle: -1, steer: -Math.sign(diff) }
      : { throttle: Math.abs(diff) > 0.9 ? 0.35 : 1, steer: Math.max(-1, Math.min(1, diff * 2.2)) };
    for (let t = 0; t < dt - 1e-6; t += STEP) stepCar(c.car, controls, c.spec, this.index);
  }

  private nextWaypoint(from: Point, to: Point): Point {
    const nodes = this.index.map.graph.nodes, g = this.graph;
    const nearestNode = (p: Point) => {
      const hit = this.index.roads.nearest(p, 80);
      if (!hit) return -1;
      const e = this.index.map.graph.edges[hit.road];
      return g.nodeIndex.get(hit.t < 0.5 ? e.from : e.to) ?? -1;
    };
    const target = nearestNode(to), here = nearestNode(from);
    if (target < 0 || here < 0 || here === target) return to;
    const hp = nodes[here].position;
    if (Math.hypot(hp.x - from.x, hp.y - from.y) > 14) return hp;
    const dist = distancesFrom(g, target);
    let best = g.adjacency[here][0];
    if (!best) return to;
    for (const l of g.adjacency[here]) if (dist[l.to] + l.length < dist[best.to] + best.length) best = l;
    // Aim along the road rather than cutting the corner through buildings.
    const road = this.index.map.roads[best.edge], edge = this.index.map.graph.edges[best.edge];
    const pts = edge.from === nodes[here].id ? road.points : [...road.points].reverse();
    const next = pts[1];
    return next && Math.hypot(next.x - from.x, next.y - from.y) > 10 ? next : nodes[best.to].position;
  }
}
