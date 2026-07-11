import { test } from "node:test";
import assert from "node:assert/strict";
import { getActiveCar, activeEntries, allJobs, jobMeta } from "../src/select.js";
import { JOBS } from "../src/schema.js";

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

// ---- allJobs + jobMeta (per-car registry) --------------------------------

test("allJobs merges built-ins (builtin:true) with custom jobs (builtin:false)", () => {
  const c = { customJobs: { cj_ab12: { label: "Coolant flush", icon: "❄️" } } };
  const reg = allJobs(c);
  // every built-in present + flagged builtin:true
  for (const key of Object.keys(JOBS)) {
    assert.equal(reg[key].builtin, true);
    assert.equal(reg[key].label, JOBS[key].label);
  }
  // the custom job present + flagged builtin:false
  assert.deepEqual(reg.cj_ab12, { label: "Coolant flush", icon: "❄️", builtin: false });
});

test("allJobs tolerates a missing customJobs (undefined car too)", () => {
  assert.equal(Object.keys(allJobs({})).length, Object.keys(JOBS).length);
  assert.equal(Object.keys(allJobs(undefined)).length, Object.keys(JOBS).length);
});

test("jobMeta resolves built-in, custom, and unknown-key fallback", () => {
  const c = { customJobs: { cj_ab12: { label: "Coolant flush", icon: "❄️" } } };
  assert.deepEqual(jobMeta(c, "oil"), { label: "Engine oil", icon: "🛢️" });
  assert.deepEqual(jobMeta(c, "cj_ab12"), { label: "Coolant flush", icon: "❄️" });
  assert.deepEqual(jobMeta(c, "cj_gone"), { label: "cj_gone", icon: "🔧" });
});
