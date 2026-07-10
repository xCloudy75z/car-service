// Pure input + import validation. No Date.now()/Math.random().

import { CURRENT_VERSION } from "./schema.js";

// Parse a user-typed number tolerating thousands separators / spaces.
// Returns NaN when not parseable — callers validate the parsed number, not raw text.
export const coerceNumber = (v) => {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[,\s]/g, "");
  if (cleaned === "") return NaN;
  return Number(cleaned);
};

export const isYMD = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
};

// Normalize a tag: trim, lowercase, collapse spaces to underscores.
const normalizeTag = (t) =>
  String(t).trim().toLowerCase().replace(/\s+/g, "_");

// validateEntry(input) → { ok, value|null, errors }
// - rejects empty/invalid date, non-finite odometer, negative cost
// - accepts null odometer (unknown)
// - normalizes tags (trim/lowercase); missing cost defaults to 0
export function validateEntry(input) {
  const errors = {};
  const raw = input || {};

  const date = typeof raw.date === "string" ? raw.date.trim() : "";
  if (!isYMD(date)) errors.date = "Enter a valid date (YYYY-MM-DD).";

  let odometer = raw.odometer;
  if (odometer === "" || odometer === null || odometer === undefined) {
    odometer = null; // unknown is allowed
  } else {
    const n = coerceNumber(odometer);
    if (!Number.isFinite(n) || n < 0) errors.odometer = "Odometer must be a number of 0 or more.";
    else odometer = Math.round(n);
  }

  let cost = raw.cost;
  if (cost === "" || cost === null || cost === undefined) {
    cost = 0;
  } else {
    const c = coerceNumber(cost);
    if (!Number.isFinite(c) || c < 0) errors.cost = "Cost must be a number of 0 or more.";
    else cost = c;
  }

  const tags = Array.isArray(raw.tags)
    ? Array.from(new Set(raw.tags.map(normalizeTag).filter(Boolean)))
    : [];

  const workshop = typeof raw.workshop === "string" ? raw.workshop.trim() : "";
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    value: ok ? { date, odometer, cost, tags, workshop, notes } : null,
    errors
  };
}

// validateImportEnvelope(env) → { ok, errors[] }
// Guards a backup file before it is trusted (full transactional restore is Slice 4).
export function validateImportEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== "object") {
    errors.push("Not a valid backup file.");
    return { ok: false, errors };
  }
  if (env.app !== "car-service") errors.push("This file is not a Car Service History backup.");
  if (!Number.isInteger(env.schemaVersion)) errors.push("Missing or invalid schema version.");
  else if (env.schemaVersion > CURRENT_VERSION) errors.push("This backup is from a newer version of the app.");
  if (!env.data || typeof env.data !== "object") errors.push("Backup contains no data.");
  return { ok: errors.length === 0, errors };
}
