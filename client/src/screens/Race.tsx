import type { Room } from "@colyseus/sdk";
import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type * as THREE from "three";
import { carById, withPaint, type CarSpec } from "../../../shared/cars.js";
import { copyCarState, createCarState, STEP, stepCar, STEPS_PER_INPUT, type CarState, type Controls, type StepEvents } from "../../../shared/sim.js";
import type { MapIndex } from "../../../shared/spatial.js";
import type { Traffic } from "../../../shared/traffic.js";
import type { MapData } from "../../../shared/types.js";
import { audio } from "../game/audio";
import { callout } from "../game/callouts";
import { ChaseCamera, type Follow } from "../game/ChaseCamera";
import { TouchControls, useControls, type ControlSource } from "../game/input";
import { mapTools, simIndex } from "../game/mapIndex";
import { Attribution, CalloutHud, Dashboard, LawHud, MiniMap, MuteButton, type Marker } from "../hud/Hud";
import { createClient, raceLink } from "../net";
import { CarModel } from "../world/CarModel";
import { elevationAt } from "../world/elevation";
import { Crosshair, ShotEffects, type Shot } from "../world/Combat";
import { PlayerTag, RaceGate, roadAt } from "../world/RaceMarkers";
import { weaponOf } from "../../../shared/weapons.js";
import { AdaptiveResolution, Beacon, Scene } from "../world/Scene";
import { BusStops, ChaserView, type ChaserPose } from "../world/Street";
import { TrafficView } from "../world/TrafficView";
import { react, type DriveFeedback } from "./FreeDrive";
import { junctionName } from "./Lobby";

/** Mirrors server/src/schema.ts (only the fields the client reads). */
type ServerRacer = {
  sessionId: string; name: string; carId: string; colour: string;
  x: number; y: number; heading: number; speed: number; steer: number; hole: string; ack: number;
  remaining: number; place: number; ready: boolean; finished: boolean; connected: boolean; finishTime: number;
  heat: number; held: number; heldBy: string; demand: boolean;
  copActive: boolean; copX: number; copY: number; copHeading: number;
  agberoActive: boolean; agberoX: number; agberoY: number; agberoHeading: number;
  armed: boolean; health: number; ammo: number; wrecked: number;
};
type ServerState = {
  status: "lobby" | "countdown" | "racing" | "finished"; hostId: string; winnerId: string;
  countdown: number; raceTime: number; closesIn: number; routeLength: number; potholes: boolean; goSlow: boolean;
  weapons: boolean;
  startNodeId: string; finishNodeId: string; startX: number; startY: number; startHeading: number; finishX: number; finishY: number;
};
type View = ServerState & { players: ServerRacer[] };
type Sample = { t: number; x: number; y: number; heading: number };

const INTERP_DELAY = 110; // ms behind real time for other racers' cars
const SNAP_DISTANCE = 8;

const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Client-side prediction for the local car. Each input covers STEPS_PER_INPUT fixed steps; the server
 * simulates the same steps and echoes the last input it applied (`ack`). On every server update we
 * rewind to the server's state and replay the inputs it hasn't seen yet, so the car feels instant but
 * the server stays in charge of where everyone really is.
 */
class Predictor {
  state: CarState = createCarState({ x: 0, y: 0 }, 0);
  prev: CarState = copyCarState(this.state);
  offset = { x: 0, y: 0, heading: 0 };
  active = false;
  private pending: { seq: number; controls: Controls; applied: number }[] = [];
  private seq = 0;
  private acc = 0;
  /** Mirrors the server: while held by police/agbero, the car can't move. */
  held = false;
  /** Swapped for the smooth-roads index when the host switched potholes off. */
  constructor(private room: Room, private spec: CarSpec, public index: MapIndex, private traffic: Traffic) {}

  /** The racer's traffic clock, derived from input sequence numbers exactly like the server does. */
  private static clock(seq: number, step: number) { return ((seq - 1) * STEPS_PER_INPUT + step) * STEP; }
  get time() {
    const current = this.pending.at(-1);
    return current ? Predictor.clock(current.seq, current.applied) + this.acc : Predictor.clock(this.seq + 1, 0);
  }
  private step(s: CarState, p: { seq: number; controls: Controls }, i: number, events?: StepEvents) {
    if (this.held) s.speed = 0;
    stepCar(s, this.held ? { throttle: 0, steer: 0 } : p.controls, this.spec, this.index, events, { traffic: this.traffic, time: Predictor.clock(p.seq, i) });
  }

  start(r: ServerRacer) {
    this.state = createCarState(r, r.heading);
    this.prev = copyCarState(this.state);
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.offset = { x: 0, y: 0, heading: 0 };
    this.active = true;
  }

  tick(dt: number, read: () => Controls, feedback: DriveFeedback) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps++ < 8) {
      let current = this.pending.at(-1);
      if (!current || current.applied >= STEPS_PER_INPUT) {
        const controls = read();
        current = { seq: ++this.seq, controls, applied: 0 };
        this.pending.push(current);
        this.room.send("input", { seq: current.seq, throttle: controls.throttle, steer: controls.steer });
      }
      this.prev = copyCarState(this.state);
      const events: StepEvents = {};
      this.step(this.state, current, current.applied, events);
      react(events, feedback);
      current.applied++;
      this.acc -= STEP;
    }
    const decay = Math.exp(-dt * 8);
    this.offset.x *= decay; this.offset.y *= decay; this.offset.heading *= decay;
  }

  reconcile(r: ServerRacer) {
    this.held = r.held > 0 || r.wrecked > 0;
    if (!this.active) return;
    this.pending = this.pending.filter((p) => p.seq > r.ack);
    const before = { x: this.state.x, y: this.state.y, heading: this.state.heading };
    const s = createCarState(r, r.heading);
    s.speed = r.speed; s.steer = r.steer; s.lastHole = r.hole;
    for (const p of this.pending) for (let i = 0; i < p.applied; i++) this.step(s, p, i);
    const dx = before.x - s.x, dy = before.y - s.y, dh = wrap(before.heading - s.heading);
    if (Math.hypot(dx, dy) < SNAP_DISTANCE) {
      // Absorb the correction into a decaying visual offset, and shift `prev` by the same amount,
      // so the rendered car doesn't jump this frame.
      this.offset.x += dx; this.offset.y += dy; this.offset.heading = wrap(this.offset.heading + dh);
      this.prev = { ...copyCarState(s), x: this.prev.x - dx, y: this.prev.y - dy, heading: this.prev.heading - dh };
    } else {
      this.offset = { x: 0, y: 0, heading: 0 };
      this.prev = copyCarState(s);
    }
    this.state = s;
  }

  pose() {
    const a = this.acc / STEP, p = this.prev, s = this.state;
    return {
      x: p.x + (s.x - p.x) * a + this.offset.x,
      y: p.y + (s.y - p.y) * a + this.offset.y,
      heading: p.heading + wrap(s.heading - p.heading) * a + this.offset.heading,
      speed: s.speed
    };
  }
}

/** Buffered snapshot interpolation for cars we don't control. */
function sampleAt(buffer: Sample[], t: number): Sample | undefined {
  if (!buffer.length) return undefined;
  if (t <= buffer[0].t) return buffer[0];
  for (let i = buffer.length - 1; i > 0; i--) {
    const a = buffer[i - 1], b = buffer[i];
    if (t >= a.t) {
      if (t >= b.t) return b;
      const k = (t - a.t) / (b.t - a.t);
      return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: a.heading + wrap(b.heading - a.heading) * k };
    }
  }
  return buffer.at(-1);
}

function RemoteCar({ spec, buffer, markers, id, index, name, place, armed, health }: { spec: CarSpec; buffer: MutableRefObject<Map<string, Sample[]>>; markers: MutableRefObject<Marker[]>; id: string; index: MapIndex; name: string; place?: number; armed?: boolean; health?: number }) {
  const group = useRef<THREE.Group>(null);
  const z = useRef(0);
  useFrame((_, dt) => {
    const s = sampleAt(buffer.current.get(id) || [], performance.now() - INTERP_DELAY);
    if (!s || !group.current) return;
    z.current += (elevationAt(index, s, z.current) - z.current) * Math.min(1, dt * 10);
    group.current.position.set(s.x, z.current, -s.y);
    group.current.rotation.set(0, -s.heading, 0);
    const m = markers.current.find((m) => m.kind === "car" && (m as Marker & { id?: string }).id === id) as (Marker & { id?: string }) | undefined;
    if (m) { m.x = s.x; m.y = s.y; }
  });
  return <group ref={group}>
    <CarModel spec={spec} armed={armed} />
    <PlayerTag name={name} colour={spec.colour} place={place} health={health} />
  </group>;
}

function LocalCar({ spec, armed, predictor, controls, follow, feedback, fallback, index, map, roadName, trafficTime, raceClock }: {
  armed?: boolean;
  spec: CarSpec; predictor: Predictor; controls: ControlSource; follow: MutableRefObject<Follow>; feedback: DriveFeedback;
  fallback: MutableRefObject<Sample[]>; index: MapIndex; map: MapData; roadName: MutableRefObject<string>;
  trafficTime: MutableRefObject<number>; raceClock: MutableRefObject<{ time: number; at: number }>;
}) {
  const group = useRef<THREE.Group>(null);
  const frame = useRef(0), z = useRef(0);
  useFrame((_, dt) => {
    let pose: { x: number; y: number; heading: number; speed: number } | undefined;
    if (predictor.active) {
      predictor.tick(dt, controls.read, feedback);
      pose = predictor.pose();
      audio.setEngine(Math.min(1, Math.abs(pose.speed) / spec.topSpeed), Math.max(0, controls.read().throttle));
    } else {
      const s = sampleAt(fallback.current, performance.now() - INTERP_DELAY);
      if (s) pose = { ...s, speed: 0 };
      audio.setEngine(0, 0);
    }
    // Traffic runs on our predicted clock while racing, otherwise on the (extrapolated) race clock.
    trafficTime.current = predictor.active ? predictor.time : raceClock.current.time + (performance.now() - raceClock.current.at) / 1000;
    if (!pose || !group.current) return;
    z.current += (elevationAt(index, pose, z.current) - z.current) * Math.min(1, dt * 10);
    group.current.position.set(pose.x, z.current, -pose.y);
    group.current.rotation.set(0, -pose.heading, 0);
    Object.assign(follow.current, pose, { z: z.current });
    if (frame.current++ % 10 === 0) {
      const hit = index.roads.nearest(pose, 25);
      roadName.current = hit && hit.edge < 2 ? map.roads[hit.road].name : "Off road";
    }
  });
  return <group ref={group}>
    <CarModel spec={spec} highlight headlights armed={armed} />
    <PlayerTag name="" colour={spec.colour} you />
  </group>;
}

export default function Race({ map, car, armed, name, night, room: initialRoom, roomId, onExit }: {
  map: MapData; car: CarSpec; armed: boolean; name: string; night: boolean; room?: Room; roomId?: string; onExit: () => void;
}) {
  const { index, traffic } = mapTools(map);
  const [room, setRoom] = useState<Room | undefined>(initialRoom);
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const controls = useControls();
  const follow = useRef<Follow>({ x: 0, y: 0, heading: 0, speed: 0, topSpeed: car.topSpeed });
  const feedback: DriveFeedback = { shake: useRef({ amount: 0 }), roadName: useRef("") };
  const markers = useRef<(Marker & { id?: string })[]>([]);
  const buffers = useRef(new Map<string, Sample[]>());
  const predictor = useMemo(() => (room ? new Predictor(room, car, index, traffic) : undefined), [room, car, index, traffic]);
  // Combat: what the crosshair is locked on, recent shots for effects, and the fire button.
  const weapon = armed ? weaponOf(car) : undefined;
  const lock = useRef("");
  const [locked, setLocked] = useState(false);
  const shots = useRef<Shot[]>([]);
  const lastFire = useRef(0);
  const viewRef = useRef<View | undefined>(undefined);
  const targetsNow = useCallback(() => {
    const v = viewRef.current, now = performance.now() - INTERP_DELAY;
    if (!v || !room) return [];
    return v.players.filter((p) => p.sessionId !== room.sessionId && !p.finished && p.connected && p.wrecked <= 0).flatMap((p) => {
      const s = sampleAt(buffers.current.get(p.sessionId) || [], now);
      return s ? [{ id: p.sessionId, x: s.x, y: s.y }] : [];
    });
  }, [room]);
  const fire = useCallback(() => {
    const v = viewRef.current, me = v?.players.find((p) => p.sessionId === room?.sessionId);
    if (!room || !weapon || !me?.armed || me.ammo < 1 || me.wrecked > 0 || v?.status !== "racing") return;
    const now = performance.now();
    if (now - lastFire.current < weapon.cooldown * 1000) return;
    lastFire.current = now;
    audio.gunshot(1);
    room.send("fire");
  }, [room, weapon]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.key === "f" || e.key === "F" || e.key === "Enter") && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); fire(); } };
    addEventListener("keydown", onKey);
    const timer = setInterval(() => setLocked(!!lock.current), 120);
    return () => { removeEventListener("keydown", onKey); clearInterval(timer); };
  }, [fire]);
  useEffect(() => {
    if (!room) return;
    const off = room.onMessage("shot", (m: Omit<Shot, "at" | "hit"> & { wrecked: boolean }) => {
      shots.current.push({ ...m, at: performance.now(), hit: !!m.to });
      const mine = m.from === room.sessionId, me = follow.current;
      if (!mine) audio.gunshot(Math.max(0.15, 1 - Math.hypot(m.x1 - me.x, m.y1 - me.y) / 200));
      if (m.to) audio.clang(m.to === room.sessionId ? 1.2 : 0.5);
      if (m.to === room.sessionId) {
        feedback.shake.current.amount = Math.max(feedback.shake.current.amount, m.wrecked ? 1.2 : 0.6);
        navigator.vibrate?.(m.wrecked ? [100, 50, 100] : 50);
        callout(m.wrecked ? "wrecked" : "shot", m.wrecked);
      } else if (mine && m.to) callout(m.wrecked ? "wreckedThem" : "hit", m.wrecked);
    });
    return () => { off?.(); };
  }, [room]);
  const trafficTime = useRef(0);
  const raceClock = useRef({ time: 0, at: performance.now() });
  const chasers = useRef(new Map<string, { cop: MutableRefObject<ChaserPose>; agbero: MutableRefObject<ChaserPose> }>());
  const chasersFor = (id: string) => {
    let c = chasers.current.get(id);
    if (!c) { c = { cop: { current: { active: false, x: 0, y: 0, heading: 0 } }, agbero: { current: { active: false, x: 0, y: 0, heading: 0 } } }; chasers.current.set(id, c); }
    return c;
  };
  const lastLaw = useRef({ heldBy: "", agbero: false, demand: false, cop: false });
  const lastStatus = useRef("");
  const leaving = useRef(false);

  // Join by link if we weren't handed a room by the lobby.
  useEffect(() => {
    if (room || !roomId) return;
    let cancelled = false;
    createClient().joinById(roomId, { name, carId: car.id, colour: car.colour, armed })
      .then((r) => { if (cancelled) r.leave(); else setRoom(r); })
      .catch((e) => setError(e instanceof Error && /started/i.test(e.message) ? "That race has already started." : "Couldn't join that race. It may have ended, or the race server isn't reachable."));
    return () => { cancelled = true; };
  }, [room, roomId, name, car.id]);

  useEffect(() => {
    if (!room || !predictor) return;
    const onState = (raw: ServerState) => {
      // Schema fields are accessors, so copy them out with toJSON().
      const json = (raw as unknown as { toJSON: () => ServerState & { players: Record<string, ServerRacer> } }).toJSON();
      const players = Object.values(json.players);
      const now = performance.now();
      for (const r of players) {
        const buffer = buffers.current.get(r.sessionId) || [];
        buffer.push({ t: now, x: r.x, y: r.y, heading: r.heading });
        if (buffer.length > 30) buffer.splice(0, buffer.length - 30);
        buffers.current.set(r.sessionId, buffer);
      }
      raceClock.current = { time: json.status === "racing" ? json.raceTime : 0, at: performance.now() };
      for (const p of players) {
        const c = chasersFor(p.sessionId);
        Object.assign(c.cop.current, { active: p.copActive, x: p.copX, y: p.copY, heading: p.copHeading });
        Object.assign(c.agbero.current, { active: p.agberoActive, x: p.agberoX, y: p.agberoY, heading: p.agberoHeading });
      }
      predictor.index = simIndex(map, json.potholes !== false, json.goSlow === true);
      const me = players.find((p) => p.sessionId === room.sessionId);
      if (me) {
        // Street-law sounds from state changes.
        const was = lastLaw.current;
        if (me.heldBy && !was.heldBy) { audio.thud(1.5); navigator.vibrate?.([80, 60, 80]); if (me.heldBy === "police") callout("busted", true); }
        if (me.copActive && !was.cop) callout("chase", true);
        if (me.agberoActive && !was.agbero) audio.whistle();
        if (was.demand && !me.demand && !me.agberoActive) audio.cash();
        lastLaw.current = { heldBy: me.heldBy, agbero: me.agberoActive, demand: me.demand, cop: me.copActive };
        audio.setSiren(me.copActive, Math.hypot(me.copX - me.x, me.copY - me.y));
        const shouldPredict = raw.status === "racing" && !me.finished;
        if (shouldPredict && !predictor.active) predictor.start(me);
        else if (!shouldPredict) predictor.active = false;
        else predictor.reconcile(me);
        if (!predictor.active) Object.assign(follow.current, { x: me.x, y: me.y, heading: me.heading });
      }
      if (raw.status !== lastStatus.current) {
        if (raw.status === "racing") navigator.vibrate?.(120);
        lastStatus.current = raw.status;
      }
      markers.current = [
        { kind: "start", x: raw.startX, y: raw.startY, colour: "#34c759" },
        { kind: "finish", x: raw.finishX, y: raw.finishY, colour: "#ff453a" },
        ...players.filter((p) => p.sessionId !== room.sessionId).map((p) => ({ kind: "car" as const, id: p.sessionId, x: p.x, y: p.y, colour: p.colour })),
        ...(me?.copActive ? [{ kind: "police" as const, x: me.copX, y: me.copY, colour: "#3b82f6" }] : []),
        ...(me?.agberoActive ? [{ kind: "agbero" as const, x: me.agberoX, y: me.agberoY, colour: "#f5b700" }] : [])
      ];
      viewRef.current = { ...json, players };
      setView(viewRef.current);
    };
    room.onStateChange(onState);
    // The first state may have arrived before this screen mounted (e.g. while it lazy-loaded).
    if ((room.state as { players?: unknown } | undefined)?.players) onState(room.state as ServerState);
    room.onLeave((code) => { if (!leaving.current && code !== 1000 && code !== 4000) setError("Disconnected from the race server."); });
    return () => { room.onStateChange.remove(onState); };
  }, [room, predictor, map]);

  useEffect(() => {
    if (room && view && !window.location.pathname.includes(room.roomId)) history.replaceState(null, "", `/race/${map.area.slug}/${room.roomId}`);
  }, [room, view, map.area.slug]);
  useEffect(() => () => { audio.stop(); }, []);
  useEffect(() => () => { room?.leave(); }, [room]);

  const leave = () => { leaving.current = true; room?.leave(); history.replaceState(null, "", "/"); onExit(); };

  if (error) return <main className="setup"><h2>{error}</h2><button className="primary" onClick={leave}>Back to garage</button></main>;
  if (!room || !view || !predictor) return <main className="setup"><p>Joining race…</p></main>;

  const me = view.players.find((p) => p.sessionId === room.sessionId);
  const link = raceLink(map.area.slug, room.roomId);
  const isHost = view.hostId === room.sessionId;
  const ranked = [...view.players].sort((a, b) => a.place - b.place);
  const share = async () => {
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: "Race me in Ikorodu", text: `Race me from ${junctionName(map, view.startNodeId)} to ${junctionName(map, view.finishNodeId)}!`, url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch { /* user cancelled */ }
  };

  return <main className="game" onPointerDown={() => audio.unlock()} onKeyDown={() => audio.unlock()} tabIndex={-1}>
    <Canvas camera={{ fov: 60, near: 0.8, far: 450, position: [view.startX, 8, -view.startY + 12] }} shadows gl={{ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" }}>
      <Scene map={map} potholes={view.potholes !== false} night={night} goSlow={view.goSlow === true} player={follow}>
        <Beacon x={view.finishX} y={view.finishY} colour="#ff453a" />
        <RaceGate x={view.startX} y={view.startY} label="START" colour="#19b8d6" {...roadAt(index, view.startX, view.startY, view.startHeading)} />
        <RaceGate x={view.finishX} y={view.finishY} label="FINISH" colour="#e3204b" {...roadAt(index, view.finishX, view.finishY, 0)} />
        {view.players.filter((p) => p.sessionId !== room.sessionId).map((p) =>
          <RemoteCar key={p.sessionId} id={p.sessionId} spec={withPaint(carById(p.carId), p.colour)} buffer={buffers} markers={markers} index={index}
            name={p.name} place={view.status === "racing" ? p.place : undefined} armed={p.armed} health={view.weapons && view.players.some((q) => q.armed) ? p.health : undefined} />)}
        {view.players.map((p) => <group key={`law-${p.sessionId}`}>
          <ChaserView pose={chasersFor(p.sessionId).cop} livery="police" index={index} />
          <ChaserView pose={chasersFor(p.sessionId).agbero} livery="agbero" index={index} />
        </group>)}
        <TrafficView traffic={traffic} index={index} time={trafficTime} player={follow} />
        <BusStops traffic={traffic} />
        {weapon && me?.armed && view.status === "racing" && !me.finished && <Crosshair index={index} me={follow} weapon={weapon} targets={targetsNow} lock={lock} />}
        <ShotEffects shots={shots} />
        <LocalCar spec={car} armed={me?.armed} predictor={predictor} controls={controls} follow={follow} feedback={feedback} index={index} map={map}
          roadName={feedback.roadName} fallback={{ current: buffers.current.get(room.sessionId) || [] }} trafficTime={trafficTime} raceClock={raceClock} />
      </Scene>
      <ChaseCamera target={follow} shake={feedback.shake} />
      <AdaptiveResolution />
    </Canvas>

    <div className="hud">
      <div className="hud-top">
        <button className="chip" onClick={leave}>← Leave</button>
        <MuteButton />
        {view.status === "racing" && me && <div className="chip stat place"><b>{ordinal(me.place).toUpperCase()}</b><small> / {view.players.length}</small></div>}
        {view.status === "racing" && <div className="chip stat">{formatTime(view.raceTime)}</div>}
      </div>
      <MiniMap map={map} follow={follow} markers={markers} />
      <CalloutHud />
      {view.status === "racing" && me?.armed && weapon && !me.finished && <div className="combat-hud">
        <div className="health"><span>Health</span><i><b style={{ width: `${me.health}%` }} className={me.health < 35 ? "low" : ""} /></i></div>
        <div className="ammo"><span>{weapon.label}</span><b>{"▮".repeat(me.ammo)}<em>{"▮".repeat(Math.max(0, weapon.magazine - me.ammo))}</em></b></div>
        <p className="lock-hint">{locked ? "🎯 LOCKED. Press F / Enter to shoot" : "Steer the crosshair onto a rival"}</p>
      </div>}
      {view.status === "racing" && me && me.wrecked > 0 && <div className="wrecked">WRECKED<small>Back on the road in {Math.ceil(me.wrecked)}s</small></div>}
      {view.status === "racing" && me && !me.armed && me.health < 100 && <div className="combat-hud"><div className="health"><span>Health</span><i><b style={{ width: `${me.health}%` }} className={me.health < 35 ? "low" : ""} /></i></div></div>}
      {view.status === "racing" && me && !me.finished && <LawHud law={{ heat: me.heat, held: me.held, heldBy: me.heldBy, copActive: me.copActive, copDistance: Math.hypot(me.copX - me.x, me.copY - me.y), demand: me.demand, agberoActive: me.agberoActive }} />}
      {view.status === "racing" && me && !me.finished && <div className="to-go">{me.remaining >= 1000 ? `${(me.remaining / 1000).toFixed(2)} km` : `${Math.round(me.remaining)} m`} to finish</div>}
      {view.status === "racing" && view.winnerId && me && !me.finished && <div className="banner">{view.players.find((p) => p.sessionId === view.winnerId)?.name} finished! {Math.ceil(view.closesIn)}s left</div>}
      {(view.status === "countdown" || (view.status === "racing" && view.raceTime < 1.2)) &&
        <div className="countdown" key={view.status === "countdown" ? view.countdown : "go"}>{view.status === "countdown" ? view.countdown : "GO!"}</div>}
      <Dashboard follow={follow} roadName={feedback.roadName} />
      <Attribution map={map} />
    </div>

    {view.status === "lobby" && <section className="panel">
      <p className="eyebrow">RACE LOBBY · {map.area.name}</p>
      <h2>{junctionName(map, view.startNodeId)} → {junctionName(map, view.finishNodeId)}</h2>
      <p className="muted">Shortest route {(view.routeLength / 1000).toFixed(2)} km. Any road counts; only the finish is fixed.</p>
      <p className="muted">{view.potholes !== false ? "🕳️ Potholes ON: real Lagos roads." : "✨ Potholes OFF: smooth roads for this race."}{view.goSlow ? " 🚦 Rush hour: go-slow at the hotspots." : ""}</p>
      <div className="share">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Race link" />
        <button onClick={share}>{copied ? "Copied!" : typeof navigator.share === "function" ? "Share" : "Copy"}</button>
      </div>
      <ul className="racers">
        {view.players.map((p) => <li key={p.sessionId}>
          <span className="swatch" style={{ background: p.colour }} />
          <span>{p.name}{p.sessionId === room.sessionId ? " (you)" : ""}{p.sessionId === view.hostId ? " · host" : ""}<small>{carById(p.carId).name}</small></span>
          <b className={p.ready ? "ready" : ""}>{p.ready ? "READY" : "…"}</b>
        </li>)}
      </ul>
      {view.players.length < 2 && <p className="hint">Waiting for a friend to open the link…</p>}
      <button className={`primary ${me?.ready ? "secondary" : ""}`} onClick={() => room.send("ready", !me?.ready)}>{me?.ready ? "Not ready" : "I'm ready"}</button>
      <p className="hint">The countdown starts when everyone (at least 2 racers) is ready.</p>
    </section>}

    {(view.status === "finished" || me?.finished) && <section className="panel results">
      <p className="eyebrow">{view.status === "finished" ? "RACE OVER" : "YOU FINISHED"}</p>
      <h2>{view.winnerId === room.sessionId ? "You win! 🏆" : me?.finished ? `${ordinal(me.place)} place` : `${view.players.find((p) => p.sessionId === view.winnerId)?.name || "Nobody"} wins`}</h2>
      <ol className="racers">
        {ranked.map((p) => <li key={p.sessionId}>
          <span className="swatch" style={{ background: p.colour }} />
          <span>{p.sessionId === view.winnerId ? "🏆 " : ""}{p.name}{p.sessionId === room.sessionId ? " (you)" : ""}</span>
          <b>{p.finished ? formatTime(p.finishTime) : !p.connected ? "DNF" : view.status === "finished" ? "DNF" : "racing…"}</b>
        </li>)}
      </ol>
      {view.status === "finished" && isHost && <button className="primary" onClick={() => room.send("rematch")}>Rematch</button>}
      {view.status === "finished" && !isHost && <p className="hint">The host can start a rematch.</p>}
      <button onClick={leave}>Back to garage</button>
    </section>}

    {view.status === "racing" && me && !me.finished && <TouchControls controls={controls} />}
    {view.status === "racing" && me?.armed && !me.finished && <button className={`pad shoot ${locked ? "locked" : ""}`} onPointerDown={(e) => { e.preventDefault(); fire(); }}>SHOOT</button>}
  </main>;
}
