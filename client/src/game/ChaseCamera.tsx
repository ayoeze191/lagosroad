import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/** z is the visual elevation (bridge decks); the rest is the car's ground-plane pose. */
export type Follow = { x: number; y: number; heading: number; speed: number; topSpeed: number; z?: number };
export type Shake = { amount: number };

/** Smoothed third-person camera; widens FOV with speed and shakes on impacts. */
export function ChaseCamera({ target, shake }: { target: MutableRefObject<Follow>; shake: MutableRefObject<Shake> }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const heading = useRef<number | null>(null);
  const wanted = new THREE.Vector3();
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = target.current, cam = camera as THREE.PerspectiveCamera;
    // Heading lags a little so turns feel weighty, with wrap-around handled.
    if (heading.current === null) heading.current = t.heading;
    let diff = t.heading - heading.current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    heading.current += diff * (1 - Math.exp(-dt * 4));
    const h = heading.current, ratio = Math.min(1, Math.abs(t.speed) / t.topSpeed);
    const back = 8.5 + ratio * 3, height = 3.6 + ratio * 1.2;
    const z = t.z || 0;
    wanted.set(t.x - Math.sin(h) * back, height + z, -(t.y - Math.cos(h) * back));
    if (camera.position.distanceToSquared(wanted) > 900) camera.position.copy(wanted);
    else camera.position.lerp(wanted, 1 - Math.exp(-dt * 6));
    const s = shake.current;
    if (s.amount > 0.001) {
      camera.position.x += (Math.random() - 0.5) * s.amount;
      camera.position.y += (Math.random() - 0.5) * s.amount;
      s.amount *= Math.exp(-dt * 9);
    }
    look.current.set(t.x + Math.sin(h) * 6, 1.2 + z, -(t.y + Math.cos(h) * 6));
    camera.lookAt(look.current);
    const fov = 60 + ratio * 14;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3)); cam.updateProjectionMatrix(); }
  });
  return null;
}
