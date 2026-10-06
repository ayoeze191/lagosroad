import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildGraph, type Graph } from "../../shared/route.js";
import { MapIndex } from "../../shared/spatial.js";
import { Traffic } from "../../shared/traffic.js";
import type { MapData } from "../../shared/types.js";

export type LoadedMap = { map: MapData; index: MapIndex; graph: Graph; traffic: Traffic; variants?: Map<string, MapIndex> };

/** The sim index for a race's road conditions (built on first use and shared by every race on the map). */
export function raceIndex(world: LoadedMap, potholes: boolean, goSlow = false) {
  if (potholes && !goSlow) return world.index;
  const key = `${potholes}:${goSlow}`, variants = (world.variants ??= new Map());
  let index = variants.get(key);
  if (!index) { index = new MapIndex(world.map, { potholes, goSlow }); variants.set(key, index); }
  return index;
}

/** Maps are staged into server/maps by `npm run map:stage` (or MAPS_DIR). */
function mapsDir() {
  if (process.env.MAPS_DIR) return process.env.MAPS_DIR;
  const candidates = [resolve(process.cwd(), "maps"), resolve(process.cwd(), "server/maps"), resolve(import.meta.dirname, "../maps"), resolve(import.meta.dirname, "../../../maps")];
  return candidates.find((dir) => existsSync(dir)) || candidates[0];
}

const cache = new Map<string, Promise<LoadedMap>>();

export function loadMap(slug: string): Promise<LoadedMap> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.reject(new Error("Invalid LCDA"));
  if (!cache.has(slug)) {
    const loading = readFile(resolve(mapsDir(), `${slug}.json`), "utf8").then((text) => {
      const map = JSON.parse(text) as MapData;
      map.footbridges ??= [];
      map.water ??= [];
      const graph = buildGraph(map);
      return { map, index: new MapIndex(map), graph, traffic: new Traffic(map, graph) };
    });
    loading.catch(() => cache.delete(slug));
    cache.set(slug, loading);
  }
  return cache.get(slug)!;
}
