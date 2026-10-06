import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MapIndex } from "../../../shared/spatial.js";

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  paint(canvas.getContext("2d")!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Racer marker floating over a car: a down arrow in their paint colour and a name tag (with their
 * place). Drawn on top of everything, and grows with distance so you can spot rivals across town.
 */
export function PlayerTag({ name, colour, place, you, health }: { name: string; colour: string; place?: number; you?: boolean; health?: number }) {
  const group = useRef<THREE.Group>(null);
  const label = you ? "YOU" : name.toUpperCase();
  const tag = useMemo(() => canvasTexture(512, 128, (ctx) => {
    ctx.font = "italic 900 64px 'Barlow Condensed', system-ui, sans-serif";
    const text = place ? `${place}  ${label}` : label;
    const w = Math.min(500, ctx.measureText(text).width + 64);
    const x0 = (512 - w) / 2;
    ctx.fillStyle = "#07080cdd";
    ctx.beginPath(); ctx.moveTo(x0 + 18, 12); ctx.lineTo(x0 + w, 12); ctx.lineTo(x0 + w - 18, 116); ctx.lineTo(x0, 116); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colour; ctx.fillRect(x0 + 10, 108, w - 20, 8);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 256, 64, w - 40);
    if (health !== undefined) { // health bar under the name
      ctx.fillStyle = "#000a"; ctx.fillRect(x0 + 10, 108, w - 20, 14);
      ctx.fillStyle = health > 60 ? "#34ff8a" : health > 30 ? "#ffd23f" : "#ff3b4e"; ctx.fillRect(x0 + 10, 108, (w - 20) * health / 100, 14);
    }
  }), [label, colour, place, health]);
  useEffect(() => () => tag.dispose(), [tag]);
  const arrow = useMemo(() => new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, toneMapped: false }), [colour]);
  useEffect(() => () => arrow.dispose(), [arrow]);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }) => {
    const g = group.current;
    if (!g) return;
    g.getWorldPosition(world);
    const d = world.distanceTo(camera.position);
    g.scale.setScalar(Math.max(1, d / 28) * (you ? 0.75 : 1));
    g.position.y = 3.4 + Math.sin(clock.elapsedTime * 3) * 0.12;
    g.children[1].rotation.y = clock.elapsedTime * 2.5; // spin the arrow
  });
  return <group ref={group} position={[0, 3.4, 0]}>
    <sprite position={[0, 1.15, 0]} scale={[3.2, 0.8, 1]} renderOrder={10}>
      <spriteMaterial map={tag} depthTest={false} transparent toneMapped={false} />
    </sprite>
    <mesh material={arrow} rotation={[Math.PI, 0, 0]} renderOrder={10}>
      <coneGeometry args={[0.45, 0.9, 4]} />
    </mesh>
  </group>;
}

/** Road direction and width at a point (for laying lines across it). */
export function roadAt(index: MapIndex, x: number, y: number, fallbackHeading: number) {
  const hit = index.roads.nearest({ x, y }, 40);
  if (!hit) return { heading: fallbackHeading, width: 12 };
  return { heading: Math.atan2(hit.dx, hit.dy), width: index.map.roads[hit.road].width };
}

/**
 * Start/finish gate: a checkered line across the whole road and an overhead arch with a glowing banner.
 * `heading` is the road direction (0 = north).
 */
export function RaceGate({ x, y, heading, width, label, colour }: { x: number; y: number; heading: number; width: number; label: "START" | "FINISH"; colour: string }) {
  const w = Math.max(6, width + 1);
  const checker = useMemo(() => {
    const t = canvasTexture(64, 16, (ctx) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? "#151515" : "#f4f4f4"; ctx.fillRect(i * 4, j * 4, 4, 4); }
    });
    t.magFilter = THREE.NearestFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(w / 4, 1);
    return t;
  }, [w]);
  const banner = useMemo(() => canvasTexture(1024, 160, (ctx) => {
    for (let i = 0; i < 64; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? "#151515" : "#f4f4f4"; ctx.fillRect(i * 16, j === 0 ? 0 : 144, 16, 16); }
    ctx.fillStyle = colour; ctx.fillRect(0, 16, 1024, 128);
    ctx.font = "italic 900 110px 'Barlow Condensed', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 512, 84);
  }), [label, colour]);
  useEffect(() => () => { checker.dispose(); banner.dispose(); }, [checker, banner]);
  const H = 6.2;
  return <group position={[x, 0, -y]} rotation={[0, -heading, 0]}>
    <mesh position={[0, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, 2]} />
      <meshBasicMaterial map={checker} toneMapped={false} />
    </mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[s * (w / 2 + 0.4), H / 2, 0]}>
      <boxGeometry args={[0.45, H, 0.45]} />
      <meshStandardMaterial color="#1b1d24" metalness={0.6} roughness={0.35} />
    </mesh>)}
    {[-1, 1].map((s) => <mesh key={`f${s}`} position={[0, H + 0.6, s * 0.16]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
      <planeGeometry args={[w + 1.2, 1.6]} />
      <meshBasicMaterial map={banner} toneMapped={false} side={THREE.FrontSide} />
    </mesh>)}
    <mesh position={[0, H + 0.6, 0]}>
      <boxGeometry args={[w + 1.3, 1.7, 0.28]} />
      <meshStandardMaterial color="#111318" metalness={0.5} roughness={0.4} />
    </mesh>
  </group>;
}
