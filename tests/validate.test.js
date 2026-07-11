import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fmtKm, fmtMoney, fmtDate } from "../src/format.js";
import { validateEntry, coerceNumber, isYMD, validateImportEnvelope, safeJsonParse } from "../src/validate.js";
import { CURRENT_VERSION, MAX_CUSTOM_JOBS, MAX_CUSTOM_LABEL } from "../src/schema.js";

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

// ---- Custom jobs import validation (Slice 6c, §7) --------------------------

const customEnvelope = () => ({
  app: "car-service",
  schemaVersion: CURRENT_VERSION,
  exportedAt: "2026-07-11T00:00:00.000Z",
  data: {
    version: CURRENT_VERSION,
    activeCarId: "car-x",
    cars: [
      {
        id: "car-x",
        profile: { name: "Daily", make: "Toyota", model: "Corolla", year: 2019, plate: "A-1" },
        entries: [
          { id: "e1", date: "2026-01-01", odometer: 50000, workshop: "Speedy", cost: 120,
            tags: ["oil", "cj_ab12cd34"], notes: "ok", createdAt: "t0", updatedAt: "t0", deletedAt: null }
        ],
        intervals: { oil: { km: 10000 }, cj_ab12cd34: { km: 30000 } },
        customJobs: { cj_ab12cd34: { label: "Coolant flush", icon: "❄️" } },
        baselines: { cj_ab12cd34: { odometer: 40000 } }
      }
    ],
    settings: { theme: "light", currencyLabel: "AED" }
  }
});

test("import: a custom job + its interval + entry tag + baseline all survive (roundtrip lossless)", () => {
  const r = validateImportEnvelope(customEnvelope());
  assert.equal(r.ok, true);
  const car = r.data.cars[0];
  assert.deepEqual(car.customJobs.cj_ab12cd34, { label: "Coolant flush", icon: "❄️" });
  assert.deepEqual(car.intervals.cj_ab12cd34, { km: 30000 });
  assert.ok(car.entries[0].tags.includes("cj_ab12cd34"));
  assert.deepEqual(car.baselines.cj_ab12cd34, { odometer: 40000 });
});

test("import: a cj_ interval/tag/baseline with no matching customJob is dropped", () => {
  const env = customEnvelope();
  env.data.cars[0].intervals.cj_zzzz = { km: 5000 };
  env.data.cars[0].entries[0].tags.push("cj_zzzz");
  env.data.cars[0].baselines.cj_zzzz = { odometer: 1000 };
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  const car = r.data.cars[0];
  assert.equal(car.intervals.cj_zzzz, undefined);
  assert.equal(car.baselines.cj_zzzz, undefined);
  assert.equal(car.entries[0].tags.includes("cj_zzzz"), false);
  // the legitimate custom key still survives
  assert.ok(car.customJobs.cj_ab12cd34);
});

test("import: a cross-car custom tag is dropped (no shared registry across cars)", () => {
  const env = customEnvelope();
  // second car has its OWN custom job; car-x must not gain access to it
  env.data.cars.push({
    id: "car-y",
    profile: { name: "Other", make: "", model: "", year: null, plate: "" },
    entries: [],
    intervals: {},
    customJobs: { cj_other99: { label: "Diff swap", icon: "⚙️" } },
    baselines: {}
  });
  env.data.cars[0].entries[0].tags.push("cj_other99");
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(r.data.cars[0].entries[0].tags.includes("cj_other99"), false);
  assert.ok(r.data.cars[1].customJobs.cj_other99);
});

test("import: customJobs over MAX_CUSTOM_JOBS are capped", () => {
  const env = customEnvelope();
  const jobs = {};
  for (let i = 0; i < MAX_CUSTOM_JOBS + 10; i++) jobs["cj_job" + i] = { label: "Job " + i, icon: "🔧" };
  env.data.cars[0].customJobs = jobs;
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.data.cars[0].customJobs).length, MAX_CUSTOM_JOBS);
});

test("import: a cj_ key with uppercase or a hyphen is rejected from customJobs", () => {
  const env = customEnvelope();
  env.data.cars[0].customJobs = {
    cj_ABCD: { label: "Bad case", icon: "🔧" },
    "cj_ab-cd": { label: "Bad hyphen", icon: "🔧" },
    cj_good12: { label: "Good", icon: "🔧" }
  };
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  const keys = Object.keys(r.data.cars[0].customJobs);
  assert.deepEqual(keys, ["cj_good12"]);
});

test("import: an over-long custom-job label is capped to MAX_CUSTOM_LABEL", () => {
  const env = customEnvelope();
  env.data.cars[0].customJobs = { cj_long01: { label: "x".repeat(200), icon: "🔧" } };
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(r.data.cars[0].customJobs.cj_long01.label.length, MAX_CUSTOM_LABEL);
});

test("import: a custom job with an over-long multi-emoji icon is reduced to one grapheme", () => {
  const env = customEnvelope();
  env.data.cars[0].customJobs = { cj_icon01: { label: "Coolant", icon: "🔧🛢🚗" } };
  const r = validateImportEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(r.data.cars[0].customJobs.cj_icon01.icon, "🔧");
});
