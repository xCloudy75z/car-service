import { test } from "node:test";
import assert from "node:assert/strict";
import { getActiveCar, activeEntries } from "../src/select.js";

const car = (id) => ({ id, profile: {}, entries: [], intervals: {}, customJobs: {}, baselines: {} });

test("getActiveCar returns the car matching activeCarId", () => {
  const state = { activeCarId: "b", cars: [car("a"), car("b")] };
  assert.equal(getActiveCar(state).id, "b");
});

test("getActiveCar falls back to cars[0] when activeCarId is missing", () => {
  const state = { cars: [car("a"), car("b")] }; // no activeCarId
  assert.equal(getActiveCar(state).id, "a");
});

test("getActiveCar falls back to cars[0] when activeCarId is stale", () => {
  const state = { activeCarId: "gone", cars: [car("a"), car("b")] };
  assert.equal(getActiveCar(state).id, "a");
});

test("activeEntries filters out soft-deleted entries", () => {
  const c = {
    entries: [
      { id: "1", deletedAt: null },
      { id: "2", deletedAt: "t5" },
      { id: "3" }
    ]
  };
  assert.deepEqual(activeEntries(c).map((e) => e.id), ["1", "3"]);
});
