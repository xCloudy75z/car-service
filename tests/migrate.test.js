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
