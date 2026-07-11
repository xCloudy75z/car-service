// Persistence + CRUD. Owns IDs (crypto.randomUUID), soft delete, createdAt/updatedAt,
// temp-key-then-swap writes, and quota handling. Storage backend is injectable for
// testing; defaults to window.localStorage in the browser.

import { CURRENT_VERSION, DEFAULT_INTERVALS, JOBS } from "./schema.js";
import { migrate } from "./migrate.js";
import { getActiveCar } from "./select.js";

const KEY = "car-service:data";
const TMP_KEY = "car-service:data.tmp";

function defaultBackend() {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
}

function defaultNow() {
  return new Date().toISOString();
}

const cloneIntervals = () => JSON.parse(JSON.stringify(DEFAULT_INTERVALS));

// Rebuild only the active car via `fn`, returning a new state object (immutable-ish).
function replaceActiveCar(state, fn) {
  const car = getActiveCar(state);
  return { ...state, cars: state.cars.map((c) => (c.id === car.id ? fn(c) : c)) };
}

export function createStore(storage = defaultBackend(), now = defaultNow) {
  let state = null;
  let lastError = null;

  const createId = () =>
    globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `id-${now()}-${Math.round(performance?.now?.() ?? 0)}`;

  function defaultState() {
    const id = createId();
    return {
      version: CURRENT_VERSION,
      activeCarId: id,
      cars: [
        {
          id,
          profile: { name: "", make: "", model: "", year: null, plate: "" },
          entries: [],
          intervals: cloneIntervals(),
          baselines: {}
        }
      ],
      settings: { theme: "light", currencyLabel: "AED" }
    };
  }

  // temp-key-then-swap so a failed large write never corrupts the good record.
  function persist(next) {
    lastError = null;
    state = next;
    if (!storage) return next;
    try {
      const json = JSON.stringify(next);
      storage.setItem(TMP_KEY, json);
      storage.setItem(KEY, json);
      storage.removeItem(TMP_KEY);
    } catch (err) {
      // Keep the change in memory; surface via lastError so the UI can prompt a backup.
      lastError = err;
    }
    return next;
  }

  function load() {
    let raw = null;
    try {
      raw = storage ? storage.getItem(KEY) : null;
    } catch (err) {
      lastError = err;
      raw = null;
    }
    if (!raw) return persist(defaultState());

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Corrupt data → recover to an empty app rather than crash.
      lastError = err;
      return persist(defaultState());
    }
    if (!parsed || typeof parsed !== "object") return persist(defaultState());

    let migrated;
    try {
      migrated = migrate(parsed);
    } catch (err) {
      lastError = err;
      return persist(defaultState());
    }

    state = migrated;
    if (migrated.version !== parsed.version) persist(migrated); // write upgraded shape back
    return state;
  }

  function ensureLoaded() {
    if (!state) load();
    return state;
  }

  function addEntry(data) {
    const s = ensureLoaded();
    const ts = now();
    const d = data || {};
    const entry = {
      id: createId(),
      date: typeof d.date === "string" ? d.date : null,
      odometer: d.odometer === undefined ? null : d.odometer,
      workshop: typeof d.workshop === "string" ? d.workshop : "",
      cost: typeof d.cost === "number" && Number.isFinite(d.cost) ? d.cost : 0,
      tags: Array.isArray(d.tags) ? d.tags.slice() : [],
      notes: typeof d.notes === "string" ? d.notes : "",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null
    };
    return persist(replaceActiveCar(s, (c) => ({ ...c, entries: [...c.entries, entry] })));
  }

  function updateEntry(id, patch) {
    const s = ensureLoaded();
    const ts = now();
    return persist(
      replaceActiveCar(s, (c) => ({
        ...c,
        entries: c.entries.map((e) =>
          e.id === id
            ? { ...e, ...patch, id: e.id, createdAt: e.createdAt, updatedAt: ts }
            : e
        )
      }))
    );
  }

  function deleteEntry(id) {
    const s = ensureLoaded();
    const ts = now();
    return persist(
      replaceActiveCar(s, (c) => ({
        ...c,
        entries: c.entries.map((e) =>
          e.id === id ? { ...e, deletedAt: ts, updatedAt: ts } : e
        )
      }))
    );
  }

  // Used-car "before I started logging" anchor for a predicted job.
  // On invalid input we set lastError and return state unchanged (never persist bad data) —
  // matching how the rest of the store surfaces failures via the lastError channel.
  function setBaseline(tag, data) {
    const s = ensureLoaded();
    const job = JOBS[tag];
    if (!job || !job.predicted) {
      lastError = new Error(`setBaseline: "${tag}" is not a predicted job`);
      return s;
    }
    const d = data || {};
    const odometer = d.odometer;
    if (typeof odometer !== "number" || !Number.isFinite(odometer) || odometer < 0) {
      lastError = new Error("setBaseline: odometer must be a finite number ≥ 0");
      return s;
    }
    const date = typeof d.date === "string" && d.date ? d.date : null;
    const value = date ? { odometer, date } : { odometer };
    return persist(
      replaceActiveCar(s, (c) => ({
        ...c,
        baselines: { ...(c.baselines || {}), [tag]: value }
      }))
    );
  }

  function clearBaseline(tag) {
    const s = ensureLoaded();
    return persist(
      replaceActiveCar(s, (c) => {
        const next = { ...(c.baselines || {}) };
        delete next[tag];
        return { ...c, baselines: next };
      })
    );
  }

  return {
    load,
    addEntry,
    updateEntry,
    deleteEntry,
    setBaseline,
    clearBaseline,
    getState: () => ensureLoaded(),
    createId,
    get lastError() {
      return lastError;
    }
  };
}
