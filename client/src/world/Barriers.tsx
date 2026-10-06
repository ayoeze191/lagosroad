import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GATE_SAFE_SPEED } from "../../../shared/sim.js";
import { GATE_KINDS, type Barrier, type MapData } from "../../../shared/types.js";
import type { Follow } from "../game/ChaseCamera";

const SHOW_WITHIN = 260; // metres

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  paint(canvas.getContext("2d")!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Diagonal hazard stripes, `a`/`b` alternating. */
const stripes = (a: string, b: string) => canvasTexture(128, 32, (ctx) => {
  ctx.fillStyle = a; ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = b;
  for (let x = -32; x < 160; x += 32) { ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 0); ctx.fill(); }
});

const signTexture = () => canvasTexture(512, 96, (ctx) => {
  ctx.fillStyle = "#0f3d8a"; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#f5b700"; ctx.fillRect(0, 0, 512, 8); ctx.fillRect(0, 88, 512, 8);
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 44px system-ui, sans-serif"; ctx.fillText("ESTATE GATE", 256, 38);
  ctx.font = "700 22px system-ui, sans-serif"; ctx.fillStyle = "#ffd84d"; ctx.fillText("SLOW DOWN · GATEMAN ON DUTY · 25 KM/H", 256, 72);
});

type Kit = ReturnType<typeof makeKit>;
function makeKit() {
  const boom = stripes("#d81f26", "#f4f4f4"); boom.repeat.set(6, 1);
  const bump = stripes("#151515", "#f5c400"); bump.repeat.set(4, 1);
  const jersey = stripes("#d81f26", "#f4f4f4"); jersey.repeat.set(1.5, 1);
  const bollard = stripes("#151515", "#f5c400"); bollard.repeat.set(1, 3);
  const lam = (color: string) => new THREE.MeshLambertMaterial({ color });
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    ball: new THREE.SphereGeometry(0.5, 12, 8),
    // Jersey barrier cross-section: wide foot, sloped sides, narrow top.
    jersey: new THREE.ExtrudeGeometry(new THREE.Shape([[-0.32, 0], [0.32, 0], [0.3, 0.1], [0.14, 0.32], [0.1, 0.82], [-0.1, 0.82], [-0.14, 0.32], [-0.3, 0.1]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 1.9, bevelEnabled: false }).translate(0, 0, -0.95),
    pillar: lam("#efe3c8"),
    cap: lam("#b3261e"),
    hut: lam("#f2f2f2"),
    hutTrim: lam("#1f5fae"),
    roof: lam("#8c2a1e"),
    glass: new THREE.MeshLambertMaterial({ color: "#20303d" }),
    pole: lam("#3a3d42"),
    uniform: lam("#2c3e6b"),
    skin: lam("#6b4428"),
    boom: new THREE.MeshLambertMaterial({ map: boom }),
    bump: new THREE.MeshLambertMaterial({ map: bump }),
    jerseyMat: new THREE.MeshLambertMaterial({ map: jersey }),
    bollard: new THREE.MeshLambertMaterial({ map: bollard }),
    drum: lam("#ff6a00"),
    band: new THREE.MeshBasicMaterial({ color: "#f4f4f4" }),
    sign: new THREE.MeshBasicMaterial({ map: signTexture() }),
    beacon: new THREE.MeshBasicMaterial({ color: "#ffb000" })
  };
}

type Live = { group: THREE.Group | null; boom: THREE.Group | null; man: THREE.Group | null; open: number; smashed: boolean; approach: number };

/**
 * Real OSM gates and road blocks. Estate gates have a gateman who lifts the boom if you roll up
 * slowly (the sim lets you through for free); come in fast and you snap the boom off.
 */
export function Barriers({ map, player }: { map: MapData; player?: MutableRefObject<Follow> }) {
  const barriers = map.barriers || [];
  const kit = useMemo(makeKit, []);
  const live = useRef<Live[]>([]);
  // Filled before render so the child refs (boom, gateman) have somewhere to land.
  if (live.current.length !== barriers.length) live.current = barriers.map(() => ({ group: null, boom: null, man: null, open: 0, smashed: false, approach: 0 }));
  const frame = useRef(0);
  useFrame(({ camera, clock }, dt) => {
    const cx = camera.position.x, cy = -camera.position.z, p = player?.current;
    const flash = Math.sin(clock.elapsedTime * 7) > 0;
    kit.beacon.color.set(flash ? "#ffb000" : "#4a2a00");
    const cull = frame.current++ % 10 === 0;
    barriers.forEach((b, i) => {
      const l = live.current[i];
      if (!l?.group) return;
      if (cull) l.group.visible = Math.hypot(b.position.x - cx, b.position.y - cy) < SHOW_WITHIN;
      if (!l.group.visible || !p || !l.boom) return;
      const rx = p.x - b.position.x, ry = p.y - b.position.y;
      const along = rx * b.dx + ry * b.dy, across = Math.abs(-rx * b.dy + ry * b.dx);
      const onRoad = across < b.width / 2 + 1.5, speed = Math.abs(p.speed);
      if (onRoad && Math.abs(along) > 2 && Math.abs(along) < 30) l.approach = speed;
      if (onRoad && Math.abs(along) < 1.8 && l.approach > GATE_SAFE_SPEED + 0.3 && !l.smashed) l.smashed = true;
      const wantOpen = onRoad && Math.abs(along) < 22 && l.approach <= GATE_SAFE_SPEED + 0.3;
      l.open += ((wantOpen ? 1 : 0) - l.open) * Math.min(1, dt * 2.5);
      if (l.smashed) {
        // The snapped boom lies twisted on the tarmac.
        l.boom.position.y += (0.12 - l.boom.position.y) * Math.min(1, dt * 6);
        l.boom.rotation.set(0, 0.45, 0);
      } else l.boom.rotation.x = -l.open * 1.4;
      if (l.man) l.man.rotation.z = l.open > 0.2 && !l.smashed ? Math.sin(clock.elapsedTime * 9) * 0.35 : 0;
    });
  });
  return <>{barriers.map((b, i) => <group key={b.id} ref={(g) => { live.current[i].group = g; }}
    position={[b.position.x, 0, -b.position.y]} rotation={[0, Math.atan2(b.dy, b.dx), 0]}>
    {GATE_KINDS.has(b.kind) ? <Gate b={b} kit={kit} live={live} i={i} /> : b.kind === "bollard" || b.kind === "block" ? <Bollards b={b} kit={kit} /> : <RoadBlock b={b} kit={kit} />}
  </group>)}</>;
}

/** Local frame: +x along the road, z across it (the road is `b.width` wide). */
function Gate({ b, kit, live, i }: { b: Barrier; kit: Kit; live: MutableRefObject<Live[]>; i: number }) {
  const half = b.width / 2, side = half + 0.75, span = 2 * side;
  return <>
    {[-1, 1].map((s) => <group key={s} position={[0, 0, s * side]}>
      <mesh geometry={kit.box} material={kit.pillar} position={[0, 1.6, 0]} scale={[0.8, 3.2, 0.8]} />
      <mesh geometry={kit.box} material={kit.cap} position={[0, 3.3, 0]} scale={[1, 0.25, 1]} />
      <mesh geometry={kit.box} material={kit.cap} position={[0, 0.15, 0]} scale={[0.95, 0.3, 0.95]} />
      <mesh geometry={kit.ball} material={kit.beacon} position={[0, 3.6, 0]} scale={0.38} />
    </group>)}
    {/* Overhead arch with the estate sign, readable from both directions. */}
    <mesh geometry={kit.box} material={kit.cap} position={[0, 4.15, 0]} scale={[0.5, 0.25, span + 1]} />
    <mesh geometry={kit.box} material={kit.hutTrim} position={[0, 4.75, 0]} scale={[0.25, 1, span * 0.8]} />
    {[-1, 1].map((s) => <mesh key={s} material={kit.sign} position={[s * 0.14, 4.75, 0]} rotation={[0, s * Math.PI / 2, 0]}>
      <planeGeometry args={[span * 0.78, 0.95]} />
    </mesh>)}
    {/* Boom arm hinged on one pillar. */}
    <group ref={(g) => { live.current[i].boom = g; }} position={[0, 1.05, -side + 0.35]}>
      <mesh geometry={kit.box} material={kit.boom} position={[0, 0, (span - 0.6) / 2]} scale={[0.14, 0.14, span - 0.6]} />
      <mesh geometry={kit.box} material={kit.pole} position={[0, 0, -0.3]} scale={[0.3, 0.3, 0.5]} />
    </group>
    {/* Gateman's hut and the gateman himself. */}
    <group position={[-2.2, 0, side + 2]}>
      <mesh geometry={kit.box} material={kit.hut} position={[0, 1.2, 0]} scale={[2, 2.4, 2]} />
      <mesh geometry={kit.box} material={kit.hutTrim} position={[0, 0.25, 0]} scale={[2.04, 0.5, 2.04]} />
      <mesh geometry={kit.box} material={kit.glass} position={[0, 1.55, -1.01]} scale={[1.4, 0.8, 0.04]} />
      <mesh geometry={kit.box} material={kit.glass} position={[1.01, 1.55, 0]} scale={[0.04, 0.8, 1.2]} />
      <mesh geometry={kit.box} material={kit.roof} position={[0, 2.5, 0]} scale={[2.6, 0.2, 2.6]} />
      <group ref={(g) => { live.current[i].man = g; }} position={[1.6, 0, -1.4]}>
        <mesh geometry={kit.box} material={kit.uniform} position={[0, 0.45, 0]} scale={[0.4, 0.9, 0.26]} />
        <mesh geometry={kit.box} material={kit.uniform} position={[0, 1.18, 0]} scale={[0.5, 0.62, 0.3]} />
        <mesh geometry={kit.box} material={kit.skin} position={[0, 1.66, 0]} scale={[0.26, 0.28, 0.26]} />
        <mesh geometry={kit.box} material={kit.uniform} position={[0, 1.84, 0]} scale={[0.32, 0.1, 0.34]} />
        <mesh geometry={kit.box} material={kit.uniform} position={[0, 1.75, -0.45]} scale={[0.12, 0.6, 0.12]} rotation={[0.9, 0, 0]} />
      </group>
    </group>
    {/* Hazard-striped speed bumps either side. */}
    {[-6, 6].map((x) => <mesh key={x} geometry={kit.box} material={kit.bump} position={[x, 0.12, 0]} scale={[0.6, 0.12, b.width]} />)}
  </>;
}

function Bollards({ b, kit }: { b: Barrier; kit: Kit }) {
  const n = Math.max(2, Math.round(b.width / 1.6)), gap = b.width / n;
  return <>
    {Array.from({ length: n + 1 }, (_, k) => {
      const z = -b.width / 2 + k * gap;
      return <group key={k} position={[0, 0, z]}>
        <mesh geometry={kit.cyl} material={kit.bollard} position={[0, 0.5, 0]} scale={[0.26, 1, 0.26]} />
        <mesh geometry={kit.ball} material={k % 2 ? kit.band : kit.beacon} position={[0, 1.05, 0]} scale={0.24} />
      </group>;
    })}
  </>;
}

function RoadBlock({ b, kit }: { b: Barrier; kit: Kit }) {
  const n = Math.max(2, Math.ceil(b.width / 1.9));
  return <>
    {Array.from({ length: n }, (_, k) => <mesh key={k} geometry={kit.jersey} material={kit.jerseyMat} position={[(k % 2) * 0.25, 0, -b.width / 2 + 0.95 + k * 1.9 * (b.width - 1.9) / Math.max(1, (n - 1) * 1.9)]} />)}
    {[-1, 1].map((s) => <group key={s} position={[-1.2, 0, s * (b.width / 2 + 0.6)]}>
      <mesh geometry={kit.cyl} material={kit.drum} position={[0, 0.5, 0]} scale={[0.6, 1, 0.6]} />
      <mesh geometry={kit.cyl} material={kit.band} position={[0, 0.45, 0]} scale={[0.62, 0.12, 0.62]} />
      <mesh geometry={kit.cyl} material={kit.band} position={[0, 0.75, 0]} scale={[0.62, 0.12, 0.62]} />
      <mesh geometry={kit.ball} material={kit.beacon} position={[0, 1.12, 0]} scale={0.28} />
    </group>)}
  </>;
}
