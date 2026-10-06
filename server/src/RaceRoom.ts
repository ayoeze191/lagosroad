import { Room, type Client } from "@colyseus/core";
import { carById, CARS, withPaint, type CarSpec } from "../../shared/cars.js";
import { Law } from "../../shared/police.js";
import { distancesFrom, remainingDistance, startHeading } from "../../shared/route.js";
import { createCarState, STEP, stepCar, STEPS_PER_INPUT, type CarState, type Controls, type StepEvents } from "../../shared/sim.js";
import { loadMap, raceIndex, type LoadedMap } from "./map.js";
import { findTarget, MAX_HEALTH, weaponOf, WRECK_SECONDS } from "../../shared/weapons.js";
import type { MapIndex } from "../../shared/spatial.js";
import { RaceState, Racer } from "./schema.js";

type CreateOptions = { lcda?: string; startNodeId?: string; finishNodeId?: string; name?: string; carId?: string; potholes?: boolean; goSlow?: boolean; weapons?: boolean; armed?: boolean; colour?: string };
type JoinOptions = { name?: string; carId?: string; colour?: string; armed?: boolean };
type InputMessage = { seq: number; throttle: number; steer: number };
type Sim = { car: CarState; spec: CarSpec; queue: InputMessage[]; tokens: number; law: Law; wantsArms: boolean; cooldown: number; reloadIn: number };

const TICK_MS = 50; // one input (= STEPS_PER_INPUT fixed steps) per tick
const COUNTDOWN_MS = 3000;
const FINISH_RADIUS = 14;
const CLOSE_AFTER_WINNER_MS = 30_000;
const MIN_ROUTE_METRES = 300;

const cleanName = (name: unknown) => (typeof name === "string" && name.trim() ? name.trim().slice(0, 16) : "Racer");
const finite = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = 8;
  state = new RaceState();
  private world!: LoadedMap;
  /** Sim index with or without potholes, as the host chose. */
  private index!: MapIndex;
  private toFinish!: Float64Array;
  private sims = new Map<string, Sim>();
  private startedAt = 0;
  private countdownEndsAt = 0;
  private closesAt = 0;

  async onCreate(options: CreateOptions) {
    const lcda = options.lcda || "ikorodu-west";
    this.world = await loadMap(lcda);
    this.state.potholes = options.potholes !== false;
    this.state.goSlow = options.goSlow === true;
    this.state.weapons = options.weapons !== false;
    this.index = raceIndex(this.world, this.state.potholes, this.state.goSlow);
    const { map, graph } = this.world;
    const mainNodes = map.graph.nodes.filter((n) => n.component === map.mainComponent);
    const start = map.graph.nodes.find((n) => n.id === options.startNodeId) || mainNodes[0];
    const finish = map.graph.nodes.find((n) => n.id === options.finishNodeId) || mainNodes.at(-1);
    if (!start || !finish) throw new Error("This map has no junctions to race between");
    this.toFinish = distancesFrom(graph, graph.nodeIndex.get(finish.id)!);
    const routeLength = this.toFinish[graph.nodeIndex.get(start.id)!];
    if (!Number.isFinite(routeLength)) throw new Error("Start and finish are not connected by road");
    if (routeLength < MIN_ROUTE_METRES) throw new Error(`Pick a finish at least ${MIN_ROUTE_METRES} m away by road`);

    Object.assign(this.state, {
      lcda,
      startNodeId: start.id, finishNodeId: finish.id,
      startX: start.position.x, startY: start.position.y,
      startHeading: startHeading(map, graph, this.toFinish, start.id),
      finishX: finish.position.x, finishY: finish.position.y,
      routeLength
    });
    this.setMetadata({ lcda });

    this.onMessage("input", (client, message: InputMessage) => {
      const sim = this.sims.get(client.sessionId), racer = this.state.players.get(client.sessionId);
      if (!sim || !racer || this.state.status !== "racing" || racer.finished) return;
      if (typeof message?.seq !== "number" || message.seq <= (sim.queue.at(-1)?.seq ?? racer.ack)) return;
      sim.queue.push({ seq: message.seq, throttle: finite(message.throttle, -1, 1), steer: finite(message.steer, -1, 1) });
      if (sim.queue.length > 12) sim.queue.splice(0, sim.queue.length - 12);
    });
    this.onMessage("fire", (client) => this.fire(client.sessionId));
    this.onMessage("ready", (client, ready: boolean) => {
      const racer = this.state.players.get(client.sessionId);
      if (!racer || this.state.status !== "lobby") return;
      racer.ready = !!ready;
      this.beginIfReady();
    });
    this.onMessage("car", (client, message: { carId: string; colour?: string; armed?: boolean }) => {
      const racer = this.state.players.get(client.sessionId), sim = this.sims.get(client.sessionId);
      if (!racer || !sim || this.state.status !== "lobby" || !CARS.some((c) => c.id === message?.carId)) return;
      sim.spec = withPaint(carById(message.carId), message.colour);
      sim.wantsArms = message.armed === true;
      racer.carId = sim.spec.id;
      racer.colour = sim.spec.colour;
      this.arm(racer, sim);
    });
    this.onMessage("rematch", (client) => {
      if (client.sessionId !== this.state.hostId || this.state.status !== "finished") return;
      this.resetToLobby();
    });

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  onJoin(client: Client, options: JoinOptions) {
    if (this.state.status !== "lobby") throw new Error("That race has already started");
    const spec = withPaint(carById(options?.carId), options?.colour);
    const racer = new Racer();
    Object.assign(racer, { sessionId: client.sessionId, name: cleanName(options?.name), carId: spec.id, colour: spec.colour, remaining: this.state.routeLength });
    this.state.players.set(client.sessionId, racer);
    const sim: Sim = { car: createCarState({ x: 0, y: 0 }, 0), spec, queue: [], tokens: 0, law: new Law(this.index, this.world.graph, this.world.traffic), wantsArms: options?.armed === true, cooldown: 0, reloadIn: 0 };
    this.sims.set(client.sessionId, sim);
    this.arm(racer, sim);
    this.placeOnGrid(racer, this.state.players.size - 1);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  async onDrop(client: Client) {
    const racer = this.state.players.get(client.sessionId);
    if (!racer || this.state.status === "lobby") return;
    racer.connected = false;
    await this.allowReconnection(client, 20);
  }

  onReconnect(client: Client) {
    const racer = this.state.players.get(client.sessionId);
    if (racer) racer.connected = true;
  }

  onLeave(client: Client) {
    const racer = this.state.players.get(client.sessionId);
    if (!racer) return;
    if (this.state.status === "lobby" || this.state.status === "countdown") {
      this.state.players.delete(client.sessionId);
      this.sims.delete(client.sessionId);
      if (this.state.status === "countdown") { this.state.status = "lobby"; this.unlock(); }
    } else {
      racer.connected = false; // keep them in the results as DNF
    }
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = [...this.state.players.values()].find((r) => r.connected && r.sessionId !== client.sessionId)?.sessionId || "";
    }
  }

  /** Armed only if the car can carry a weapon, the player asked for it and the host allows weapons. */
  private arm(racer: Racer, sim: Sim) {
    const weapon = weaponOf(sim.spec);
    racer.armed = !!weapon && sim.wantsArms && this.state.weapons;
    racer.ammo = racer.armed && weapon ? weapon.magazine : 0;
    sim.reloadIn = weapon?.reload ?? 0;
  }

  /** Server-authoritative shot: same lock-on rules as the client's crosshair. */
  private fire(id: string) {
    const racer = this.state.players.get(id), sim = this.sims.get(id);
    if (!racer || !sim || this.state.status !== "racing" || !racer.armed || racer.finished) return;
    const weapon = weaponOf(sim.spec);
    if (!weapon || racer.ammo < 1 || sim.cooldown > 0 || racer.wrecked > 0 || sim.law.held > 0) return;
    racer.ammo--;
    sim.cooldown = weapon.cooldown;
    if (racer.ammo + 1 >= weapon.magazine) sim.reloadIn = weapon.reload;
    const targets = [...this.state.players.values()].filter((r) => r.sessionId !== id && !r.finished && r.connected && r.wrecked <= 0)
      .map((r) => ({ id: r.sessionId, x: r.x, y: r.y }));
    const shooter = { x: sim.car.x, y: sim.car.y, heading: sim.car.heading };
    const hit = findTarget(this.index, shooter, weapon, targets);
    let wrecked = false;
    if (hit) {
      const target = this.state.players.get(hit.id)!, victim = this.sims.get(hit.id)!;
      target.health = Math.max(0, target.health - weapon.damage);
      victim.car.speed *= 1 - weapon.speedLoss;
      victim.car.heading += (Math.random() < 0.5 ? -1 : 1) * 0.1; // knocked off line
      if (target.health <= 0) { target.wrecked = WRECK_SECONDS; victim.car.speed = 0; wrecked = true; }
    }
    const end = hit || { x: shooter.x + Math.sin(shooter.heading) * weapon.range, y: shooter.y + Math.cos(shooter.heading) * weapon.range };
    this.broadcast("shot", { from: id, to: hit?.id || "", x1: shooter.x, y1: shooter.y, x2: end.x, y2: end.y, wrecked });
  }

  private placeOnGrid(racer: Racer, slot: number) {
    // Staggered two-wide grid behind the start junction.
    const h = this.state.startHeading;
    const back = 2 + Math.floor(slot / 2) * 6, side = slot % 2 ? 1.6 : -1.6;
    racer.x = this.state.startX - Math.sin(h) * back + Math.cos(h) * side;
    racer.y = this.state.startY - Math.cos(h) * back - Math.sin(h) * side;
    racer.heading = h;
    racer.speed = 0;
    racer.steer = 0;
    racer.hole = "";
    const sim = this.sims.get(racer.sessionId);
    if (sim) { sim.car = createCarState({ x: racer.x, y: racer.y }, h); sim.queue = []; sim.tokens = 0; sim.law = new Law(this.index, this.world.graph, this.world.traffic); }
    Object.assign(racer, { heat: 0, held: 0, heldBy: "", copActive: false, demand: false, agberoActive: false, health: MAX_HEALTH, wrecked: 0 });
    if (sim) this.arm(racer, sim);
  }

  private beginIfReady() {
    const racers = [...this.state.players.values()];
    if (racers.length < 2 || !racers.every((r) => r.ready)) return;
    this.state.status = "countdown";
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.lock();
  }

  private resetToLobby() {
    for (const [id, racer] of this.state.players) if (!racer.connected) { this.state.players.delete(id); this.sims.delete(id); }
    let slot = 0;
    for (const racer of this.state.players.values()) {
      Object.assign(racer, { ready: false, finished: false, finishTime: 0, place: 0, ack: 0, remaining: this.state.routeLength });
      this.placeOnGrid(racer, slot++);
    }
    Object.assign(this.state, { status: "lobby", winnerId: "", raceTime: 0, closesIn: 0, countdown: 0 });
    this.unlock();
  }

  private tick() {
    const now = Date.now();
    const { status } = this.state;
    if (status === "countdown") {
      this.state.countdown = Math.max(0, Math.ceil((this.countdownEndsAt - now) / 1000));
      if (now >= this.countdownEndsAt) {
        this.state.status = "racing";
        this.startedAt = now;
      }
      return;
    }
    if (status !== "racing") return;
    this.state.raceTime = (now - this.startedAt) / 1000;

    const { map, graph } = this.world, index = this.index;
    for (const [id, sim] of this.sims) {
      const racer = this.state.players.get(id);
      if (!racer || racer.finished) continue;
      // One input per tick on average, with a little catch-up allowance for jitter.
      sim.tokens = Math.min(sim.tokens + 1, 4);
      let processed = 0;
      while (sim.queue.length && sim.tokens >= 1 && processed < 2) {
        const input = sim.queue.shift()!;
        const frozen = sim.law.held > 0 || racer.wrecked > 0;
        const controls: Controls = frozen ? { throttle: 0, steer: 0 } : { throttle: input.throttle, steer: input.steer };
        for (let i = 0; i < STEPS_PER_INPUT; i++) {
          // Each racer's traffic clock is derived from their input sequence, exactly as the client predicts it.
          const time = ((input.seq - 1) * STEPS_PER_INPUT + i) * STEP;
          if (frozen) sim.car.speed = 0;
          const events: StepEvents = {};
          stepCar(sim.car, controls, sim.spec, index, events, { traffic: this.world.traffic, time });
          sim.law.record(events, time);
        }
        sim.law.update(STEPS_PER_INPUT * STEP, sim.car, sim.spec.body === "bus");
        sim.law.news.length = 0;
        racer.ack = input.seq;
        sim.tokens--;
        processed++;
      }
      // Combat timers: wreck countdown, gun cooldown and one round back every `reload` seconds.
      const dt = TICK_MS / 1000;
      if (racer.wrecked > 0) { racer.wrecked = Math.max(0, racer.wrecked - dt); sim.car.speed = 0; if (!racer.wrecked) racer.health = MAX_HEALTH; }
      sim.cooldown = Math.max(0, sim.cooldown - dt);
      const weapon = racer.armed ? weaponOf(sim.spec) : undefined;
      if (weapon && racer.ammo < weapon.magazine && (sim.reloadIn -= dt) <= 0) { racer.ammo++; sim.reloadIn = weapon.reload; }
      racer.x = sim.car.x;
      racer.y = sim.car.y;
      racer.heading = sim.car.heading;
      racer.speed = sim.car.speed;
      racer.steer = sim.car.steer;
      racer.heat = Math.round(sim.law.heat);
      racer.held = sim.law.held;
      racer.heldBy = sim.law.heldBy;
      racer.demand = !!sim.law.demand;
      racer.copActive = !!sim.law.police;
      if (sim.law.police) { racer.copX = sim.law.police.car.x; racer.copY = sim.law.police.car.y; racer.copHeading = sim.law.police.car.heading; }
      racer.agberoActive = !!sim.law.agbero;
      if (sim.law.agbero) { racer.agberoX = sim.law.agbero.car.x; racer.agberoY = sim.law.agbero.car.y; racer.agberoHeading = sim.law.agbero.car.heading; }
      racer.hole = sim.car.lastHole;
      const left = remainingDistance(map, graph, index.roads, this.toFinish, sim.car);
      if (left !== undefined) racer.remaining = left;
      if (Math.hypot(sim.car.x - this.state.finishX, sim.car.y - this.state.finishY) < FINISH_RADIUS) {
        racer.finished = true;
        racer.remaining = 0;
        racer.speed = 0;
        racer.finishTime = this.state.raceTime;
        racer.place = [...this.state.players.values()].filter((r) => r.finished).length;
        if (!this.state.winnerId) {
          this.state.winnerId = id;
          this.closesAt = now + CLOSE_AFTER_WINNER_MS;
        }
      }
    }

    // Live positions: finished racers by place, then everyone else by distance left.
    const order = [...this.state.players.values()].sort((a, b) =>
      a.finished !== b.finished ? (a.finished ? -1 : 1) : a.finished ? a.place - b.place : a.remaining - b.remaining);
    order.forEach((racer, i) => { racer.place = i + 1; });

    if (this.state.winnerId) this.state.closesIn = Math.max(0, (this.closesAt - now) / 1000);
    const stillRacing = order.some((r) => r.connected && !r.finished);
    if (this.state.winnerId && (!stillRacing || now >= this.closesAt)) this.state.status = "finished";
    if (!order.some((r) => r.connected)) this.state.status = "finished";
  }
}
