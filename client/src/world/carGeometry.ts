import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CarBody } from "../../../shared/cars.js";

/**
 * Procedural vehicles built from each real car's side silhouette (extruded, with wheel arches cut out),
 * a separate glasshouse, and the details that make it recognisable: lights, grilles, intakes, spare wheels.
 *
 * Car space: x to the right, y up, `f` metres forward. three.js forward is -z, so z = -f.
 */
export type Role = "paint" | "glass" | "trim" | "chrome" | "rim" | "tyre" | "light" | "tail" | "amber" | "red" | "blue" | "skin" | "shirt" | "helmet";

/** Flat colours for every role but paint (used directly by traffic, which bakes them into vertex colours). */
export const ROLE_COLOURS: Record<Role, string> = {
  paint: "#ffffff", glass: "#121a22", trim: "#161616", chrome: "#dfe3e8", rim: "#b4bac1", tyre: "#111111",
  light: "#fff6d6", tail: "#d0141b", amber: "#ff9a1f", red: "#d4161c", blue: "#1f3f8f", skin: "#6b4428", shirt: "#2d3a4f", helmet: "#1a1a1a"
};

type V = [number, number, number?]; // f, y, corner radius
type Parts = Partial<Record<Role, THREE.BufferGeometry[]>>;

class Builder {
  parts: Parts = {};
  add(role: Role, g: THREE.BufferGeometry) {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    (this.parts[role] ??= []).push(geometry);
  }
  /** Rounded polygon in the side view (f, y), extruded across `width`. */
  side(role: Role, pts: V[], width: number, bevel = 0.05, arches: { f: number; r: number; y: number }[] = [], x = 0) {
    const shape = outline(pts, arches);
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -depth / 2).rotateY(Math.PI / 2).translate(x, 0, 0);
    this.add(role, g);
  }
  box(role: Role, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    g.rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]).translate(at[0], at[1], -at[2]);
    this.add(role, g);
  }
  /** Cylinder lying along `axis` ("x" = across the car, "f" = along it, "y" = upright). */
  cyl(role: Role, r: number, len: number, at: [number, number, number], axis: "x" | "y" | "f" = "f", seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === "x") g.rotateZ(Math.PI / 2); else if (axis === "f") g.rotateX(Math.PI / 2);
    g.translate(at[0], at[1], -at[2]);
    this.add(role, g);
  }
  blob(role: Role, scale: [number, number, number], at: [number, number, number]) {
    const g = new THREE.SphereGeometry(0.5, 14, 10).scale(scale[0], scale[1], scale[2]).translate(at[0], at[1], -at[2]);
    this.add(role, g);
  }
  wheel(x: number, f: number, r: number, w: number, rim: Role = "rim") {
    const out = Math.sign(x);
    this.cyl("tyre", r, w, [x, r, f], "x", 18);
    this.cyl(rim, r * 0.66, 0.03, [x + out * (w / 2 + 0.005), r, f], "x", 16);
    this.cyl("trim", r * 0.2, 0.04, [x + out * (w / 2 + 0.02), r, f], "x", 8);
  }
  axle(f: number, track: number, r: number, w = 0.26, rim: Role = "rim") {
    this.wheel(-track / 2, f, r, w, rim);
    this.wheel(track / 2, f, r, w, rim);
  }
  mirror(f: number, y: number, W: number) {
    for (const s of [-1, 1]) this.box("paint", [0.2, 0.12, 0.1], [s * (W / 2 + 0.08), y, f]);
  }
  /** Seated rider (okada, keke): torso, head, arms forward to the bars. */
  rider(f: number, seat: number, helmet: boolean) {
    this.box("shirt", [0.42, 0.62, 0.3], [0, seat + 0.33, f], [0.2, 0, 0]);
    this.box("skin", [0.24, 0.26, 0.24], [0, seat + 0.8, f + 0.06]);
    if (helmet) this.blob("helmet", [0.32, 0.3, 0.34], [0, seat + 0.85, f + 0.06]);
    for (const s of [-1, 1]) this.box("shirt", [0.11, 0.11, 0.5], [s * 0.24, seat + 0.48, f + 0.28], [0.5, 0, 0]);
    for (const s of [-1, 1]) this.box("trim", [0.13, 0.13, 0.5], [s * 0.15, seat + 0.05, f + 0.25], [-0.3, 0, 0]);
  }
  build() {
    const out: Partial<Record<Role, THREE.BufferGeometry>> = {};
    for (const [role, list] of Object.entries(this.parts) as [Role, THREE.BufferGeometry[]][]) {
      out[role] = mergeGeometries(list)!;
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

/** Polygon (going over the top, rear-bottom first) with rounded corners; the bottom edge gets wheel arches. */
function outline(pts: V[], arches: { f: number; r: number; y: number }[]) {
  const shape = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i];
    if (!r || i === 0 || i === n - 1) { if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); continue; }
    const [px, py] = pts[i - 1], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(x - px, y - py) || 1, l2 = Math.hypot(nx - x, ny - y) || 1;
    const k = Math.min(r, l1 / 2, l2 / 2);
    shape.lineTo(x - (x - px) / l1 * k, y - (y - py) / l1 * k);
    shape.quadraticCurveTo(x, y, x + (nx - x) / l2 * k, y + (ny - y) / l2 * k);
  }
  // Bottom edge, front to rear, with a semicircular arch over each wheel.
  const bottom = pts[n - 1][1];
  for (const a of [...arches].sort((p, q) => q.f - p.f)) {
    shape.lineTo(a.f + a.r, bottom);
    shape.lineTo(a.f + a.r, a.y);
    shape.absarc(a.f, a.y, a.r, 0, Math.PI, false);
    shape.lineTo(a.f - a.r, bottom);
  }
  shape.lineTo(pts[0][0], pts[0][1]);
  return shape;
}

/** Thin roof skin following the top of a glasshouse (so cabins read as painted roofs with glass below). */
function roof(b: Builder, top: V[], width: number, thick = 0.05) {
  const lower: V[] = [...top].reverse().map(([f, y]) => [f, y - thick]);
  b.side("paint", [...top, ...lower], width, 0.02);
}

export type CarGeometry = Partial<Record<Role, THREE.BufferGeometry>>;
const cache = new Map<string, CarGeometry>();

/** Merged geometry per material role for a body style at a given size. Cached. */
export function carGeometry(body: CarBody, L: number, W: number, livery?: "police" | "agbero", armed = false): CarGeometry {
  const key = `${body}:${L}:${W}:${livery || ""}:${armed}`;
  let g = cache.get(key);
  if (!g) { g = buildCar(body, L, W, livery, armed); cache.set(key, g); }
  return g;
}

/** A gun: receiver, barrel and grip, pointing forward from (x, y, f). */
function gun(b: Builder, x: number, y: number, f: number, scale = 1) {
  b.box("trim", [0.12 * scale, 0.14 * scale, 0.55 * scale], [x, y, f]);
  b.cyl("trim", 0.03 * scale, 0.7 * scale, [x, y + 0.03 * scale, f + 0.6 * scale], "f", 8);
  b.box("trim", [0.08 * scale, 0.2 * scale, 0.08 * scale], [x, y - 0.14 * scale, f - 0.1 * scale]);
}

function buildCar(body: CarBody, L: number, W: number, livery?: "police" | "agbero", armed = false): CarGeometry {
  const b = new Builder(), h = L / 2;
  switch (body) {
    case "supercar": { // Lamborghini Aventador: one-wedge profile, cab-forward, Y-shaped lights, huge side intakes.
      const R = 0.37, ff = h - 0.95, fr = -h + 1.05;
      b.side("paint", [[-h, 0.14], [-h, 0.66, 0.06], [-h + 0.12, 0.88, 0.08], [-0.6, 0.92], [0.55, 0.84], [h - 0.3, 0.56, 0.2], [h, 0.36, 0.1], [h - 0.05, 0.14]], W, 0.07, [{ f: ff, r: R + 0.05, y: R }, { f: fr, r: R + 0.06, y: R }]);
      b.side("glass", [[-h + 0.55, 0.82], [-h + 0.6, 0.9], [-0.55, 1.13, 0.18], [0.05, 1.15, 0.12], [0.8, 0.84], [0.8, 0.8]], W * 0.74, 0.04);
      roof(b, [[-0.75, 1.1], [-0.4, 1.155], [0.1, 1.16], [0.3, 1.1]], W * 0.62);
      for (let i = 0; i < 4; i++) b.box("trim", [W * 0.6, 0.03, 0.1], [0, 0.96 + i * 0.012, -h + 0.75 + i * 0.22]); // engine-cover louvres
      for (const s of [-1, 1]) {
        b.box("trim", [0.04, 0.34, 0.75], [s * (W / 2 + 0.01), 0.58, -0.75], [0, 0, 0]); // side intake
        b.box("trim", [0.3, 0.14, 0.6], [s * (W / 2 - 0.12), 0.94, -0.95]); // roof-line scoop
        b.box("light", [0.48, 0.05, 0.22], [s * 0.66, 0.55, h - 0.32], [0, s * 0.35, s * -0.15]);
        b.box("tail", [0.52, 0.045, 0.04], [s * 0.62, 0.66, -h - 0.01], [0, 0, s * 0.45]); // the Y
        b.box("tail", [0.4, 0.045, 0.04], [s * 0.62, 0.56, -h - 0.01], [0, 0, s * -0.55]);
        b.box("trim", [0.5, 0.16, 0.06], [s * 0.6, 0.27, h - 0.04]); // front intakes
      }
      b.box("trim", [W * 0.9, 0.05, 0.4], [0, 0.15, h - 0.2]); // splitter
      b.box("trim", [W * 0.85, 0.22, 0.12], [0, 0.28, -h + 0.02]); // diffuser
      b.cyl("chrome", 0.08, 0.1, [0, 0.42, -h - 0.02], "f", 6); // hexagonal exhaust
      b.box("paint", [W * 0.8, 0.04, 0.3], [0, 0.95, -h + 0.18], [0.2, 0, 0]); // ducktail spoiler
      b.mirror(0.45, 0.92, W);
      b.axle(ff, W - 0.2, R, 0.28); b.axle(fr, W - 0.16, R + 0.02, 0.33);
      break;
    }
    case "coupe": {
      if (L > 4.5) { // Ferrari 812: very long bonnet, cabin set far back, twin round tail lamps, fastback.
        const R = 0.36, ff = h - 1.0, fr = -h + 1.1;
        b.side("paint", [[-h, 0.16], [-h, 0.72, 0.08], [-h + 0.1, 0.87, 0.06], [-h + 0.65, 0.9], [0.25, 0.93], [1.5, 0.82, 0.35], [h, 0.56, 0.2], [h + 0.02, 0.3, 0.08], [h - 0.05, 0.16]], W, 0.08, [{ f: ff, r: R + 0.05, y: R }, { f: fr, r: R + 0.05, y: R }]);
        b.side("glass", [[-h + 0.6, 0.84], [-h + 0.62, 0.88], [-0.85, 1.2, 0.25], [-0.25, 1.25, 0.18], [0.38, 0.9], [0.38, 0.84]], W * 0.72, 0.04);
        roof(b, [[-1.0, 1.17], [-0.6, 1.24], [-0.2, 1.25], [0.05, 1.18]], W * 0.6);
        for (const s of [-1, 1]) {
          b.cyl("tail", 0.085, 0.06, [s * 0.42, 0.74, -h - 0.02]); b.cyl("tail", 0.085, 0.06, [s * 0.7, 0.72, -h - 0.02]);
          b.box("light", [0.5, 0.07, 0.25], [s * 0.66, 0.63, h - 0.18], [0, s * 0.3, s * -0.12]);
          b.box("trim", [0.04, 0.16, 0.45], [s * (W / 2 + 0.005), 0.62, ff - 0.7]); // fender vent
          b.cyl("chrome", 0.05, 0.1, [s * 0.5, 0.3, -h - 0.02], "f", 10); b.cyl("chrome", 0.05, 0.1, [s * 0.64, 0.3, -h - 0.02], "f", 10);
        }
        b.box("trim", [1.1, 0.22, 0.06], [0, 0.34, h - 0.0]); // egg-crate grille
        b.box("trim", [W * 0.8, 0.14, 0.1], [0, 0.24, -h + 0.02]);
        b.box("amber", [0.1, 0.1, 0.02], [0, 0.82, h - 0.35]); // badge on the bonnet nose
        b.mirror(0.3, 0.98, W);
        b.axle(ff, W - 0.18, R, 0.27); b.axle(fr, W - 0.14, R + 0.01, 0.31);
      } else { // Porsche 911: frog-eye round headlights on raised wings, one long arc to the tail, full-width light bar.
        const R = 0.35, ff = h - 0.95, fr = -h + 0.95;
        b.side("paint", [[-h, 0.15], [-h, 0.7, 0.14], [-h + 0.18, 0.9, 0.18], [-1.0, 0.94], [0.45, 0.88], [1.6, 0.74, 0.3], [h, 0.48, 0.2], [h - 0.05, 0.15]], W, 0.08, [{ f: ff, r: R + 0.05, y: R }, { f: fr, r: R + 0.06, y: R }]);
        b.side("glass", [[-h + 0.25, 0.86], [-h + 0.3, 0.9], [-0.9, 1.22, 0.45], [-0.1, 1.3, 0.3], [0.58, 0.88], [0.58, 0.84]], W * 0.74, 0.04);
        roof(b, [[-1.05, 1.2], [-0.55, 1.285], [-0.15, 1.3], [0.2, 1.24]], W * 0.62);
        for (const s of [-1, 1]) {
          b.blob("paint", [0.5, 0.26, 1.1], [s * 0.6, 0.66, 1.55]); // raised front wings
          b.blob("paint", [0.55, 0.3, 1.25], [s * 0.66, 0.74, -1.3]); // wide rear haunches
          b.cyl("light", 0.12, 0.12, [s * 0.6, 0.76, 1.98], "f", 18); b.cyl("chrome", 0.135, 0.08, [s * 0.6, 0.76, 1.94], "f", 18);
          b.cyl("chrome", 0.05, 0.1, [s * 0.18, 0.28, -h - 0.02], "f", 10);
        }
        b.box("tail", [W - 0.28, 0.06, 0.04], [0, 0.78, -h - 0.01]); // light bar
        b.box("trim", [W * 0.6, 0.02, 0.5], [0, 0.95, -1.75]); // engine-lid grille
        b.box("paint", [W * 0.7, 0.04, 0.25], [0, 0.97, -h + 0.25], [0.15, 0, 0]); // ducktail
        b.box("trim", [1.0, 0.14, 0.06], [0, 0.3, h - 0.06]);
        b.mirror(0.4, 0.95, W);
        b.axle(ff, W - 0.2, R, 0.26); b.axle(fr, W - 0.12, R + 0.01, 0.31);
      }
      break;
    }
    case "suv": { // Mercedes G-Class: a box on a box, upright screen, round lamps, indicator pods, spare wheel on the door.
      const R = 0.43, ff = h - 0.85, fr = -h + 0.95;
      b.side("paint", [[-h, 0.4], [-h, 1.15, 0.04], [h - 0.04, 1.14, 0.04], [h, 0.4]], W, 0.05, [{ f: ff, r: R + 0.06, y: R }, { f: fr, r: R + 0.06, y: R }]);
      b.side("glass", [[-h + 0.04, 1.12], [-h + 0.05, 1.92, 0.04], [h - 1.35, 1.92, 0.04], [h - 1.15, 1.12]], W * 0.93, 0.03);
      roof(b, [[-h + 0.02, 1.93], [h - 1.33, 1.93]], W * 0.95, 0.07);
      for (const f of [-h + 0.08, -0.95, 0.05]) b.box("paint", [W * 0.945, 0.78, 0.13], [0, 1.53, f]); // B/C/D pillars
      for (const s of [-1, 1]) {
        b.box("paint", [0.09, 0.85, 0.1], [s * W * 0.45, 1.52, h - 1.25], [-0.12, 0, 0]); // A pillars
        b.box("trim", [0.2, 0.12, 2.1], [s * (W / 2 + 0.02), 0.93, 0]); // rubbing strip
        b.box("trim", [0.12, 0.08, 1.6], [s * (W / 2 + 0.1), 0.42, 0.1]); // side step
        b.cyl("light", 0.13, 0.08, [s * 0.68, 0.98, h + 0.02], "f", 18); b.cyl("chrome", 0.15, 0.05, [s * 0.68, 0.98, h + 0.0], "f", 18);
        b.box("amber", [0.13, 0.09, 0.22], [s * 0.82, 1.2, h - 0.15]); // fender-top indicators
        b.box("tail", [0.17, 0.42, 0.05], [s * 0.86, 1.05, -h - 0.02]);
        b.box("trim", [0.32, 0.36, 0.95], [s * (W / 2 - 0.05), 0.62, ff]); // arch flares
        b.box("trim", [0.32, 0.36, 0.95], [s * (W / 2 - 0.05), 0.62, fr]);
      }
      b.box("trim", [0.9, 0.34, 0.04], [0, 0.98, h + 0.01]);
      for (let i = 0; i < 3; i++) b.box("chrome", [0.88, 0.035, 0.05], [0, 0.9 + i * 0.08, h + 0.02]);
      b.box("trim", [W + 0.04, 0.24, 0.2], [0, 0.52, h + 0.05]); b.box("trim", [W + 0.04, 0.24, 0.2], [0, 0.52, -h - 0.05]);
      b.cyl("tyre", 0.42, 0.26, [0, 1.2, -h - 0.15], "f", 18); b.cyl("paint", 0.36, 0.28, [0, 1.2, -h - 0.16], "f", 18); // spare wheel cover
      b.box("chrome", [0.45, 0.05, 0.05], [0, 0.62, h + 0.16]);
      if (armed) { // escort standing up through the sunroof
        b.box("shirt", [0.5, 0.55, 0.32], [0, 2.2, -0.2]);
        b.box("skin", [0.24, 0.26, 0.24], [0, 2.62, -0.18]);
        b.blob("helmet", [0.3, 0.16, 0.32], [0, 2.75, -0.18]);
        gun(b, 0.12, 2.3, 0.15, 1.2);
      }
      b.mirror(h - 1.15, 1.4, W);
      b.axle(ff, W - 0.18, R, 0.32); b.axle(fr, W - 0.18, R, 0.32);
      break;
    }
    case "limo": { // Rolls-Royce Phantom: upright Pantheon grille, very long flat bonnet, high beltline, chrome everywhere.
      const R = 0.42, ff = h - 1.0, fr = -h + 1.15;
      b.side("paint", [[-h, 0.22], [-h, 0.95, 0.15], [-h + 0.25, 1.08, 0.1], [-1.55, 1.1], [0.85, 1.12], [h - 0.15, 1.08, 0.08], [h, 1.0, 0.06], [h, 0.22]], W, 0.07, [{ f: ff, r: R + 0.06, y: R }, { f: fr, r: R + 0.06, y: R }]);
      b.side("glass", [[-1.78, 1.08], [-1.75, 1.12], [-1.2, 1.62, 0.28], [0.35, 1.65, 0.18], [1.05, 1.12], [1.05, 1.08]], W * 0.84, 0.04);
      roof(b, [[-1.3, 1.58], [-1.0, 1.645], [0.3, 1.66], [0.55, 1.58]], W * 0.75, 0.06);
      b.box("paint", [W * 0.85, 0.5, 0.14], [0, 1.37, -0.35]); // B pillar
      for (const s of [-1, 1]) {
        b.box("chrome", [0.03, 0.03, 2.9], [s * W * 0.43, 1.13, -0.35]); // window surround
        b.box("light", [0.4, 0.13, 0.04], [s * 0.66, 0.93, h + 0.01]);
        b.box("chrome", [0.42, 0.025, 0.04], [s * 0.66, 0.84, h + 0.01]);
        b.box("tail", [0.13, 0.38, 0.04], [s * 0.8, 0.84, -h - 0.01]);
        b.box("chrome", [0.04, 0.03, 0.22], [s * (W / 2 + 0.01), 0.95, 0.3]); b.box("chrome", [0.04, 0.03, 0.22], [s * (W / 2 + 0.01), 0.95, -1.0]); // door handles
      }
      b.box("chrome", [0.78, 0.6, 0.08], [0, 0.82, h + 0.02]); // Pantheon grille
      b.box("trim", [0.62, 0.46, 0.04], [0, 0.82, h + 0.05]);
      for (let i = -3; i <= 3; i++) b.box("chrome", [0.025, 0.46, 0.05], [i * 0.085, 0.82, h + 0.06]);
      b.box("chrome", [0.05, 0.12, 0.08], [0, 1.2, h - 0.08]); // bonnet mascot
      b.box("chrome", [W * 0.92, 0.06, 0.06], [0, 0.45, h + 0.03]); b.box("chrome", [W * 0.92, 0.06, 0.06], [0, 0.5, -h - 0.03]);
      b.mirror(0.95, 1.25, W);
      b.axle(ff, W - 0.2, R, 0.28, "chrome"); b.axle(fr, W - 0.2, R, 0.28, "chrome");
      break;
    }
    case "bus": { // Danfo (VW T3): yellow box, two black stripes, sliding door open with the conductor hanging out.
      const R = 0.36, ff = h - 0.85, fr = -h + 1.0;
      b.side("paint", [[-h, 0.3], [-h, 1.95, 0.12], [h - 0.18, 2.02, 0.15], [h, 1.25, 0.06], [h, 0.3]], W, 0.06, [{ f: ff, r: R + 0.06, y: R }, { f: fr, r: R + 0.06, y: R }]);
      b.box("glass", [W + 0.02, 0.55, L - 1.2], [0, 1.55, -0.25]);
      for (const f of [-1.3, -0.25, 0.85]) b.box("paint", [W + 0.04, 0.56, 0.12], [0, 1.55, f]);
      b.box("glass", [W * 0.86, 0.62, 0.05], [0, 1.6, h - 0.06], [-0.12, 0, 0]); // windscreen
      b.box("glass", [W * 0.8, 0.45, 0.04], [0, 1.6, -h - 0.01]);
      for (const y of [1.04, 0.86]) b.box("trim", [W + 0.04, 0.08, L - 0.05], [0, y, 0]); // danfo stripes
      b.box("trim", [0.04, 1.2, 0.95], [W / 2 + 0.01, 0.98, 0.15]); // open sliding door
      b.box("trim", [W * 0.85, 0.12, 0.04], [0, 1.05, h + 0.01]); // grille band
      for (const s of [-1, 1]) {
        b.box("light", [0.3, 0.2, 0.04], [s * 0.7, 0.88, h + 0.02]);
        b.box("amber", [0.14, 0.1, 0.04], [s * 0.85, 0.66, h + 0.02]);
        b.box("tail", [0.16, 0.36, 0.04], [s * 0.88, 0.9, -h - 0.02]);
        b.box("chrome", [0.04, 0.04, 3.2], [s * W * 0.42, 2.17, -0.3]); // roof rack rails
      }
      b.box("trim", [W + 0.05, 0.2, 0.15], [0, 0.48, h + 0.06]); b.box("trim", [W + 0.05, 0.2, 0.15], [0, 0.48, -h - 0.06]);
      b.box("amber", [1.2, 0.3, 1.0], [0, 2.22, -0.6]); b.box("blue", [0.8, 0.25, 0.7], [0.1, 2.2, 0.5]); // load on the rack
      // Conductor hanging off the door.
      b.box("red", [0.4, 0.6, 0.28], [W / 2 + 0.3, 1.3, 0.2], [0, 0, -0.2]);
      b.box("skin", [0.24, 0.26, 0.24], [W / 2 + 0.38, 1.76, 0.2]);
      b.box("trim", [0.16, 0.8, 0.16], [W / 2 + 0.18, 0.72, 0.2]);
      b.box("skin", [0.1, 0.45, 0.1], [W / 2 + 0.1, 1.6, 0.35], [0, 0, 0.9]);
      if (armed) gun(b, W / 2 + 0.45, 1.35, 0.35, 1.1); // the conductor's gun, out of the door
      b.mirror(h - 0.2, 1.45, W);
      b.axle(ff, W - 0.2, R, 0.26); b.axle(fr, W - 0.2, R, 0.26);
      break;
    }
    case "sport": { // VW Golf GTI: two-box hatch, red stripe across the grille, roof spoiler.
      const R = 0.35, ff = h - 0.85, fr = -h + 0.8;
      b.side("paint", [[-h, 0.18], [-h, 0.95, 0.1], [0.7, 0.95], [1.65, 0.85, 0.25], [h, 0.62, 0.15], [h, 0.18]], W, 0.08, [{ f: ff, r: R + 0.05, y: R }, { f: fr, r: R + 0.05, y: R }]);
      b.side("glass", [[-h + 0.03, 0.92], [-h + 0.06, 0.96], [-h + 0.18, 1.42, 0.12], [0.0, 1.46, 0.15], [0.82, 0.95], [0.82, 0.92]], W * 0.82, 0.04);
      roof(b, [[-h + 0.15, 1.41], [-h + 0.4, 1.465], [-0.05, 1.47], [0.2, 1.4]], W * 0.76);
      b.box("paint", [W * 0.84, 0.48, 0.18], [0, 1.18, -0.35]); // B pillar
      b.box("paint", [W * 0.84, 0.48, 0.3], [0, 1.18, -h + 0.38]); // thick C pillar
      b.box("paint", [W * 0.75, 0.05, 0.3], [0, 1.47, -h + 0.05]); // roof spoiler
      b.box("trim", [1.35, 0.15, 0.05], [0, 0.73, h + 0.01]);
      b.box("red", [1.45, 0.025, 0.06], [0, 0.8, h + 0.01]);
      b.box("trim", [1.3, 0.2, 0.05], [0, 0.4, h + 0.01]); // honeycomb intake
      for (const s of [-1, 1]) {
        b.box("light", [0.36, 0.13, 0.05], [s * 0.64, 0.76, h + 0.0]);
        b.box("tail", [0.42, 0.13, 0.05], [s * 0.6, 0.86, -h - 0.01]);
      }
      b.cyl("chrome", 0.045, 0.1, [-0.55, 0.3, -h - 0.03], "f", 10); b.cyl("chrome", 0.045, 0.1, [-0.4, 0.3, -h - 0.03], "f", 10);
      b.mirror(0.65, 1.05, W);
      b.axle(ff, W - 0.2, R, 0.26); b.axle(fr, W - 0.2, R, 0.26);
      break;
    }
    case "keke": { // Bajaj RE tricycle: one wheel up front, nose cowl, canvas roof, open sides.
      const R = 0.24;
      b.side("paint", [[-h + 0.05, 0.28], [-h + 0.05, 0.92, 0.1], [0.55, 0.92], [0.72, 0.6, 0.15], [0.68, 0.28]], W, 0.05, [{ f: -h + 0.55, r: R + 0.05, y: R }]);
      b.side("paint", [[0.45, 0.3], [0.45, 1.15], [0.7, 1.22, 0.1], [h - 0.1, 0.75, 0.25], [h, 0.45, 0.1], [h - 0.15, 0.3]], 0.62, 0.05);
      b.box("trim", [W + 0.08, 0.08, 2.15], [0, 1.82, -0.4]); // canvas roof
      b.box("trim", [W, 0.9, 0.06], [0, 1.36, -h + 0.08]);
      b.box("glass", [W * 0.55, 0.3, 0.07], [0, 1.45, -h + 0.08]);
      for (const s of [-1, 1]) {
        b.box("trim", [0.05, 0.92, 0.05], [s * (W / 2 - 0.04), 1.36, 0.6]);
        b.box("trim", [0.05, 0.92, 0.05], [s * (W / 2 - 0.04), 1.36, -h + 0.1]);
        b.box("tail", [0.12, 0.12, 0.03], [s * (W / 2 - 0.15), 0.75, -h + 0.03]);
      }
      b.box("glass", [W * 0.72, 0.62, 0.04], [0, 1.4, 0.62], [-0.15, 0, 0]);
      b.box("trim", [W - 0.2, 0.5, 0.35], [0, 1.15, -0.85]); // passenger bench
      b.cyl("light", 0.09, 0.06, [0, 0.66, h - 0.04], "f", 14);
      for (const s of [-1, 1]) b.box("amber", [0.07, 0.07, 0.03], [s * 0.22, 0.9, h - 0.18]);
      b.box("chrome", [0.7, 0.03, 0.03], [0, 1.15, 0.4]);
      b.rider(0.05, 0.85, false);
      b.wheel(0, h - 0.4, R, 0.14); b.axle(-h + 0.55, W - 0.12, R, 0.16);
      break;
    }
    case "bike": { // Bajaj Boxer okada with its rider (the agbero wears his yellow shirt).
      const R = 0.31;
      b.blob("paint", [0.32, 0.24, 0.55], [0, 0.88, 0.25]); // tank
      b.box("trim", [0.3, 0.1, 0.75], [0, 0.88, -0.3]); // seat
      b.box("paint", [0.26, 0.22, 0.5], [0, 0.7, -0.35]); // side panels
      b.box("trim", [0.28, 0.3, 0.42], [0, 0.48, 0.1]); // engine
      b.cyl("chrome", 0.05, 0.8, [0.18, 0.4, -0.35]); // exhaust
      b.box("paint", [0.16, 0.05, 0.55], [0, 0.72, -h + 0.25], [0.2, 0, 0]); // rear mudguard
      b.box("paint", [0.14, 0.05, 0.4], [0, 0.66, h - 0.3], [-0.3, 0, 0]);
      for (const s of [-1, 1]) b.box("chrome", [0.04, 0.75, 0.04], [s * 0.1, 0.65, h - 0.45], [-0.35, 0, 0]); // forks
      b.box("chrome", [0.72, 0.04, 0.04], [0, 1.08, 0.58]);
      b.blob("paint", [0.3, 0.3, 0.2], [0, 0.98, 0.68]); b.cyl("light", 0.08, 0.05, [0, 0.98, 0.78], "f", 12);
      b.box("tail", [0.14, 0.07, 0.03], [0, 0.82, -h + 0.02]);
      b.rider(-0.25, 0.88, true);
      b.wheel(0, h - 0.35, R, 0.1, "chrome"); b.wheel(0, -h + 0.35, R, 0.12, "chrome");
      break;
    }
    case "pickup": { // Toyota Hilux double cab: tall nose, cab, open load bed (with a roof turret when armed).
      const R = 0.4, ff = h - 0.95, fr = -h + 1.15, bed = -h + 1.75;
      b.side("paint", [[-h, 0.42], [-h, 1.12, 0.05], [0.95, 1.12], [h - 0.15, 1.08, 0.15], [h, 0.85, 0.1], [h, 0.42]], W, 0.06, [{ f: ff, r: R + 0.07, y: R }, { f: fr, r: R + 0.07, y: R }]);
      b.side("glass", [[-0.55, 1.1], [-0.5, 1.72, 0.08], [0.45, 1.74, 0.1], [1.05, 1.12]], W * 0.88, 0.04);
      roof(b, [[-0.52, 1.72], [0.45, 1.745]], W * 0.9, 0.06);
      b.box("paint", [W * 0.9, 0.6, 0.12], [0, 1.42, -0.05]); // B pillar
      b.box("trim", [W - 0.2, 0.08, 1.7], [0, 1.0, bed]); // bed floor
      for (const s of [-1, 1]) {
        b.box("paint", [0.08, 0.42, 1.75], [s * (W / 2 - 0.04), 1.3, bed]); // bed sides
        b.box("light", [0.38, 0.16, 0.05], [s * 0.62, 0.98, h + 0.01]);
        b.box("tail", [0.14, 0.42, 0.05], [s * (W / 2 - 0.1), 1.1, -h - 0.01]);
        b.box("trim", [0.3, 0.38, 1.0], [s * (W / 2 - 0.05), 0.62, ff]);
        b.box("trim", [0.3, 0.38, 1.0], [s * (W / 2 - 0.05), 0.62, fr]);
      }
      b.box("paint", [W - 0.1, 0.42, 0.08], [0, 1.3, -h + 0.05]); // tailgate
      b.box("chrome", [W * 0.6, 0.3, 0.05], [0, 0.95, h + 0.02]); // grille
      b.box("trim", [W + 0.04, 0.22, 0.2], [0, 0.55, h + 0.05]);
      b.box("trim", [W * 0.92, 0.06, 0.06], [0, 1.85, -0.05]); // roll bar over the cab
      if (armed) { // pintle-mounted turret behind the cab
        b.cyl("trim", 0.08, 0.6, [0, 1.6, bed + 0.2], "y", 8);
        b.box("trim", [0.5, 0.36, 0.1], [0, 2.0, bed + 0.45]); // gun shield
        gun(b, 0, 1.95, bed + 0.3, 1.6);
        b.rider(bed - 0.15, 1.05, false);
      }
      b.mirror(1.0, 1.35, W);
      b.axle(ff, W - 0.16, R, 0.3); b.axle(fr, W - 0.16, R, 0.3);
      break;
    }
    default: { // Toyota Camry, the classic tokunbo saloon (and the police cruiser).
      const R = 0.34, ff = h - 0.85, fr = -h + 0.85;
      b.side("paint", [[-h, 0.2], [-h, 0.8, 0.12], [-h + 0.1, 0.96, 0.1], [-1.35, 0.99], [0.7, 0.93], [1.75, 0.83, 0.25], [h, 0.62, 0.15], [h, 0.2]], W, 0.08, [{ f: ff, r: R + 0.05, y: R }, { f: fr, r: R + 0.05, y: R }]);
      b.side("glass", [[-1.48, 0.95], [-1.45, 0.99], [-0.85, 1.42, 0.22], [0.1, 1.45, 0.18], [0.85, 0.93], [0.85, 0.9]], W * 0.8, 0.04);
      roof(b, [[-1.0, 1.38], [-0.7, 1.445], [0.1, 1.455], [0.3, 1.38]], W * 0.72);
      b.box("paint", [W * 0.82, 0.46, 0.14], [0, 1.18, -0.2]);
      b.box("chrome", [0.75, 0.12, 0.05], [0, 0.72, h + 0.01]);
      b.box("trim", [1.1, 0.16, 0.05], [0, 0.4, h + 0.01]);
      for (const s of [-1, 1]) {
        b.box("light", [0.42, 0.14, 0.08], [s * 0.6, 0.76, h - 0.02], [0, s * 0.25, 0]);
        b.box("tail", [0.42, 0.14, 0.05], [s * 0.58, 0.86, -h - 0.01]);
        b.box("chrome", [0.03, 0.03, 0.18], [s * (W / 2 + 0.005), 0.86, 0.2]); b.box("chrome", [0.03, 0.03, 0.18], [s * (W / 2 + 0.005), 0.86, -0.75]);
      }
      if (livery === "police") {
        for (const s of [-1, 1]) b.box("blue", [0.02, 0.2, L - 0.7], [s * (W / 2 + 0.01), 0.68, 0]);
        b.box("blue", [W * 0.6, 0.02, 1.0], [0, 0.97, 1.4]);
      }
      b.mirror(0.6, 1.0, W);
      b.axle(ff, W - 0.18, R, 0.25); b.axle(fr, W - 0.18, R, 0.25);
    }
  }
  return b.build();
}
