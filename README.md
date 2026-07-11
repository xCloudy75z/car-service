# 🔧 Car Service History

An **offline-first, installable web app** that keeps your car's complete service
history on your own device and tells you what maintenance is coming up. No login,
no server, no internet required. Framework-free vanilla JavaScript.

- **Live app:** https://xcloudy75z.github.io/car-service/app/
- **Project hub** (spec, review, mockup, progress, docs): https://xcloudy75z.github.io/car-service/
- **Repo:** https://github.com/xCloudy75z/car-service

---

## What it does

- **Log every service** — date, odometer (optional), workshop, cost, one or more
  jobs per visit, notes.
- **Predicts what's due** — per-car maintenance predictions with progress bars and
  soft time-based reminders (e.g. brake fluid "also due by time"). **Used-car
  anchors** let predictions work on a car you adopted mid-life.
- **Search & filter** your history; **Insights** tab with total/yearly spend and a
  cost-by-job breakdown.
- **Multiple vehicles** — a whole garage; each car has its own history, intervals,
  custom items and anchors.
- **Editable intervals** — set each job's distance, turn predictions on/off per
  job, add your **own custom maintenance items** (with an emoji + optional interval).
- **Backup & restore** — export your history to a file and restore it safely
  (transactional; rejects foreign/newer/hostile files; snapshot + undo).
- **Installs to your home screen**, works **fully offline**, and **updates in
  place** (a "Check for updates" button + a visible version/build stamp in Settings).

## Why it's built the way it is

- **Offline-first & private** — all data lives in your browser's `localStorage`;
  nothing ever leaves the device (a strict Content-Security-Policy with
  `connect-src 'none'` enforces this). Fonts are self-hosted.
- **Vanilla JS, no framework** — small, fast, dependency-free; the deployable app is
  a folder of plain ES modules.
- **Accessible** — WCAG-AA contrast, a proper tab pattern with arrow-key nav,
  screen-reader labels, focus management, reduced-motion support.

## Tech stack

| Area | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules), HTML, CSS |
| Storage | `localStorage` (single namespaced key, versioned JSON) |
| App type | Installable PWA (`manifest.webmanifest` + service worker) |
| Fonts | Self-hosted variable woff2 (Bricolage Grotesque, Inter, JetBrains Mono) |
| Tests | Node's built-in runner (`node --test`) — **145 tests** |
| Build | Tiny Node script (`scripts/build.js`) → `app/` |
| CI | GitHub Actions (`.github/workflows/ci.yml`): test + lint + build on every push |
| Deploy | GitHub Pages (serves `main` at root; the app is committed under `app/`) |
| Look | "Cognac" — warm leather-and-paper light theme |

## Repository layout

```
src/                    # app source (ES modules)
  schema.js             # job registry, default intervals, versions, custom-key rules
  format.js             # date / km / money / escape helpers (pure)
  validate.js           # input + import allow-list validation (pure)
  migrate.js            # versioned schema migrations (pure)
  calc.js               # predictions + stats (pure)
  select.js             # accessors: getActiveCar, allJobs, jobMeta, filterEntries (pure)
  store.js              # localStorage persistence + all mutations (IDs, undo, backup)
  ui/render.js          # DOM builders (car header, due strip, timeline, cards)
  ui/home.js            # History view (search, filters, timeline)
  ui/maintenance.js     # Maintenance rows
  ui/insights.js        # Insights (stats + cost-by-job)
  ui/sheet.js           # accessible slide-in dialog
  ui/toast.js           # toasts + undo toast
  app.js                # controller: tabs, sheets, Garage, intervals editor, backup
  build-info.js         # (dev placeholder) version + build timestamp
  register-sw.js        # PWA registration + in-place update reload
  sw.js                 # service worker (versioned cache, offline)
  styles/cognac.css     # the design system
  fonts/                # self-hosted woff2
scripts/
  build.js              # assemble app/ (+ stamp version into sw.js & build-info.js)
  generate-icons.js     # generate PWA icons (dependency-free PNG encoder)
  lint-pure.js          # fail build on nondeterminism / unsafe DOM sinks
  serve.js              # tiny static server for local verification
app/                    # BUILD OUTPUT (committed) — served by GitHub Pages at /app/
tests/                  # node --test suites
docs/                   # documentation (this folder) + superpowers specs/plans
preview/                # hub pages (spec, review, mockup, progress, docs)
index.html              # project hub
.github/workflows/ci.yml
```

## Develop

Node 20+ (the test runner glob needs 21+; CI uses 22). No dependencies to install.

```bash
node --test "tests/**/*.test.js"   # run the test suite (145)
node scripts/lint-pure.js          # purity + safe-DOM lint
node scripts/generate-icons.js     # (re)generate PWA icons
node scripts/build.js              # assemble app/ (stamps version + build time)
node scripts/serve.js              # serve app/ at http://localhost:5173 to verify
```

On this Windows machine, wrap npm/node in `cmd /c "..."` and use the bundled
GitHub Desktop git. See `docs/HANDOVER.md`.

## Build & deploy

`scripts/build.js` copies `src/` into `app/`, generates a **content-hash version**
(over all built files) that it stamps into `sw.js` (cache name) and `build-info.js`
(shown in Settings), and copies the icons. `app/` is committed; GitHub Pages serves
`main` from the repo root, so the app is live at `…/car-service/app/`. Pushing to
`main` triggers the CI gate (tests + lint + build); the site itself is served
statically from the committed `app/`.

## Data & privacy

- One key: `car-service:data` — a versioned JSON object (see `docs/ARCHITECTURE.md`).
- Nothing is sent anywhere. The only way data leaves the device is a backup file
  **you** save. That file contains your car details/notes — keep it private.

## Documentation

- `docs/ARCHITECTURE.md` — modules, data model (v3), the prediction model, the
  build/PWA/deploy pipeline, the security model, testing.
- `docs/CHANGELOG.md` — version history (v1 slices 1–5, Garage v1.1 slices 6a–6c).
- `docs/PROJECT-STATUS.md` — what's shipped, what's next.
- `docs/HANDOVER.md` — cold-start orientation for a fresh session/developer.
- `docs/superpowers/specs/` — the design specs (each adversarially reviewed).
- `docs/superpowers/plans/` — the implementation plans.
- **Readable online:** https://xcloudy75z.github.io/car-service/preview/docs.html

## How this was built

Every feature went: **brainstorm → written spec → adversarial "break-it" review by
independent agents → hardened spec → implementation plan (also break-tested) →
build in small test-first slices, each verified running in a real browser, then
deployed.** The reviews caught real bugs (including a backup data-loss bug) before
any code shipped. Details in `docs/CHANGELOG.md` and the specs/plans.
