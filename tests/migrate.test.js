import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, MIGRATIONS } from "../src/migrate.js";
import { CURRENT_VERSION } from "../src/schema.js";

const v1blob = () => ({
  version: 1,
  entries: [
    { id: "e1", date: "2026-01-01", odometer: 50000, tags: ["oil"], deletedAt: null },
    { id: "e2", date: "2026-03-01", odometer: 55000, tags: ["tires"], deletedAt: null }
  ],
  settings: { theme: "dark", currencyLabel: "AED" }
});

test("MIGRATIONS is keyed by from-version", () => {
  assert.equal(typeof MIGRATIONS[1], "function");
});

test("v1 flat entries → v2 car-nested shape at CURRENT_VERSION", () => {
  const out = migrate(v1blob());
  assert.equal(out.version, CURRENT_VERSION);
  assert.equal(Array.isArray(out.cars), true);
  assert.equal(out.cars.length, 1);
  assert.equal(out.activeCarId, out.cars[0].id);
  // entries carried into the single car
  assert.deepEqual(out.cars[0].entries, v1blob().entries);
  // intervals + baselines present
  assert.equal(typeof out.cars[0].intervals, "object");
  assert.equal(typeof out.cars[0].baselines, "object");
  // settings preserved
  assert.equal(out.settings.theme, "dark");
});

test("migrate is idempotent (running twice = running once)", () => {
  const once = migrate(v1blob());
  const twice = migrate(migrate(v1blob()));
  assert.deepEqual(twice, once);
  // already-current data passes through unchanged
  assert.deepEqual(migrate(once), once);
});

test("migrate on already-current data is a no-op", () => {
  const current = migrate(v1blob());
  assert.equal(migrate(current).version, CURRENT_VERSION);
});

// ---- v2 → v3 (customJobs + ghost-key drop) ----

const v2blob = () => ({
  version: 2,
  activeCarId: "car-1",
  cars: [
    {
      id: "car-1",
      profile: { name: "A", make: "", model: "", year: null, plate: "" },
      entries: [{ id: "e1", date: "2026-01-01", odometer: 1000, tags: ["oil"], deletedAt: null }],
      intervals: { oil: { km: 10000 }, ghost_key: { km: 5000 } },
      baselines: {}
    }
  ],
  settings: { theme: "dark", currencyLabel: "AED" }
});

test("v2 → v3: each car gains customJobs:{} and version bumps to 3", () => {
  const out = migrate(v2blob());
  assert.equal(out.version, 3);
  assert.deepEqual(out.cars[0].customJobs, {});
});

test("v2 → v3: an existing customJobs object is preserved", () => {
  const blob = v2blob();
  blob.cars[0].customJobs = { cj_ab12: { label: "Coolant flush", icon: "❄️" } };
  const out = migrate(blob);
  assert.deepEqual(out.cars[0].customJobs, { cj_ab12: { label: "Coolant flush", icon: "❄️" } });
});

test("v2 → v3: a stray intervals key (not in JOBS ∪ customJobs) is dropped", () => {
  const out = migrate(v2blob());
  assert.equal("ghost_key" in out.cars[0].intervals, false);
  assert.equal("oil" in out.cars[0].intervals, true);
});

test("v2 → v3: a custom interval key IS kept when it exists in customJobs", () => {
  const blob = v2blob();
  blob.cars[0].customJobs = { cj_ab12: { label: "Coolant flush", icon: "❄️" } };
  blob.cars[0].intervals.cj_ab12 = { km: 30000 };
  const out = migrate(blob);
  assert.deepEqual(out.cars[0].intervals.cj_ab12, { km: 30000 });
});

test("v2 → v3: non-array cars does not throw (safe empty garage)", () => {
  const out = migrate({ version: 2, cars: "oops", settings: {} });
  assert.equal(out.version, 3);
  assert.deepEqual(out.cars, []);
});

test("migrate is idempotent through v3 (running twice = running once)", () => {
  const once = migrate(v2blob());
  const twice = migrate(migrate(v2blob()));
  assert.deepEqual(twice, once);
});

test("v1 → v3 chains: single car gains customJobs:{} and lands at v3", () => {
  const out = migrate(v1blob());
  assert.equal(out.version, 3);
  assert.deepEqual(out.cars[0].customJobs, {});
});
