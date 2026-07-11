# Garage — Multi-Vehicle + Editable Profile & Intervals — Design Spec (v2, hardened)

**Date:** 2026-07-11
**Status:** Hardened after 3-agent adversarial review; awaiting owner sign-off
**Owner:** Abdulla
**Author:** Claude (Opus 4.8)
**Builds on:** v1 (`2026-07-10-...`), data model v2.

> Adds **multiple vehicles**, an **editable car profile**, and **editable service
> intervals incl. custom items** to shipped v1. User decisions: switcher in **both**
> header + Settings; **full** intervals control (edit distances, toggle prediction
> on/off, add custom items).
> **v2 note:** this revision folds in the fixes from a 3-agent break-it review.
> Findings marked **[R]**.

---

## 1. Goal

Several independent cars (own services, intervals, custom items, anchors); edit each
car's details; fully control what's predicted per car. No data loss on upgrade or on
backup round-trip.

## 2. Core model change

Prediction becomes **per-car and data-driven**: *a job is predicted for a car iff a
distance exists for it in that car's `intervals`.* `JOBS[t].predicted` is demoted to
**only** the seed hint for a new car's default intervals. Everything that "lists
predicted jobs" reads `Object.keys(car.intervals)`; everything that needs a job's
label/icon reads a per-car registry `allJobs(car)` / `jobMeta(car, key)`.

## 3. Data model — v3

```jsonc
{
  "version": 3,
  "activeCarId": "uuid",
  "cars": [{
    "id": "uuid",
    "profile": { "name":"", "make":"", "model":"", "year":2019, "plate":"" },
    "entries": [ /* unchanged */ ],
    "intervals": { "oil": { "km":10000 }, "brake_fluid": { "km":40000, "timeHintMonths":24 } },
    "customJobs": { "cj_ab12cd34": { "label":"Coolant flush", "icon":"❄️" } },  // NEW
    "baselines": { /* unchanged */ }
  }],
  "settings": { "theme":"light", "currencyLabel":"AED", "lastBackupAt":null }
}
```

- **Custom-job key = `"cj_" + <lowercase base36 id>`** — **must match `^cj_[a-z0-9]{4,}$`**.
  The key generator and the import regex share ONE constant `CUSTOM_KEY_RE` in `schema.js`.
  Do **not** use `crypto.randomUUID()` verbatim (hyphens fail the regex). A unit test
  asserts a freshly-generated key passes `CUSTOM_KEY_RE`. **[R — was total data-loss on restore]**
- `customJobs[key]`: `label` (string, 1–60 chars), `icon` (a single emoji grapheme, default `🔧`).
- **Migration v2→v3:** guard `Array.isArray(d.cars)`; for each car set `customJobs` =
  existing object if present else `{}`; **drop any `intervals` key not in `JOBS ∪ customJobs`**
  (kills legacy ghost keys); bump `version`. Idempotent; chains v1→v2→v3. `CURRENT_VERSION = 3`. **[R]**
- **`defaultState()` (fresh install) MUST include `customJobs:{}`** and version 3; all
  registry helpers use `car.customJobs || {}` defensively. **[R — fresh-install crash]**

## 4. Refactor scope — ALL `JOBS`-touching sites (grep `JOBS\[|\.predicted|Object.keys(JOBS)`) [R]

The original list was incomplete. Every site below changes; several need a `car`
threaded through a signature that is car-less today:

| File | Change |
|---|---|
| `schema.js` | Add `CUSTOM_KEY_RE`, `newCustomKey()`, `MAX_CUSTOM_LABEL=60`, `MAX_CUSTOM_JOBS=50`. `predicted` flag retained as seed hint only. |
| `select.js` | `allJobs(car)`, `jobMeta(car,key)` (safe fallback `{label:key,icon:"🔧"}`), `getActiveCar` keeps `cars[0]` fallback. **`filterEntries(entries,{query,tag},car)`** — new `car` param so custom labels are searchable. |
| `calc.js` | `predictedKeys(car)`=`Object.keys(car.intervals)`; single `intervalFor(car,key)` = `car.intervals[key] || null` (**remove `DEFAULT_INTERVALS` fallback**); `predict(car,key)` only called for keys in intervals; stable ordering (see §6). |
| `store.js` | Car CRUD, interval ops, custom-job ops, and **`setBaseline` gate fix** (§5). |
| `validate.js` | Import cleaners threaded with per-car `customJobs` (§7). |
| `ui/render.js` | `dueStrip` uses `jobMeta(car,…)`; `timeline`/`entryCard`/`jobsRow` take `car` (or a bound resolver) so history cards show custom labels. Empty-state for zero predicted (§6). |
| `ui/maintenance.js` | iterate `predictedKeys(car)`; **`const {label,icon}=jobMeta(car,tag)`** (was `JOBS[tag].label` → crash); drop the duplicated `intervalFor`; empty-state for zero predicted. |
| `ui/home.js` | filter chips from `Object.keys(allJobs(car))`; labels via `jobMeta`. |
| `ui/insights.js` | labels/icons via `jobMeta(car,tag)`. |
| `app.js` | Add-service tick-list from `allJobs(activeCar)` + `jobMeta`; anchor-sheet title via `jobMeta`; the new Garage/intervals/switcher UI. |

## 5. Store API (all persist atomically + return new state; validate; guard)

**Cars** — `addCar(profile)` (fresh id, sanitised profile, `entries:[]`, `intervals`=deep
copy of `DEFAULT_INTERVALS`, `customJobs:{}`, `baselines:{}`; append; set active) ·
`switchCar(id)` · `updateCarProfile(id,patch)` · **`deleteCar(id)`** (reject if
`cars.length===1`; on delete of active, active→new `cars[0]`; **keep an in-memory
snapshot for one-level undo, like `undoRestore`**). **[R — irreversible loss]**

**Intervals (active car)** — `setInterval(key,km,timeHintMonths?)` (`key` must be in
`allJobs(activeCar)`; `km` finite `>0`; **MERGE onto the existing interval so
`timeHintMonths` is preserved** on a km-only edit) · `removeInterval(key)` (entries
untouched) · `resetIntervals()` (→ deep copy of `DEFAULT_INTERVALS`; UI confirms first). **[R]**

**Custom jobs (active car)** — `addCustomJob(label,icon,km?)` (sanitise label 1–60 &
icon→one grapheme/default; key `newCustomKey()`; cap `MAX_CUSTOM_JOBS`; if `km` valid
also `setInterval`) → `{state,key}` · `updateCustomJob(key,{label?,icon?})` ·
**`deleteCustomJob(key)`** (remove from `customJobs` **and** `intervals` **and** strip
`key` from every entry's `tags` — in **one atomic write**; keep undo snapshot). **[R]**

**Baselines** — **`setBaseline(key,{odometer,date})` gate changes** from
`JOBS[key].predicted` to `predictedKeys(activeCar).includes(key)`, so anchors work for
custom jobs and newly-enabled built-ins. **[R — anchors were silently dead]**

## 6. UI surfaces [R]

- **Car header switch control** — do **NOT** make the header a `<button>` (it contains
  the gear → nested-button). Add a **separate** pill button around just the car
  name+chevron (`aria-label="Switch car — current: <name>"`), a **sibling** of the gear.
  Show it **only when `cars.length > 1`** (single-car users add via Settings). **[R]**
- **Car switcher sheet** — accessible dialog; each car a `<button>` with make/model/plate
  to disambiguate unnamed cars; the active row carries `aria-current="true"` + a tick;
  **＋ Add car**. On pick: `switchCar` → re-render → **move focus to the rebuilt header
  switch control** (don't rely on the detached-node focus return) → close. **[R]**
- **Settings → Your Garage** — car list (switch/Edit/Delete). **Delete** confirm shows
  the service count; if `lastBackupAt` is null and the car has entries, escalate
  ("can't be undone and you've never backed up — back up first?"); then Delete →
  **"Car deleted — Undo" toast**. Delete control hidden when one car. Any garage
  mutation **rebuilds the Settings sheet body from fresh state** (no stale writes). **[R]**
- **Settings → Service intervals** (active car) — **stacked cards, grouped "Built-in" /
  "Custom"**, each: icon + label on top; km field + unit + a real **`role="switch"`
  `aria-checked` toggle** on a second line with ≥44px spacing. Turning a toggle **ON**
  reveals/focuses the km field and **does not persist "predicted" until a valid km is
  entered** (no NaN/desync); for a built-in with a default, prefill it. **Reset to
  defaults** confirms ("resets distances; keeps your custom items but stops predicting
  them"). **Add custom item**: label + a **tap-to-pick emoji palette** (🔧🛢🧰❄️🔋🛞⚙️🚗…,
  🔧 preselected) + optional km; **warn on a label that collides** with an existing job.
  Delete-custom offered here (confirm: "removes it from N past services; those records
  stay but lose this job" + Undo). **[R]**
- **Add/Edit service tick-list, filters, maintenance rows, insights, history cards** — all
  resolve via `allJobs(activeCar)` / `jobMeta`, so custom items appear and render
  everywhere and deleted keys degrade to a safe fallback. **[R]**
- **Empty states** — if `predictedKeys(car)` is empty (all toggled off / new custom-less
  car with intervals cleared), both the Next-due strip and the Maintenance tab show
  "No predicted items yet — add intervals in Settings." **[R]**
- **Ordering** — Next-due/Maintenance sort by status (over→soon→ok→none), tie-broken by a
  **stable canonical order**: built-ins in `JOBS` order, then customs by label. **[R]**

## 7. Backup / restore validation (Slice-4 `validate.js` changes) [R]

- **Clean `customJobs` FIRST**, per car: keys match `CUSTOM_KEY_RE`, `label` 1–60,
  `icon` one grapheme; cap count at `MAX_CUSTOM_JOBS`.
- Build `validKeys = new Set([...Object.keys(JOBS), ...cleanedCustomJobKeys])` for **that
  car**, and thread it into `cleanIntervals`, `cleanTags`, **and `cleanBaselines`** (the
  last was omitted before). Each drops keys/tags/intervals/baselines not in `validKeys`.
  One shared `cj_` predicate everywhere so they can't diverge.
- Reject an `intervals`/`tag`/`baseline` `cj_*` key with no matching entry in this car's
  cleaned `customJobs` (no cross-car or ghost references).
- Cap entries and customJobs per car (DoS on hostile files). `safeJsonParse` proto-guard
  already covers `__proto__`. v2 backups still import (migrate clone adds `customJobs:{}`);
  v3 backups into an older app still rejected as newer.

## 8. Edge cases [R]

Stale `activeCarId` → `cars[0]`. Delete last car blocked + control hidden. Custom job
w/o interval = log-only. Toggle-on requires a valid km before it predicts. Reset warns
+ keeps custom items (unpredicted). Zero predicted → explicit empty state. Duplicate
custom label → collision warning; keys unique regardless. Delete custom job → history
tags stripped (confirm + undo; note it drops that job from Insights cost attribution).
Delete car / custom job → one-level undo snapshots. Emoji cap by grapheme, not code unit.
Migration guards non-array `cars`. `setInterval`/`addCustomJob` reject unknown/oversized
input. All garage mutations inside an open Settings sheet rebuild its body.

## 9. Build plan (three verifiable sub-slices; each tested + deployed + browser-verified)

- **6a — Multi-vehicle + editable profile + v3 migration.** `defaultState` gains
  `customJobs:{}`; `CURRENT_VERSION=3`; migration (§3). Store car CRUD (add/switch/
  update-profile/delete w/ guard + **undo**). Header switch control (only when >1 car) +
  switcher sheet (focus handling); Settings Garage list + profile form (rebuild-on-mutate).
  Predictions unchanged behaviour, now per active car. Tests: migrate v2→v3 (+guards,
  idempotent, chain); car CRUD (last-car guard, active reassign, undo).
- **6b — Editable intervals + prediction refactor.** The `predicted=intervals-presence`
  refactor across all §4 files (incl. `predictedKeys`, `jobMeta` threading, empty states,
  stable sort, single `intervalFor`, `setBaseline` gate fix). `setInterval`(merge)/
  `removeInterval`/`resetIntervals`; the stacked intervals editor (toggle-needs-km, reset
  confirm). Tests: predictedKeys; predict after edit/toggle/off; km-edit preserves caption;
  anchor on a newly-enabled built-in; zero-predicted empty state.
- **6c — Custom items.** `customJobs` end-to-end: registry through every render/filter/
  search/insights/tick-list site; add/update/deleteCustomJob (+ atomic tag-strip + undo);
  emoji palette; collision warning; **import-validation update (§7)**. Tests: custom-job
  CRUD; tag-strip on delete; anchor on a custom job; import accepts customJobs + cj_ tags
  + cj_ baselines; count cap; roundtrip lossless incl. a custom-job baseline; fresh key
  passes `CUSTOM_KEY_RE`.

## 10. Testing summary (expanded per review) [R]

migrate v2→v3 (+ non-array guard, idempotent, v1→v3 chain, drops stray interval keys) ·
car CRUD (+ last-car guard, active reassign, undo) · setInterval merge (caption survives)
/removeInterval/resetIntervals · addCustomJob/updateCustomJob/deleteCustomJob (atomic tag
strip) · setBaseline for custom + enabled-`predicted:false` built-in · allJobs/jobMeta
(merge + fallback) · predictedKeys + predict (no DEFAULT fallback) · filterEntries with car
(searchable custom label) · import: accepts customJobs/cj_ tags/cj_ baselines, drops
unknown + cross-car refs, count cap, roundtrip lossless incl. custom baseline · fresh
`cj_` key matches `CUSTOM_KEY_RE`.

## 11. Out of scope (future)

Per-item time-rule editing; reordering cars; car photos; cross-device car sharing; moving
services between cars.
