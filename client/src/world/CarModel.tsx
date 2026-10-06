import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CarSpec } from "../../../shared/cars.js";
import { carGeometry, ROLE_COLOURS, type Role } from "./carGeometry";
import { glow, NIGHT } from "./look";
import { useRealModel } from "./realModels";

const shadow = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.35, depthWrite: false });
const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const box = new THREE.BoxGeometry(1, 1, 1);

const std = (color: string, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
/** Unlit and brighter than white, so the bloom pass makes lamps glow. */
const lamp = (color: string, boost: number) => { const m = new THREE.MeshBasicMaterial({ color, toneMapped: false }); m.color.multiplyScalar(boost); return m; };
/** Shared materials for everything but the paint. */
const MATERIALS: Record<Exclude<Role, "paint" | "shirt">, THREE.Material> = {
  glass: new THREE.MeshPhysicalMaterial({ color: ROLE_COLOURS.glass, roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6 }),
  trim: std(ROLE_COLOURS.trim, 0.55),
  chrome: std(ROLE_COLOURS.chrome, 0.12, 1),
  rim: std(ROLE_COLOURS.rim, 0.25, 0.9),
  tyre: std(ROLE_COLOURS.tyre, 0.92),
  light: lamp(ROLE_COLOURS.light, 1.5),
  tail: lamp(ROLE_COLOURS.tail, 1.3),
  amber: lamp(ROLE_COLOURS.amber, 1.2),
  red: std(ROLE_COLOURS.red, 0.6),
  blue: std(ROLE_COLOURS.blue, 0.5),
  skin: std(ROLE_COLOURS.skin, 0.8),
  helmet: std(ROLE_COLOURS.helmet, 0.25, 0.3)
};
const SHIRTS = { agbero: std("#e0b000", 0.8), default: std(ROLE_COLOURS.shirt, 0.8) };

export type Livery = "police" | "agbero";

/**
 * Vehicle facing -z (three.js forward), origin at ground level. Uses a real 3D model from
 * /cars/<car id>.glb when one is installed (see public/cars/README.md), else the procedural lookalike.
 */
export const CarModel = forwardRef<THREE.Group, { spec: CarSpec; highlight?: boolean; livery?: Livery; headlights?: boolean; armed?: boolean }>(function CarModel({ spec, highlight, livery, headlights, armed }, ref) {
  // Metallic paint under a glossy clearcoat, like a showroom car.
  const paint = useMemo(() => new THREE.MeshPhysicalMaterial({ color: spec.colour, metalness: 0.55, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06, emissive: highlight ? spec.colour : "#000", emissiveIntensity: highlight ? 0.04 : 0 }), [spec.colour, highlight]);
  useEffect(() => () => paint.dispose(), [paint]);
  const real = useRealModel(livery ? undefined : spec);
  const parts = useMemo(() => Object.entries(carGeometry(spec.body, spec.length, spec.width, livery, armed && !!spec.weapon)) as [Role, THREE.BufferGeometry][], [spec.body, spec.length, spec.width, livery, armed, spec.weapon]);
  return <group ref={ref}>
    <mesh geometry={shadowGeometry} material={shadow} scale={[spec.width * 1.25, 1, spec.length * 1.1]} position={[0, 0.03, 0]} />
    {real
      ? <primitive object={real} />
      : parts.map(([role, geometry]) => <mesh key={role} geometry={geometry} castShadow={role === "paint"}
        material={role === "paint" ? paint : role === "shirt" ? SHIRTS[livery === "agbero" ? "agbero" : "default"] : MATERIALS[role]} />)}
    {headlights && <Headlights length={spec.length} />}
    {livery === "police" && <LightBar y={1.5} />}
  </group>;
});

/** Real headlight beams at night: a spotlight that lights the road and buildings, plus a glow on the tarmac. */
function Headlights({ length }: { length: number }) {
  const light = useRef<THREE.SpotLight>(null), pool = useRef<THREE.Mesh>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0, -30); return o; }, []);
  useFrame(() => {
    const on = NIGHT.value > 0.5;
    if (light.current) light.current.intensity = on ? 80 : 0;
    if (pool.current) pool.current.visible = on;
  });
  return <>
    <primitive object={target} />
    <spotLight ref={light} position={[0, 0.8, -length / 2]} target={target} angle={0.42} penumbra={0.55} distance={70} decay={1.4} color="#fff1d0" />
    <mesh ref={pool} position={[0, 0.06, -length / 2 - 9]} rotation={[-Math.PI / 2, 0, 0]} scale={[7, 18, 1]} renderOrder={2}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={glow()} color="#ffe6b8" transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  </>;
}

/** Flashing red/blue bar on the police car's roof. */
function LightBar({ y }: { y: number }) {
  const red = useRef<THREE.MeshBasicMaterial>(null), blue = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const on = Math.floor(clock.elapsedTime * 6) % 2 === 0;
    red.current?.color.set(on ? "#ff2020" : "#400000").multiplyScalar(on ? 2 : 1);
    blue.current?.color.set(on ? "#001040" : "#2050ff").multiplyScalar(on ? 1 : 2);
  });
  return <>
    <mesh position={[0, y - 0.04, 0.1]} scale={[1.2, 0.06, 0.3]} geometry={box} material={MATERIALS.trim} />
    <mesh position={[-0.33, y + 0.04, 0.1]} scale={[0.55, 0.14, 0.28]} geometry={box}><meshBasicMaterial ref={red} toneMapped={false} /></mesh>
    <mesh position={[0.33, y + 0.04, 0.1]} scale={[0.55, 0.14, 0.28]} geometry={box}><meshBasicMaterial ref={blue} toneMapped={false} /></mesh>
  </>;
}

/** Garage turntable: the picked car slowly spinning under studio lights. */
export function CarTurntable({ spec }: { spec: CarSpec }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.5; });
  return <group>
    <CarModel ref={group} spec={spec} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
      <circleGeometry args={[Math.max(3.4, spec.length * 0.7), 48]} />
      <meshStandardMaterial color="#14161d" roughness={0.18} metalness={0.4} />
    </mesh>
  </group>;
}
