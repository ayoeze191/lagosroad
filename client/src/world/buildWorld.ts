import * as THREE from "three";
import { bridgeElevation, MAJOR_HIGHWAYS, type MapData, type Point, type Road } from "../../../shared/types.js";
import { NIGHT, glow } from "./look";
import { asphaltTexture, dirtTexture, puddleTexture, zincTexture } from "./textures";

export const TILE = 300;
const UV_SCALE = 1 / 7;

/** Road surface heights keep overlapping layers from z-fighting. */
export const roadHeight = (road: Pick<Road, "paved" | "highway">) => (!road.paved ? 0.03 : MAJOR_HIGHWAYS.has(road.highway) ? 0.1 : 0.065);

class GeometryBuilder {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private vertex(x: number, y: number, h: number) {
    this.pos.push(x, h, -y);
    this.uv.push(x * UV_SCALE, y * UV_SCALE);
    return this.pos.length / 3 - 1;
  }
  /** a,b at height h; c,d at height h2 (defaults to h) — lets bridge decks slope. */
  quad(a: Point, b: Point, c: Point, d: Point, h: number, h2 = h) {
    const i = this.vertex(a.x, a.y, h), j = this.vertex(b.x, b.y, h), k = this.vertex(c.x, c.y, h2), l = this.vertex(d.x, d.y, h2);
    this.idx.push(i, j, k, i, k, l);
  }
  disc(c: Point, r: number, h: number, segments = 10) {
    const centre = this.vertex(c.x, c.y, h);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      this.vertex(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, h);
    }
    for (let s = 0; s < segments; s++) this.idx.push(centre, centre + 1 + s, centre + 2 + s);
  }
  build() {
    if (!this.idx.length) return undefined;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type Box = { x: number; y: number; z: number; len: number; h: number; w: number; yaw: number; pitch?: number; colour: THREE.Color };

type Tile = {
  key: string;
  minX: number; minY: number;
  paved: GeometryBuilder; unpaved: GeometryBuilder; lines: GeometryBuilder; water: GeometryBuilder; bank: GeometryBuilder;
  /** Bridge parts: centred boxes with a colour. */
  boxes: Box[];
  holes: { x: number; y: number; h: number; r: number }[];
  /** Streetlights: base position, the direction the arm reaches over the road, and road height. */
  lamps: { x: number; y: number; dx: number; dy: number; h: number }[];
  buildings: MapData["buildings"];
  trees: MapData["trees"];
};

const WALLS = ["#e9dcc0", "#f2c9a0", "#c9dde0", "#bfe0c4", "#e7b9a4", "#f4efe6", "#d9c27a", "#b8c4d6"].map((c) => new THREE.Color(c));
const HIP_ROOFS = ["#8c4a2f", "#77746d", "#9b5b36", "#4f6272"].map((c) => new THREE.Color(c));
const FLAT_ROOF = new THREE.Color("#a59f95");
/** Shop signboards in Lagos brand colours (they glow at night). */
const SIGNS = ["#ffcc00", "#2bd24c", "#e4002b", "#19e3ff", "#ff2e88", "#f4f4f4", "#1f6fff", "#ff7a00"].map((c) => new THREE.Color(c));
/** Roads that get streetlights. */
const LIT_ROADS = new Set([...MAJOR_HIGHWAYS, "tertiary", "tertiary_link"]);
const LEAVES = ["#2f6b2f", "#3d7a34", "#4b8a3a", "#2a5e2c"].map((c) => new THREE.Color(c));

export type World = { group: THREE.Group; tiles: { object: THREE.Group; minX: number; minY: number }[]; potholes: THREE.Object3D[]; setNight: (night: boolean) => void; dispose: () => void };

/** Build every static mesh for a map, grouped into tiles that can be culled by distance. */
export function buildWorld(map: MapData): World {
  const tiles = new Map<string, Tile>();
  const tileAt = (x: number, y: number) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), key = `${tx},${ty}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { key, minX: tx * TILE, minY: ty * TILE, paved: new GeometryBuilder(), unpaved: new GeometryBuilder(), lines: new GeometryBuilder(), water: new GeometryBuilder(), bank: new GeometryBuilder(), boxes: [], holes: [], lamps: [], buildings: [], trees: [] };
      tiles.set(key, tile);
    }
    return tile;
  };

  // Rivers and streams under everything else, with muddy banks.
  for (const w of map.water || []) ribbon(w.points, w.width / 2 + 1.5, (tile, a, b, c, d) => tile.bank.quad(a, b, c, d, 0.004), tileAt);
  for (const w of map.water || []) ribbon(w.points, w.width / 2, (tile, a, b, c, d) => tile.water.quad(a, b, c, d, 0.012), tileAt);

  // Road ribbons with mitred joints.
  for (const road of map.roads) {
    if (road.bridge) { addBridge(road, tileAt); continue; }
    const pts = road.points, half = road.width / 2, h = roadHeight(road);
    const left: Point[] = [], right: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next.x - prev.x, dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      let scale = 1;
      if (i > 0 && i < pts.length - 1) {
        const ax = pts[i].x - prev.x, ay = pts[i].y - prev.y, al = Math.hypot(ax, ay) || 1;
        const nx = -ay / al, ny = ax / al; // segment normal
        scale = Math.min(2, 1 / Math.max(0.3, nx * -dy + ny * dx));
      }
      left.push({ x: pts[i].x - dy * half * scale, y: pts[i].y + dx * half * scale });
      right.push({ x: pts[i].x + dy * half * scale, y: pts[i].y - dx * half * scale });
    }
    for (let i = 1; i < pts.length; i++) {
      const tile = tileAt((pts[i - 1].x + pts[i].x) / 2, (pts[i - 1].y + pts[i].y) / 2);
      (road.paved ? tile.paved : tile.unpaved).quad(left[i - 1], right[i - 1], right[i], left[i], h);
    }
    if (MAJOR_HIGHWAYS.has(road.highway) && road.paved) addLaneLines(road, tileAt, h + 0.015);
    if (road.paved && LIT_ROADS.has(road.highway)) addLamps(road, tileAt, h);
  }

  // Junction discs fill the gaps where ribbons meet.
  const byNode = new Map<string, Road[]>();
  map.graph.edges.forEach((edge, i) => {
    for (const id of [edge.from, edge.to]) {
      const list = byNode.get(id);
      if (list) list.push(map.roads[i]); else byNode.set(id, [map.roads[i]]);
    }
  });
  for (const node of map.graph.nodes) {
    const roads = byNode.get(node.id);
    if (!roads) continue;
    const top = roads.reduce((best, r) => (roadHeight(r) > roadHeight(best) ? r : best));
    const radius = Math.max(...roads.map((r) => r.width)) / 2;
    const tile = tileAt(node.position.x, node.position.y);
    (top.paved ? tile.paved : tile.unpaved).disc(node.position, radius, roadHeight(top));
  }

  for (const fb of map.footbridges || []) addFootbridge(fb.points, fb.layer, tileAt);

  const roadsById = new Map(map.roads.map((r) => [r.id, r]));
  for (const hole of map.potholes) {
    const road = roadsById.get(hole.roadId);
    tileAt(hole.position.x, hole.position.y).holes.push({ x: hole.position.x, y: hole.position.y, r: hole.radius, h: (road ? roadHeight(road) : 0.1) + 0.01 });
  }
  for (const b of map.buildings) tileAt(b.x, b.y).buildings.push(b);
  for (const t of map.trees) tileAt(t.x, t.y).trees.push(t);

  // Shared geometry and materials.
  const asphalt = asphaltTexture(), dirt = dirtTexture(), puddles = puddleTexture(), zinc = zincTexture();
  puddles.repeat.set(0.3, 0.3);
  zinc.repeat.set(10, 1);
  const glowMap = glow();
  const materials = {
    // Wet tarmac: low roughness with puddles, so streetlights and the sky reflect in it.
    paved: new THREE.MeshStandardMaterial({ map: asphalt, roughnessMap: puddles, roughness: 0.55, metalness: 0.05 }),
    unpaved: new THREE.MeshStandardMaterial({ map: dirt, roughness: 0.95 }),
    lines: new THREE.MeshStandardMaterial({ color: "#f1e7b8", roughness: 0.5, emissive: "#f1e7b8", emissiveIntensity: 0 }),
    water: new THREE.MeshStandardMaterial({ color: "#1f3e48", roughness: 0.08, metalness: 0.2 }),
    bank: new THREE.MeshStandardMaterial({ color: "#5e4a30", roughness: 1 }),
    structure: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
    // A pale broken-edge rim makes the dark hole readable on dark tarmac from a distance.
    // Broken tarmac edge (a shade darker than the road) around muddy rainwater that mirrors the sky.
    hole: new THREE.MeshStandardMaterial({ color: "#14120f", roughness: 0.04, metalness: 0.35 }),
    rim: new THREE.MeshStandardMaterial({ color: "#2a2826", roughness: 0.95 }),
    wall: facade(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.88 })),
    zinc: new THREE.MeshStandardMaterial({ color: "#ffffff", map: zinc, roughness: 0.42, metalness: 0.55, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
    sign: glowing(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }), 0.55),
    trunk: new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.95 }),
    leaves: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, flatShading: true }),
    pole: new THREE.MeshStandardMaterial({ color: "#3b3f46", roughness: 0.5, metalness: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: "#2a2a2a", emissive: "#ffc27a", emissiveIntensity: 2.2 }),
    pool: new THREE.MeshBasicMaterial({ map: glowMap, color: "#ff9a45", transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  };
  const geometries = {
    hole: jagged(14, 0.22, "hole"),
    rim: jagged(18, 0.3, "rim"),
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    centredBox: new THREE.BoxGeometry(1, 1, 1),
    hip: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    trunk: new THREE.CylinderGeometry(0.18, 0.28, 1, 5).translate(0, 0.5, 0),
    crown: new THREE.IcosahedronGeometry(1, 0),
    frond: new THREE.ConeGeometry(1, 1, 7, 1, true),
    pole: new THREE.CylinderGeometry(0.08, 0.12, 1, 6).translate(0, 0.5, 0),
    pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  };
  const pools: THREE.Object3D[] = [];

  const group = new THREE.Group();
  const tileObjects: World["tiles"] = [];
  const shadows = (mesh: THREE.Mesh, cast: boolean) => { mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; };
  const potholeMeshes: THREE.Object3D[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, fill: (i: number) => THREE.Color | void) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      const colour = fill(i);
      mesh.setMatrixAt(i, m);
      if (colour) mesh.setColorAt(i, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  };

  for (const tile of tiles.values()) {
    const object = new THREE.Group();
    for (const [builder, material] of [[tile.bank, materials.bank], [tile.water, materials.water], [tile.unpaved, materials.unpaved], [tile.paved, materials.paved], [tile.lines, materials.lines]] as const) {
      const geometry = builder.build();
      if (geometry) object.add(shadows(new THREE.Mesh(geometry, material), false));
    }
    if (tile.boxes.length) {
      const euler = new THREE.Euler();
      object.add(instanced(geometries.centredBox, materials.structure, tile.boxes.length, (i) => {
        const b = tile.boxes[i];
        // yaw follows the map direction; pitch tilts stairs and ramps.
        euler.set(0, b.yaw, b.pitch || 0, "YXZ");
        m.compose(p.set(b.x, b.z, -b.y), q.setFromEuler(euler), s.set(b.len, b.h, b.w));
        return b.colour;
      }));
    }
    if (tile.holes.length) {
      // Each hole gets its own turn and stretch, so the shared jagged shape never looks repeated.
      const spin = (h: { x: number; y: number }) => q.setFromAxisAngle(up, (h.x * 12.9898 + h.y * 78.233) % (Math.PI * 2));
      const rims = instanced(geometries.rim, materials.rim, tile.holes.length, (i) => { const h = tile.holes[i]; m.compose(p.set(h.x, h.h - 0.004, -h.y), spin(h), s.set(h.r * 1.3, 1, h.r * 1.05)); });
      const holes = instanced(geometries.hole, materials.hole, tile.holes.length, (i) => { const h = tile.holes[i]; m.compose(p.set(h.x, h.h, -h.y), spin(h), s.set(h.r * 0.95, 1, h.r * 0.8)); });
      object.add(rims, holes);
      potholeMeshes.push(rims, holes);
    }
    if (tile.buildings.length) {
      const bs = tile.buildings;
      object.add(shadows(instanced(geometries.box, materials.wall, bs.length, (i) => {
        const b = bs[i];
        m.compose(p.set(b.x, 0, -b.y), q.setFromAxisAngle(up, b.angle), s.set(b.w, b.h, b.d));
        return WALLS[b.wall % WALLS.length];
      }), true));
      const hips = bs.filter((b) => b.h < 6), flats = bs.filter((b) => b.h >= 6);
      if (hips.length) object.add(shadows(instanced(geometries.hip, materials.zinc, hips.length, (i) => {
        const b = hips[i];
        m.compose(p.set(b.x, b.h, -b.y), q.setFromAxisAngle(up, b.angle), s.set(b.w * 1.12, 1.4 + b.d * 0.12, b.d * 1.12));
        return HIP_ROOFS[b.roof % HIP_ROOFS.length];
      }), true));
      if (flats.length) object.add(shadows(instanced(geometries.box, materials.roof, flats.length, (i) => {
        const b = flats[i];
        m.compose(p.set(b.x, b.h, -b.y), q.setFromAxisAngle(up, b.angle), s.set(b.w * 1.03, 0.5, b.d * 1.03));
        return FLAT_ROOF;
      }), true));
      // Shop signboards over the ground floor of about a third of the buildings (both street faces).
      const signs = bs.filter((b) => b.h > 3.6 && (b.wall * 7 + b.roof * 3 + Math.round(b.w)) % 3 === 0);
      if (signs.length) {
        const off = new THREE.Vector3();
        object.add(instanced(geometries.centredBox, materials.sign, signs.length * 2, (i) => {
          const b = signs[i >> 1], side = i & 1 ? 1 : -1;
          q.setFromAxisAngle(up, b.angle);
          off.set(0, 0, side * (b.d / 2 + 0.08)).applyQuaternion(q);
          m.compose(p.set(b.x + off.x, 3.35, -b.y + off.z), q, s.set(b.w * 0.72, 0.85, 0.12));
          return SIGNS[(b.wall + b.roof + (i & 1)) % SIGNS.length];
        }));
      }
    }
    if (tile.lamps.length) {
      const ls = tile.lamps;
      // Yaw that points a box's -z axis along the arm direction (dx, dy).
      const yaw = (l: { dx: number; dy: number }) => q.setFromAxisAngle(up, Math.atan2(-l.dx, l.dy));
      object.add(instanced(geometries.pole, materials.pole, ls.length, (i) => {
        m.compose(p.set(ls[i].x, 0, -ls[i].y), q.identity(), s.set(1, 7.6, 1));
      }));
      object.add(instanced(geometries.centredBox, materials.pole, ls.length, (i) => {
        const l = ls[i];
        m.compose(p.set(l.x + l.dx * 1.1, 7.5, -(l.y + l.dy * 1.1)), yaw(l), s.set(0.1, 0.1, 2.3));
      }));
      object.add(instanced(geometries.centredBox, materials.lamp, ls.length, (i) => {
        const l = ls[i];
        m.compose(p.set(l.x + l.dx * 2.2, 7.4, -(l.y + l.dy * 2.2)), yaw(l), s.set(0.35, 0.14, 0.8));
      }));
      const pool = instanced(geometries.pool, materials.pool, ls.length, (i) => {
        const l = ls[i];
        m.compose(p.set(l.x + l.dx * 3, l.h + 0.03, -(l.y + l.dy * 3)), q.identity(), s.set(12, 1, 12));
      });
      pool.renderOrder = 2;
      object.add(pool);
      pools.push(pool);
    }
    if (tile.trees.length) {
      const ts = tile.trees;
      object.add(instanced(geometries.trunk, materials.trunk, ts.length, (i) => {
        const t = ts[i], trunk = t.kind === 1 ? t.h : t.h * 0.45;
        m.compose(p.set(t.x, 0, -t.y), q.identity(), s.set(t.kind === 1 ? 0.8 : 1, trunk, t.kind === 1 ? 0.8 : 1));
      }));
      const broad = ts.filter((t) => t.kind !== 1), palms = ts.filter((t) => t.kind === 1);
      if (broad.length) object.add(shadows(instanced(geometries.crown, materials.leaves, broad.length, (i) => {
        const t = broad[i], r = t.h * 0.34;
        m.compose(p.set(t.x, t.h * 0.45 + r * 0.7, -t.y), q.setFromAxisAngle(up, i), s.set(r, r * 0.85, r));
        return LEAVES[i % LEAVES.length];
      }), true));
      if (palms.length) object.add(instanced(geometries.frond, materials.leaves, palms.length, (i) => {
        const t = palms[i];
        m.compose(p.set(t.x, t.h - 0.2, -t.y), q.setFromAxisAngle(up, i), s.set(3, 1.1, 3));
        return LEAVES[(i + 1) % LEAVES.length];
      }));
    }
    group.add(object);
    tileObjects.push({ object, minX: tile.minX, minY: tile.minY });
  }

  return {
    group,
    tiles: tileObjects,
    potholes: potholeMeshes,
    setNight: (night: boolean) => {
      materials.paved.roughness = night ? 0.32 : 0.75;
      materials.lamp.emissiveIntensity = night ? 2.2 : 0;
      materials.lines.emissiveIntensity = night ? 0.12 : 0;
      for (const pool of pools) pool.visible = night;
    },
    dispose: () => {
      group.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose(); if (o instanceof THREE.InstancedMesh) o.dispose(); });
      Object.values(geometries).forEach((g) => g.dispose());
      Object.values(materials).forEach((mat) => mat.dispose());
      asphalt.dispose(); dirt.dispose(); puddles.dispose(); zinc.dispose();
    }
  };
}

/** Dashed centre line plus solid edge lines on major roads. */
function addLaneLines(road: Road, tileAt: (x: number, y: number) => Tile, h: number) {
  const pts = road.points, half = road.width / 2, lineW = 0.09, edgeOffset = half - 0.45;
  const DASH = 3, GAP = 6;
  let travelled = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, nx = -dy, ny = dx;
    const tile = tileAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    const at = (t: number, off: number, w: number): [Point, Point] => [
      { x: a.x + dx * t + nx * (off + w), y: a.y + dy * t + ny * (off + w) },
      { x: a.x + dx * t + nx * (off - w), y: a.y + dy * t + ny * (off - w) }
    ];
    // Centre dashes, phase-continuous along the road.
    let t = (DASH + GAP) - (travelled % (DASH + GAP));
    if (t >= DASH + GAP) t = 0;
    const phase = travelled % (DASH + GAP);
    if (phase < DASH) {
      const end = Math.min(len, DASH - phase);
      const [l0, r0] = at(0, 0, lineW), [l1, r1] = at(end, 0, lineW);
      tile.lines.quad(l0, r0, r1, l1, h);
    }
    for (; t < len; t += DASH + GAP) {
      const end = Math.min(len, t + DASH);
      const [l0, r0] = at(t, 0, lineW), [l1, r1] = at(end, 0, lineW);
      tile.lines.quad(l0, r0, r1, l1, h);
    }
    // Edge lines.
    for (const side of [-1, 1]) {
      const [l0, r0] = at(0, side * edgeOffset, lineW * 0.8), [l1, r1] = at(len, side * edgeOffset, lineW * 0.8);
      tile.lines.quad(l0, r0, r1, l1, h);
    }
    travelled += len;
  }
}

const CONCRETE = new THREE.Color("#b9b4aa"), DARK_CONCRETE = new THREE.Color("#8f8a80"), STEEL = new THREE.Color("#2f5d8a");
const HAZARD_YELLOW = new THREE.Color("#f2c200"), HAZARD_BLACK = new THREE.Color("#1c1c1c");
const REFLECT_RED = new THREE.Color("#ff3b30"), REFLECT_WHITE = new THREE.Color("#ffffff");
const CANOPY = new THREE.Color("#2e7d4f"), ADS = ["#1b75bc", "#e4002b", "#f7b500", "#00a651"].map((c) => new THREE.Color(c));

type TileAt = (x: number, y: number) => Tile;

/** Flat mitred ribbon helper (used for water and banks). */
function ribbon(pts: Point[], half: number, emit: (tile: Tile, a: Point, b: Point, c: Point, d: Point) => void, tileAt: TileAt) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) continue;
    const nx = -(b.y - a.y) / len * half, ny = (b.x - a.x) / len * half;
    emit(tileAt((a.x + b.x) / 2, (a.y + b.y) / 2), { x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny });
  }
}

/** Split a polyline so no piece is longer than `step` metres (bridges need smooth slopes). */
function densify(pts: Point[], step: number) {
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  return out;
}

/** Road bridge: sloped deck on the road's own elevation profile, concrete parapets, pillars under high decks. */
function addBridge(road: Road, tileAt: TileAt) {
  const pts = densify(road.points, 4), half = road.width / 2, base = roadHeight(road);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = cum[cum.length - 1];
  const elev = cum.map((d) => bridgeElevation(road, d, length));
  let sincePillar = 10, stripe = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1];
    if (seg < 0.01) continue;
    const dx = (b.x - a.x) / seg, dy = (b.y - a.y) / seg, nx = -dy * half, ny = dx * half;
    const tile = tileAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    (road.paved ? tile.paved : tile.unpaved).quad({ x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny }, base + elev[i - 1], base + elev[i]);
    const mid = (elev[i - 1] + elev[i]) / 2, yaw = Math.atan2(dy, dx), pitch = Math.atan2(elev[i] - elev[i - 1], seg);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    // Parapet walls on both edges, painted in Lagos black-and-yellow hazard bands, with reflector posts.
    stripe++;
    for (const side of [-1, 1]) {
      for (const half of [0, 1]) {
        const t = half ? 0.25 : -0.25, hx = cx + dx * seg * t, hy = cy + dy * seg * t, hz = base + elev[i - 1] + (elev[i] - elev[i - 1]) * (0.5 + t);
        tile.boxes.push({ x: hx + nx * side * 1.02, y: hy + ny * side * 1.02, z: hz + 0.45, len: seg / 2 + 0.03, h: 0.9, w: 0.3, yaw, pitch, colour: (stripe + half) % 2 ? HAZARD_YELLOW : HAZARD_BLACK });
      }
      if (stripe % 3 === 0) tile.boxes.push({ x: a.x + nx * side * 1.02, y: a.y + ny * side * 1.02, z: base + elev[i - 1] + 1.05, len: 0.16, h: 0.3, w: 0.34, yaw, colour: side > 0 ? REFLECT_RED : REFLECT_WHITE });
    }
    // Deck slab under the road surface.
    if (mid > 0.25) tile.boxes.push({ x: cx, y: cy, z: base + mid - 0.45, len: seg + 0.05, h: 0.9, w: road.width + 0.6, yaw, pitch, colour: DARK_CONCRETE });
    sincePillar += seg;
    if (mid > 2 && sincePillar > 22) {
      sincePillar = 0;
      tile.boxes.push({ x: cx, y: cy, z: (mid - 0.9) / 2, len: 1.4, h: mid - 0.9, w: road.width * 0.55, yaw, colour: DARK_CONCRETE });
    }
  }
}

/** Pedestrian overhead bridge: stairs at each end, deck, railings, canopy roof and an ad panel. */
function addFootbridge(points: Point[], layer: number, tileAt: TileAt) {
  if (points.length < 2) return;
  const E = 6 + (Math.max(1, layer) - 1) * 1.2;
  const first = points[0], last = points[points.length - 1];
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let travelled = 0, adDone = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 0.01) continue;
    const dx = (b.x - a.x) / seg, dy = (b.y - a.y) / seg, yaw = Math.atan2(dy, dx), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const tile = tileAt(cx, cy);
    tile.boxes.push({ x: cx, y: cy, z: E, len: seg + 0.1, h: 0.35, w: 2.6, yaw, colour: CONCRETE });
    for (const side of [-1, 1]) {
      const ox = -dy * 1.25 * side, oy = dx * 1.25 * side;
      tile.boxes.push({ x: cx + ox, y: cy + oy, z: E + 0.65, len: seg + 0.1, h: 1.1, w: 0.08, yaw, colour: STEEL });
      tile.boxes.push({ x: cx + ox, y: cy + oy, z: E + 1.5, len: seg + 0.1, h: 1.9, w: 0.06, yaw, colour: STEEL }); // canopy posts band
    }
    tile.boxes.push({ x: cx, y: cy, z: E + 2.55, len: seg + 0.3, h: 0.12, w: 3.2, yaw, colour: CANOPY });
    // The big advertising panel hung on the side over the carriageway.
    if (!adDone && travelled + seg > total * 0.35) {
      adDone = true;
      const ox = -dy * 1.45, oy = dx * 1.45;
      tile.boxes.push({ x: cx + ox, y: cy + oy, z: E - 0.2, len: Math.min(seg, 14), h: 1.6, w: 0.12, yaw, colour: ADS[Math.abs(Math.round(cx + cy)) % ADS.length] });
    }
    travelled += seg;
  }
  // Columns at each end, and stairs running down beyond each end.
  for (const [end, prev] of [[first, points[1]], [last, points[points.length - 2]]] as const) {
    const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1, dx = (end.x - prev.x) / len, dy = (end.y - prev.y) / len;
    const tile = tileAt(end.x, end.y), yaw = Math.atan2(dy, dx);
    for (const side of [-1, 1]) tile.boxes.push({ x: end.x - dy * 1.1 * side, y: end.y + dx * 1.1 * side, z: E / 2, len: 0.5, h: E, w: 0.5, yaw, colour: DARK_CONCRETE });
    const run = E * 1.7, stair = Math.hypot(run, E);
    tile.boxes.push({ x: end.x + dx * run / 2, y: end.y + dy * run / 2, z: E / 2, len: stair, h: 0.3, w: 2, yaw, pitch: -Math.atan2(E, run), colour: CONCRETE });
    for (const side of [-1, 1]) tile.boxes.push({ x: end.x + dx * run / 2 - dy * 1 * side, y: end.y + dy * run / 2 + dx * 1 * side, z: E / 2 + 0.55, len: stair, h: 0.9, w: 0.06, yaw, pitch: -Math.atan2(E, run), colour: STEEL });
  }
}

/** Streetlights every ~34 m, alternating sides, arm reaching over the carriageway. */
function addLamps(road: Road, tileAt: TileAt, h: number) {
  const pts = road.points, half = road.width / 2 + 0.9;
  let next = 12, travelled = 0, side = 1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    while (next <= travelled + len) {
      const t = next - travelled, nx = -dy * side, ny = dx * side;
      const x = a.x + dx * t + nx * half, y = a.y + dy * t + ny * half;
      tileAt(x, y).lamps.push({ x, y, dx: -nx, dy: -ny, h });
      side = -side;
      next += 34;
    }
    travelled += len;
  }
}

const SHARED_VARYINGS = "varying vec3 vWPos; varying vec3 vWNormal; varying float vHeight; varying float vSeed;";

/**
 * Building facades drawn in the shader from world position, so every house gets floors, window bays,
 * burglar-proof bars, ground-floor shops with rolling shutters, and grime, at its real size.
 * At night (NIGHT uniform) a random mix of windows and shops light up.
 */
function facade(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${SHARED_VARYINGS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        mat4 wim = modelMatrix * instanceMatrix;
        vWPos = (wim * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(wim) * objectNormal);
        vHeight = length(instanceMatrix[1].xyz);
        vSeed = float(gl_InstanceID);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        ${SHARED_VARYINGS}
        uniform float uNight;
        float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float win, isShop, bars, shopLit; vec2 cell;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float side = 1.0 - step(0.5, abs(vWNormal.y));
        vec3 tng = normalize(vec3(-vWNormal.z, 0.0, vWNormal.x) + 1e-5);
        float u = dot(vWPos, tng), y = vWPos.y;
        cell = vec2(floor(u / 2.7), floor(y / 3.1));
        vec2 f = vec2(fract(u / 2.7), fract(y / 3.1));
        float below = step(y, vHeight - 0.7);
        float ground = 1.0 - step(3.1, y);
        isShop = ground * step(0.45, fh(vec2(vSeed, 3.1)));
        float window = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.78);
        float shopFront = step(0.05, f.x) * step(f.x, 0.95) * step(0.0, f.y) * step(f.y, 0.8);
        win = side * below * mix(window, shopFront, isShop);
        bars = step(0.84, fract(f.x * 7.0)) * (1.0 - isShop);
        float shutter = step(0.5, fract(f.y * 22.0));
        shopLit = isShop * step(0.7, fh(vec2(vSeed, 9.0)));
        diffuseColor.rgb *= mix(1.0, 0.72 + 0.28 * smoothstep(0.0, 2.2, y), side);
        diffuseColor.rgb *= 1.0 - 0.18 * side * (1.0 - ground) * step(f.y, 0.06) * below;
        vec3 glass = mix(vec3(0.04, 0.06, 0.08), vec3(0.16), bars);
        vec3 shop = mix(vec3(0.36, 0.37, 0.4), vec3(0.24, 0.25, 0.27), shutter);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(glass, shop, isShop), win);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, win * (1.0 - isShop));`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float lit = step(0.52, fh(cell + vSeed * 1.37));
        vec3 warm = mix(vec3(1.0, 0.68, 0.34), vec3(0.62, 0.8, 1.0), step(0.86, fh(cell + 7.0)));
        totalEmissiveRadiance += uNight * win * ((1.0 - isShop) * lit * warm * 0.8 * (1.0 - bars * 0.7) + shopLit * vec3(1.0, 0.86, 0.62) * 0.35);`);
  };
  return material;
}

/** Instance colour doubles as emissive at night (signboards). */
function glowing(material: THREE.MeshStandardMaterial, strength: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor * uNight * ${strength.toFixed(2)};`);
  };
  return material;
}

/** Irregular flat polygon (a broken pothole outline), seeded so it's the same every visit. */
function jagged(points: number, roughness: number, seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const random = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const shape = new THREE.Shape();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2, r = 1 - roughness + random() * roughness * 1.4;
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}
