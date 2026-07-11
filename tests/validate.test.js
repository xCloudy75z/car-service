import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fmtKm, fmtMoney, fmtDate } from "../src/format.js";
import { validateEntry, coerceNumber, isYMD, validateImportEnvelope, safeJsonParse } from "../src/validate.js";
import { CURRENT_VERSION } from "../src/schema.js";

// ---- format.js ----

test("escapeHtml escapes < > & \" '", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
});

test("escapeHtml handles non-strings", () => {
  assert.equal(escapeHtml(123), "123");
});

test("fmtKm formats with separators, null → em dash", () => {
  assert.equal(fmtKm(52000), "52,000 km");
  assert.equal(fmtKm(null), "—");
});

test("fmtMoney formats with label + 2 decimals", () => {
  assert.equal(fmtMoney(1250, "AED"), "AED 1,250.00");
});

test("fmtDate passes valid ISO, blanks → em dash", () => {
  assert.equal(fmtDate("2026-07-01"), "2026-07-01");
  assert.equal(fmtDate(null), "—");
});

// ---- validate.js ----

test("coerceNumber strips thousands separators", () => {
  assert.equal(coerceNumber("1,250"), 1250);
  assert.equal(coerceNumber("52 000"), 52000);
  assert.equal(coerceNumber(42), 42);
  assert.equal(Number.isNaN(coerceNumber("abc")), true);
});

test("isYMD validates YYYY-MM-DD", () => {
  assert.equal(isYMD("2026-07-01"), true);
  assert.equal(isYMD("2026-13-01"), false);
  assert.equal(isYMD("2026-7-1"), false);
  assert.equal(isYMD("not a date"), false);
});

test("validateEntry rejects empty/invalid date", () => {
  const r = validateEntry({ date: "", odometer: 50000, cost: 100, tags: ["oil"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.date);
});

test("validateEntry rejects non-finite odometer", () => {
  const r = validateEntry({ date: "2026-07-01", odometer: "abc", cost: 100, tags: ["oil"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.odometer);
});

test("validateEntry rejects negative cost", () => {
  const r = validateEntry({ date: "2026-07-01", odometer: 50000, cost: "-5", tags: ["oil"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.cost);
});

test("validateEntry accepts null odometer (unknown)", () => {
  const r = validateEntry({ date: "2026-07-01", odometer: null, cost: 100, tags: ["oil"] });
  assert.equal(r.ok, true);
  assert.equal(r.value.odometer, null);
});

test("validateEntry normalizes tags (trim/lowercase) and coerces numbers", () => {
  const r = validateEntry({ date: "2026-07-01", odometer: "52,000", cost: "1,250", tags: [" Oil ", "AIR_Filter", ""] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.tags, ["oil", "air_filter"]);
  assert.equal(r.value.odometer, 52000);
  assert.equal(r.value.cost, 1250);
});

test("validateEntry defaults missing cost to 0", () => {
  const r = validateEntry({ date: "2026-07-01", odometer: 50000, tags: ["oil"] });
  assert.equal(r.ok, true);
  assert.equal(r.value.cost, 0);
});

test("validateImportEnvelope rejects foreign / newer / accepts good", () => {
  assert.equal(validateImportEnvelope({ app: "something-else", schemaVersion: 2, data: {} }).ok, false);
  assert.equal(validateImportEnvelope({ app: "car-service", schemaVersion: 999, data: {} }).ok, false);
  assert.equal(validateImportEnvelope({ app: "car-service", schemaVersion: 2, data: {} }).ok, true);
});

// ---- Import trust boundary (Slice 4) ----

const goodCar = () => ({
  id: "car-x",
  profile: { name: "Daily", make: "Toyota", model: "Corolla", year: 2019, plate: "A-1" },
  entries: [
    { id: "e1", date: "2026-01-01", odometer: 50000, workshop: "Speedy", cost: 120, tags: ["oil"], notes: "ok",
      createdAt: "t0", updatedAt: "t0", deletedAt: null }
  ],
  intervals: { oil: { km: 10000 } },
  baselines: { brake_fluid: { odometer: 35000 } }
});
const goodEnvelope = () => ({
  app: "car-service",
  schemaVersion: CURRENT_VERSION,
  exportedAt: "2026-07-11T00:00:00.000Z",
  data: { version: CURRENT_VERSION, activeCarId: "car-x", cars: [goodCar()], settings: { theme: "light", currencyLabel: "AED" } }
});

test("validateImportEnvelope rejects non-object / missing version", () => {
  assert.equal(validateImportEnvelope(null).ok, false);
  assert.equal(validateImportEnvelope("nope").ok, false);
  assert.equal(validateImportEnvelope({ app: "car-service", data: {} }).ok, false); // no schemaVersion
  assert.equal(validateImportEnvelope({ app: "car-service", schemaVersion: 1.5, data: {} }).ok, false);
});

test("validateImportEnvelope newer-version error mentions updating", () => {
  const r = validateImportEnvelope({ app: "car-service", schemaVersion: CURRENT_VERSION + 1, data: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /newer version/i);
});

test("validateImportEnvelope accepts a good envelope and returns clean data", () => {
  const r = validateImportEnvelope(goodEnvelope());
  assert.equal(r.ok, true);
  assert.equal(r.data.cars.length, 1);
  assert.equal(r.data.cars[0].entries[0].odometer, 50000);
  assert.equal(r.data.cars[0].entries[0].cost, 120);
  assert.equal(r.data.cars[0].entries[0].date, "2026-01-01");
});

test("validateImportEnvelope drops unknown tags and unknown keys", () => {
  const env = goodEnvelope();
  env.data.cars[0].entries[0].tags = ["oil", "not_a_real_job", "TIRES"];
  env.data.cars[0].entries[0].evil = "should be dropped";
  env.data.cars[0].hackerField = 1;
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.cars[0].entries[0].tags, ["oil", "tires"]);
  assert.equal("evil" in r.data.cars[0].entries[0], false);
  assert.equal("hackerField" in r.data.cars[0], false);
});

test("validateImportEnvelope rejects a file with an invalid entry date", () => {
  const env = goodEnvelope();
  env.data.cars[0].entries[0].date = "07/11/2026";
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, false);
  assert.match(r.error, /date/i);
});

test("validateImportEnvelope clamps a negative cost to 0 and bad odometer to null", () => {
  const env = goodEnvelope();
  env.data.cars[0].entries[0].cost = -99;
  env.data.cars[0].entries[0].odometer = "not-a-number";
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(r.data.cars[0].entries[0].cost, 0);
  assert.equal(r.data.cars[0].entries[0].odometer, null);
});

test("safeJsonParse strips __proto__ so it cannot pollute", () => {
  const parsed = safeJsonParse('{"a":1,"__proto__":{"polluted":1}}');
  assert.equal(parsed.a, 1);
  assert.equal(({}).polluted, undefined); // Object.prototype untouched
  assert.equal(Object.prototype.polluted, undefined);
});

test("safeJsonParse throws on invalid JSON (caller shows an error toast)", () => {
  assert.throws(() => safeJsonParse("{not json"));
});
