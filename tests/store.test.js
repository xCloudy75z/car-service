import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { CURRENT_VERSION } from "../src/schema.js";

// In-memory localStorage shim (Map-backed) so store runs under Node.
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m
  };
}

// Deterministic incrementing clock so we can assert updatedAt bumps.
function makeClock() {
  let n = 0;
  return () => `t${n++}`;
}

test("fresh load returns a seeded single-car state at CURRENT_VERSION", () => {
  const store = createStore(makeStorage(), makeClock());
  const state = store.load();
  assert.equal(state.version, CURRENT_VERSION);
  assert.equal(state.cars.length, 1);
  assert.deepEqual(state.cars[0].entries, []);
  assert.equal(state.activeCarId, state.cars[0].id);
  assert.equal(typeof state.cars[0].intervals.oil.km, "number");
});

test("load persists the seed so a second store sees the same data", () => {
  const storage = makeStorage();
  const s1 = createStore(storage, makeClock());
  const first = s1.load();
  const s2 = createStore(storage, makeClock());
  const second = s2.load();
  assert.equal(second.activeCarId, first.activeCarId);
});

test("addEntry assigns a unique id + createdAt/updatedAt and appends to active car", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.addEntry({ date: "2026-07-01", odometer: 50000, cost: 100, tags: ["oil"] });
  const entries = state.cars[0].entries;
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(typeof e.id, "string");
  assert.ok(e.id.length > 0);
  assert.equal(e.createdAt, "t0");
  assert.equal(e.updatedAt, "t0");
  assert.equal(e.deletedAt, null);
});

test("two rapid addEntry calls get distinct ids", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.addEntry({ date: "2026-07-01", odometer: 50000, tags: ["oil"] });
  const state = store.addEntry({ date: "2026-07-02", odometer: 50100, tags: ["tires"] });
  const [a, b] = state.cars[0].entries;
  assert.notEqual(a.id, b.id);
});

test("updateEntry patches fields and bumps updatedAt, preserves createdAt", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const added = store.addEntry({ date: "2026-07-01", odometer: 50000, cost: 100, tags: ["oil"] });
  const id = added.cars[0].entries[0].id;
  const updated = store.updateEntry(id, { cost: 250 });
  const e = updated.cars[0].entries[0];
  assert.equal(e.cost, 250);
  assert.equal(e.createdAt, "t0");
  assert.equal(e.updatedAt, "t1"); // bumped
});

test("deleteEntry is a soft delete (sets deletedAt)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const added = store.addEntry({ date: "2026-07-01", odometer: 50000, tags: ["oil"] });
  const id = added.cars[0].entries[0].id;
  const state = store.deleteEntry(id);
  const e = state.cars[0].entries[0];
  assert.ok(e.deletedAt); // still present, but tombstoned
  assert.equal(e.id, id);
});

test("corrupt stored JSON recovers to a fresh seeded state (never crashes)", () => {
  const storage = makeStorage();
  storage.setItem("car-service:data", "{not valid json");
  const store = createStore(storage, makeClock());
  const state = store.load();
  assert.equal(state.version, CURRENT_VERSION);
  assert.equal(state.cars.length, 1);
});

test("setBaseline stores under the active car's baselines[tag]", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setBaseline("brake_fluid", { odometer: 35000, date: "2025-01-01" });
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].baselines.brake_fluid, { odometer: 35000, date: "2025-01-01" });
});

test("setBaseline without a date stores just the odometer", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setBaseline("oil", { odometer: 20000 });
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].baselines.oil, { odometer: 20000 });
});

test("setBaseline persists so a second store sees the anchor", () => {
  const storage = makeStorage();
  const s1 = createStore(storage, makeClock());
  s1.load();
  s1.setBaseline("brake_fluid", { odometer: 35000 });
  const s2 = createStore(storage, makeClock());
  const state = s2.load();
  assert.deepEqual(state.cars[0].baselines.brake_fluid, { odometer: 35000 });
});

test("clearBaseline removes the anchor", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.setBaseline("brake_fluid", { odometer: 35000 });
  const state = store.clearBaseline("brake_fluid");
  assert.equal(state.cars[0].baselines.brake_fluid, undefined);
});

test("setBaseline rejects a non-finite or negative odometer (sets lastError, no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setBaseline("oil", { odometer: -5 });
  assert.ok(store.lastError);
  assert.equal(state.cars[0].baselines.oil, undefined);
  store.setBaseline("oil", { odometer: NaN });
  assert.ok(store.lastError);
  assert.equal(store.getState().cars[0].baselines.oil, undefined);
});

test("setBaseline rejects a non-predicted job tag (sets lastError, no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setBaseline("tires", { odometer: 1000 }); // tires is predicted:false
  assert.ok(store.lastError);
  assert.equal(state.cars[0].baselines.tires, undefined);
});

test("load migrates a stored v1 blob up to CURRENT_VERSION", () => {
  const storage = makeStorage();
  storage.setItem("car-service:data", JSON.stringify({
    version: 1,
    entries: [{ id: "e1", date: "2026-01-01", odometer: 50000, tags: ["oil"], deletedAt: null }],
    settings: { theme: "light", currencyLabel: "AED" }
  }));
  const store = createStore(storage, makeClock());
  const state = store.load();
  assert.equal(state.version, CURRENT_VERSION);
  assert.equal(state.cars[0].entries.length, 1);
});
