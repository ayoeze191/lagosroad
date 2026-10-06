import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MapData } from "../../../shared/types.js";
import { labelAnchors } from "./labels";

const POOL = 14; // signs on screen at once
const RADIUS = 170; // metres
const SIGN_HEIGHT = 1.3; // metres
const POLE_HEIGHT = 3.4;

/** Green Lagos-style street sign, drawn once per street name. */
function signTexture(name: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 44px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.font = font;
  const text = name.length > 32 ? `${name.slice(0, 31)}…` : name;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.height = 76;
  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(0, 0, canvas.width, canvas.height, 12); ctx.fill();
  ctx.fillStyle = "#17693a";
  ctx.beginPath(); ctx.roundRect(5, 5, canvas.width - 10, canvas.height - 10, 9); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * Street-name signs on poles beside the road. All named streets have fixed anchor points,
 * but only the nearest few get a sign at any moment, so it costs a handful of draw calls.
 */
export function StreetSigns({ map }: { map: MapData }) {
  const anchors = useMemo(() => labelAnchors(map), [map]);
  const textures = useRef(new Map<string, ReturnType<typeof signTexture>>());
  const pool = useMemo(() => {
    const poleGeometry = new THREE.CylinderGeometry(0.06, 0.06, POLE_HEIGHT, 5).translate(0, POLE_HEIGHT / 2, 0);
    const poleMaterial = new THREE.MeshLambertMaterial({ color: "#9aa0a6" });
    return Array.from({ length: POOL }, () => {
      const group = new THREE.Group();
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
      sprite.position.y = POLE_HEIGHT + SIGN_HEIGHT / 2 - 0.1;
      group.add(new THREE.Mesh(poleGeometry, poleMaterial), sprite);
      group.visible = false;
      return { group, sprite };
    });
  }, []);
  const root = useMemo(() => { const g = new THREE.Group(); pool.forEach((p) => g.add(p.group)); return g; }, [pool]);
  const last = useRef(0);

  useEffect(() => () => {
    textures.current.forEach((t) => t.texture.dispose());
    textures.current.clear();
    pool.forEach((p) => p.sprite.material.dispose());
  }, [pool]);

  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - last.current < 0.3) return;
    last.current = clock.elapsedTime;
    const cx = camera.position.x, cy = -camera.position.z;
    const near: { a: (typeof anchors)[number]; d: number }[] = [];
    for (const a of anchors) {
      const d = Math.hypot(a.x - cx, a.y - cy);
      if (d < RADIUS) near.push({ a, d });
    }
    near.sort((p, q) => p.d - q.d);
    pool.forEach((slot, i) => {
      const hit = near[i];
      slot.group.visible = !!hit;
      if (!hit) return;
      let tex = textures.current.get(hit.a.name);
      if (!tex) { tex = signTexture(hit.a.name); textures.current.set(hit.a.name, tex); }
      if (slot.sprite.material.map !== tex.texture) { slot.sprite.material.map = tex.texture; slot.sprite.material.needsUpdate = true; }
      const scale = hit.a.major ? 1.25 : 1;
      slot.sprite.scale.set(SIGN_HEIGHT * tex.aspect * scale, SIGN_HEIGHT * scale, 1);
      slot.group.position.set(hit.a.x, 0, -hit.a.y);
    });
  });

  return <primitive object={root} />;
}
