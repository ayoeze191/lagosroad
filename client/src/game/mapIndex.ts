import { MapIndex } from "../../../shared/spatial.js";
import { buildGraph, type Graph } from "../../../shared/route.js";
import { Traffic } from "../../../shared/traffic.js";
import type { MapData } from "../../../shared/types.js";

const cache = new WeakMap<MapData, { index: MapIndex; graph: Graph; traffic: Traffic }>();

/** Spatial index, road graph and traffic for a map, built once and shared by every screen. */
export function mapTools(map: MapData) {
  let tools = cache.get(map);
  if (!tools) {
    const graph = buildGraph(map);
    tools = { index: new MapIndex(map), graph, traffic: new Traffic(map, graph) };
    cache.set(map, tools);
  }
  return tools;
}

const variants = new WeakMap<MapData, Map<string, MapIndex>>();
/** The sim index to drive on for these road conditions (potholes on/off, go-slow on/off). */
export function simIndex(map: MapData, potholes: boolean, goSlow = false) {
  if (potholes && !goSlow) return mapTools(map).index;
  let byKey = variants.get(map);
  if (!byKey) { byKey = new Map(); variants.set(map, byKey); }
  const key = `${potholes}:${goSlow}`;
  let index = byKey.get(key);
  if (!index) { index = new MapIndex(map, { potholes, goSlow }); byKey.set(key, index); }
  return index;
}
