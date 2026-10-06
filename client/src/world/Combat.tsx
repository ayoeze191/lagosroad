import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { MapIndex } from "../../../shared/spatial.js";
import { findTarget, type Target, type WeaponStats } from "../../../shared/weapons.js";
import type { Follow } from "../game/ChaseCamera";

export type Shot = { from: string; to: string; x1: number; y1: number; x2: number; y2: number; at: number; hit: boolean };

const GUN_HEIGHT = 1.4;

function reticleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
  for (const [x1, y1, x2, y2] of [[64, 4, 64, 34], [64, 94, 64, 124], [4, 64, 34, 64], [94, 64, 124, 64]]) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(64, 64, 5, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Lock-on crosshair. It sits ahead of your car and turns with it; when a rival is inside your aim
 * cone, in range and in clear view, it snaps onto them and turns red. Uses the same `findTarget`
 * as the server, so a red lock means the shot will land.
 */
export function Crosshair({ index, me, weapon, targets, lock }: {
  index: MapIndex; me: MutableRefObject<Follow>; weapon: WeaponStats; targets: () => Target[]; lock: MutableRefObject<string>;
}) {
  const sprite = useRef<THREE.Sprite>(null);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true, toneMapped: false }), []);
  const frame = useRef(0), locked = useRef<Target | undefined>(undefined);
  useFrame(({ camera, clock }) => {
    const s = sprite.current, f = me.current;
    if (!s) return;
    const list = targets();
    if (frame.current++ % 3 === 0) locked.current = findTarget(index, f, weapon, list); // ~20 Hz is plenty
    const t = locked.current && list.find((x) => x.id === locked.current!.id);
    lock.current = t?.id || "";
    const at = t || { x: f.x + Math.sin(f.heading) * weapon.range * 0.55, y: f.y + Math.cos(f.heading) * weapon.range * 0.55 };
    s.position.set(at.x, GUN_HEIGHT + (f.z || 0), -at.y);
    const d = s.position.distanceTo(camera.position);
    const pulse = t ? 1 + Math.sin(clock.elapsedTime * 14) * 0.08 : 1;
    s.scale.setScalar(Math.max(1.6, d * 0.055) * pulse);
    material.color.set(t ? "#ff2a3c" : "#ffffff");
    material.opacity = t ? 1 : 0.7;
  });
  return <sprite ref={sprite} material={material} renderOrder={20} />;
}

/** Tracers, muzzle flashes and sparks for recent shots (from the server's broadcast). */
export function ShotEffects({ shots }: { shots: MutableRefObject<Shot[]> }) {
  const MAX = 24;
  const lines = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 6), 3));
    const material = new THREE.LineBasicMaterial({ color: "#ffd27a", transparent: true, toneMapped: false });
    material.color.multiplyScalar(2);
    const l = new THREE.LineSegments(geometry, material);
    l.frustumCulled = false;
    return l;
  }, []);
  const flashes = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb347").multiplyScalar(3), toneMapped: false }), MAX * 2);
    m.frustumCulled = false;
    return m;
  }, []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), []);
  useFrame(() => {
    const now = performance.now();
    shots.current = shots.current.filter((s) => now - s.at < 260);
    const pos = lines.geometry.attributes.position as THREE.BufferAttribute;
    let n = 0, f = 0;
    for (const s of shots.current.slice(-MAX)) {
      const age = (now - s.at) / 260;
      if (age < 0.5) { pos.setXYZ(n * 2, s.x1, GUN_HEIGHT, -s.y1); pos.setXYZ(n * 2 + 1, s.x2, GUN_HEIGHT - 0.2, -s.y2); n++; }
      const size = 1 - age;
      flashes.setMatrixAt(f++, tmp.m.compose(tmp.p.set(s.x1, GUN_HEIGHT + 0.3, -s.y1), tmp.q, tmp.s.setScalar(age < 0.3 ? size : 0.0001)));
      if (s.hit) flashes.setMatrixAt(f++, tmp.m.compose(tmp.p.set(s.x2, 1, -s.y2), tmp.q, tmp.s.setScalar(size * 1.4)));
    }
    lines.geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    flashes.count = f;
    flashes.instanceMatrix.needsUpdate = true;
  });
  return <><primitive object={lines} /><primitive object={flashes} /></>;
}
