// Pure input + import validation. No Date.now()/Math.random().

import { CURRENT_VERSION, JOBS } from "./schema.js";

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

// ---- Import trust boundary (spec §15) --------------------------------------
// Import is treated as HOSTILE input. Everything below rebuilds a fresh state
// object field-by-field from an allow-list; unknown keys are dropped and
// prototype-polluting keys are never read/copied.

const PROTO_KEYS = ["__proto__", "constructor", "prototype"];

// Parse JSON with a reviver that DROPS __proto__/constructor/prototype so a
// hostile file can never pollute Object.prototype. Throws on invalid JSON.
export function safeJsonParse(text) {
  return JSON.parse(String(text), (key, value) => (PROTO_KEYS.includes(key) ? undefined : value));
}

// String → capped String (defends against giant strings from a hostile file).
const capStr = (v, cap = 500) => (v == null ? "" : String(v).slice(0, cap));

// Finite number ≥ 0, else fallback. Used for odometer (null) and cost (0).
const numOr = (v, fallback) => {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const yearOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const isoOrNull = (v) => (typeof v === "string" && v ? v.slice(0, 40) : null);

// Only keep known/normalized job tags; drop unknowns and duplicates.
const cleanTags = (v) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const t of v) {
    const k = normalizeTag(t);
    if (JOBS[k] && !out.includes(k)) out.push(k);
  }
  return out;
};

function cleanProfile(p) {
  const o = p && typeof p === "object" ? p : {};
  return {
    name: capStr(o.name, 100),
    make: capStr(o.make, 100),
    model: capStr(o.model, 100),
    year: yearOrNull(o.year),
    plate: capStr(o.plate, 40)
  };
}

// Rejects the whole file if any entry has an invalid service date (throws).
function cleanEntry(e) {
  const o = e && typeof e === "object" ? e : {};
  const date = typeof o.date === "string" ? o.date : "";
  if (!isYMD(date)) {
    throw new Error("This backup has a service with an invalid date, so it can't be restored.");
  }
  return {
    id: typeof o.id === "string" ? o.id.slice(0, 100) : "",
    date,
    odometer: o.odometer == null || o.odometer === "" ? null : numOr(o.odometer, null),
    workshop: capStr(o.workshop, 500),
    cost: numOr(o.cost, 0),
    tags: cleanTags(o.tags),
    notes: capStr(o.notes, 2000),
    createdAt: isoOrNull(o.createdAt),
    updatedAt: isoOrNull(o.updatedAt),
    deletedAt: isoOrNull(o.deletedAt)
  };
}

function cleanIntervals(iv) {
  const o = iv && typeof iv === "object" ? iv : {};
  const out = {};
  for (const k of Object.keys(JOBS)) {
    const v = o[k];
    if (!v || typeof v !== "object") continue;
    const km = Number(v.km);
    if (!Number.isFinite(km) || km <= 0) continue;
    const entry = { km: Math.round(km) };
    const tm = Number(v.timeHintMonths);
    if (Number.isFinite(tm) && tm > 0) entry.timeHintMonths = Math.round(tm);
    out[k] = entry;
  }
  return out;
}

function cleanBaselines(bl) {
  const o = bl && typeof bl === "object" ? bl : {};
  const out = {};
  for (const k of Object.keys(JOBS)) {
    const v = o[k];
    if (!v || typeof v !== "object") continue;
    const od = Number(v.odometer);
    if (!Number.isFinite(od) || od < 0) continue;
    const entry = { odometer: Math.round(od) };
    if (typeof v.date === "string" && isYMD(v.date)) entry.date = v.date;
    out[k] = entry;
  }
  return out;
}

function cleanSettings(s) {
  const o = s && typeof s === "object" ? s : {};
  const out = {
    theme: o.theme === "dark" ? "dark" : "light",
    currencyLabel: capStr(o.currencyLabel, 10) || "AED"
  };
  if (typeof o.lastBackupAt === "string" && o.lastBackupAt) out.lastBackupAt = o.lastBackupAt.slice(0, 40);
  return out;
}

function cleanCar(c) {
  const o = c && typeof c === "object" ? c : {};
  return {
    id: typeof o.id === "string" ? o.id.slice(0, 100) : "",
    profile: cleanProfile(o.profile),
    entries: Array.isArray(o.entries) ? o.entries.map(cleanEntry) : [],
    intervals: cleanIntervals(o.intervals),
    baselines: cleanBaselines(o.baselines)
  };
}

// Rebuild a clean top-level state from the allow-list. Throws on a bad entry date.
function cleanState(src, schemaVersion) {
  const version = Number.isInteger(src.version) ? src.version : schemaVersion;
  const cars = Array.isArray(src.cars) ? src.cars.map(cleanCar) : [];
  const activeCarId =
    typeof src.activeCarId === "string" && src.activeCarId
      ? src.activeCarId.slice(0, 100)
      : cars[0]
        ? cars[0].id
        : null;
  return { version, activeCarId, cars, settings: cleanSettings(src.settings) };
}

// validateImportEnvelope(obj, currentVersion) → { ok:true, data } | { ok:false, error }
// Verifies the envelope, rejects foreign/newer/malformed files, and rebuilds the
// `data` payload field-by-field from an allow-list into a fresh, trusted object.
export function validateImportEnvelope(obj, currentVersion = CURRENT_VERSION) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "This file isn't a valid backup." };
  }
  if (obj.app !== "car-service") {
    return { ok: false, error: "This file isn't a Car Service History backup." };
  }
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    return { ok: false, error: "This backup is missing a valid version number." };
  }
  if (obj.schemaVersion > currentVersion) {
    return { ok: false, error: "This backup was made by a newer version — update the app first." };
  }
  const src = obj.data;
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return { ok: false, error: "This backup contains no data." };
  }
  try {
    return { ok: true, data: cleanState(src, obj.schemaVersion) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "This backup is damaged and can't be restored." };
  }
}
