// Pure, stepwise schema migrations. No Date.now()/Math.random().
// Loop: while (data.version < CURRENT_VERSION) data = MIGRATIONS[data.version](data).
// Each migration bumps version and is idempotent when re-run on its own output.

import { CURRENT_VERSION, DEFAULT_INTERVALS, JOBS } from "./schema.js";

const cloneIntervals = () => JSON.parse(JSON.stringify(DEFAULT_INTERVALS));
const defaultProfile = () => ({ name: "", make: "", model: "", year: null, plate: "" });
const defaultSettings = () => ({ theme: "light", currencyLabel: "AED" });

// Deterministic car id (migrations must be pure/idempotent — random IDs live in store.js).
const MIGRATED_CAR_ID = "car-1";

export const MIGRATIONS = {
  // v1: flat root-level `entries` array → v2: car-nested shape.
  1: (d) => ({
    version: 2,
    activeCarId: MIGRATED_CAR_ID,
    cars: [
      {
        id: MIGRATED_CAR_ID,
        profile: d.profile && typeof d.profile === "object" ? d.profile : defaultProfile(),
        entries: Array.isArray(d.entries) ? d.entries : [],
        intervals: d.intervals && typeof d.intervals === "object" ? d.intervals : cloneIntervals(),
        baselines: d.baselines && typeof d.baselines === "object" ? d.baselines : {}
      }
    ],
    settings: d.settings && typeof d.settings === "object" ? d.settings : defaultSettings()
  }),

  // v2: car-nested shape → v3: each car gains `customJobs`; ghost interval keys
  // (any key not in JOBS ∪ that car's customJobs) are dropped. Idempotent; a
  // non-array `cars` degrades to a safe empty garage rather than throwing.
  2: (d) => {
    const jobKeys = Object.keys(JOBS);
    const cars = Array.isArray(d.cars) ? d.cars : [];
    return {
      ...d,
      version: 3,
      cars: cars.map((c) => {
        if (!c || typeof c !== "object") return c;
        const customJobs =
          c.customJobs && typeof c.customJobs === "object" ? c.customJobs : {};
        const allowed = new Set([...jobKeys, ...Object.keys(customJobs)]);
        const srcIntervals =
          c.intervals && typeof c.intervals === "object" ? c.intervals : {};
        const intervals = {};
        for (const k of Object.keys(srcIntervals)) {
          if (allowed.has(k)) intervals[k] = srcIntervals[k];
        }
        return { ...c, customJobs, intervals };
      })
    };
  }
};

export function migrate(data) {
  let d = data && typeof data === "object" ? data : { version: CURRENT_VERSION };
  if (typeof d.version !== "number") d = { ...d, version: 1 };
  while (d.version < CURRENT_VERSION) {
    const step = MIGRATIONS[d.version];
    if (typeof step !== "function") break; // unknown version: stop rather than loop forever
    d = step(d);
  }
  return d;
}
