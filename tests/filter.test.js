import { test } from "node:test";
import assert from "node:assert/strict";
import { filterEntries } from "../src/select.js";

const E = (id, over, extra = {}) => ({
  id,
  date: "2026-01-0" + id,
  odometer: 10000 * id,
  tags: over.tags || [],
  workshop: over.workshop || "",
  notes: over.notes || "",
  deletedAt: null,
  ...extra
});

const entries = [
  E(1, { tags: ["oil"], workshop: "Speedy Lube", notes: "synthetic 5w30" }),
  E(2, { tags: ["tires", "brakes"], workshop: "Al Futtaim", notes: "rotated" }),
  E(3, { tags: ["oil", "air_filter"], workshop: "Corner Garage", notes: "" })
];

test("empty query + no tag returns all entries", () => {
  assert.equal(filterEntries(entries, {}).length, 3);
  assert.equal(filterEntries(entries, { query: "", tag: null }).length, 3);
});

test("query matches workshop (case-insensitive)", () => {
  const r = filterEntries(entries, { query: "speedy" });
  assert.deepEqual(r.map((e) => e.id), [1]);
});

test("query matches notes", () => {
  const r = filterEntries(entries, { query: "ROTATED" });
  assert.deepEqual(r.map((e) => e.id), [2]);
});

test("query matches a job label via JOBS (not the raw tag key)", () => {
  // "engine oil" is the label for the `oil` tag
  const r = filterEntries(entries, { query: "engine oil" });
  assert.deepEqual(r.map((e) => e.id).sort(), [1, 3]);
});

test("tag filter returns only entries carrying that tag", () => {
  const r = filterEntries(entries, { tag: "oil" });
  assert.deepEqual(r.map((e) => e.id).sort(), [1, 3]);
});

test("combined query + tag both must match", () => {
  const r = filterEntries(entries, { query: "corner", tag: "oil" });
  assert.deepEqual(r.map((e) => e.id), [3]);
});

test("no match returns []", () => {
  assert.deepEqual(filterEntries(entries, { query: "zzz-nonexistent" }), []);
  assert.deepEqual(filterEntries(entries, { tag: "battery" }), []);
});

test("tolerates missing fields / undefined options", () => {
  const bare = [{ id: 9, tags: ["oil"] }];
  assert.equal(filterEntries(bare).length, 1);
  assert.equal(filterEntries(bare, { query: "oil" }).length, 1); // matches "Engine oil" label
  assert.equal(filterEntries(undefined, { query: "x" }).length, 0);
});
