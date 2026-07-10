import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS, DEFAULT_INTERVALS, dueSoonKm } from "../src/schema.js";

test("schema exposes predicted jobs with intervals", () => {
  for (const k of Object.keys(DEFAULT_INTERVALS)) assert.equal(JOBS[k].predicted, true);
});

test("dueSoon caps at 1000km", () => {
  assert.equal(dueSoonKm(100000), 1000);
  assert.equal(dueSoonKm(10000), 1000);
  assert.equal(dueSoonKm(5000), 500);
});
