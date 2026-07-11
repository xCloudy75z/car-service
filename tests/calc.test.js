import { test } from "node:test";
import assert from "node:assert/strict";
import { currentKm, lastDone, predict, stats, costByJob, predictedKeys, intervalFor } from "../src/calc.js";
import { DEFAULT_INTERVALS } from "../src/schema.js";

const car = (entries, baselines = {}) => ({
  entries,
  baselines,
  intervals: JSON.parse(JSON.stringify(DEFAULT_INTERVALS))
});
const E = (id, date, odometer, tags) => ({ id, date, odometer, tags, deletedAt: null });

test("currentKm = max odometer, ignores deleted + null odo", () => {
  const c = car([
    E(1, "2026-01-01", 50000, ["oil"]),
    { ...E(2, "2026-02-01", 60000, ["oil"]), deletedAt: "x" },
    E(3, "2026-03-01", null, ["tires"])
  ]);
  assert.equal(currentKm(c), 50000);
});

test("currentKm empty → 0", () => {
  assert.equal(currentKm(car([])), 0);
});

test("lastDone picks highest odometer, not insert order (out-of-order backfill)", () => {
  const c = car([
    E(1, "2026-01-01", 50000, ["oil"]),
    E(2, "2025-06-01", 40000, ["oil"])
  ]);
  assert.equal(lastDone(c, "oil").odometer, 50000);
});

test("lastDone tie-break by later date then id", () => {
  const c = car([
    E("a", "2026-01-01", 50000, ["oil"]),
    E("b", "2026-02-01", 50000, ["oil"])
  ]);
  assert.equal(lastDone(c, "oil").id, "b");
});

test("lastDone falls back to baseline anchor", () => {
  const c = car([], { brake_fluid: { odometer: 35000 } });
  const ld = lastDone(c, "brake_fluid");
  assert.equal(ld.odometer, 35000);
  assert.equal(ld.anchor, true);
});

test("lastDone with no entry and no baseline → null", () => {
  assert.equal(lastDone(car([]), "oil"), null);
});

test("predict status: ok (plenty of interval left)", () => {
  // oil at 58000, no other entries → currentKm 58000, nextDue 68000, remaining 10000 > 1000
  const p = predict(car([E(1, "2026-01-01", 58000, ["oil"])]), "oil");
  assert.equal(p.status, "ok");
  assert.equal(p.nextDue, 68000);
  assert.equal(p.remaining, 10000);
});

test("predict status: soon (remaining within due-soon window)", () => {
  // oil last done 40000, tyres later push currentKm to 49300
  // oil nextDue 50000, remaining 700 <= min(1000, 10000*0.1)=1000
  const p = predict(car([
    E(1, "2026-01-01", 40000, ["oil"]),
    E(2, "2026-02-01", 49300, ["tires"])
  ]), "oil");
  assert.equal(p.status, "soon");
  assert.equal(p.nextDue, 50000);
  assert.equal(p.remaining, 700);
});

test("predict status: over (nextDue below currentKm)", () => {
  // oil last done 40000 → nextDue 50000; tyres at 57000 drive currentKm to 57000
  // remaining = 50000 - 57000 = -7000 → overdue
  const p = predict(car([
    E(1, "2026-01-01", 40000, ["oil"]),
    E(2, "2026-02-01", 57000, ["tires"])
  ]), "oil");
  assert.equal(p.status, "over");
  assert.equal(p.nextDue, 50000);
  assert.equal(p.remaining, -7000);
});

test("predict status: none (never logged, no anchor)", () => {
  assert.equal(predict(car([]), "oil").status, "none");
});

test("predict uses baseline anchor and flags anchor:true", () => {
  const c = car([E(1, "2026-01-01", 60000, ["tires"])], { oil: { odometer: 55000 } });
  const p = predict(c, "oil");
  // anchor oil at 55000, nextDue 65000, currentKm 60000, remaining 5000
  assert.equal(p.status, "ok");
  assert.equal(p.anchor, true);
  assert.equal(p.nextDue, 65000);
});

test("stats never returns NaN/Infinity on tiny data", () => {
  const s = stats(car([E(1, "2026-07-01", 1000, ["oil"])]), "2026-07-10");
  assert.equal(Number.isFinite(s.total), true);
  assert.equal(s.avgPerYear, null); // <1-day span → null, not Infinity
});

test("stats empty → zeros and null avg", () => {
  const s = stats(car([]), "2026-07-10");
  assert.deepEqual([s.total, s.count, s.avgPerYear], [0, 0, null]);
});

test("stats computes total, thisYear, count and a finite avgPerYear over a real span", () => {
  const c = car([
    E(1, "2025-01-01", 30000, ["oil"]),
    E(2, "2026-01-01", 40000, ["oil"]),
    { ...E(3, "2026-02-01", 45000, ["tires"]), deletedAt: "x" } // deleted, ignored
  ]);
  // costs default undefined → treated as 0; set explicit costs
  c.entries[0].cost = 200;
  c.entries[1].cost = 300;
  const s = stats(c, "2026-07-10");
  assert.equal(s.count, 2);
  assert.equal(s.total, 500);
  assert.equal(s.thisYear, 300); // only the 2026 entry
  assert.equal(Number.isFinite(s.avgPerYear), true);
  // span = 365 days → denom = max(1, 365/365.25) = 1 → avg ~= total
  assert.equal(Math.round(s.avgPerYear), 500);
});

// ---- costByJob ------------------------------------------------------------

const withCost = (id, cost, tags) => ({ ...E(id, "2026-01-01", 10000, tags), cost });

test("costByJob single-tag entry attributes full cost to that job", () => {
  const rows = costByJob(car([withCost(1, 200, ["oil"])]));
  assert.deepEqual(rows, [{ tag: "oil", total: 200 }]);
});

test("costByJob splits a multi-tag entry evenly across its tags", () => {
  const rows = costByJob(car([withCost(1, 300, ["oil", "air_filter", "tires"])]));
  const map = Object.fromEntries(rows.map((r) => [r.tag, r.total]));
  assert.equal(map.oil, 100);
  assert.equal(map.air_filter, 100);
  assert.equal(map.tires, 100);
});

test("costByJob accumulates across entries and sorts by total desc", () => {
  const rows = costByJob(car([
    withCost(1, 200, ["oil"]),
    withCost(2, 100, ["oil", "tires"]), // oil +50, tires +50
    withCost(3, 400, ["tires"])         // tires +400
  ]));
  // oil = 250, tires = 450 → tires first
  assert.deepEqual(rows, [
    { tag: "tires", total: 450 },
    { tag: "oil", total: 250 }
  ]);
});

test("costByJob ignores deleted entries and no-tag entries", () => {
  const rows = costByJob(car([
    withCost(1, 200, ["oil"]),
    withCost(2, 999, []),                              // no tags → contributes nothing
    { ...withCost(3, 500, ["oil"]), deletedAt: "x" }   // deleted → ignored
  ]));
  assert.deepEqual(rows, [{ tag: "oil", total: 200 }]);
});

test("costByJob empty → []", () => {
  assert.deepEqual(costByJob(car([])), []);
});

// ---- predictedKeys + intervalFor (no DEFAULT_INTERVALS fallback) -----------

test("predictedKeys returns the keys of car.intervals", () => {
  assert.deepEqual(predictedKeys(car([])).sort(), Object.keys(DEFAULT_INTERVALS).sort());
});

test("predictedKeys of a car with empty intervals → []", () => {
  assert.deepEqual(predictedKeys({ entries: [], intervals: {} }), []);
});

test("predictedKeys tolerates undefined intervals (no throw) → []", () => {
  assert.deepEqual(predictedKeys({ entries: [] }), []);
  assert.deepEqual(predictedKeys(undefined), []);
});

test("intervalFor returns the interval for a present key", () => {
  assert.deepEqual(intervalFor(car([]), "oil"), { km: 10000 });
});

test("intervalFor returns null (no default fallback) for a key not in intervals", () => {
  // `brakes` has no default interval and is not seeded → null, not a default.
  assert.equal(intervalFor(car([]), "brakes"), null);
  // A key removed from intervals also resolves to null.
  assert.equal(intervalFor({ entries: [], intervals: {} }, "oil"), null);
  assert.equal(intervalFor(undefined, "oil"), null);
});
