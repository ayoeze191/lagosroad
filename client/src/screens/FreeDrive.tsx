import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type * as THREE from "three";
import type { CarSpec } from "../../../shared/cars.js";
import { Law } from "../../../shared/police.js";
import { copyCarState, createCarState, STEP, stepCar, STEPS_PER_INPUT, type CarState, type StepEvents } from "../../../shared/sim.js";
import type { MapIndex } from "../../../shared/spatial.js";
import { MAJOR_HIGHWAYS, type MapData } from "../../../shared/types.js";
import { audio } from "../game/audio";
import { callout } from "../game/callouts";
import { ChaseCamera, type Follow, type Shake } from "../game/ChaseCamera";
import { TouchControls, useControls, type ControlSource } from "../game/input";
import { mapTools, simIndex } from "../game/mapIndex";
import { Attribution, CalloutHud, Dashboard, LawHud, MiniMap, MuteButton, type LawView, type Marker } from "../hud/Hud";
import { CarModel } from "../world/CarModel";
import { elevationAt } from "../world/elevation";
import { AdaptiveResolution, Scene } from "../world/Scene";
import { BusStops, ChaserView, type ChaserPose } from "../world/Street";
import { TrafficView } from "../world/TrafficView";

/** Start on a major road near the middle of the map, facing along it (or at ?spawn=x,y,heading for testing). */
function spawnPoint(map: MapData) {
  const forced = new URLSearchParams(location.search).get("spawn")?.split(",").map(Number);
  if (forced && forced.length >= 2 && forced.every(Number.isFinite)) return { x: forced[0], y: forced[1], heading: forced[2] || 0, score: 0 };
  let best: { x: number; y: number; heading: number; score: number } | undefined;
  for (const road of map.roads) {
    if (!MAJOR_HIGHWAYS.has(road.highway) || road.bridge || road.points.length < 2) continue;
    const [a, b] = road.points, score = Math.hypot(a.x, a.y);
    if (!best || score < best.score) best = { x: a.x, y: a.y, heading: Math.atan2(b.x - a.x, b.y - a.y), score };
  }
  if (best) return best;
  const [a, b] = map.roads[0].points;
  return { x: a.x, y: a.y, heading: Math.atan2(b.x - a.x, b.y - a.y), score: 0 };
}

export type DriveFeedback = { shake: MutableRefObject<Shake>; roadName: MutableRefObject<string> };

/** Turn simulation events into shake, sound and vibration. Shared with the multiplayer race. */
export function react(events: StepEvents, feedback: DriveFeedback) {
  if (events.pedestrian) callout("pedestrian", true);
  else if (events.barrier) callout("barrier");
  else if (events.nearMiss) callout("nearMiss");
  else if (events.pothole) callout("pothole");
  if (events.barrier) {
    feedback.shake.current.amount = Math.max(feedback.shake.current.amount, 1);
    audio.thud(1.6);
    navigator.vibrate?.([60, 40, 60]);
  }
  if (events.pothole) {
    feedback.shake.current.amount = Math.max(feedback.shake.current.amount, 0.35 + events.pothole.depth * 3);
    audio.thud(0.6 + events.pothole.depth * 4);
    navigator.vibrate?.(40);
  }
  if (events.pedestrian) { feedback.shake.current.amount = Math.max(feedback.shake.current.amount, 0.7); audio.thud(1); navigator.vibrate?.(60); }
  if (events.wall || events.traffic) {
    feedback.shake.current.amount = Math.max(feedback.shake.current.amount, 0.6);
    audio.thud(1.2);
    navigator.vibrate?.(70);
  }
  if (events.traffic) audio.honk();
}

/** Sounds for street-law happenings (chase starts, busted, agbero paid/chasing…). */
export function announce(news: string[]) {
  for (const n of news) {
    if (n === "busted" || n === "agbero-caught") { audio.thud(1.5); navigator.vibrate?.([80, 60, 80]); }
    if (n === "rammed") { audio.thud(1.8); navigator.vibrate?.(90); callout("rammed"); }
    if (n === "chase") callout("chase", true);
    if (n === "busted") callout("busted", true);
    if (n === "escaped") callout("escaped", true);
    if (n === "agbero") callout("agbero", true);
    if (n === "paid") audio.cash();
    if (n === "agbero") audio.whistle();
  }
}

type LawRefs = { cop: MutableRefObject<ChaserPose>; agbero: MutableRefObject<ChaserPose> };

/** This run's numbers, shown on the game-over screen. */
type RunStats = { started: number; distance: number; top: number; over: boolean };

function LocalCar({ map, index, spec, controls, follow, feedback, state, law, time, chasers, markers, run, onBusted }: {
  map: MapData; index: MapIndex; spec: CarSpec; controls: ControlSource; follow: MutableRefObject<Follow>; feedback: DriveFeedback; state: MutableRefObject<CarState>;
  law: Law; time: MutableRefObject<number>; chasers: LawRefs; markers: MutableRefObject<Marker[]>;
  run: MutableRefObject<RunStats>; onBusted: () => void;
}) {
  const { traffic } = mapTools(map);
  const group = useRef<THREE.Group>(null);
  const prev = useRef(copyCarState(state.current));
  const acc = useRef(0), frame = useRef(0), steps = useRef(0), z = useRef(0);
  useFrame((_, dt) => {
    acc.current += Math.min(dt, 0.1);
    const held = law.held > 0 || run.current.over;
    const input = held ? { throttle: 0, steer: 0 } : controls.read();
    while (acc.current >= STEP) {
      prev.current = copyCarState(state.current);
      if (held) state.current.speed = 0;
      const before = { x: state.current.x, y: state.current.y };
      const events: StepEvents = {};
      stepCar(state.current, input, spec, index, events, { traffic, time: time.current });
      react(events, feedback);
      law.record(events, time.current);
      if (!run.current.over) {
        run.current.distance += Math.hypot(state.current.x - before.x, state.current.y - before.y);
        run.current.top = Math.max(run.current.top, Math.abs(state.current.speed));
      }
      time.current += STEP;
      if (++steps.current % STEPS_PER_INPUT === 0) {
        law.update(STEPS_PER_INPUT * STEP, state.current, spec.body === "bus");
        announce(law.news);
        // Solo play: getting caught by the police ends the run.
        if (law.news.includes("busted") && !run.current.over) { run.current.over = true; onBusted(); }
        law.news.length = 0;
      }
      acc.current -= STEP;
    }
    const s = state.current, p = prev.current, a = acc.current / STEP;
    const x = p.x + (s.x - p.x) * a, y = p.y + (s.y - p.y) * a;
    const heading = p.heading + Math.atan2(Math.sin(s.heading - p.heading), Math.cos(s.heading - p.heading)) * a;
    z.current += (elevationAt(index, { x, y }, z.current) - z.current) * Math.min(1, dt * 10);
    group.current?.position.set(x, z.current, -y);
    group.current?.rotation.set(0, -heading, 0);
    Object.assign(follow.current, { x, y, heading, speed: s.speed, z: z.current });
    audio.setEngine(Math.min(1, Math.abs(s.speed) / spec.topSpeed), Math.max(0, input.throttle));

    // Chasers for rendering, the minimap and the siren.
    for (const [ref, c] of [[chasers.cop, law.police], [chasers.agbero, law.agbero]] as const) {
      ref.current.active = !!c;
      if (c) Object.assign(ref.current, { x: c.car.x, y: c.car.y, heading: c.car.heading });
    }
    audio.setSiren(!!law.police, law.police ? Math.hypot(law.police.car.x - s.x, law.police.car.y - s.y) : 999);
    markers.current = [
      ...(law.police ? [{ kind: "police" as const, x: law.police.car.x, y: law.police.car.y, colour: "#3b82f6" }] : []),
      ...(law.agbero ? [{ kind: "agbero" as const, x: law.agbero.car.x, y: law.agbero.car.y, colour: "#f5b700" }] : [])
    ];
    if (frame.current++ % 10 === 0) {
      const hit = index.roads.nearest(s, 25);
      feedback.roadName.current = hit && hit.edge < 2 ? map.roads[hit.road].name : "Off road";
    }
  });
  return <CarModel ref={group} spec={spec} highlight headlights />;
}

export default function FreeDrive({ map, car, potholes, night, goSlow, onExit }: { map: MapData; car: CarSpec; potholes: boolean; night: boolean; goSlow: boolean; onExit: () => void }) {
  const tools = mapTools(map);
  const index = simIndex(map, potholes, goSlow);
  const spawn = useMemo(() => spawnPoint(map), [map]);
  const controls = useControls();
  const state = useRef(createCarState(spawn, spawn.heading));
  const follow = useRef<Follow>({ x: spawn.x, y: spawn.y, heading: spawn.heading, speed: 0, topSpeed: car.topSpeed });
  const feedback: DriveFeedback = { shake: useRef({ amount: 0 }), roadName: useRef("") };
  const markers = useRef<Marker[]>([]);
  const [attempt, setAttempt] = useState(0);
  const law = useMemo(() => new Law(index, tools.graph, tools.traffic), [index, tools, attempt]);
  const run = useRef<RunStats>({ started: 0, distance: 0, top: 0, over: false });
  const [busted, setBusted] = useState<RunStats>();
  const onBusted = () => setBusted({ ...run.current, started: time.current - run.current.started });
  const tryAgain = () => {
    Object.assign(state.current, createCarState(spawn, spawn.heading));
    run.current = { started: time.current, distance: 0, top: 0, over: false };
    setBusted(undefined);
    setAttempt((a) => a + 1);
  };
  const time = useRef(0);
  const chasers: LawRefs = { cop: useRef({ active: false, x: 0, y: 0, heading: 0 }), agbero: useRef({ active: false, x: 0, y: 0, heading: 0 }) };
  const [lawView, setLawView] = useState<LawView>({ heat: 0, held: 0, heldBy: "", copActive: false, copDistance: 0, demand: false, agberoActive: false });

  useEffect(() => {
    const timer = setInterval(() => {
      const s = state.current;
      setLawView({
        heat: law.heat, held: law.held, heldBy: law.heldBy, copActive: !!law.police,
        copDistance: law.police ? Math.hypot(law.police.car.x - s.x, law.police.car.y - s.y) : 0,
        demand: !!law.demand, agberoActive: !!law.agbero
      });
    }, 200);
    return () => { clearInterval(timer); audio.stop(); };
  }, [law]);

  const respawn = () => {
    const s = state.current, hit = tools.index.roads.nearest(s, 400);
    if (!hit) return;
    const along = Math.atan2(hit.dx, hit.dy);
    Object.assign(s, createCarState({ x: hit.px, y: hit.py }, along + (Math.cos(s.heading - along) < 0 ? Math.PI : 0)));
  };

  return <main className="game" onPointerDown={() => audio.unlock()} onKeyDown={() => audio.unlock()} tabIndex={-1}>
    <Canvas camera={{ fov: 60, near: 0.8, far: 450, position: [spawn.x, 6, -spawn.y + 10] }} shadows gl={{ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" }}>
      <Scene map={map} potholes={potholes} night={night} goSlow={goSlow} player={follow}>
        <TrafficView traffic={tools.traffic} index={tools.index} time={time} player={follow} />
        <BusStops traffic={tools.traffic} />
        <ChaserView pose={chasers.cop} livery="police" index={tools.index} />
        <ChaserView pose={chasers.agbero} livery="agbero" index={tools.index} />
        <LocalCar map={map} index={index} spec={car} controls={controls} follow={follow} feedback={feedback} state={state} law={law} time={time} chasers={chasers} markers={markers} run={run} onBusted={onBusted} />
      </Scene>
      <ChaseCamera target={follow} shake={feedback.shake} />
      <AdaptiveResolution />
    </Canvas>
    <div className="hud">
      <div className="hud-top">
        <button className="chip" onClick={onExit}>← Garage</button>
        <button className="chip" onClick={respawn}>Respawn</button>
        <MuteButton />
      </div>
      <div className="area-name">FREE DRIVE · {map.area.name}{potholes ? "" : " · SMOOTH ROADS"}{goSlow ? " · RUSH HOUR" : ""}</div>
      <LawHud law={lawView} />
      <CalloutHud />
      <MiniMap map={map} follow={follow} markers={markers} />
      <Dashboard follow={follow} roadName={feedback.roadName} />
      <Attribution map={map} />
    </div>
    {busted && <section className="panel gameover">
      <p className="eyebrow">Police don catch you</p>
      <h2 className="busted">Busted</h2>
      <p className="gameover-sub">Game over</p>
      <dl className="run-stats">
        <div><dt>Time on the run</dt><dd>{Math.floor(busted.started / 60)}:{String(Math.floor(busted.started % 60)).padStart(2, "0")}</dd></div>
        <div><dt>Distance</dt><dd>{(busted.distance / 1000).toFixed(2)} km</dd></div>
        <div><dt>Top speed</dt><dd>{Math.round(busted.top * 3.6)} km/h</dd></div>
      </dl>
      <button className="primary" onClick={tryAgain}><span>Try again</span></button>
      <button onClick={onExit}><span>Back to garage</span></button>
    </section>}
    {!busted && <TouchControls controls={controls} />}
  </main>;
}
