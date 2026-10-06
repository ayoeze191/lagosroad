import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MapData } from "../../shared/types.js";

type MapFile = Pick<MapData, "roads" | "potholes" | "graph"> & Partial<Pick<MapData, "mainComponent">>;

export function validateMap(map: MapFile) {
  const problems: string[] = [];
  const roads = new Set(map.roads.map((road) => road.id));
  const nodes = new Set(map.graph.nodes.map((node) => node.id));
  if (!map.roads.length) problems.push("contains no roads");
  if (map.roads.length !== map.graph.edges.length) problems.push("roads and graph edges must be one-to-one");
  for (const road of map.roads) {
    if (road.points.length < 2) problems.push(`${road.id} has fewer than two points`);
    if (!(road.width > 0)) problems.push(`${road.id} has invalid width`);
    if (road.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) problems.push(`${road.id} has invalid coordinates`);
  }
  map.graph.edges.forEach((edge, i) => {
    if (!roads.has(edge.roadId)) problems.push(`${edge.id} references unknown road`);
    else if (map.roads[i]?.id !== edge.roadId) problems.push(`${edge.id} is not aligned with roads[${i}]`);
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) problems.push(`${edge.id} references unknown node`);
    if (!(edge.length > 0)) problems.push(`${edge.id} has invalid length`);
  });
  for (const hole of map.potholes) {
    if (!roads.has(hole.roadId)) problems.push(`${hole.id} references unknown road`);
    if (!(hole.radius > 0) || !Number.isFinite(hole.position.x) || !Number.isFinite(hole.position.y)) problems.push(`${hole.id} is invalid`);
  }
  if (map.mainComponent !== undefined && !map.graph.nodes.some((n) => n.component === map.mainComponent)) problems.push("main road network is empty");
  return problems;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npm run map:validate -- <lcda-slug>");
  const map = JSON.parse(await readFile(resolve(import.meta.dirname, "../data", `${slug}.json`), "utf8")) as MapData;
  const problems = validateMap(map);
  if (problems.length) throw new Error(`Invalid ${slug} map:\n- ${problems.slice(0, 50).join("\n- ")}`);
  console.log(`${slug}: ${map.roads.length} roads, ${map.graph.nodes.length} nodes, ${map.potholes.length} potholes, ${map.buildings.length} buildings validated.`);
}

if (process.argv[1]?.endsWith("validate-map.ts")) main().catch((error) => { console.error(error); process.exitCode = 1; });
