// Pure, stepwise schema migrations. No Date.now()/Math.random().
// Loop: while (data.version < CURRENT_VERSION) data = MIGRATIONS[data.version](data).
// Each migration bumps version and is idempotent when re-run on its own output.

import { CURRENT_VERSION, DEFAULT_INTERVALS } from "./schema.js";

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
  })
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
