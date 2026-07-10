# Car Service History — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the offline-first, installable Car Service History PWA (Cognac look) — log a car's services, predict what's due, back up/restore — built vanilla-JS with the rem-money recipe and deployed to GitHub Pages.

**Architecture:** Small, single-purpose vanilla ES modules under `src/`. Pure logic (schema/format/validate/migrate/calc/select) is unit-tested with `node --test`. `store.js` owns persistence (localStorage) + IDs. A tiny Node `build.js` assembles `app/` (the deployable app at `…/car-service/app/`): inlines CSS, concatenates JS into one same-origin `app.js` (so CSP can be `script-src 'self'`), and emits `sw.js` + `manifest.webmanifest` + icons. Reference data model, security and PWA rules: `docs/superpowers/specs/2026-07-10-car-service-history-design.md`.

**Tech Stack:** HTML/CSS/vanilla JS (no framework), localStorage, service worker + manifest (PWA), Node for the build + `node --test` for tests. Git via the bundled GitHub Desktop git.exe. Deploy: GitHub Pages (main branch, `/app/` served statically; build output committed).

---

## Build cadence (mandatory)

Build in **slices**. Each slice ends with a **deployed, verified-running** artifact and a check-in with the owner before the next.

- **Slice 1 — Deployable core:** data + storage + calc + a rendered Home (car header, current km, Next-due strip, timeline) + Add/Edit/Delete + PWA shell → **built, deployed to `/app/`, installs, works offline, verified.** Then STOP and check in.
- **Slice 2 — Predictions & Maintenance tab:** full prediction rows, anchors, time captions, statuses.
- **Slice 3 — Search, filters, Insights (stats).**
- **Slice 4 — Backup/restore (transactional) + storage.persist + nudges.**
- **Slice 5 — Hardening pass:** CSP, a11y audit (focus trap, live regions, reduced-motion, contrast), SW update flow, deploy workflow, final verify on a real phone.

Slices 2–5 get their own detailed task lists when we reach them; this document details **Slice 1** fully and outlines the rest.

---

## File Structure

```
src/
  schema.js      # JOBS registry, DEFAULT_INTERVALS, CURRENT_VERSION, status thresholds
  format.js      # fmtKm, fmtMoney, fmtDate, escapeHtml (pure)
  validate.js    # validateEntry, validateImportEnvelope, coerceNumber, isYMD (pure)
  migrate.js     # migrate(data), MIGRATIONS table (pure)
  calc.js        # currentKm, lastDone, predict, stats — pure, takes todayISO
  select.js      # getActiveCar, activeEntries (accessors)
  store.js       # load/save, CRUD, createId, export/import, quota-safe writes
  ui/render.js   # pure-ish HTML builders (textContent-only via helpers)
  ui/home.js     # Home view wiring
  ui/sheet.js    # accessible slide-in dialog (focus trap, Esc, aria)
  ui/toast.js    # toast + undo
  app.js         # bootstrap/wiring
  styles/cognac.css
  sw.js          # service worker (versioned cache)
  index.html     # app shell (dev: links src modules; build inlines/concats)
scripts/
  build.js       # assemble app/ (concat JS, inline CSS, stamp SW version, copy icons+manifest)
  dev.js         # optional watch+serve
tests/
  calc.test.js  validate.test.js  migrate.test.js  store.test.js
icons/           # 192/512/maskable/apple-touch (generated)
app/             # BUILD OUTPUT (committed) — served at /car-service/app/
.github/workflows/deploy.yml   # (Slice 5) test → build → commit app/
```

Module boundaries (interfaces the tasks must honor):

- `schema.js` exports `JOBS` (`{tag:{label,icon,predicted}}`), `DEFAULT_INTERVALS` (`{oil:{km},…, brake_fluid:{km,timeHintMonths}}`), `CURRENT_VERSION = 2`, `dueSoonKm(intervalKm)` = `Math.min(intervalKm*0.1, 1000)`.
- `calc.js` is **pure** and takes data + `todayISO` — never calls `Date.now()`.
  - `currentKm(car)` → max odometer among non-deleted entries with a numeric odometer, else 0.
  - `lastDone(car, tag)` → the non-deleted entry carrying `tag` with the **highest odometer** (tie-break: later `date`, then `id`); if none, the car's `baselines[tag]` (`{odometer}`) marked `anchor:true`; else `null`.
  - `predict(car, tag)` → `{status:'ok'|'soon'|'over'|'none', remaining, nextDue, pct, anchor, timeHintMonths}`.
  - `stats(car, todayISO)` → `{total, thisYear, count, avgPerYear|null}` with `avgPerYear` null until ≥1 entry and a ≥1-day span; denominator `max(1, spanDays/365.25)`; guards empty → zeros/null, never NaN/Infinity.
- `store.js` owns IDs (`crypto.randomUUID()`), soft delete (`deletedAt`), `createdAt/updatedAt`, temp-key-then-swap writes, quota handling. Public API is storage-agnostic and returns the new state.

---

## Slice 1 — Deployable Core

### Task 1: Project scaffold + test runner

**Files:**
- Create: `package.json`, `.gitignore`, `src/schema.js`, `tests/schema.smoke.test.js`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "car-service-history",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test tests/",
    "build": "node scripts/build.js",
    "lint:pure": "node scripts/lint-pure.js"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 3: Write `src/schema.js`** (the single registry)

```js
export const CURRENT_VERSION = 2;
export const JOBS = {
  oil:{label:"Engine oil",icon:"🛢️",predicted:true},
  air_filter:{label:"Air filter",icon:"💨",predicted:true},
  cabin_filter:{label:"Cabin filter",icon:"❄️",predicted:true},
  brake_fluid:{label:"Brake fluid",icon:"🛑",predicted:true},
  spark_plugs:{label:"Spark plugs",icon:"⚡",predicted:true},
  brakes:{label:"Brakes",icon:"🅿️",predicted:false},
  tires:{label:"Tyres",icon:"🛞",predicted:false},
  battery:{label:"Battery",icon:"🔋",predicted:false},
  transmission:{label:"Transmission",icon:"⚙️",predicted:false},
  suspension:{label:"Suspension",icon:"🔩",predicted:false},
  engine:{label:"Engine",icon:"🚗",predicted:false}
};
export const DEFAULT_INTERVALS = {
  oil:{km:10000}, air_filter:{km:20000},
  cabin_filter:{km:20000,timeHintMonths:12},
  brake_fluid:{km:40000,timeHintMonths:24},
  spark_plugs:{km:100000}
};
export const dueSoonKm = (intervalKm) => Math.min(intervalKm*0.1, 1000);
```

- [ ] **Step 4: Write `tests/schema.smoke.test.js`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS, DEFAULT_INTERVALS, dueSoonKm } from "../src/schema.js";
test("schema exposes predicted jobs with intervals", () => {
  for (const k of Object.keys(DEFAULT_INTERVALS)) assert.equal(JOBS[k].predicted, true);
});
test("dueSoon caps at 1000km", () => { assert.equal(dueSoonKm(100000), 1000); assert.equal(dueSoonKm(10000), 1000); assert.equal(dueSoonKm(5000), 500); });
```

- [ ] **Step 5: Run tests** — `cmd /c "npm test"` → Expected: PASS (2 tests).
- [ ] **Step 6: Commit** — `feat: scaffold + schema registry`.

### Task 2: `calc.js` prediction engine (TDD — the risky core)

**Files:** Create `src/calc.js`, `src/select.js`; Test `tests/calc.test.js`

- [ ] **Step 1: Write failing tests** covering the review's blockers:

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { currentKm, lastDone, predict, stats } from "../src/calc.js";
const car = (entries, baselines={}) => ({ entries, baselines, intervals:null });
const E = (id,date,odometer,tags) => ({id,date,odometer,tags,deletedAt:null});

test("currentKm = max odometer, ignores deleted + null odo", () => {
  const c = car([E(1,"2026-01-01",50000,["oil"]),{...E(2,"2026-02-01",60000,["oil"]),deletedAt:"x"},E(3,"2026-03-01",null,["tires"])]);
  assert.equal(currentKm(c), 50000);
});
test("lastDone picks highest odometer, not insert order (out-of-order backfill)", () => {
  const c = car([E(1,"2026-01-01",50000,["oil"]),E(2,"2025-06-01",40000,["oil"])]);
  assert.equal(lastDone(c,"oil").odometer, 50000);
});
test("lastDone tie-break by later date then id", () => {
  const c = car([E("a","2026-01-01",50000,["oil"]),E("b","2026-02-01",50000,["oil"])]);
  assert.equal(lastDone(c,"oil").id, "b");
});
test("lastDone falls back to baseline anchor", () => {
  const c = car([], { brake_fluid:{odometer:35000} });
  const ld = lastDone(c,"brake_fluid"); assert.equal(ld.odometer,35000); assert.equal(ld.anchor,true);
});
test("predict statuses: ok / soon / over / none", () => {
  assert.equal(predict(car([E(1,"2026-01-01",58000,["oil"])]),"oil").status, "ok");   // 68000 due, 10000 left
  assert.equal(predict(car([E(1,"2026-01-01",57700,["oil"])]),"oil").status, "soon");  // 67700 due, 300 left <=1000
  assert.equal(predict(car([E(1,"2026-01-01",47000,["oil"])]),"oil").status, "over");  // 57000 due < 47000? see below
  assert.equal(predict(car([]),"oil").status, "none");
});
test("stats never returns NaN/Infinity on tiny data", () => {
  const s = stats(car([E(1,"2026-07-01",1000,["oil"])]) , "2026-07-10");
  assert.equal(Number.isFinite(s.total), true);
  assert.equal(s.avgPerYear, null); // <1yr span → null, not Infinity
});
test("stats empty → zeros and null avg", () => {
  const s = stats(car([]), "2026-07-10");
  assert.deepEqual([s.total,s.count,s.avgPerYear], [0,0,null]);
});
```

> Note: fix the `over` case data when implementing — use an entry whose `odo + interval < currentKm`. Add a dedicated overdue fixture (e.g. `[E(1,'…',40000,['oil']), E(2,'…',57000,['tires'])]` → oil next 50000 < 57000 = overdue).

- [ ] **Step 2: Run** `cmd /c "npm test"` → Expected: FAIL (calc not implemented).
- [ ] **Step 3: Implement `src/select.js`**

```js
export const activeEntries = (car) => car.entries.filter(e => !e.deletedAt);
```

- [ ] **Step 4: Implement `src/calc.js`** per interfaces in File Structure (currentKm, lastDone with tie-break + baseline, predict using `dueSoonKm`, stats with `max(1, spanDays/365.25)` and null-until-enough-data guard).
- [ ] **Step 5: Run** `cmd /c "npm test"` → Expected: PASS.
- [ ] **Step 6: Commit** — `feat: pure prediction + stats engine with review-driven tests`.

### Task 3: `format.js` + `validate.js`

**Files:** Create `src/format.js`, `src/validate.js`; Test `tests/validate.test.js`

- [ ] **Step 1: Write failing tests** — `escapeHtml` escapes `<>&"'`; `validateEntry` rejects empty date, non-finite odometer, negative cost; accepts null odometer (unknown); normalizes tags (trim/lowercase); `coerceNumber("1,250")===1250`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `format.js` (fmtKm, fmtMoney, fmtDate, escapeHtml) and `validate.js` (validateEntry → `{ok,value,errors}`; coerceNumber strips separators; isYMD).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat: formatting + input validation`.

### Task 4: `store.js` (localStorage, IDs, soft delete)

**Files:** Create `src/store.js`, `src/migrate.js`; Test `tests/store.test.js`, `tests/migrate.test.js` (use a localStorage shim in tests).

- [ ] **Step 1: Write failing tests** — fresh load returns a seeded single-car state at `CURRENT_VERSION`; `addEntry` assigns a unique id + `createdAt/updatedAt`; `deleteEntry` sets `deletedAt` (soft); `updateEntry` bumps `updatedAt`; two rapid `addEntry` calls get distinct ids; `migrate` upgrades a `version:1` blob (flat `entries`) into `version:2` (car-nested) and is idempotent when run twice.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `migrate.js` (MIGRATIONS `{1:(d)=>…}`, loop `while(d.version<CURRENT) d=MIGRATIONS[d.version](d)`, each bumps version) and `store.js` (namespaced key `car-service:data`, temp-key-then-swap write, `createId=crypto.randomUUID`, CRUD returning new state, `defaultState()` seeding one empty car + `DEFAULT_INTERVALS`). Wrap writes in try/catch; expose a `lastError` channel.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat: versioned localStorage store + migrations`.

### Task 5: Cognac design system + app shell

**Files:** Create `src/styles/cognac.css`, `src/index.html`

- [ ] **Step 1: Port the Cognac tokens** from `preview/mockup.html` into `src/styles/cognac.css` (the `:root` Cognac palette, Bricolage/Inter/JetBrains fonts self-hosted or system-fallback, phone-free full-screen layout, plus tokens for cards/chips/status/sheet/toast/tabbar/fab). **Accessibility from the start:** status classes carry icon+text, `:focus-visible` rings, `prefers-reduced-motion` media query, tap targets ≥44px, contrast-checked values.
- [ ] **Step 2: Write `src/index.html`** — app shell: header (car + current km + gear), `#app` mount, tab bar (History/Maintenance/Insights), FAB, `#sheet`, `#toast`. Dev-time `<script type="module" src="app.js">`. Add the CSP `<meta>` and Apple PWA meta tags + `apple-touch-icon` and `<link rel="manifest" href="manifest.webmanifest">` (relative).
- [ ] **Step 3: Commit** — `feat: cognac design system + app shell`.

### Task 6: Render Home + Add/Edit/Delete (wire to store)

**Files:** Create `src/ui/render.js`, `src/ui/home.js`, `src/ui/sheet.js`, `src/ui/toast.js`, `src/app.js`

- [ ] **Step 1: Implement `ui/render.js`** — builders that produce DOM via `document.createElement` + `textContent` (never `innerHTML` with user data): `carHeader(car)`, `dueStrip(car)`, `timeline(entries)`, `entryCard(entry)`.
- [ ] **Step 2: Implement `ui/sheet.js`** — accessible dialog: `role="dialog"`, `aria-modal`, focus trap, Esc close, focus return, background `inert`.
- [ ] **Step 3: Implement `ui/toast.js`** — polite success / assertive error live region; delete uses a 6s **Undo** toast.
- [ ] **Step 4: Implement `ui/home.js` + `app.js`** — mount Home, wire FAB → add sheet (date, odometer[optional], workshop, cost, multi-tag tick, notes; bidirectional + date-aware odometer warning), Save → `store.addEntry` → re-render + toast; edit/delete with undo. Re-render recomputes `calc` from state each time.
- [ ] **Step 5: Manual verify (dev)** — open `src/index.html` via a static server; add a service, confirm it persists across refresh, confirm Next-due recomputes. (Automated DOM tests deferred; logic is covered by calc/store tests.)
- [ ] **Step 6: Commit** — `feat: home view + add/edit/delete wired to store`.

### Task 7: PWA shell + build + DEPLOY + verify running

**Files:** Create `src/sw.js`, `src/manifest.webmanifest`, `icons/*`, `scripts/build.js`, `scripts/lint-pure.js`

- [ ] **Step 1: `manifest.webmanifest`** — `name`, `short_name`, `start_url:"./"`, `scope:"./"`, `display:"standalone"`, Cognac `theme_color`/`background_color`, relative icon `src`s (192/512/maskable).
- [ ] **Step 2: `sw.js`** — cache-first app shell; cache name embeds `__VERSION__` (stamped by build); `install` precaches the shell (relative URLs); `activate` deletes non-current caches + `clients.claim()`; `skipWaiting()`; scope-relative.
- [ ] **Step 3: `scripts/lint-pure.js`** — fail if `Date.now()`/`Math.random()` appear in `schema/format/validate/migrate/calc/select`; fail if `innerHTML`/`insertAdjacentHTML`/`document.write` appear in `src/`.
- [ ] **Step 4: `scripts/build.js`** — read `src/index.html`; inline `cognac.css`; concatenate JS modules into one `app/app.js` (same-origin, so CSP `script-src 'self'`), referenced by a single `<script src="app.js">`; write `app/index.html`; stamp `__VERSION__` (content hash) into `app/sw.js`; copy `manifest.webmanifest` + `icons/` into `app/`. Log output size.
- [ ] **Step 5: Build + local verify** — `cmd /c "npm run lint:pure"` then `cmd /c "npm run build"`; serve `app/` under a `/car-service/app/` sub-path locally and confirm: loads, add/persist works, SW registers, offline reload works.
- [ ] **Step 6: Deploy** — commit `app/` + `src/` + tests; push to `main`; verify `…github.io/car-service/app/` returns 200 and the app runs; **install to a phone home screen and confirm offline** (owner-verifiable). Point the hub's "Live App" card at `/app/`.
- [ ] **Step 7: Commit** — `feat: PWA shell + build + first deploy of running app`.

### Slice 1 Done = check-in

Deployed, installable, offline app at `…/car-service/app/` with: seeded empty car, add/edit/delete services, live Next-due strip, current mileage, persistence. **Stop and check in with the owner before Slice 2.**

---

## Slice 2 — Predictions & Maintenance tab (outline)

Maintenance tab: full prediction rows with icon+text status, progress bars, `timeHintMonths` captions, used-car **anchors** editor in Settings, "not logged yet" actionable state. Tests: anchor fallback, caption presence, ordering. Verify + deploy.

## Slice 3 — Search, filters, Insights (outline)

History search (workshop+notes+job) + job filter chips + no-results state; Insights tab (total, this year, count, avg/year, cost-by-job). Tests: search matching, stats correctness. Verify + deploy.

## Slice 4 — Backup/restore + durability (outline)

Transactional restore (envelope `{app,schemaVersion,exportedAt,data}` → parse w/ `__proto__`-stripping reviver → validate allow-list → migrate clone → validate → snapshot → confirm → commit); export download; `storage.persist()`; private-mode probe banner; on-home "Last backed up" + nudges. Tests: import foreign/newer/proto/roundtrip; quota path. Verify + deploy.

## Slice 5 — Hardening + ship (outline)

Finalize strict CSP; a11y audit (focus, live regions, reduced-motion, contrast in Cognac); SW update-available flow; `.github/workflows/deploy.yml` (test → lint:pure → build → publish `app/`); real-phone verification pass; update `PROJECT-STATUS` + hub "Live App" → Ready.

---

## Self-Review notes

- **Spec coverage:** data model (Task 4 + migrate), predictions incl. anchors/typo-guard/thresholds (Tasks 2,6), security/CSP/textContent (Tasks 5,6, Slice 4–5), PWA update/relative paths/iOS (Task 7, Slice 5), a11y (Tasks 5,6, Slice 5), backup transactional (Slice 4), Cognac (Task 5). Time-based = caption only (Slice 2), matching decision #5.
- **Type consistency:** `predict()` returns `{status,remaining,nextDue,pct,anchor,timeHintMonths}` used identically in render; `lastDone()` returns an entry-like `{odometer,date,id,anchor?}`; `store` CRUD always returns new state.
- **Deferred deliberately (logged, not silent):** DOM-level automated UI tests (logic is unit-tested; UI verified manually per build cadence); full time-based prediction math (roadmap).
