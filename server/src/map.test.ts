import assert from "node:assert/strict";
import test from "node:test";
import { CARS } from "../../shared/cars.js";
import { Law, HEAT } from "../../shared/police.js";
import { Traffic } from "../../shared/traffic.js";
import { buildGraph, distancesFrom, remainingDistance } from "../../shared/route.js";
import { createCarState, stepCar } from "../../shared/sim.js";
import { MapIndex } from "../../shared/spatial.js";
import type { MapData } from "../../shared/types.js";

const straight = (potholes: MapData["potholes"] = []): MapData => ({
  schemaVersion: 2, generatedAt: "", source: { attribution: "", licence: "", provider: "" },
  area: { slug: "t", name: "T", seed: "t" }, extent: { minX: -10, minY: -10, maxX: 10, maxY: 1000 }, mainComponent: 0,
  roads: [{ id: "r", name: "Test Rd", highway: "primary", surface: "asphalt", paved: true, width: 10, points: [{ x: 0, y: 0 }, { x: 0, y: 1000 }] }],
  graph: { nodes: [{ id: "a", position: { x: 0, y: 0 }, component: 0 }, { id: "b", position: { x: 0, y: 1000 }, component: 0 }], edges: [{ id: "r", from: "a", to: "b", roadId: "r", length: 1000 }] },
  potholes, buildings: [], trees: [], footbridges: [], water: []
});
const drive = (map: MapData, steps: number, x = 0) => {
  const index = new MapIndex(map), car = createCarState({ x, y: 0 }, 0);
  for (let i = 0; i < steps; i++) stepCar(car, { throttle: 1, steer: 0 }, CARS[2], index);
  return car;
};

test("the nearest road reports on-road and off-road correctly", () => {
  const index = new MapIndex(straight());
  assert.ok(index.roads.nearest({ x: 2, y: 50 })!.edge < 0);
  assert.ok(index.roads.nearest({ x: 20, y: 50 })!.edge > 0);
});

test("driving off the road is much slower", () => {
  assert.ok(drive(straight(), 600, 30).speed < drive(straight(), 600).speed * 0.5);
});

test("hitting a pothole sharply cuts speed", () => {
  const clean = drive(straight(), 240);
  const holed = drive(straight([{ id: "p", roadId: "r", position: { x: 0, y: clean.y - 5 }, radius: 1, depth: 0.1 }]), 240);
  assert.ok(holed.speed < clean.speed * 0.8);
});

test("remaining distance follows the road graph", () => {
  const map = straight(), graph = buildGraph(map), index = new MapIndex(map);
  const toFinish = distancesFrom(graph, graph.nodeIndex.get("b")!);
  assert.equal(Math.round(remainingDistance(map, graph, index.roads, toFinish, { x: 0, y: 250 })!), 750);
});

test("traffic is deterministic and solid", () => {
  const map = straight(), graph = buildGraph(map), index = new MapIndex(map);
  const a = new Traffic(map, graph), b = new Traffic(map, graph);
  assert.ok(a.vehicles.length > 0);
  assert.deepEqual(a.vehiclePose(a.vehicles[0], 12.5), b.vehiclePose(b.vehicles[0], 12.5));
  // Drive straight into the first vehicle's position at t=0: we should bounce and lose speed.
  const v = a.vehicles[0], pose = a.vehiclePose(v, 0);
  const car = createCarState({ x: pose.x, y: pose.y - 1.5 }, 0);
  car.speed = 20;
  const events: Record<string, unknown> = {};
  stepCar(car, { throttle: 1, steer: 0 }, CARS[1], index, events, { traffic: { vehiclesNear: (_p: unknown, _t: number, _r: number, visit: (v: unknown, pose: unknown) => void) => visit(v, { ...pose }), walkersNear: () => undefined } as unknown as Traffic, time: 0 });
  assert.equal(events.traffic, v.id);
  assert.ok(car.speed < 10);
});

test("rough driving brings the police; getting caught holds you", () => {
  const map = straight(), graph = buildGraph(map), index = new MapIndex(map);
  const law = new Law(index, graph);
  const player = createCarState({ x: 0, y: 500 }, 0);
  law.record({ traffic: "v1" }, 1);
  law.record({ traffic: "v2" }, 2);
  law.update(0.05, player, false);
  assert.ok(law.heat >= HEAT.wanted && law.police, "police should spawn");
  // Sit still next to the police car.
  player.x = law.police!.car.x; player.y = law.police!.car.y;
  for (let i = 0; i < 40 && !law.held; i++) { law.update(0.05, player, false); player.x = law.police?.car.x ?? player.x; player.y = law.police?.car.y ?? player.y; }
  assert.equal(law.heldBy, "police");
  assert.equal(law.heat, 0);
});

test("danfo drivers must pay the agbero or be chased", () => {
  const map = straight(), graph = buildGraph(map), index = new MapIndex(map);
  const traffic = { agberoPosts: [{ id: "a1", x: 7, y: 300, heading: 0 }] } as unknown as Traffic;
  // Stop and pay.
  const payer = new Law(index, graph, traffic), bus = createCarState({ x: 0, y: 300 }, 0);
  for (let i = 0; i < 30; i++) payer.update(0.05, bus, true);
  assert.ok(payer.news.includes("paid"));
  // Drive past without stopping.
  const dodger = new Law(index, graph, traffic), runner = createCarState({ x: 0, y: 300 }, 0);
  runner.speed = 25;
  for (let i = 0; i < 40; i++) { runner.y += 25 * 0.05; dodger.update(0.05, runner, true); }
  assert.ok(dodger.agbero, "agbero should chase");
  // Only danfos get stopped.
  const car = new Law(index, graph, traffic);
  for (let i = 0; i < 30; i++) car.update(0.05, createCarState({ x: 0, y: 300 }, 0), false);
  assert.ok(!car.demand && !car.news.includes("paid"));
});
