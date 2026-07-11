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

// ---- Backup & restore (Slice 4) ----

function seededStore() {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.addEntry({ date: "2026-01-01", odometer: 50000, cost: 120, tags: ["oil"], workshop: "Speedy", notes: "orig" });
  store.addEntry({ date: "2026-03-01", odometer: 55000, cost: 80, tags: ["tires"] });
  return store;
}

test("exportBackup returns a valid envelope whose data matches state + sets lastBackupAt", () => {
  const store = seededStore();
  const env = store.exportBackup();
  assert.equal(env.app, "car-service");
  assert.equal(env.schemaVersion, CURRENT_VERSION);
  assert.equal(typeof env.exportedAt, "string");
  assert.deepEqual(env.data, store.getState());
  assert.equal(store.getState().settings.lastBackupAt, env.exportedAt);
});

test("previewImport reports correct car/entry counts without writing", () => {
  const store = seededStore();
  const env = store.exportBackup();
  const before = JSON.stringify(store.getState());
  const pv = store.previewImport(env);
  assert.equal(pv.ok, true);
  assert.equal(pv.carCount, 1);
  assert.equal(pv.entryCount, 2); // both non-deleted
  assert.equal(JSON.stringify(store.getState()), before); // no write
});

test("previewImport rejects a bad file and does not write", () => {
  const store = seededStore();
  const before = JSON.stringify(store.getState());
  const pv = store.previewImport({ app: "not-us", schemaVersion: 2, data: {} });
  assert.equal(pv.ok, false);
  assert.ok(pv.error);
  assert.equal(JSON.stringify(store.getState()), before);
});

test("commitImport replaces state, regenerates ids, keeps live data on a bad import", () => {
  const store = seededStore();
  const env = store.exportBackup();
  const importedCarId = env.data.cars[0].id;
  const importedEntryIds = env.data.cars[0].entries.map((e) => e.id);

  // Bad import must not touch live data.
  const liveBefore = JSON.stringify(store.getState());
  const bad = store.commitImport({ app: "car-service", schemaVersion: 999, data: {} });
  assert.equal(bad.ok, false);
  assert.equal(JSON.stringify(store.getState()), liveBefore);

  // Good import replaces state and regenerates every id.
  const res = store.commitImport(env);
  assert.equal(res.ok, true);
  const car = res.state.cars[0];
  assert.notEqual(car.id, importedCarId);
  for (const e of car.entries) assert.equal(importedEntryIds.includes(e.id), false);
  assert.equal(res.state.activeCarId, car.id); // activeCarId remapped to the new id
});

test("undoRestore brings back the exact pre-restore state (one level)", () => {
  const store = seededStore();
  const env = store.exportBackup();

  // Change live data so we can prove the snapshot is the pre-restore version.
  store.addEntry({ date: "2026-06-01", odometer: 60000, tags: ["oil"] });
  const preRestore = JSON.stringify(store.getState());

  store.commitImport(env); // now 2 entries (from env), snapshot holds the 3-entry state
  assert.equal(store.getState().cars[0].entries.length, 2);

  const undone = store.undoRestore();
  assert.equal(JSON.stringify(undone), preRestore);
  assert.equal(store.getState().cars[0].entries.length, 3);

  // Second undo is a no-op (one level only).
  const again = store.undoRestore();
  assert.equal(JSON.stringify(again), preRestore);
});

test("export → commitImport roundtrip preserves entry count / dates / costs", () => {
  const store = seededStore();
  const env = store.exportBackup();
  const res = store.commitImport(env);
  assert.equal(res.ok, true);
  const entries = res.state.cars[0].entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, "2026-01-01");
  assert.equal(entries[0].cost, 120);
  assert.equal(entries[1].date, "2026-03-01");
  assert.equal(entries[1].cost, 80);
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
