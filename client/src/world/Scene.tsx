import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import type { MapData } from "../../../shared/types.js";
import type { Follow } from "../game/ChaseCamera";
import { buildWorld, TILE } from "./buildWorld";
import { Barriers } from "./Barriers";
import { JamView } from "./TrafficView";
import { Places } from "./Places";
import { StreetSigns } from "./StreetSigns";
import { Bloom, Environment, HIGH_QUALITY, Lighting, Sky } from "./look";
import { groundTexture } from "./textures";

const FOG_NEAR = 140, FOG_FAR = 380, DRAW_DISTANCE = 420;

const worldCache = new WeakMap<MapData, ReturnType<typeof buildWorld>>();
/** Built once per map and kept, so going back to the garage and driving again is instant. */
export function getWorld(map: MapData) {
  let world = worldCache.get(map);
  if (!world) { world = buildWorld(map); worldCache.set(map, world); }
  return world;
}

/** Static world: tiles beyond the fog are hidden so phones only draw what's near. */
function Tiles({ map, potholes, night }: { map: MapData; potholes: boolean; night: boolean }) {
  const world = useMemo(() => getWorld(map), [map]);
  useEffect(() => { for (const mesh of world.potholes) mesh.visible = potholes; }, [world, potholes]);
  useEffect(() => world.setNight(night), [world, night]);
  const frame = useRef(0);
  useFrame(({ camera }) => {
    if (frame.current++ % 8) return;
    const cx = camera.position.x, cy = -camera.position.z;
    for (const tile of world.tiles) {
      const dx = Math.max(tile.minX - cx, 0, cx - (tile.minX + TILE));
      const dy = Math.max(tile.minY - cy, 0, cy - (tile.minY + TILE));
      tile.object.visible = dx * dx + dy * dy < DRAW_DISTANCE * DRAW_DISTANCE;
    }
  });
  return <primitive object={world.group} />;
}

function Ground({ night }: { night: boolean }) {
  const texture = useMemo(() => { const t = groundTexture(); t.repeat.set(300, 300); return t; }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
    <planeGeometry args={[12000, 12000]} />
    <meshStandardMaterial map={texture} roughness={1} color={night ? "#5a6070" : "#ffffff"} />
  </mesh>;
}

/**
 * The 3D world on the real map: sky, light, wet roads, buildings, streetlights, signs, gates.
 * `night` switches to the Need-for-Speed night look. `player` lets estate gatemen see you coming.
 */
export function Scene({ map, potholes = true, night = true, goSlow = false, player, children }: { map: MapData; potholes?: boolean; night?: boolean; goSlow?: boolean; player?: MutableRefObject<Follow>; children?: ReactNode }) {
  return <>
    <Environment night={night} />
    <Sky night={night} />
    <Lighting night={night} fogNear={FOG_NEAR} fogFar={FOG_FAR} />
    {HIGH_QUALITY && <Bloom strength={night ? 0.42 : 0.15} />}
    <Ground night={night} />
    <Tiles map={map} potholes={potholes} night={night} />
    <StreetSigns map={map} />
    <Barriers map={map} player={player} />
    {goSlow && <JamView map={map} />}
    <Places map={map} />
    {children}
  </>;
}

/** Tall glowing column visible above the rooftops, so you always know where the finish is. */
export function Beacon({ x, y, colour, height = 60 }: { x: number; y: number; colour: string; height?: number }) {
  return <group position={[x, 0, -y]}>
    <mesh position={[0, height / 2, 0]}>
      <cylinderGeometry args={[2.2, 2.2, height, 12, 1, true]} />
      <meshBasicMaterial color={colour} transparent opacity={0.45} fog={false} depthWrite={false} />
    </mesh>
    <mesh position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[10, 13, 32]} />
      <meshBasicMaterial color={colour} />
    </mesh>
  </group>;
}

/** Checkered start line painted across the road, perpendicular to the start heading. */
export function StartLine({ x, y, heading, width = 12 }: { x: number; y: number; heading: number; width?: number }) {
  const squares = useMemo(() => {
    const list: [number, number, boolean][] = [];
    const n = Math.round(width / 1);
    for (let i = 0; i < n; i++) for (let row = 0; row < 2; row++) list.push([i - (n - 1) / 2, row - 0.5, (i + row) % 2 === 0]);
    return list;
  }, [width]);
  return <group position={[x, 0.13, -y]} rotation={[0, -heading, 0]}>
    {squares.map(([sx, sz, white], i) => <mesh key={i} position={[sx, 0, sz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={white ? "#f4f4f4" : "#1a1a1a"} />
    </mesh>)}
  </group>;
}

/** Keeps the renderer honest on slow phones by stepping resolution down when FPS drops. */
export function AdaptiveResolution() {
  const { setDpr } = useThree();
  const stats = useRef({ frames: 0, time: 0, dpr: Math.min(1.5, window.devicePixelRatio || 1) });
  useEffect(() => setDpr(stats.current.dpr), [setDpr]);
  useFrame((_, dt) => {
    const s = stats.current;
    s.frames++; s.time += dt;
    if (s.time < 2) return;
    const fps = s.frames / s.time;
    s.frames = 0; s.time = 0;
    const next = fps < 40 ? Math.max(0.6, s.dpr - 0.2) : fps > 57 ? Math.min(Math.min(1.5, window.devicePixelRatio || 1), s.dpr + 0.1) : s.dpr;
    if (Math.abs(next - s.dpr) > 0.01) { s.dpr = next; setDpr(next); }
  });
  return null;
}
