import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../../shared/rng.js";
import { validateMap } from "./validate-map.js";

const road = { id: "r", name: "Test", highway: "residential", surface: "asphalt", paved: true, width: 5, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] };

test("accepts a connected, valid map", () => assert.deepEqual(validateMap({
  roads: [road],
  potholes: [{ id: "p", roadId: "r", position: { x: 1, y: 0 }, radius: 0.4, depth: 0.05 }],
  graph: { nodes: [{ id: "a", position: { x: 0, y: 0 }, component: 0 }, { id: "b", position: { x: 2, y: 0 }, component: 0 }], edges: [{ id: "r", from: "a", to: "b", roadId: "r", length: 2 }] },
  mainComponent: 0
}), []));

test("rejects broken graph references", () => assert.match(validateMap({
  roads: [],
  potholes: [{ id: "p", roadId: "missing", position: { x: 0, y: 0 }, radius: 1, depth: 0.05 }],
  graph: { nodes: [], edges: [{ id: "e", from: "a", to: "b", roadId: "missing", length: 0 }] }
}).join(" "), /unknown road/));

test("seeded RNG is deterministic", () => {
  const a = seededRandom("ikorodu-west-v1"), b = seededRandom("ikorodu-west-v1");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
