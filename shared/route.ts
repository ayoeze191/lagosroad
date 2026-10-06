import { seededRandom } from "./rng.js";
import type { RoadGrid } from "./spatial.js";
import { headingTowards } from "./sim.js";
import { regionAt, type MapData, type Point } from "./types.js";

export type Graph = {
  nodeIndex: Map<string, number>;
  adjacency: { to: number; length: number; edge: number }[][];
};

export function buildGraph(map: MapData): Graph {
  const nodeIndex = new Map(map.graph.nodes.map((n, i) => [n.id, i]));
  const adjacency = map.graph.nodes.map(() => [] as Graph["adjacency"][number]);
  map.graph.edges.forEach((e, i) => {
    const a = nodeIndex.get(e.from)!, b = nodeIndex.get(e.to)!;
    adjacency[a].push({ to: b, length: e.length, edge: i });
    adjacency[b].push({ to: a, length: e.length, edge: i });
  });
  return { nodeIndex, adjacency };
}

/** Shortest road distance from `source` to every node (Infinity if unreachable). */
export function distancesFrom(graph: Graph, source: number): Float64Array {
  const dist = new Float64Array(graph.adjacency.length).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (d: number, n: number) => {
    heap.push([d, n]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  dist[source] = 0;
  push(0, source);
  while (heap.length) {
    const [d, n] = pop();
    if (d > dist[n]) continue;
    for (const { to, length } of graph.adjacency[n]) {
      const nd = d + length;
      if (nd < dist[to]) { dist[to] = nd; push(nd, to); }
    }
  }
  return dist;
}

/** Remaining road distance to the finish for a position, using the nearest road. */
export function remainingDistance(map: MapData, graph: Graph, roads: RoadGrid, toFinish: Float64Array, p: Point): number | undefined {
  const hit = roads.nearest(p, 60);
  if (!hit) return undefined;
  const edge = map.graph.edges[hit.road];
  const a = graph.nodeIndex.get(edge.from)!, b = graph.nodeIndex.get(edge.to)!;
  return Math.min(toFinish[a] + hit.t * edge.length, toFinish[b] + (1 - hit.t) * edge.length) + Math.max(0, hit.edge);
}

/** Facing direction at a start node: along the first road that heads towards the finish. */
export function startHeading(map: MapData, graph: Graph, toFinish: Float64Array, startId: string): number {
  const start = graph.nodeIndex.get(startId)!;
  let best: { score: number; edge: number } | undefined;
  for (const link of graph.adjacency[start]) {
    const score = toFinish[link.to] + link.length;
    if (!best || score < best.score) best = { score, edge: link.edge };
  }
  const node = map.graph.nodes[start].position;
  if (!best) return 0;
  const edge = map.graph.edges[best.edge];
  const pts = map.roads[best.edge].points;
  const next = edge.from === startId ? pts[Math.min(1, pts.length - 1)] : pts[Math.max(0, pts.length - 2)];
  return headingTowards(node, next);
}

/**
 * Pick a start/finish pair on the main network whose route length falls in [min, max] metres.
 * With `between` = [a, b] (region indexes), the start is in LCDA a and the finish in LCDA b.
 */
export function randomRace(map: MapData, graph: Graph, seed = String(Math.random()), min = 1200, max = 3200, between?: [number, number]) {
  const random = seededRandom(seed);
  const candidates = map.graph.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => n.component === map.mainComponent && graph.adjacency[i].length >= 3);
  const pool = candidates.length > 10 ? candidates : map.graph.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.component === map.mainComponent);
  const inRegion = (r: number) => pool.filter(({ n }) => regionAt(map, n.position) === r);
  const starts = between ? inRegion(between[0]) : pool, finishes = between ? inRegion(between[1]) : pool;
  if (!starts.length || !finishes.length) return undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    const start = starts[Math.floor(random() * starts.length)];
    const dist = distancesFrom(graph, start.i);
    const fits = finishes.filter(({ i }) => dist[i] >= min && dist[i] <= max);
    if (fits.length) {
      const finish = fits[Math.floor(random() * fits.length)];
      return { start: start.n.id, finish: finish.n.id, length: dist[finish.i] };
    }
  }
  return undefined;
}
