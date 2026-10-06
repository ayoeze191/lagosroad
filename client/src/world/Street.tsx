import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { POLICE_CAR, type CarSpec } from "../../../shared/cars.js";
import type { MapIndex } from "../../../shared/spatial.js";
import type { Traffic } from "../../../shared/traffic.js";
import { CarModel, type Livery } from "./CarModel";
import { elevationAt } from "./elevation";

const box = new THREE.BoxGeometry(1, 1, 1);
const pole = new THREE.MeshLambertMaterial({ color: "#8d949b" });
const sign = new THREE.MeshLambertMaterial({ color: "#f5b700" });
const signText = new THREE.MeshLambertMaterial({ color: "#1a1a1a" });
const shirt = new THREE.MeshLambertMaterial({ color: "#e0b000" });
const trousers = new THREE.MeshLambertMaterial({ color: "#2d2f36" });
const skin = new THREE.MeshLambertMaterial({ color: "#6b4428" });
const shelter = new THREE.MeshLambertMaterial({ color: "#3b6e8f" });

/** Bus stops (yellow sign + small shelter) with an agbero waiting at each one. */
export function BusStops({ traffic }: { traffic: Traffic }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const men = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ camera, clock }) => {
    const cx = camera.position.x, cy = -camera.position.z;
    traffic.agberoPosts.forEach((post, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.visible = Math.hypot(post.x - cx, post.y - cy) < 300;
      // The agbero bounces and waves at passing buses.
      const man = men.current[i];
      if (g.visible && man) man.position.y = Math.abs(Math.sin(clock.elapsedTime * 3 + i)) * 0.12;
    });
  });
  return <>{traffic.agberoPosts.map((post, i) => <group key={post.id} ref={(g) => { groups.current[i] = g; }} position={[post.x, 0, -post.y]} rotation={[0, -post.heading, 0]}>
    <mesh geometry={box} material={pole} position={[1.6, 1.4, 0]} scale={[0.1, 2.8, 0.1]} />
    <mesh geometry={box} material={sign} position={[1.6, 2.9, 0]} scale={[0.08, 0.7, 1.4]} />
    <mesh geometry={box} material={signText} position={[1.64, 2.9, 0]} scale={[0.02, 0.18, 1.0]} />
    <mesh geometry={box} material={shelter} position={[2.8, 2.5, 0]} scale={[1.8, 0.1, 3.2]} />
    <mesh geometry={box} material={pole} position={[3.6, 1.25, 1.5]} scale={[0.08, 2.5, 0.08]} />
    <mesh geometry={box} material={pole} position={[3.6, 1.25, -1.5]} scale={[0.08, 2.5, 0.08]} />
    <group ref={(g) => { men.current[i] = g; }} position={[0.6, 0, 0]}>
      <mesh geometry={box} material={trousers} position={[0, 0.45, 0]} scale={[0.42, 0.9, 0.26]} />
      <mesh geometry={box} material={shirt} position={[0, 1.2, 0]} scale={[0.5, 0.65, 0.3]} />
      <mesh geometry={box} material={shirt} position={[-0.35, 1.55, 0]} scale={[0.14, 0.6, 0.14]} rotation={[0, 0, 0.5]} />
      <mesh geometry={box} material={skin} position={[0, 1.7, 0]} scale={[0.27, 0.3, 0.27]} />
    </group>
  </group>)}</>;
}

export type ChaserPose = { active: boolean; x: number; y: number; heading: number };

const AGBERO_BIKE: CarSpec = { ...POLICE_CAR, id: "agbero-bike", body: "bike", colour: "#b8202b", length: 2.1, width: 0.8 };

/** A police car or agbero okada that eases towards its latest known pose. */
export function ChaserView({ pose, livery, index }: { pose: MutableRefObject<ChaserPose>; livery: Livery; index: MapIndex }) {
  const group = useRef<THREE.Group>(null);
  const shown = useRef({ x: 0, y: 0, heading: 0, z: 0, fresh: true });
  const spec = useMemo(() => (livery === "police" ? POLICE_CAR : AGBERO_BIKE), [livery]);
  useFrame((_, dt) => {
    const g = group.current, p = pose.current, s = shown.current;
    if (!g) return;
    g.visible = p.active;
    if (!p.active) { s.fresh = true; return; }
    const k = s.fresh ? 1 : 1 - Math.exp(-dt * 12);
    s.fresh = false;
    s.x += (p.x - s.x) * k;
    s.y += (p.y - s.y) * k;
    s.heading += Math.atan2(Math.sin(p.heading - s.heading), Math.cos(p.heading - s.heading)) * k;
    s.z += (elevationAt(index, s, s.z) - s.z) * Math.min(1, dt * 8);
    g.position.set(s.x, s.z, -s.y);
    g.rotation.set(0, -s.heading, 0);
  });
  return <CarModel ref={group} spec={spec} livery={livery} />;
}
