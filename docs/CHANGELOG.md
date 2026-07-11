# Changelog

All dates 2026-07. The app deploys to GitHub Pages; each entry notes the build
version shown in **Settings → App → Version** at the time it shipped.

## v1.1 — "Garage" (multi-vehicle + customization)

Data model bumped to **v3**. Spec and plan were each adversarially reviewed by
independent agents (which caught a custom-key/restore data-loss bug, anchor/import
gate omissions, an 8-file refactor blast radius, and test-sequencing bugs — all
fixed before build). Built logic-then-UI, browser-verified each sub-slice.

- **6a — Multiple vehicles** (`0878233e95`). v3 migration; car add/switch/edit/delete
  with a shared one-level undo; a header switch pill (only when >1 car); Settings
  "Your Garage" list; disambiguated switcher with `aria-current`; delete confirm +
  never-backed-up escalation + undo; last car can't be deleted.
- **6b — Editable intervals** (`4139aaff28`). Prediction became "a key exists in
  `car.intervals`" (refactored across calc/select/store/render/maintenance/home/
  insights; the old `predicted` flag is now only a seed hint). Settings "Service
  intervals" editor: per-job distance + on/off `role="switch"` toggle (won't predict
  until a valid distance) + reset-to-defaults; `setInterval` merges (a distance-only
  edit preserves the time caption); empty state when all off.
- **6c — Custom maintenance items** (`6397d8083d`). Per-car `customJobs`; an
  `allJobs`/`jobMeta` registry used everywhere; add via an emoji-palette editor (+
  optional distance) with a duplicate-name warning; edit; delete (atomic tag-strip +
  undo). The import validator now threads per-car `validKeys` through every cleaner,
  so custom jobs + their intervals + entry tags + baselines survive export→import
  (verified with an in-browser roundtrip). Custom keys use a backup-safe format.

**Tests:** 79 → **145**.

## v1 — initial release

Designed from a brief, then brainstormed into a spec, adversarially reviewed by six
agents (8 blockers / 10 majors / 13 minors found and fixed in the spec), planned, and
built in five verified slices.

- **Slice 1 — Deployable core.** Data model + `localStorage` store + prediction
  engine + Home/History (add/edit/delete, live "next due", timeline) + installable
  offline PWA. Deployed and verified running.
- **Slice 2 — Maintenance tab.** Full prediction rows with progress bars, used-car
  "last done" anchors, and soft time-based captions.
- **Slice 3 — Search + Insights.** Live history search + job filter chips + a
  no-results state; Insights tab (total / this-year / count / avg-per-year + a
  cost-by-job breakdown).
- **Slice 4 — Backup & Restore.** Transactional export/import: envelope + allow-list
  validation + prototype-pollution guard + snapshot-before-commit + undo; rejects
  foreign/newer/corrupt/hostile files.
- **Slice 5 — Hardening + ship.** WCAG-AA contrast pass; accessible tab pattern with
  arrow-key nav; **self-hosted fonts** (offline + private) and a fully-locked CSP;
  solid accessible buttons; a more robust runtime-caching service worker; a CI
  quality-gate workflow.

Also in v1: an in-app **"Check for updates"** button and a **version/build-timestamp**
in Settings, so new builds reach an installed app in place — no reinstall.

## Design decisions (locked)

Light **Cognac** theme (warm leather/paper) with light+dark considered and light
chosen; one entry per visit with multiple job tags; current mileage = highest
odometer on record; **distance-based predictions + a soft time caption** (full
time-rules deferred); backup/restore included; per-car everything; currency label
editable (default AED); English only. See `docs/superpowers/specs/`.
