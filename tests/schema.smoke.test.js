import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOBS,
  DEFAULT_INTERVALS,
  dueSoonKm,
  CURRENT_VERSION,
  CUSTOM_KEY_RE,
  newCustomKey,
  MAX_CUSTOM_JOBS,
  MAX_CUSTOM_LABEL
} from "../src/schema.js";

test("schema exposes predicted jobs with intervals", () => {
  for (const k of Object.keys(DEFAULT_INTERVALS)) assert.equal(JOBS[k].predicted, true);
});

test("dueSoon caps at 1000km", () => {
  assert.equal(dueSoonKm(100000), 1000);
  assert.equal(dueSoonKm(10000), 1000);
  assert.equal(dueSoonKm(5000), 500);
});

test("CURRENT_VERSION is 3", () => {
  assert.equal(CURRENT_VERSION, 3);
});

test("newCustomKey from a UUID seed matches CUSTOM_KEY_RE (no hyphens leak)", () => {
  const key = newCustomKey("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(CUSTOM_KEY_RE.test(key), true);
  assert.match(key, /^cj_[a-z0-9]{4,}$/);
});

test("newCustomKey from the store fallback seed shape also matches", () => {
  // store.js's createId fallback yields something like `id-123-4`.
  const key = newCustomKey("id-123-4");
  assert.equal(CUSTOM_KEY_RE.test(key), true);
  assert.match(key, /^cj_[a-z0-9]{4,}$/);
});

test("newCustomKey pads short/empty seeds to a valid key", () => {
  assert.match(newCustomKey(""), /^cj_[a-z0-9]{4,}$/);
  assert.match(newCustomKey("a"), /^cj_[a-z0-9]{4,}$/);
});

test("custom-job caps are exposed", () => {
  assert.equal(MAX_CUSTOM_JOBS, 50);
  assert.equal(MAX_CUSTOM_LABEL, 60);
});
