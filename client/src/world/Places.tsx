import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MapData, Place } from "../../../shared/types.js";

const SIGN_RADIUS = 220, LANDMARK_RADIUS = 650, MAX_SIGNS = 10, MAX_LANDMARKS = 6;

const textures = new Map<string, { texture: THREE.Texture; aspect: number }>();
/** Yellow Lagos bus-stop sign ("BUS STOP" over the stop's name), or a landmark pin label. */
function texture(place: Place) {
  const key = `${place.kind}:${place.name}`;
  let t = textures.get(key);
  if (t) return t;
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
  const bus = place.kind === "bus_stop";
  const font = "italic 800 54px 'Barlow Condensed', system-ui, sans-serif";
  ctx.font = font;
  const name = place.name.replace(/ bus stop$/i, "").toUpperCase();
  canvas.width = Math.max(320, Math.ceil(ctx.measureText(name).width) + 70);
  canvas.height = bus ? 150 : 96;
  if (bus) {
    ctx.fillStyle = "#ffd200"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, 50);
    ctx.fillStyle = "#ffd200"; ctx.font = "900 34px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🚌 BUS STOP", canvas.width / 2, 27);
    ctx.fillStyle = "#111"; ctx.font = font; ctx.fillText(name, canvas.width / 2, 100);
  } else {
    ctx.fillStyle = "#07080cdd"; ctx.beginPath(); ctx.roundRect(0, 0, canvas.width, canvas.height, 18); ctx.fill();
    ctx.fillStyle = "#19e3ff"; ctx.fillRect(0, canvas.height - 8, canvas.width, 8);
    ctx.fillStyle = "#fff"; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`📍 ${name}`, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  t = { texture, aspect: canvas.width / canvas.height };
  textures.set(key, t);
  return t;
}

const pole = new THREE.MeshStandardMaterial({ color: "#2b2e33", metalness: 0.6, roughness: 0.4 });

/**
 * Real places from OpenStreetMap in the 3D city: a yellow BUS STOP sign at each of the nearest stops,
 * and big floating labels over landmarks (markets, malls, stadiums…) so you know where you are.
 */
export function Places({ map }: { map: MapData }) {
  const stops = useMemo(() => (map.places || []).filter((p) => p.kind === "bus_stop"), [map]);
  const landmarks = useMemo(() => (map.places || []).filter((p) => p.kind === "landmark"), [map]);
  const [near, setNear] = useState<{ stops: Place[]; landmarks: Place[] }>({ stops: [], landmarks: [] });
  const frame = useRef(0), last = useRef("");
  useFrame(({ camera }) => {
    if (frame.current++ % 30) return;
    const cx = camera.position.x, cy = -camera.position.z;
    const pick = (list: Place[], radius: number, max: number) => list
      .map((p) => ({ p, d: Math.hypot(p.x - cx, p.y - cy) })).filter((e) => e.d < radius)
      .sort((a, b) => a.d - b.d).slice(0, max).map((e) => e.p);
    const next = { stops: pick(stops, SIGN_RADIUS, MAX_SIGNS), landmarks: pick(landmarks, LANDMARK_RADIUS, MAX_LANDMARKS) };
    const key = [...next.stops, ...next.landmarks].map((p) => p.name + p.x).join("|");
    if (key !== last.current) { last.current = key; setNear(next); }
  });
  useEffect(() => () => { textures.forEach((t) => t.texture.dispose()); textures.clear(); }, []);
  return <>
    {near.stops.map((p) => {
      const t = texture(p), h = 1.1, w = h * t.aspect;
      return <group key={`s${p.name}${p.x}`} position={[p.x, 0, -p.y]}>
        <mesh material={pole} position={[0, 1.6, 0]}><cylinderGeometry args={[0.06, 0.06, 3.2, 6]} /></mesh>
        <sprite position={[0, 3.4, 0]} scale={[w, h, 1]}><spriteMaterial map={t.texture} toneMapped={false} /></sprite>
      </group>;
    })}
    {near.landmarks.map((p) => {
      const t = texture(p), h = 3.2;
      return <sprite key={`l${p.name}${p.x}`} position={[p.x, 26, -p.y]} scale={[h * t.aspect, h, 1]}>
        <spriteMaterial map={t.texture} toneMapped={false} fog={false} />
      </sprite>;
    })}
  </>;
}
