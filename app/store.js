// Persistence + CRUD. Owns IDs (crypto.randomUUID), soft delete, createdAt/updatedAt,
// temp-key-then-swap writes, and quota handling. Storage backend is injectable for
// testing; defaults to window.localStorage in the browser.

import { CURRENT_VERSION, DEFAULT_INTERVALS, JOBS } from "./schema.js";
import { migrate } from "./migrate.js";
import { getActiveCar } from "./select.js";
import { validateImportEnvelope } from "./validate.js";

const deepClone = (x) => JSON.parse(JSON.stringify(x));

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
  let snapshot = null; // one-level pre-restore backup for undoRestore()

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

  // ---- Backup & restore (transactional) ------------------------------------

  // Record the current time as the last backup, then hand back a portable
  // envelope. The live state is updated so "Last backed up" reflects this.
  function exportBackup() {
    const s = ensureLoaded();
    const at = now();
    const next = { ...s, settings: { ...(s.settings || {}), lastBackupAt: at } };
    persist(next);
    return { app: "car-service", schemaVersion: CURRENT_VERSION, exportedAt: at, data: next };
  }

  function setLastBackupAt(iso) {
    const s = ensureLoaded();
    const at = typeof iso === "string" && iso ? iso : now();
    return persist({ ...s, settings: { ...(s.settings || {}), lastBackupAt: at } });
  }

  // A well-formed state has ≥1 car, string car ids, entry arrays, and an
  // activeCarId that points at a real car. Guards against a broken restore.
  function isWellFormed(st) {
    if (!st || typeof st !== "object" || !Array.isArray(st.cars) || st.cars.length === 0) return false;
    for (const c of st.cars) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) return false;
      if (!Array.isArray(c.entries)) return false;
    }
    if (typeof st.activeCarId !== "string" || !st.activeCarId) return false;
    return st.cars.some((c) => c.id === st.activeCarId);
  }

  // Validate + migrate a CLONE (never touches stored data). Returns the migrated
  // clean state or an error — used by both preview and commit.
  function prepareImport(parsedObj) {
    const res = validateImportEnvelope(parsedObj, CURRENT_VERSION);
    if (!res.ok) return { ok: false, error: res.error };
    let migrated;
    try {
      migrated = migrate(deepClone(res.data));
    } catch (_) {
      return { ok: false, error: "This backup couldn't be read." };
    }
    if (!migrated || !Array.isArray(migrated.cars) || migrated.cars.length === 0) {
      return { ok: false, error: "This backup has no cars to restore." };
    }
    return { ok: true, data: migrated };
  }

  // Dry run: validate + count without any writes, so the UI can confirm.
  function previewImport(parsedObj) {
    const prep = prepareImport(parsedObj);
    if (!prep.ok) return { ok: false, error: prep.error };
    let entryCount = 0;
    for (const c of prep.data.cars) {
      for (const e of c.entries || []) if (!e.deletedAt) entryCount++;
    }
    return { ok: true, carCount: prep.data.cars.length, entryCount };
  }

  // Transactional restore: validate → migrate clone → regenerate every id →
  // well-formed check → snapshot current → write. On ANY failure, stored data
  // is left untouched.
  function commitImport(parsedObj) {
    const prep = prepareImport(parsedObj);
    if (!prep.ok) return { ok: false, error: prep.error };

    const ts = now();
    const idMap = new Map();
    const cars = prep.data.cars.map((c) => {
      const newId = createId();
      idMap.set(c.id, newId);
      return {
        ...c,
        id: newId,
        entries: (Array.isArray(c.entries) ? c.entries : []).map((e) => ({
          ...e,
          id: createId(),
          updatedAt: ts
        }))
      };
    });
    const next = {
      ...prep.data,
      cars,
      activeCarId: idMap.get(prep.data.activeCarId) || cars[0].id
    };

    if (!isWellFormed(next)) {
      return { ok: false, error: "Restore failed a safety check — your data is unchanged." };
    }

    const prev = ensureLoaded();
    persist(next);
    if (lastError) {
      // Write failed (e.g. quota). Roll the in-memory state back so live data is intact.
      state = prev;
      snapshot = null;
      return { ok: false, error: "Couldn't save the restored data — your original data is unchanged." };
    }
    snapshot = prev; // enable one-level undo
    return { ok: true, state: next };
  }

  // Bring back the pre-restore snapshot, one level. No-op if none.
  function undoRestore() {
    if (!snapshot) return ensureLoaded();
    const restored = snapshot;
    snapshot = null;
    return persist(restored);
  }

  return {
    load,
    addEntry,
    updateEntry,
    deleteEntry,
    setBaseline,
    clearBaseline,
    exportBackup,
    setLastBackupAt,
    previewImport,
    commitImport,
    undoRestore,
    getState: () => ensureLoaded(),
    createId,
    get lastError() {
      return lastError;
    }
  };
}
