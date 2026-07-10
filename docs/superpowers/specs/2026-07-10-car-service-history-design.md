# Car Service History — Design Spec

**Date:** 2026-07-10
**Status:** Approved for planning
**Owner:** Abdulla
**Author:** Claude (Opus 4.8)

---

## 1. Executive Summary

An offline-first, installable web app that keeps one car's complete service
history on the owner's own device and automatically tells them what maintenance
is due next. No login, no server, no internet required. Built as a framework-free
(vanilla JavaScript) Progressive Web App using the proven `rem-money` recipe from
the owner's existing portfolio: modular source → small Node build → single-file
installable offline app → auto-deploy to GitHub Pages.

## 2. Problem Statement

Car owners forget when maintenance was last done ("when was the last oil
change?"). Dealer/brand apps are locked to one workshop and useless if the owner
switches garages. A car with no organized service history loses resale value.
There is no simple, private, cross-workshop place to keep the whole record.

## 3. User Personas

- **Primary — The Practical Owner:** Owns one car, services it at mixed
  workshops, is not technical, uses a phone. Wants to glance before a workshop
  visit and know what's due, and to hold a clean record for resale.
- **Secondary — The Seller:** Preparing to sell; wants a credible, complete
  maintenance record to show a buyer.

## 4. Product Vision

The single source of truth for a car's maintenance: what was done, when, at what
mileage, for how much, where — and what's coming up. Reduces pre-workshop stress
and protects resale value.

## 5. User Journey

1. Opens the app (installed icon on phone home screen, works offline).
2. First run: optionally fills a minimal car profile; sees a friendly empty state.
3. Taps **+ Add Service**, enters date/odometer/workshop/cost, ticks the jobs
   done, adds notes, saves.
4. Entry appears at the top of the timeline; predictions and stats update.
5. Before a workshop visit: opens app, reads the **Next due** strip and searches
   past work ("did they already do the brakes?").
6. Periodically taps **Backup** to save a safety copy.

## 6. Information Architecture

Effectively one scrolling screen plus slide-in sheets:

- **Home** (the screen): car header → Next-due strip → stats row → search/filter →
  timeline list → floating **+ Add Service**.
- **Add / Edit Service sheet** (slide-in).
- **Settings sheet**: car profile, theme toggle, backup/restore, currency label.
- **Confirm dialog** for destructive actions.

## 7. Screen Inventory

| Screen / Surface | Purpose |
|---|---|
| Home | Timeline, predictions, stats, search/filter, entry point |
| Add/Edit Service sheet | Create or edit one service visit |
| Settings sheet | Car profile, theme, backup/restore, currency |
| Confirm dialog | Guard deletes and restores |
| Toast | Non-blocking success/error feedback |
| Empty state | First-run guidance when no entries exist |

## 8. UX Recommendations

- Mobile-first, premium, calm, spacious; soft shadows, rounded corners, subtle
  motion. Performance over effects.
- Light theme default; dark via toggle (preference saved). No FOUC (theme applied
  before first paint).
- Minimal typing: multi-job tick-boxes, sensible defaults, numeric keypads for
  km/cost.
- Destructive actions always confirm. Feedback via auto-dismissing toast (3s).
- Clear action hierarchy in forms: primary Save · secondary · Cancel.

## 9. Feature Prioritization (MVP)

**In:** Car profile (minimal) · Add/edit/delete service (multi-tag) · Timeline ·
Search · Filter by job · Stats (total, this year, count, avg/year) · Distance-based
maintenance predictions · Backup/restore · Light/dark · Installable + offline (PWA).

**Explicitly out (future):** multiple vehicles, photos/invoices, PDF/CSV export,
cloud sync, fuel/tire/warranty/registration/inspection tracking, VIN/OBD, AI
insights, time-based prediction rules, editable intervals UI.

## 10. Workflows

- **User workflow:** open → (first run: car profile) → add service → review
  timeline/predictions → search before visits → periodic backup.
- **System workflow:** UI event → validate input → update in-memory state →
  persist to localStorage → recompute predictions/stats (pure `calc.js`) →
  re-render.
- **Storage workflow:** one namespaced localStorage key holds a versioned JSON
  object. Every write is wrapped; migrations run on load if `version` is behind.
- **Reminder workflow:** current km = max odometer on record. For each interval
  item, find last entry tagged with it → next due = lastOdo + interval →
  remaining = nextDue − currentKm → status colour. Never-done items show "not yet
  recorded."
- **Exception workflow:** invalid/empty fields blocked with inline messages;
  odometer lower than an earlier entry warns (typo guard, not a hard block);
  full/blocked storage shows a clear error, never silent loss.
- **Recovery workflow:** corrupt/missing data loads as an empty app (never
  crashes). Backup file export/import restores full state. Data versioning keeps
  older saved data compatible as features are added.

## 11. System Architecture

Framework-free PWA following the `rem-money` recipe.

- **Source (`src/`):** small, single-purpose vanilla modules loaded as scripts in
  dev, inlined at build.
  - `format.js` — dates, km, currency formatting.
  - `validate.js` — input validation (pure).
  - `migrate.js` — schema versioning/migrations (pure).
  - `calc.js` — prediction engine + statistics (pure, fully unit-tested).
  - `store.js` — localStorage load/save/CRUD, wrapped in try/catch.
  - `seed.js` — optional sample data for first-run/demo.
  - `components/` — `sheet.js`, `toast.js`, `confirmDialog.js`, `serviceSheet.js`,
    `settingsSheet.js`.
  - `views/home.js` — the single screen renderer.
  - `app.js` — bootstrap and wiring.
  - `styles/main.css` — design system + light/dark tokens.
- **Build (`scripts/build.js`):** inlines JS + CSS into one `dist/index.html`,
  emits `sw.js`, copies icons + `manifest.webmanifest`.
- **PWA:** `manifest.webmanifest` (installable) + service worker (offline cache).
- **Quality gates:** `node --test` on pure modules; a "pure lint" ensuring logic
  modules avoid nondeterminism (`Date.now()`, `Math.random()`) so tests are
  reliable — mirrors `rem-money`.
- **Deploy:** GitHub Action → test → build → publish `dist/` to GitHub Pages on
  push. `dist/` is a build artifact (gitignored).

## 12. Data Model

Single root object, versioned, car-wrapped so multi-vehicle is a later addition
rather than a rebuild.

```jsonc
{
  "version": 1,
  "car": {
    "id": "string",
    "name": "string",      // all optional
    "make": "string",
    "model": "string",
    "year": 2020,
    "plate": "string"
  },
  "entries": [
    {
      "id": "string",
      "date": "YYYY-MM-DD",
      "odometer": 52000,          // km, integer >= 0
      "workshop": "string",
      "cost": 250.00,             // number >= 0
      "tags": ["oil", "air_filter"],   // one or more job tags
      "notes": "string"
    }
  ],
  "intervals": {                  // km; stored as data => editable later
    "oil": 10000,
    "air_filter": 20000,
    "cabin_filter": 20000,
    "brake_fluid": 40000,
    "spark_plugs": 100000
  },
  "settings": {
    "theme": "light",             // "light" | "dark"
    "currencyLabel": "AED"
  }
}
```

**Job tags.** A single flat set. A subset carries a default interval (these get
predictions); the rest are log/filter-only.

- *Predicted (has interval):* `oil`, `air_filter`, `cabin_filter`, `brake_fluid`,
  `spark_plugs`.
- *Log-only (no interval):* `tires`, `brakes`, `battery`, `transmission`,
  `suspension`, `engine`, plus user `custom` tags.

## 13. localStorage Structure

- One key, namespaced: `car-service:data` → the JSON object in §12.
- Theme cached separately for instant first-paint: `car-service:theme-cache`.
- All reads/writes go through `store.js`; every write wrapped so quota/blocked
  errors surface as a toast, never a silent loss.

## 14. Automation Opportunities

- **Predictions** computed automatically from history + current km — no manual
  "next due" entry.
- **Current mileage** derived automatically (max odometer) — zero extra typing.
- **Stats** (total, yearly, count, average) computed on the fly.
- Data **migrations** run automatically on load when the schema version advances.

## 15. Security Review

- Fully local: no server, no accounts, no network calls, no tracking. Data never
  leaves the device except via a user-initiated backup file the user places
  themselves.
- Backup is plain JSON the user controls; no secrets involved.
- Rendering escapes user text to avoid HTML injection into the DOM.

## 16. Scalability Review

- Car-wrapped model → multi-vehicle later = wrap in a `cars[]` array + selector.
- Intervals stored as data → editable-intervals UI later with no model change.
- Pure `calc.js` handles far more entries than a personal log will ever hold.
- Modular source keeps each concern small and independently testable.

## 17. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Browser storage cleared → data loss | High | Backup/restore; encourage periodic backup |
| Schema change breaks old data | Medium | Versioned model + migrations |
| Bad odometer typo skews predictions | Medium | Warn when odometer < previous entry |
| Storage quota/blocked | Low | Wrapped writes + clear error toast |
| Corrupt stored JSON | Low | Safe parse → load empty app, offer restore |

## 18. Edge Cases

- No entries yet → empty state; predictions show "not yet recorded."
- Item never logged → grey "not yet recorded" (cannot predict).
- Odometer lower than an earlier entry → non-blocking warning.
- Duplicate-looking entry (same date + odometer) → allowed but softly flagged.
- Empty required fields (date, odometer) → blocked with inline message.
- Restoring a backup → confirm dialog before overwriting current data.
- Very long notes/workshop names → truncated in cards, full in detail/edit.

## 19. MVP Scope

Everything in §9 "In". Single car. Distance-based predictions. Installable +
offline. Backup/restore. Light/dark. English only.

## 20. Future Roadmap (architecture-ready, not built)

Multiple vehicles → photos/invoices → PDF/CSV export → printable report → cloud
sync → editable intervals UI → time-based rules → fuel/tire/warranty/registration/
inspection tracking → VIN/OBD → AI insights/resale report → expense analytics.

## 21. Decisions Log (resolved with owner)

1. Process: right-sized (one spec, then incremental build).
2. Theme: light + dark toggle, light default. *(Resolved a brief contradiction.)*
3. Entry shape: one entry per visit, multiple job tags.
4. Current mileage: highest odometer on record.
5. Prediction basis: distance-only for MVP.
6. Backup/restore: included (data-safety net).
7. Car profile: minimal, all fields optional.
8. Build approach: `rem-money` pattern (vanilla + small build → single-file
   installable offline PWA + tests + push-to-deploy).
9. Currency: AED, editable label. Files: clean modular split. i18n: skipped for MVP.

## Build Sequence (verifiable steps)

1. **Skeleton + design system + storage + PWA shell** → confirm it opens,
   installs, and works offline (package early per build-cadence rule).
2. **Add/edit/delete service + timeline** → confirm persistence across refresh.
3. **Prediction engine + Next-due cards** (with `calc.js` tests).
4. **Search, filters, stats.**
5. **Backup/restore, car profile, dark toggle, final polish + deploy workflow.**

Each step verified running in a real browser before the next.
