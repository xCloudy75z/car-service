# Project Status

**As of 2026-07-12 · shipped: v1 + v1.1 "Garage" · latest build `6397d8083d` · 145 tests green · CI passing.**

## Shipped ✅

- Core: log services, live "next due" predictions, installable offline PWA, in-place updates.
- Maintenance tab: prediction rows, progress bars, used-car anchors, time captions.
- Search + job filters; Insights (spend stats + cost-by-job).
- Transactional Backup & Restore (rejects foreign/newer/hostile files; snapshot + undo).
- Multiple vehicles (add/switch/edit/delete + undo).
- Editable per-car intervals (distance, on/off, reset).
- Custom maintenance items (emoji-palette editor; backup-safe roundtrip).
- Hardening: WCAG-AA a11y, strict CSP, self-hosted fonts, CI gate.

## Not started / future (architecture-ready) ⬜

- **Per-item TIME rules** — editing "every N months" (today it's a display caption
  only; interval objects already carry `timeHintMonths`).
- **Reorder cars** in the switcher.
- **Receipt/invoice photos** — needs IndexedDB for binaries (localStorage would
  overflow); `store.js` interface is the seam.
- **PDF / printable report**, **CSV export**.
- **Cross-device sync** — entries already carry `id/createdAt/updatedAt/deletedAt`
  (tombstones), so last-write-wins is feasible without a migration.
- **VIN decode, fuel/tire/warranty/registration tracking, AI insights** — from the
  original future list.

## Known minor items (defensible, not bugs)

- "Avg / year" reads ≈ the total until there's ≥1 year of history (the denominator is
  floored so it can't show a silly number).
- The decorative 🔧 in the car header is a full-colour emoji; could be vectorized.

## Operational notes

- **Deploy** is a manual commit of `app/` (Pages serves `main` at root; CI is a
  quality gate, not a deployer). Could switch to an Actions-based deploy later.
- **To ship a change:** edit `src/` → `node scripts/build.js` → verify with
  `node scripts/serve.js` → commit `src/` + `app/` → push (CI runs) → the installed
  app updates via "Check for updates" or on next launch.
- The `app/` version bumps on any change (hash over all files), so CSS-only fixes
  still update.
