import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { CURRENT_VERSION, DEFAULT_INTERVALS, CUSTOM_KEY_RE, MAX_CUSTOM_JOBS } from "../src/schema.js";

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

test("fresh seed car includes an empty customJobs object (v3 shape)", () => {
  const store = createStore(makeStorage(), makeClock());
  const state = store.load();
  assert.deepEqual(state.cars[0].customJobs, {});
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

// ---- Cars (multi-vehicle, Slice 6a) ----

test("addCar appends a fully-shaped car and makes it active", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const firstId = first.cars[0].id;
  const state = store.addCar({ name: "Second", make: "Toyota", model: "Corolla", year: 2019, plate: "X1" });
  assert.equal(state.cars.length, 2);
  const added = state.cars[1];
  assert.equal(state.activeCarId, added.id);
  assert.notEqual(added.id, firstId);
  assert.deepEqual(added.entries, []);
  assert.deepEqual(added.customJobs, {});
  assert.deepEqual(added.baselines, {});
  assert.equal(typeof added.intervals.oil.km, "number");
  assert.deepEqual(added.profile, { name: "Second", make: "Toyota", model: "Corolla", year: 2019, plate: "X1" });
});

test("addCar sanitises the profile (caps strings, coerces year) and fills blanks", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const long = "x".repeat(200);
  const state = store.addCar({ name: long, year: "abcd" });
  const p = state.cars[1].profile;
  assert.equal(p.name.length, 60);
  assert.equal(p.year, null);
  assert.equal(p.make, "");
  assert.equal(p.plate, "");
});

test("switchCar sets the active car when it exists", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const firstId = first.cars[0].id;
  store.addCar({ name: "Second" }); // now active is the second car
  const state = store.switchCar(firstId);
  assert.equal(store.lastError, null);
  assert.equal(state.activeCarId, firstId);
});

test("switchCar with an unknown id is a no-op and sets lastError", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const active = first.activeCarId;
  const state = store.switchCar("does-not-exist");
  assert.ok(store.lastError);
  assert.equal(state.activeCarId, active);
});

test("updateCarProfile shallow-merges sanitised fields", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const id = first.cars[0].id;
  store.updateCarProfile(id, { make: "Honda", model: "Civic" });
  const state = store.updateCarProfile(id, { model: "Accord", year: 2020 });
  const p = state.cars[0].profile;
  assert.equal(p.make, "Honda"); // preserved from first patch
  assert.equal(p.model, "Accord"); // overwritten
  assert.equal(p.year, 2020);
});

test("deleteCar refuses to delete the last remaining car (lastError, no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const before = JSON.stringify(store.getState());
  const state = store.deleteCar(first.cars[0].id);
  assert.ok(store.lastError);
  assert.equal(state.cars.length, 1);
  assert.equal(JSON.stringify(store.getState()), before);
});

test("deleting the active car reassigns active to the new cars[0]", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const firstId = first.cars[0].id;
  const afterAdd = store.addCar({ name: "Second" }); // second is now active
  const secondId = afterAdd.cars[1].id;
  const state = store.deleteCar(secondId); // delete the active one
  assert.equal(store.lastError, null);
  assert.equal(state.cars.length, 1);
  assert.equal(state.cars[0].id, firstId);
  assert.equal(state.activeCarId, firstId);
});

test("undoLast restores a deleted car and the active pointer", () => {
  const store = createStore(makeStorage(), makeClock());
  const first = store.load();
  const firstId = first.cars[0].id;
  const afterAdd = store.addCar({ name: "Second" });
  const secondId = afterAdd.cars[1].id; // active
  store.deleteCar(secondId);
  assert.equal(store.getState().cars.length, 1);

  const restored = store.undoLast();
  assert.equal(restored.cars.length, 2);
  assert.ok(restored.cars.some((c) => c.id === secondId));
  assert.equal(restored.activeCarId, secondId); // active pointer restored too
  assert.ok(restored.cars.some((c) => c.id === firstId));

  // Second undo is a no-op (one level only).
  const again = store.undoLast();
  assert.equal(again.cars.length, 2);
});

test("undoRestore remains an alias for undoLast (app.js caller)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const afterAdd = store.addCar({ name: "Second" });
  const secondId = afterAdd.cars[1].id;
  store.deleteCar(secondId);
  const restored = store.undoRestore();
  assert.equal(restored.cars.length, 2);
});

// ---- Editable intervals (Slice 6b) ----

test("setInterval merges km onto the existing interval, preserving timeHintMonths", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  // brake_fluid default = { km: 40000, timeHintMonths: 24 }
  const state = store.setInterval("brake_fluid", 45000);
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].intervals.brake_fluid, { km: 45000, timeHintMonths: 24 });
});

test("setInterval can also update the timeHintMonths when supplied", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setInterval("brake_fluid", 45000, 36);
  assert.deepEqual(state.cars[0].intervals.brake_fluid, { km: 45000, timeHintMonths: 36 });
});

test("setInterval rejects a non-finite or ≤0 km (lastError, no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const before = JSON.stringify(store.getState());
  const s1 = store.setInterval("oil", 0);
  assert.ok(store.lastError);
  assert.equal(JSON.stringify(s1), before);
  store.setInterval("oil", -100);
  assert.ok(store.lastError);
  store.setInterval("oil", NaN);
  assert.ok(store.lastError);
  assert.equal(JSON.stringify(store.getState()), before);
});

test("setInterval rejects a key not in allJobs(activeCar) (lastError, no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const before = JSON.stringify(store.getState());
  const s = store.setInterval("cj_ghost", 10000);
  assert.ok(store.lastError);
  assert.equal(JSON.stringify(s), before);
});

test("setInterval enables a predicted:false built-in (e.g. brakes)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const state = store.setInterval("brakes", 60000);
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].intervals.brakes, { km: 60000 });
});

test("removeInterval deletes the key and leaves entries untouched", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.addEntry({ date: "2026-01-01", odometer: 50000, tags: ["oil"] });
  const state = store.removeInterval("oil");
  assert.equal(state.cars[0].intervals.oil, undefined);
  assert.equal(state.cars[0].entries.length, 1);
  assert.deepEqual(state.cars[0].entries[0].tags, ["oil"]);
});

test("resetIntervals restores a deep copy of DEFAULT_INTERVALS", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.setInterval("oil", 5000);
  store.removeInterval("spark_plugs");
  const state = store.resetIntervals();
  assert.deepEqual(state.cars[0].intervals, DEFAULT_INTERVALS);
  // deep copy — mutating stored state must not touch the shared constant
  state.cars[0].intervals.oil.km = 1;
  assert.equal(DEFAULT_INTERVALS.oil.km, 10000);
});

test("setBaseline succeeds for a predicted:false built-in enabled via setInterval", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.setInterval("brakes", 60000); // enable it
  const state = store.setBaseline("brakes", { odometer: 30000 });
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].baselines.brakes, { odometer: 30000 });
});

test("setBaseline rejects a key that has no interval (not predicted)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  store.removeInterval("oil"); // now oil is not predicted
  const state = store.setBaseline("oil", { odometer: 20000 });
  assert.ok(store.lastError);
  assert.equal(state.cars[0].baselines.oil, undefined);
});

// ---- Custom jobs (Slice 6c) ----

test("addCustomJob returns { state, key } with a key matching CUSTOM_KEY_RE and adds the job", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("Coolant flush", "❄️");
  assert.equal(store.lastError, null);
  assert.equal(typeof key, "string");
  assert.equal(CUSTOM_KEY_RE.test(key), true);
  assert.deepEqual(state.cars[0].customJobs[key], { label: "Coolant flush", icon: "❄️" });
});

test("addCustomJob with a valid km also sets the interval", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("Coolant flush", "❄️", 30000);
  assert.deepEqual(state.cars[0].intervals[key], { km: 30000 });
});

test("addCustomJob with no/invalid km does NOT create an interval", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("Log only", "🔧");
  assert.equal(state.cars[0].intervals[key], undefined);
});

test("addCustomJob with an empty label sets lastError and returns key null (no write)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const before = JSON.stringify(store.getState());
  const { state, key } = store.addCustomJob("   ", "❄️");
  assert.ok(store.lastError);
  assert.equal(key, null);
  assert.equal(JSON.stringify(state), before);
});

test("addCustomJob trims + caps the label to MAX_CUSTOM_LABEL", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("  " + "x".repeat(200) + "  ", "🔧");
  assert.equal(state.cars[0].customJobs[key].label.length, 60);
});

test("addCustomJob stores a multi-emoji icon as a single grapheme", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("Coolant", "🔧🛢");
  assert.equal(state.cars[0].customJobs[key].icon, "🔧");
});

test("addCustomJob defaults an empty/invalid icon to the wrench", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { state, key } = store.addCustomJob("Coolant", "");
  assert.equal(state.cars[0].customJobs[key].icon, "🔧");
});

test("addCustomJob caps the active car at MAX_CUSTOM_JOBS", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  for (let i = 0; i < MAX_CUSTOM_JOBS; i++) {
    const r = store.addCustomJob("Job " + i, "🔧");
    assert.equal(store.lastError, null);
    assert.ok(r.key);
  }
  assert.equal(Object.keys(store.getState().cars[0].customJobs).length, MAX_CUSTOM_JOBS);
  const over = store.addCustomJob("One too many", "🔧");
  assert.ok(store.lastError);
  assert.equal(over.key, null);
  assert.equal(Object.keys(store.getState().cars[0].customJobs).length, MAX_CUSTOM_JOBS);
});

test("updateCustomJob merges sanitised label + icon", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { key } = store.addCustomJob("Coolant flush", "❄️");
  const state = store.updateCustomJob(key, { label: "Radiator flush" });
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].customJobs[key], { label: "Radiator flush", icon: "❄️" });
  const state2 = store.updateCustomJob(key, { icon: "🔥🚗" });
  assert.equal(state2.cars[0].customJobs[key].icon, "🔥");
});

test("updateCustomJob on an unknown key is a no-op + lastError", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const before = JSON.stringify(store.getState());
  const state = store.updateCustomJob("cj_nope", { label: "x" });
  assert.ok(store.lastError);
  assert.equal(JSON.stringify(state), before);
});

test("deleteCustomJob removes the job + interval + strips the tag from entries in one write; undoLast restores all", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { key } = store.addCustomJob("Coolant flush", "❄️", 30000);
  store.addEntry({ date: "2026-01-01", odometer: 50000, tags: [key, "oil"] });

  const state = store.deleteCustomJob(key);
  assert.equal(state.cars[0].customJobs[key], undefined);
  assert.equal(state.cars[0].intervals[key], undefined);
  const entry = state.cars[0].entries[0];
  assert.deepEqual(entry.tags, ["oil"]); // custom tag stripped, other tag preserved
  assert.equal(entry.date, "2026-01-01"); // rest of the entry untouched

  const restored = store.undoLast();
  assert.deepEqual(restored.cars[0].customJobs[key], { label: "Coolant flush", icon: "❄️" });
  assert.deepEqual(restored.cars[0].intervals[key], { km: 30000 });
  assert.ok(restored.cars[0].entries[0].tags.includes(key));
});

test("deleteCustomJob leaves an entry with no remaining tags as an empty array", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { key } = store.addCustomJob("Coolant flush", "❄️");
  store.addEntry({ date: "2026-01-01", odometer: 50000, tags: [key] });
  const state = store.deleteCustomJob(key);
  assert.deepEqual(state.cars[0].entries[0].tags, []);
});

test("setBaseline succeeds for a custom job that has an interval (anchorable)", () => {
  const store = createStore(makeStorage(), makeClock());
  store.load();
  const { key } = store.addCustomJob("Coolant flush", "❄️", 30000);
  const state = store.setBaseline(key, { odometer: 40000 });
  assert.equal(store.lastError, null);
  assert.deepEqual(state.cars[0].baselines[key], { odometer: 40000 });
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
