# Handover — cold-start orientation

Read this to pick up the project from scratch (fresh session or new developer).

## What it is

An offline-first, installable, framework-free (vanilla JS) PWA to log a car's
service history and predict maintenance. Shipped **v1 + v1.1 "Garage"**. Live at
https://xcloudy75z.github.io/car-service/app/ · repo `xCloudy75z/car-service`.

Start with `README.md`, then `docs/ARCHITECTURE.md`. Status: `docs/PROJECT-STATUS.md`.
History: `docs/CHANGELOG.md`. Full designs: `docs/superpowers/specs/`; plans:
`docs/superpowers/plans/`.

## The mental model in 60 seconds

- One `localStorage` key `car-service:data` = a **v3** versioned object with
  `cars[]` (each car owns `entries`, `intervals`, `customJobs`, `baselines`) +
  `settings`.
- **A job is predicted for a car iff its key is in that car's `intervals`.**
- Pure logic (`schema/format/validate/migrate/calc/select`) is unit-tested and must
  stay free of `Date.now()`/`Math.random()`/`innerHTML` (`scripts/lint-pure.js`
  enforces it). `store.js` owns persistence + IDs + undo. `ui/*` + `app.js` are the
  thin DOM layer (textContent-only).
- Build = copy `src/` → `app/` + stamp a content-hash version; deploy = commit `app/`
  (Pages serves it at `/app/`).

## Environment (this Windows machine)

- **Git is not on PATH.** Use the bundled GitHub Desktop git:
  `C:\Users\games\AppData\Local\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe`
  (search under `…\GitHubDesktop\` if the version dir differs). Commit with
  `-c user.name="xCloudy75z" -c user.email="games643@hotmail.com"`.
- Wrap node/npm/gh in `cmd /c "..."` from PowerShell. `gh` is authenticated as
  `xCloudy75z`. Node is v25 locally (CI uses 22; the `node --test` glob needs 21+).
- Git push prints progress to stderr; PowerShell surfaces it as a red "error" even
  on success — check for `-> main` / the new SHA, not the red text.

## Everyday commands

```bash
node --test "tests/**/*.test.js"   # 145 tests
node scripts/lint-pure.js
node scripts/build.js              # → app/ (stamps version + build time)
node scripts/serve.js              # http://localhost:5173 (serves app/)
```

## How work is done here (process)

1. **Brainstorm** the feature (superpowers:brainstorming) → a written **spec** in
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. **Break the spec** — dispatch adversarial "try to break it" agents; fold fixes in.
3. **Plan** (superpowers:writing-plans) → `docs/superpowers/plans/…`; **break the
   plan** too.
4. **Build in small slices**, each: a fresh Opus subagent builds logic test-first,
   then another builds the UI; the orchestrator reviews, runs tests + lint, **builds
   + verifies it running in a real browser** (the `mcp__Claude_Browser` preview
   tools + a seeded `localStorage`), then commits `src/` + `app/`, deploys, and
   confirms the live version before the next slice.
5. Subagents do NOT run git; the orchestrator owns git/deploy/verify.

## Owner working style (important)

- The owner runs a **remote session** and cannot see local files, widgets, or the
  preview pane — **publish anything they need to see to GitHub Pages** and give them
  the URL. Nothing is "approved" until they've seen it. The `AskUserQuestion` tool
  UI also doesn't render for them — ask in plain text.
- The owner loves premium HTML with clickable buttons, and pulls each build on their
  phone via **Settings → App → Check for updates** (the version stamp confirms it).
- Use **Opus for everything** (planning and building, including subagents).

## Where to change what

- New job type default → `schema.js` (`JOBS`, `DEFAULT_INTERVALS`).
- Prediction/stat math → `calc.js` (pure; add tests).
- New persisted operation → `store.js` (+ tests); if it touches import, also
  `validate.js` (allow-list) — thread `validKeys` per car.
- New view / dialog → `ui/*` + wire in `app.js`; resolve any job label/icon via
  `jobMeta(car,key)`, never `JOBS[key]` directly.
- Styling → `styles/cognac.css` (reuse the Cognac tokens).
- Always rebuild (`app/`) and browser-verify before committing.
