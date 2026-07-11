import { test } from "node:test";
import assert from "node:assert/strict";
import { maintenanceRows } from "../src/ui/maintenance.js";

const E = (id, date, odometer, tags) => ({ id, date, odometer, tags, deletedAt: null });
const car = (entries, baselines = {}) => ({ entries, baselines, intervals: null });

// current km = 60000 (from the "tires" entry, which is not a predicted job).
//   oil:          last 45000 → next 55000, rem -5000        → over
//   cabin_filter: last 40500 → next 60500, rem  500 (<=1000)→ soon
//   spark_plugs:  last 10000 → next 110000, rem 50000       → ok
//   air_filter / brake_fluid: no history, no anchor         → none
const mixed = car([
  E("cur", "2026-07-01", 60000, ["tires"]),
  E("oil", "2026-01-01", 45000, ["oil"]),
  E("cab", "2026-05-01", 40500, ["cabin_filter"]),
  E("spk", "2020-01-01", 10000, ["spark_plugs"])
]);

test("maintenanceRows sorts overdue → soon → ok → none", () => {
  const rows = maintenanceRows(mixed);
  assert.deepEqual(rows.map((r) => r.tag), [
    "oil",
    "cabin_filter",
    "spark_plugs",
    "air_filter",
    "brake_fluid"
  ]);
});

test("rows carry label + icon from the JOBS registry", () => {
  const byTag = Object.fromEntries(maintenanceRows(mixed).map((r) => [r.tag, r]));
  assert.equal(byTag.oil.label, "Engine oil");
  assert.equal(typeof byTag.oil.icon, "string");
});

test("brake_fluid & cabin_filter rows have a time caption; oil does not", () => {
  const byTag = Object.fromEntries(maintenanceRows(mixed).map((r) => [r.tag, r]));
  assert.equal(typeof byTag.brake_fluid.caption, "string");
  assert.equal(typeof byTag.cabin_filter.caption, "string");
  assert.equal(byTag.oil.caption, null);
});

test("a baseline anchor with no entries yields p.anchor === true", () => {
  const c = car([], { brake_fluid: { odometer: 35000 } });
  const bf = maintenanceRows(c).find((r) => r.tag === "brake_fluid");
  assert.equal(bf.p.anchor, true);
  assert.equal(bf.p.status !== "none", true); // anchor drives a real prediction
});
