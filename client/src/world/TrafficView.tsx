import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type MutableRefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MapIndex } from "../../../shared/spatial.js";
import type { Pose, Traffic, TrafficKind } from "../../../shared/traffic.js";
import { jamCars } from "../../../shared/jams.js";
import type { MapData, Point } from "../../../shared/types.js";
import type { CarBody } from "../../../shared/cars.js";
import { carGeometry, ROLE_COLOURS, type Role } from "./carGeometry";
import { PEDESTRIAN_HIT_SPEED } from "../../../shared/sim.js";
import { elevationAt } from "./elevation";
import { ANKARA, crowdMesh, flushLooks, peopleMaterial, POSES, setLook, SHIRTS, SKIN_TONES, TROUSERS } from "./people";

const KNOCKED_SECONDS = 4;
const hashId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };

const VIEW = 220; // metres
const MAX_PER_KIND = 90, MAX_WALKERS = 160;

type Part = { size: [number, number, number]; at: [number, number, number]; colour: string };
const paintVertices = (g: THREE.BufferGeometry, colour: string) => {
  const c = new THREE.Color(colour), colours = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) { colours[i] = c.r; colours[i + 1] = c.g; colours[i + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return g;
};
/** Merge coloured boxes into one geometry; white parts take the per-instance paint colour. */
function model(parts: Part[]) {
  return mergeGeometries(parts.map((p) => paintVertices(new THREE.BoxGeometry(...p.size).translate(...p.at).toNonIndexed(), p.colour)))!;
}
/** The same lookalike vehicles the players drive, baked into one vertex-coloured geometry (paint stays white). */
function vehicle(body: CarBody, length: number, width: number) {
  const parts = Object.entries(carGeometry(body, length, width)) as [Role, THREE.BufferGeometry][];
  return mergeGeometries(parts.map(([role, g]) => {
    const copy = g.clone();
    copy.deleteAttribute("uv");
    return paintVertices(copy, ROLE_COLOURS[role]);
  }))!;
}

const W = "#ffffff", SKIN = "#6b4428";
const MODELS: Record<TrafficKind, () => THREE.BufferGeometry> = {
  danfo: () => vehicle("bus", 4.6, 2),
  car: () => vehicle("sedan", 4.2, 1.8),
  keke: () => vehicle("keke", 2.6, 1.3),
  okada: () => vehicle("bike", 1.9, 0.8)
};


const PAINT: Record<TrafficKind, string[]> = {
  danfo: ["#f5b700"],
  car: ["#c9ccd1", "#2b2d31", "#7a1f2b", "#1f4e79", "#f2f2f2", "#555b61", "#9c7a3c", "#2e5e3a"],
  keke: ["#2bb673", "#f5b700", "#1f7ae0"],
  okada: ["#e67e22", "#2980b9", "#8e44ad", "#27ae60", "#c0392b", "#f1c40f", "#ecf0f1", "#16a085"]
};

/**
 * Draws the deterministic traffic and pedestrians near the camera for time `time.current`.
 * `player` lets pedestrians visibly jump out of the way of the local car.
 */
export function TrafficView({ traffic, index, time, player }: { traffic: Traffic; index: MapIndex; time: MutableRefObject<number>; player: MutableRefObject<Point & { speed: number }> }) {
  const meshes = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
    const make = (g: THREE.BufferGeometry, n: number) => {
      const mesh = new THREE.InstancedMesh(g, material, n);
      mesh.frustumCulled = false; // instances move every frame; we cull by distance ourselves
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      return mesh;
    };
    const kinds = Object.keys(MODELS) as TrafficKind[];
    return {
      material,
      vehicles: Object.fromEntries(kinds.map((k) => [k, make(MODELS[k](), MAX_PER_KIND)])) as unknown as Record<TrafficKind, THREE.InstancedMesh>,

      paints: Object.fromEntries(kinds.map((k) => [k, PAINT[k].map((c) => new THREE.Color(c))])) as Record<TrafficKind, THREE.Color[]>
    };
  }, []);
  const crowd = useMemo(() => {
    const material = peopleMaterial();
    const meshes = (["man", "woman"] as const).map((build) => POSES.map((pose) => crowdMesh(build, pose, material, MAX_WALKERS)));
    return { material, meshes, counts: meshes.map((row) => row.map(() => 0)) };
  }, []);
  const knocked = useMemo(() => new Map<string, { at: number; x: number; y: number }>(), []);
  const group = useMemo(() => { const g = new THREE.Group(); Object.values(meshes.vehicles).forEach((m) => g.add(m)); crowd.meshes.flat().forEach((m) => g.add(m)); return g; }, [meshes, crowd]);
  useEffect(() => () => {
    Object.values(meshes.vehicles).forEach((m) => { m.geometry.dispose(); m.dispose(); });
    meshes.material.dispose();
    crowd.meshes.flat().forEach((m) => { m.geometry.dispose(); m.dispose(); });
    crowd.material.dispose();
  }, [meshes, crowd]);

  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0), e: new THREE.Euler() }), []);
  useFrame(({ camera }) => {
    const t = time.current, { m, q, p, s, up, e } = scratch;
    const centre = { x: camera.position.x, y: -camera.position.z };
    const counts: Record<string, number> = { danfo: 0, car: 0, keke: 0, okada: 0 };
    traffic.vehiclesNear(centre, t, VIEW, (v, pose: Pose) => {
      const mesh = meshes.vehicles[v.kind], i = counts[v.kind];
      if (i >= MAX_PER_KIND) return;
      counts[v.kind] = i + 1;
      m.compose(p.set(pose.x, elevationAt(index, pose), -pose.y), q.setFromAxisAngle(up, -pose.heading), s.set(1, 1, 1));
      mesh.setMatrixAt(i, m);
      const paints = meshes.paints[v.kind];
      mesh.setColorAt(i, paints[v.colour % paints.length]);
    });
    for (const kind of Object.keys(counts) as TrafficKind[]) {
      const mesh = meshes.vehicles[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Pedestrians: pick the stride pose from how far they've walked, and a build and look from their id.
    const me = player.current, now = performance.now() / 1000;
    for (const c of crowd.counts) c.fill(0);
    traffic.walkersNear(centre, t, VIEW * 0.6, (walker, pose) => {
      const seed = hashId(walker.id), build = seed % 3 === 0 ? 1 : 0;
      let x = pose.x, y = pose.y, hop = 0, lying = false;
      const dx = x - me.x, dy = y - me.y, d = Math.hypot(dx, dy);
      // Hit by the player: knocked flat for a few seconds, then back up. Otherwise they jump clear.
      if (d < 1.5 && Math.abs(me.speed) > PEDESTRIAN_HIT_SPEED && !knocked.has(walker.id)) knocked.set(walker.id, { at: now, x: dx / (d || 1), y: dy / (d || 1) });
      const hit = knocked.get(walker.id);
      if (hit && now - hit.at < KNOCKED_SECONDS) {
        lying = true;
        const k = Math.min(1, (now - hit.at) * 3);
        x += hit.x * 2.5 * k; y += hit.y * 2.5 * k;
      } else {
        if (hit) knocked.delete(walker.id);
        if (d < 8 && Math.abs(me.speed) > 6) {
          const push = (8 - d) / 8;
          x += (dx / (d || 1)) * push * 2.5;
          y += (dy / (d || 1)) * push * 2.5;
          hop = Math.sin(push * Math.PI) * 0.5;
        }
      }
      const step = Math.floor((walker.offset + walker.speed * t) / 0.45 + seed) & 3, poseIndex = lying ? 1 : [0, 1, 2, 1][step];
      const mesh = crowd.meshes[build][poseIndex], i = crowd.counts[build][poseIndex];
      if (i >= MAX_WALKERS) return;
      crowd.counts[build][poseIndex] = i + 1;
      if (lying) {
        e.set(-Math.PI / 2, -pose.heading, 0, "YXZ");
        m.compose(p.set(x, 0.14, -y), q.setFromEuler(e), s.set(1, 1, 1));
      } else m.compose(p.set(x, hop, -y), q.setFromAxisAngle(up, -pose.heading), s.set(1, 1, 1));
      mesh.setMatrixAt(i, m);
      const top = build ? ANKARA[walker.shirt % ANKARA.length] : SHIRTS[walker.shirt % SHIRTS.length];
      setLook(mesh, i, build ? ANKARA[(walker.shirt + seed) % ANKARA.length] : top, SKIN_TONES[seed % SKIN_TONES.length], build ? top : TROUSERS[(seed >> 3) % TROUSERS.length]);
    });
    crowd.meshes.forEach((row, b) => row.forEach((mesh, k) => {
      mesh.count = crowd.counts[b][k];
      mesh.instanceMatrix.needsUpdate = true;
      flushLooks(mesh);
    }));
  });
  return <primitive object={group} />;
}

/** Stopped go-slow traffic at the hotspots (static, so built once per map). Brake lights glow at night. */
export function JamView({ map }: { map: MapData }) {
  const group = useMemo(() => {
    const g = new THREE.Group(), cars = jamCars(map);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (const kind of Object.keys(MODELS) as TrafficKind[]) {
      const list = cars.filter((c) => c.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(MODELS[kind](), material, list.length);
      const paints = PAINT[kind].map((c) => new THREE.Color(c));
      list.forEach((c, i) => {
        mesh.setMatrixAt(i, m.compose(p.set(c.x, 0, -c.y), q.setFromAxisAngle(up, -c.heading), s));
        mesh.setColorAt(i, paints[c.colour % paints.length]);
      });
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }, [map]);
  useEffect(() => () => group.traverse((o) => { if (o instanceof THREE.InstancedMesh) { o.geometry.dispose(); o.dispose(); (o.material as THREE.Material).dispose(); } }), [group]);
  return <primitive object={group} />;
}
