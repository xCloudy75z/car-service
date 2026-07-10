import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fmtKm, fmtMoney, fmtDate } from "../src/format.js";
import { validateEntry, coerceNumber, isYMD, validateImportEnvelope } from "../src/validate.js";

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
