import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CarSpec } from "../../../shared/cars.js";

/**
 * Optional real 3D car models. List them in /cars/models.json (see public/cars/README.md):
 *   { "toro": { "file": "aventador.glb", "rotateY": 180, "paint": ["body", "paint"] } }
 * Each model is scaled to the car's length, sat on the ground and centred. Meshes whose material
 * name contains one of the `paint` words take the player's chosen colour.
 */
type Entry = { file: string; rotateY?: number; paint?: string[] };

let manifest: Promise<Record<string, Entry>> | undefined;
// Vite's dev server answers missing files with index.html, so only trust a JSON response.
const loadManifest = () => (manifest ??= fetch("/cars/models.json")
  .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() as Promise<Record<string, Entry>> : {}))
  .catch(() => ({})) as Promise<Record<string, Entry>>);

const scenes = new Map<string, Promise<THREE.Object3D | null>>();
function loadScene(id: string, entry: Entry) {
  let scene = scenes.get(id);
  if (!scene) {
    scene = new GLTFLoader().loadAsync(`/cars/${entry.file}`).then((gltf) => gltf.scene).catch((e) => {
      console.warn(`Couldn't load the 3D model for ${id} (/cars/${entry.file}); using the built-in one.`, e);
      return null;
    });
    scenes.set(id, scene);
  }
  return scene;
}

function fit(source: THREE.Object3D, spec: CarSpec, entry: Entry) {
  const model = source.clone(true);
  model.rotation.y = THREE.MathUtils.degToRad(entry.rotateY || 0);
  const holder = new THREE.Group();
  holder.add(model);
  let size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  // Models that face along x get turned to face along z.
  if (size.x > size.z * 1.15) { model.rotation.y += Math.PI / 2; size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3()); }
  holder.scale.setScalar(spec.length / size.z);
  const bounds = new THREE.Box3().setFromObject(holder), centre = bounds.getCenter(new THREE.Vector3());
  holder.position.set(-centre.x, -bounds.min.y, -centre.z);
  const words = (entry.paint || ["paint", "body", "carpaint"]).map((w) => w.toLowerCase());
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const recolour = (m: THREE.Material) => {
      if (!words.some((w) => m.name.toLowerCase().includes(w)) || !("color" in m)) return m;
      const copy = m.clone() as THREE.MeshStandardMaterial;
      copy.color = new THREE.Color(spec.colour);
      return copy;
    };
    o.material = Array.isArray(o.material) ? o.material.map(recolour) : recolour(o.material);
  });
  const wrapper = new THREE.Group();
  wrapper.add(holder);
  return wrapper;
}

/** The installed real model for this car (scaled and painted), or null to use the procedural one. */
export function useRealModel(spec: CarSpec | undefined) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const id = spec?.id, colour = spec?.colour;
  useEffect(() => {
    if (!spec) return;
    let live = true;
    setModel(null);
    loadManifest().then((list) => {
      const entry = list[spec.id];
      return entry ? loadScene(spec.id, entry).then((scene) => { if (live && scene) setModel(fit(scene, spec, entry)); }) : undefined;
    });
    return () => { live = false; };
  }, [id, colour]);
  return model;
}
