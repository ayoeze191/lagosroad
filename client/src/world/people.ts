import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Pedestrians: anatomically proportioned low-poly people (head, neck, shoulders, two-part arms
 * with hands, tapered legs, shoes) in Lagos clothes: men in shirt and trousers, women in ankara
 * with a matching gele headwrap. Three stride poses make them walk.
 *
 * Each vertex carries a role: 0 = its own baked colour, 1 = shirt/top, 2 = skin, 3 = trousers/ankara.
 * Roles 1–3 are coloured per person from instanced attributes, so every passer-by looks different.
 */
export type Build = "man" | "woman";
export const POSES = [-1, 0, 1] as const;

const SHOE = "#161412", HAIR = "#120e0c";

class Body {
  parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, role: number, colour = "#ffffff", transform?: THREE.Matrix4) {
    const geometry = (g.index ? g.toNonIndexed() : g);
    if (transform) geometry.applyMatrix4(transform);
    geometry.deleteAttribute("uv");
    const n = geometry.attributes.position.count, c = new THREE.Color(colour);
    const colours = new Float32Array(n * 3), roles = new Float32Array(n).fill(role);
    for (let i = 0; i < n; i++) { colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute("aRole", new THREE.BufferAttribute(roles, 1));
    this.parts.push(geometry);
  }
  build() { return mergeGeometries(this.parts)!; }
}

const cyl = (rTop: number, rBottom: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const ball = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
/** Rotation about a pivot point (x axis = swing forward/back). */
const swing = (pivot: THREE.Vector3, angle: number, roll = 0) => new THREE.Matrix4()
  .makeTranslation(pivot.x, pivot.y, pivot.z)
  .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angle, 0, roll)))
  .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

/** A person facing -z, feet at y = 0, about 1.72 m tall. `pose` -1/0/1 is the stride phase. */
export function personGeometry(build: Build, pose: number) {
  const b = new Body(), stride = 0.42 * pose, woman = build === "woman";
  // Legs swing from the hips; shoes go with them.
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.095, 0.93, 0), m = swing(hip, side * stride);
    if (woman) {
      // Only the calves show below the wrapper.
      b.add(cyl(0.055, 0.045, 0.42), 2, undefined, m.clone().multiply(at(side * 0.09, 0.27, 0)));
    } else {
      b.add(cyl(0.085, 0.07, 0.46), 3, undefined, m.clone().multiply(at(side * 0.095, 0.7, 0))); // thigh
      b.add(cyl(0.068, 0.055, 0.44), 3, undefined, m.clone().multiply(at(side * 0.095, 0.27, 0))); // shin
    }
    b.add(new THREE.BoxGeometry(0.1, 0.07, 0.25), 0, SHOE, m.clone().multiply(at(side * 0.095, 0.035, -0.05)));
  }
  if (woman) {
    b.add(cyl(0.17, 0.27, 0.66, 12), 3, undefined, at(0, 0.73, 0, 1, 1, 0.8)); // ankara wrapper
    b.add(cyl(0.17, 0.16, 0.18, 12), 3, undefined, at(0, 1.07, 0, 1, 1, 0.75)); // waist
  } else {
    b.add(new THREE.BoxGeometry(0.34, 0.2, 0.21), 3, undefined, at(0, 0.97, 0)); // hips
  }
  // Torso: tapered and flattened front-to-back, with rounded shoulders.
  b.add(cyl(woman ? 0.18 : 0.2, woman ? 0.15 : 0.165, 0.52, 12), woman ? 3 : 1, undefined, at(0, 1.3, 0, 1, 1, 0.62));
  for (const side of [-1, 1]) b.add(ball(0.085), woman ? 3 : 1, undefined, at(side * 0.19, 1.5, 0, 1, 0.9, 0.9));
  b.add(cyl(0.05, 0.055, 0.1), 2, undefined, at(0, 1.6, 0)); // neck
  // Head: slightly tall ellipsoid, a nose and ears; hair, or a gele for the women.
  b.add(ball(0.112, 14, 10), 2, undefined, at(0, 1.72, 0, 0.92, 1.12, 1));
  b.add(new THREE.BoxGeometry(0.035, 0.05, 0.04), 2, undefined, at(0, 1.7, -0.11));
  for (const side of [-1, 1]) b.add(ball(0.025, 6, 4), 2, undefined, at(side * 0.105, 1.72, 0, 0.6, 1.2, 1));
  if (woman) {
    b.add(ball(0.15, 12, 8), 3, undefined, at(0, 1.83, 0.02, 1.35, 0.7, 1.1)); // gele
    b.add(new THREE.BoxGeometry(0.34, 0.1, 0.06), 3, undefined, at(0, 1.92, 0.08).multiply(new THREE.Matrix4().makeRotationX(-0.5))); // its fanned crest
  } else {
    b.add(new THREE.SphereGeometry(0.118, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, HAIR, at(0, 1.74, 0.005, 0.95, 0.75, 1.02));
  }
  // Arms swing opposite to the legs: sleeve (top colour), forearm and hand (skin).
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 0.22, 1.48, 0), m = swing(shoulder, -side * stride * 0.8, side * 0.08);
    b.add(cyl(0.058, 0.05, 0.3), woman ? 3 : 1, undefined, m.clone().multiply(at(side * 0.22, 1.32, 0)));
    b.add(cyl(0.045, 0.038, 0.27), 2, undefined, m.clone().multiply(at(side * 0.22, 1.05, -0.02)));
    b.add(ball(0.045, 8, 6), 2, undefined, m.clone().multiply(at(side * 0.22, 0.89, -0.02, 0.8, 1.2, 1)));
  }
  return b.build();
}

export const SKIN_TONES = ["#3a2417", "#4a2c1a", "#5a361f", "#6b4428", "#7a5034", "#8a5c3c"].map((c) => new THREE.Color(c));
export const SHIRTS = ["#e74c3c", "#3498db", "#f1c40f", "#ecf0f1", "#2ecc71", "#1c1f26", "#9b59b6", "#e67e22", "#1abc9c", "#c0c6cf"].map((c) => new THREE.Color(c));
export const TROUSERS = ["#1f2a3d", "#24262b", "#4b4f57", "#6b5a3e", "#2c3e50", "#151515"].map((c) => new THREE.Color(c));
/** Bright ankara prints, for wrappers and geles. */
export const ANKARA = ["#e8590c", "#7b2cbf", "#2b9348", "#1f6fff", "#d00000", "#ffb703", "#c9184a", "#0096c7"].map((c) => new THREE.Color(c));

/** Material that colours roles 1–3 from per-instance attributes aShirt / aSkin / aPants. */
export function peopleMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aRole;\nattribute vec3 aShirt;\nattribute vec3 aSkin;\nattribute vec3 aPants;")
      .replace("#include <color_vertex>", "vColor = aRole < 0.5 ? color : aRole < 1.5 ? aShirt : aRole < 2.5 ? aSkin : aPants;");
  };
  material.customProgramCacheKey = () => "lagos-people";
  return material;
}

/** Instanced crowd mesh for one build and pose, with room for `count` people. */
export function crowdMesh(build: Build, pose: number, material: THREE.Material, count: number) {
  const geometry = personGeometry(build, pose);
  for (const name of ["aShirt", "aSkin", "aPants"]) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  }
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function setLook(mesh: THREE.InstancedMesh, i: number, shirt: THREE.Color, skin: THREE.Color, pants: THREE.Color) {
  const g = mesh.geometry;
  (g.attributes.aShirt as THREE.InstancedBufferAttribute).setXYZ(i, shirt.r, shirt.g, shirt.b);
  (g.attributes.aSkin as THREE.InstancedBufferAttribute).setXYZ(i, skin.r, skin.g, skin.b);
  (g.attributes.aPants as THREE.InstancedBufferAttribute).setXYZ(i, pants.r, pants.g, pants.b);
}

export function flushLooks(mesh: THREE.InstancedMesh) {
  const g = mesh.geometry;
  for (const name of ["aShirt", "aSkin", "aPants"]) (g.attributes[name] as THREE.InstancedBufferAttribute).needsUpdate = true;
}
