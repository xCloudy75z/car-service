# Garage (Multi-Vehicle + Editable Intervals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple vehicles, editable car profiles, and per-car editable service intervals incl. custom maintenance items to the shipped Car Service History PWA — with no data loss on upgrade or backup round-trip.

**Architecture:** Data model v3 adds `customJobs` per car and makes "predicted = a key exists in `car.intervals`" (built-in `JOBS.predicted` demoted to a seed hint). A per-car registry `allJobs(car)`/`jobMeta(car,key)` resolves labels/icons everywhere. Built in three deployable sub-slices (6a multi-vehicle, 6b editable intervals + prediction refactor, 6c custom items), each test-first, verified in a browser, and deployed before the next.

**Tech Stack:** Vanilla JS ES modules, localStorage, `node --test`, the existing `scripts/build.js` → `app/` + PWA. Full requirements + signatures + edge cases live in `docs/superpowers/specs/2026-07-11-garage-multi-vehicle-design.md` — this plan sequences them; consult the spec for exact behaviour.

---

## Shared conventions

- **TDD rhythm per task:** write failing test → `cmd /c "npm test"` (see it fail) → implement → `npm test` (green) → `cmd /c "node scripts/lint-pure.js"` → (orchestrator) build/deploy/verify. Do NOT run git (orchestrator commits).
- **Never break existing tests** (79 at start of 6a). Pure modules stay free of `Date.now()`/`Math.random()`/`innerHTML`.
- **Storage shim** for store/validate tests: the existing Map-backed shim + injectable clock (see `tests/store.test.js`).

## ⚠️ Plan-review corrections (apply these — from adversarial plan review)

These fix sequencing bugs that would otherwise leave the existing 79-test suite RED at a task's commit boundary. They OVERRIDE the task text below where they conflict.

- **C1 (was B1): Tasks 6a.1 + 6a.2 are ONE task.** Bump `CURRENT_VERSION=3`, add `CUSTOM_KEY_RE`/`newCustomKey`/`MAX_*`, add `MIGRATIONS[2]`, AND update `migrate.test.js` (chain + idempotency now target v3) — all in ONE green commit. Never bump the version without the migration (the migrate loop would strand v2 blobs and break `migrate.test.js` + `store.test.js`).
- **C2 (was B2): In 6b.1, the SAME task that removes the `DEFAULT_INTERVALS` fallback MUST update the `car()` test helper in BOTH `tests/calc.test.js` AND `tests/maintenance.test.js`** from `intervals: null` to `intervals: <deep copy of DEFAULT_INTERVALS>` (this preserves the exact `nextDue`/`remaining` numbers those tests assert). Otherwise ~8 predict assertions + the maintenance sort/caption/anchor tests go red at 6b.1.
- **C3 (was B3/m3): Guard undefined, not just empty.** `allJobs`/`jobMeta` use `(car && car.customJobs) || {}`; `predictedKeys` uses `(car && car.intervals) || {}`. `filterEntries(entries,{query,tag}, car?)` — `car` is OPTIONAL; with `car` omitted it still resolves built-in labels, so the existing 2-arg `tests/filter.test.js` calls stay green. Add the with-`car` custom-label case alongside.
- **C4 (was M1): 6b.4 also updates `tests/maintenance.test.js` helper, guards `predictedKeys`, and ADDS `maintenanceRows` unit tests** for empty intervals → `[]` and the stable tiebreak (built-ins in `JOBS` order, then customs by label).
- **C5 (was M2): Undo = ONE shared snapshot slot + a generic `undoLast()`.** The `undoToast` callback calls `undoLast()`. Each new mutation invalidates the prior undo (document this; do NOT imply independent per-feature undo stacks). Don't invent `undoDeleteCar`/`undoDeleteCustomJob` over one slot.
- **C6 (was M3): 6c.3 must thread `validKeys` through `cleanEntry`.** In `cleanCar`: clean `customJobs` FIRST → build `validKeys = new Set([...Object.keys(JOBS), ...cleanedCustomKeys])` → change `cleanEntry(e)` → `cleanEntry(e, validKeys)` → pass `validKeys` into `cleanTags`, `cleanIntervals`, and `cleanBaselines`. One shared `cj_` predicate.
- **C7 (was M4): Pin exact signatures** (append `car` as the trailing param so callers can't misalign): `timeline(entries, currency, handlers, car)`, `entryCard(entry, currency, handlers, car)`, `jobsRow(tags, car)`. Unchanged: `dueStrip(car)`, `maintenanceRows(car)`, `renderHome(car, currency, handlers)`. Update the home.js/app.js callers in the SAME sub-slice (6b).
- **C8 (was m1/m4): `tests/schema.smoke.test.js` is EXTENDED (it exists).** Test `newCustomKey(seed)` with a real UUID seed `'550e8400-e29b-41d4-a716-446655440000'` AND the store fallback seed — assert both match `CUSTOM_KEY_RE`. Note `addCustomJob` returns `{state, key}` (unlike other store methods that return `state`) — callers/tests destructure.
- **C9 (was m2): emoji "one grapheme"** via `Intl.Segmenter` in `store.js` (allowed — store is not a pure module), not `[...s][0]` (splits ZWJ/family emoji).

## File-scope map (grep target: `JOBS\[|\.predicted|Object.keys\(JOBS\)`)

`schema.js` (constants), `select.js` (allJobs/jobMeta/filterEntries+car), `calc.js` (predictedKeys/intervalFor/predict/sort), `store.js` (car+interval+customjob+baseline ops, defaultState, undo), `migrate.js` (v2→v3), `validate.js` (import cleaners threaded w/ customJobs), `ui/render.js`, `ui/maintenance.js`, `ui/home.js`, `ui/insights.js`, `app.js` (tick-list, anchor title, Garage/switcher/intervals UI), `styles/cognac.css`.

---

# Sub-slice 6a — Multi-vehicle + editable profile + v3 migration

### Task 6a.1 — schema constants + v3 bump
**Files:** Modify `src/schema.js`; Test `tests/schema.smoke.test.js`.
- [ ] Test: `CURRENT_VERSION === 3`; `CUSTOM_KEY_RE.test(newCustomKey())` is true and the key matches `^cj_[a-z0-9]{4,}$`; `MAX_CUSTOM_JOBS === 50`, `MAX_CUSTOM_LABEL === 60`.
- [ ] Implement: add `CURRENT_VERSION = 3`, `CUSTOM_KEY_RE = /^cj_[a-z0-9]{4,}$/`, `newCustomKey()` (e.g. `"cj_" + Math.abs(hash).toString(36)` — but no `Math.random`/`Date.now` in this pure module; the ID source is injected where used in store, so `newCustomKey` should accept a random-ish seed string arg and slugify to `[a-z0-9]`). Keep `JOBS`/`DEFAULT_INTERVALS`; add `MAX_*`.
- [ ] Green + lint + commit.

> Note: keep `newCustomKey(seed)` pure (slugifies `seed` to lowercase alnum, prefixes `cj_`, pads to ≥4). `store.js` passes `crypto.randomUUID()` (or its fallback) as the seed. Test both a UUID seed and the fallback seed produce keys matching `CUSTOM_KEY_RE`.

### Task 6a.2 — migrate v2→v3
**Files:** Modify `src/migrate.js`; Test `tests/migrate.test.js`.
- [ ] Tests: a v2 blob → v3 with each car gaining `customJobs:{}`; a car with an existing `customJobs` object is preserved; an `intervals` key not in `JOBS ∪ customJobs` is dropped; non-array `cars` does not throw (returns a safe shape); idempotent (`migrate(migrate(x))` deep-equals `migrate(x)`); v1→v3 chains.
- [ ] Implement `MIGRATIONS[2]` per spec §3; guard `Array.isArray`.
- [ ] Green + lint + commit.

### Task 6a.3 — defaultState + getActiveCar fallback
**Files:** Modify `src/store.js`, `src/select.js`; Test `tests/store.test.js`, `tests/select.test.js` (new).
- [ ] Tests: fresh `store.load()` yields version 3, one car WITH `customJobs:{}`; `getActiveCar` returns `cars[0]` when `activeCarId` is missing/stale.
- [ ] Implement: `defaultState()` adds `customJobs:{}` + version 3; `getActiveCar` fallback already exists (assert it).
- [ ] Green + lint + commit.

### Task 6a.4 — car CRUD in store
**Files:** Modify `src/store.js`; Test `tests/store.test.js`.
- [ ] Tests: `addCar(profile)` appends a car (fresh id, default intervals, empty entries/customJobs/baselines) and makes it active; `switchCar(id)` sets active (no-op + `lastError` for unknown id); `updateCarProfile(id,patch)` merges sanitised fields; `deleteCar` rejects when `cars.length===1` (`lastError`, no write); deleting the active car reassigns active to new `cars[0]`; after `deleteCar`, `undoDeleteCar()` (or the shared undo snapshot) restores it.
- [ ] Implement per spec §5. Reuse the existing snapshot/undo mechanism used by restore (one level).
- [ ] Green + lint + commit.

### Task 6a.5 — Header switch control + switcher sheet + Settings Garage
**Files:** Modify `src/ui/render.js` (carHeader — add a *sibling* switch pill, only when >1 car; do NOT nest in a button), `src/app.js` (openCarSwitcher, openCarForm add/edit, Garage section in openSettings, focus handling, rebuild-on-mutate), `src/styles/cognac.css`.
- [ ] No unit test (DOM/UI); orchestrator verifies in browser. Ensure `node --check` clean and existing tests still green.
- [ ] Implement per spec §6 (switcher dialog with disambiguated rows + `aria-current`; add-car form; Settings "Your Garage" list w/ Edit/Delete; delete confirm + backup escalation + Undo toast; **rebuild Settings body from fresh state on any garage mutation**; move focus to rebuilt header control after switch).
- [ ] Lint + commit.

**6a verify (orchestrator):** migrate an old backup; add/switch/edit/delete cars; last-car delete blocked; undo car delete; Settings never shows a stale car; focus after switch; no console errors. Deploy + check-in.

---

# Sub-slice 6b — Editable intervals + prediction refactor

### Task 6b.1 — calc: predictedKeys + intervalFor (no default fallback) + predict
**Files:** Modify `src/calc.js`; Test `tests/calc.test.js`.
- [ ] Tests: `predictedKeys(car)` = keys of `car.intervals`; `intervalFor(car,key)` returns the interval or null (NO `DEFAULT_INTERVALS` fallback); `predict(car,key)` for a key with an interval works; a car with empty `intervals` → `predictedKeys` `[]`.
- [ ] Implement; remove the `DEFAULT_INTERVALS[tag]` fallback branch.
- [ ] Green + lint + commit.

### Task 6b.2 — select: allJobs + jobMeta + filterEntries(car)
**Files:** Modify `src/select.js`; Test `tests/select.test.js`.
- [ ] Tests: `allJobs(car)` merges JOBS (`builtin:true`) + `car.customJobs` (`builtin:false`) and tolerates missing `customJobs`; `jobMeta(car,key)` returns `{label,icon}` for built-in, custom, and an unknown key (fallback `{label:key,icon:"🔧"}`); `filterEntries(entries,{query,tag},car)` matches a custom job's label via `jobMeta`.
- [ ] Implement; **update the existing `filterEntries` callers** (home.js) to pass `car` (done in 6b.5).
- [ ] Green + lint + commit.

### Task 6b.3 — store: setInterval(merge)/removeInterval/resetIntervals + setBaseline gate fix
**Files:** Modify `src/store.js`; Test `tests/store.test.js`.
- [ ] Tests: `setInterval('brake_fluid',45000)` **preserves `timeHintMonths:24`** (merge, not replace); rejects km ≤0/non-finite; rejects a key not in `allJobs(activeCar)`; `removeInterval` deletes the key and leaves entries untouched; `resetIntervals` = deep copy of `DEFAULT_INTERVALS`; **`setBaseline` now accepts a key that is in `activeCar.intervals`** (test: enable a `predicted:false` built-in via setInterval then setBaseline succeeds; a custom-job key with an interval also succeeds) and rejects a key with no interval.
- [ ] Implement per spec §5.
- [ ] Green + lint + commit.

### Task 6b.4 — refactor render/maintenance to predictedKeys + jobMeta + empty states + stable sort
**Files:** Modify `src/ui/render.js` (dueStrip, timeline/entryCard/jobsRow take `car`), `src/ui/maintenance.js` (predictedKeys + `jobMeta`, drop dup intervalFor); Test: none new (covered by calc/select) — orchestrator browser-verifies.
- [ ] Implement: `dueStrip(car)`/`maintenanceRows(car)` iterate `predictedKeys(car)`, resolve labels via `jobMeta(car,key)`; both render an explicit empty state when `predictedKeys` is empty; stable secondary sort (built-ins in JOBS order, then customs by label); thread `car` through history-card builders.
- [ ] `node --check` + lint + existing tests green + commit.

### Task 6b.5 — the Service intervals editor UI + home filter labels
**Files:** Modify `src/app.js` (Service intervals section in Settings: stacked grouped cards, toggle=`role=switch`, toggle-on-needs-km, reset confirm), `src/ui/home.js` (chips from `allJobs`, labels via `jobMeta`, pass `car` to `filterEntries`), `src/ui/insights.js` (labels via `jobMeta`), `src/styles/cognac.css`.
- [ ] Browser-verified; `node --check` + lint + existing tests green + commit.

**6b verify (orchestrator):** edit oil km → prediction shifts; toggle a built-in off → row disappears from Next-due/Maintenance; toggle on with empty km does NOT create a NaN row; km-edit on brake_fluid keeps the time caption; anchor a newly-enabled built-in; all-off → empty states; search/filter/insights show correct labels; no console errors. Deploy + check-in.

---

# Sub-slice 6c — Custom items

### Task 6c.1 — store: addCustomJob/updateCustomJob/deleteCustomJob (atomic + undo)
**Files:** Modify `src/store.js`; Test `tests/store.test.js`.
- [ ] Tests: `addCustomJob('Coolant flush','❄️',30000)` adds a `cj_*` job (key matches `CUSTOM_KEY_RE`) AND an interval; label sanitised (trim, ≤60, required→lastError if empty); icon → one grapheme or `🔧`; caps at `MAX_CUSTOM_JOBS`; `updateCustomJob` merges; `deleteCustomJob(key)` removes it from `customJobs` + `intervals` + **strips the tag from every entry in one write**; entries left tagless keep other fields; `undoDeleteCustomJob` restores.
- [ ] Implement per spec §5.
- [ ] Green + lint + commit.

### Task 6c.2 — registry through every render/tick-list/anchor site
**Files:** Modify `src/app.js` (Add/Edit tick-list from `allJobs(activeCar)` + `jobMeta`; anchor-sheet title via `jobMeta`), verify `render.js`/`home.js`/`insights.js`/`maintenance.js` already resolve via `jobMeta` from 6b.
- [ ] Browser-verified custom item is loggable + renders its label everywhere; `node --check` + lint + tests green + commit.

### Task 6c.3 — import validation for customJobs (validate.js)
**Files:** Modify `src/validate.js`; Test `tests/validate.test.js`.
- [ ] Tests: import a v3 backup with a custom job → its `customJobs`, matching `intervals`, entry `tags`, AND a custom-job **baseline** all survive (roundtrip lossless); a `cj_*` key not in that car's `customJobs` is dropped from intervals/tags/baselines; a cross-car custom tag is dropped; >`MAX_CUSTOM_JOBS` customJobs are capped; a `cj_` key with hyphens/uppercase is rejected; `__proto__` still stripped.
- [ ] Implement per spec §7: clean `customJobs` first → build per-car `validKeys` → thread into `cleanIntervals`/`cleanTags`/`cleanBaselines`; one shared `cj_` predicate.
- [ ] Green + lint + commit.

### Task 6c.4 — custom-item editor UI (add/edit/delete + emoji palette + collision warning)
**Files:** Modify `src/app.js` (Add custom item form: label + tap-to-pick emoji palette + optional km; edit/delete with confirm+undo; collision warning), `src/styles/cognac.css`.
- [ ] Browser-verified; `node --check` + lint + tests green + commit.

**6c verify (orchestrator):** add a custom item → appears in tick-list/filters/Next-due/Insights with its label+emoji; anchor it; export then import → custom item + its anchor survive; import a foreign/oversized/hyphen-key file → safely rejected/capped; delete custom item → confirm shows count, history untagged, Undo restores; no console errors. Deploy + final check-in.

---

## Self-Review

**Spec coverage:** §2 model change → 6b.1/6b.4; §3 v3 + key format → 6a.1/6a.2; §4 refactor scope (8 files) → 6b.4/6b.5/6c.2 + calc/select tasks; §5 store API incl. setBaseline gate + setInterval merge + undo → 6a.4/6b.3/6c.1; §6 UI (switcher/garage/intervals editor/empty states/emoji/collision) → 6a.5/6b.5/6c.4; §7 import validation → 6c.3; §8 edge cases distributed across tasks + verify steps; §10 tests enumerated in each task. No gaps.

**Placeholder scan:** none — every task names exact files, the concrete tests to add, and points to spec sections for exact signatures (which are fully specified there).

**Type/name consistency:** `predictedKeys(car)`, `intervalFor(car,key)`, `allJobs(car)`, `jobMeta(car,key)`, `filterEntries(entries,{query,tag},car)`, `newCustomKey(seed)`, `CUSTOM_KEY_RE`, store `addCar/switchCar/updateCarProfile/deleteCar/setInterval/removeInterval/resetIntervals/addCustomJob/updateCustomJob/deleteCustomJob/setBaseline` — used consistently across tasks and match the spec.

**Deferred deliberately (logged):** DOM-level tests for the new UI (logic is unit-tested; UI browser-verified per sub-slice, matching the v1 approach).
