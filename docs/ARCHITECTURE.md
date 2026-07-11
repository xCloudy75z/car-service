# Architecture

Car Service History is a **framework-free, offline-first PWA**. The design goal is
that pure, testable logic is cleanly separated from DOM/UI and from persistence, so
the risky parts (predictions, migrations, backup validation) are unit-tested and the
UI is thin.

## Layers

```
schema  ── constants + registries (jobs, default intervals, versions, key rules)
  │
format / validate / migrate / calc / select   ← PURE (no DOM, no clock, no randomness)
  │                                              unit-tested; guarded by lint-pure.js
store  ── owns localStorage + all mutations (IDs via crypto, undo, backup/restore)
  │
ui/*   ── DOM builders + accessible dialog/toast (textContent-only, no innerHTML)
  │
app.js ── controller: tabs, sheets, Garage, intervals editor, backup, updates
```

**Purity rule** (enforced by `scripts/lint-pure.js`): `schema/format/validate/
migrate/calc/select` may not use `Date.now()`/`Math.random()`, and no source file
may use `innerHTML`/`insertAdjacentHTML`/`document.write`. Time and IDs are injected
(store passes `crypto.randomUUID()` seeds and an ISO clock), which keeps the logic
deterministic and testable.

## Data model (v3)

One `localStorage` key, `car-service:data`, holds a versioned object:

```jsonc
{
  "version": 3,
  "activeCarId": "uuid",
  "cars": [{
    "id": "uuid",
    "profile": { "name":"", "make":"", "model":"", "year":2019, "plate":"" },
    "entries": [{
      "id":"uuid", "date":"YYYY-MM-DD", "odometer":52000|null,
      "workshop":"", "cost":250, "tags":["oil","cj_ab12cd"], "notes":"",
      "createdAt":"ISO", "updatedAt":"ISO", "deletedAt":null   // soft delete
    }],
    "intervals": { "oil": { "km":10000 }, "brake_fluid": { "km":40000, "timeHintMonths":24 } },
    "customJobs": { "cj_ab12cd34": { "label":"Coolant flush", "icon":"❄️" } },
    "baselines": { "brake_fluid": { "odometer":35000, "date":"2024-05-01" } }
  }],
  "settings": { "theme":"light", "currencyLabel":"AED", "lastBackupAt":null }
}
```

Key ideas:
- **Car-nested.** Each car owns its entries, intervals, custom jobs, and baselines.
  A single `activeCarId` selects the current one; `getActiveCar` falls back to
  `cars[0]` if the pointer is stale.
- **"Predicted" is data-driven.** A job is predicted for a car **iff its key exists
  in that car's `intervals`**. The built-in `JOBS[t].predicted` flag is only a
  *seed hint* used when creating a new car. Turning a prediction on/off is
  adding/removing an interval; editing a distance merges (so `timeHintMonths`
  survives a km-only edit).
- **Job registry.** `allJobs(car)` merges the fixed `JOBS` with the car's
  `customJobs`; `jobMeta(car, key)` resolves a label/icon with a safe fallback
  (`{label:key, icon:"🔧"}`) so a deleted/unknown key never renders blank.
- **Custom-job keys** match `^cj_[a-z0-9]{4,}$` (a shared `CUSTOM_KEY_RE` in
  `schema.js`) — deliberately **not** a raw UUID, because the backup validator's
  allow-list must accept them.
- **Migrations** (`migrate.js`) run on load: a keyed table applied in a
  `while (version < CURRENT)` loop; each step bumps the version, is idempotent, and
  guards bad shapes. v2→v3 adds `customJobs:{}` per car and drops any stray
  `intervals` key with no backing job.

## Prediction engine (`calc.js`, pure)

- `currentKm(car)` = highest odometer among non-deleted, numeric-odometer entries
  (outlier-tolerant; excludes unknown-odometer entries).
- `lastDone(car, key)` = the non-deleted entry carrying that job with the **highest
  odometer** (tie-break: later date, then id); else the car's `baselines[key]`
  (an *anchor*); else `null`.
- `predict(car, key)` → `{status: ok|soon|over|none, remaining, nextDue, pct,
  anchor, timeHintMonths}`. `nextDue = lastDoneOdo + interval.km`;
  due-soon threshold = `min(0.1·interval.km, 1000)`.
- `stats(car, todayISO)` → total, this-year, count, avg/year (denominator floored at
  1 year; guarded so it never returns `NaN`/`Infinity`).
- `costByJob(car)` → cost per job (a multi-job visit's cost split across its tags).
- Rows are sorted over→soon→ok→none, tie-broken by a stable canonical order
  (built-ins in `JOBS` order, then customs by label).

## Persistence & mutations (`store.js`)

`createStore(storage?, now?)` returns a store whose CRUD methods each **validate,
persist (temp-key-then-swap), and return the new state**; failures set `store.lastError`
without corrupting stored data. IDs come from `crypto.randomUUID()`. Highlights:
- Entries: `addEntry/updateEntry/deleteEntry` (soft delete via `deletedAt`).
- Cars: `addCar/switchCar/updateCarProfile/deleteCar` (last-car guarded; deleting the
  active car reassigns it).
- Intervals: `setInterval` (merge), `removeInterval`, `resetIntervals`.
- Custom jobs: `addCustomJob → {state,key}`, `updateCustomJob`, `deleteCustomJob`
  (atomic: drops the job + its interval + strips the tag from every entry).
- Anchors: `setBaseline` (allowed for any key present in the car's `intervals`).
- **One-level undo:** `deleteCar`, `deleteCustomJob`, and restore all snapshot into a
  shared slot reverted by `undoLast()`.

## Backup / restore (the untrusted boundary)

Import is treated as hostile. `store.exportBackup()` produces an envelope
`{ app:"car-service", schemaVersion, exportedAt, data }`. On import:
1. `safeJsonParse` — a `JSON.parse` reviver drops `__proto__`/`constructor`/`prototype`.
2. `validateImportEnvelope` — reject foreign `app`, missing/newer `schemaVersion`.
3. **Allow-list rebuild** into fresh objects. Per car, `customJobs` is cleaned first
   (keys `^cj_[a-z0-9]{4,}$`, label ≤60, icon one grapheme, capped at 50), a
   `validKeys` set is built, and it's threaded through `cleanEntry → cleanTags`,
   `cleanIntervals`, and `cleanBaselines` so intervals/tags/baselines referencing a
   real job (built-in or this car's custom) survive and everything else is dropped.
4. Migrate the clone → validate → **snapshot current data** → commit → offer undo.

The live `localStorage` key is never touched until commit, so a bad file can't wipe
your history.

## PWA, build & deploy

- **Build** (`scripts/build.js`): copy `src/` → `app/`; hash **all** built assets →
  stamp the version into `sw.js` (cache name) and `build-info.js` (Settings shows it);
  copy generated icons. Because the hash covers every file, any change (incl. CSS)
  bumps the version, so the service worker actually updates.
- **Service worker** (`sw.js`): precache the shell (incl. fonts) + runtime-cache
  same-origin GETs (cache-first) so anything is available offline after first load;
  `activate` deletes old-version caches; `skipWaiting` + `controllerchange` reload
  applies updates in place. `register-sw.js` also requests persistent storage.
- **Security:** a strict CSP `<meta>` — `default-src 'none'; script-src 'self';
  connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  font-src 'self'; …`. All user text is rendered via `textContent`. No off-origin
  resources (fonts self-hosted).
- **Deploy:** `app/` is committed; GitHub Pages serves `main` at repo root, so the
  app is at `…/car-service/app/`. CI (`.github/workflows/ci.yml`) runs tests + lint +
  build on every push as a quality gate.

## Accessibility

Baked in, not bolted on: WCAG-AA contrast (tuned Cognac tokens), status shown as
icon **and** words (never colour alone), the tab bar is a real `tablist/tab/tabpanel`
with arrow-key navigation, dialogs trap focus and restore it on close, live regions
announce toasts (assertive for errors, which don't auto-dismiss), `role="switch"`
toggles, ≥44px targets, and `prefers-reduced-motion` support.

## Testing

`node --test` over `tests/**` — **145 tests** covering calc (predictions, stats,
cost-by-job, edge cases), validate (input + hostile-import allow-list, prototype
guard, roundtrip losslessness incl. custom jobs/baselines), migrate (v1→v3 chain,
idempotency, guards), store (CRUD, car ops, interval ops, custom-job ops, undo), and
select (registry + filter). UI is verified in a real browser per slice before deploy.
`lint-pure.js` guards purity + safe DOM.
