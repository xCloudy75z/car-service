# Car Service History — Design Spec (v2, hardened)

**Date:** 2026-07-10
**Status:** Approved-in-principle; hardened after adversarial review; awaiting final user sign-off
**Owner:** Abdulla
**Author:** Claude (Opus 4.8)

> **v2 note.** This revision folds in the fixes from a six-agent adversarial review
> (8 blockers, 10 majors, 13 minors) plus three user decisions: **Balanced**
> future-proofing, a **used-car "last done before logging" anchor**, and
> **distance-only predictions with a soft time caption**. Changed areas are marked
> **[R]** (review fix) or **[D]** (user decision).

---

## 1. Executive Summary

An offline-first, installable web app that keeps one car's complete service
history on the owner's own device and automatically tells them what maintenance
is due next. No login, no server, no internet required. Framework-free (vanilla
JavaScript) Progressive Web App built with the proven `rem-money` recipe:
modular source → small Node build → single installable offline app →
auto-deploy to GitHub Pages.

## 2. Problem Statement

Owners forget when maintenance was last done. Brand/dealer apps are locked to one
workshop and useless if you switch garages. A car with no organized service
history loses resale value. There is no simple, private, cross-workshop place to
keep the whole record.

## 3. User Personas

- **Primary — The Practical Owner:** one car, mixed workshops, not technical,
  phone-first. Often adopts the app for a car that is **already several years
  old** — so the design must work from day one without a full logged history.
- **Secondary — The Seller:** wants a credible, complete record to show a buyer.

## 4. Product Vision

The single source of truth for a car's maintenance: what was done, when, at what
mileage, for how much, where — and what's coming up. Reduces pre-workshop stress
and protects resale value.

## 5. User Journey

1. Opens the installed app (home-screen icon, works offline).
2. First run: a short explainer that data lives only on this device and backup is
   how it survives; optional minimal car profile; optional "last done" anchors for
   a used car.
3. Taps **+ Add Service**: date, odometer (optional), workshop, cost, ticks the
   jobs done, notes; saves.
4. Entry appears at the top; predictions and stats update.
5. Before a workshop visit: reads the **Next due** strip; searches past work.
6. Backup is visible on the home screen ("Last backed up: N days ago") with a
   one-tap save and a gentle periodic nudge.

## 6. Information Architecture

One scrolling **Home** screen plus slide-in sheets:

- **Home:** car header (with current mileage shown) → Next-due strip → stats row →
  backup status → search + filter chips → timeline → floating **+ Add Service**.
- **Add / Edit Service sheet.**
- **Service detail** (tap a card): read-only view of full notes before editing. **[R]**
- **Settings sheet:** car profile, anchors, theme, backup/restore, currency label.
- **Confirm dialog** (restore/destructive only) and **Undo toast** (delete). **[R]**

## 7. Screen Inventory

| Surface | Purpose |
|---|---|
| Home | Timeline, predictions, stats, backup status, search/filter, entry point |
| Add/Edit Service sheet | Create or edit one visit |
| Service detail | Read-only full entry (notes) before edit **[R]** |
| Settings sheet | Car profile, anchors, theme, backup/restore, currency |
| Confirm dialog | Guard restore/destructive actions |
| Undo toast | Reverse an accidental delete **[R]** |
| Toast (live region) | Non-blocking feedback; errors persist **[R]** |
| Empty / first-run state | Guidance + data-safety explainer |

## 8. UX & Accessibility (baked in from step 1, not "final polish") [R]

- Mobile-first, premium, calm; soft shadows, rounded corners, subtle motion.
- Light default; dark toggle; theme applied before first paint (no flash), and
  the theme cache is kept in sync on restore.
- **Status never by colour alone:** each prediction shows an **icon + words**
  ("Overdue by 2,000 km", "Due soon (in 800 km)", "OK (in 6,400 km)", "Not logged
  yet") and a matching screen-reader label.
- **Focus management:** sheets are real dialogs — focus moves in on open, is
  trapped, Esc closes, focus returns to the trigger, background is inert.
- **Live regions:** success = polite; storage errors = assertive and **do not
  auto-dismiss**; the failed entry stays in the form.
- **Motion:** honour `prefers-reduced-motion` (fade/instant instead of slide).
- **Contrast:** tokens verified ≥ 4.5:1 text / 3:1 UI in both themes.
- **Tap targets:** ≥ 44×44 px with spacing.
- **Delete = Undo toast** (delete immediately, 6-second Undo); confirm dialog kept
  for restore only.
- Numbers: decimal keypad; tolerate thousands separators ("1,250"); validate the
  parsed number, not the raw text. Save disabled until the write resolves
  (no double-submit).

## 9. Feature Prioritization (MVP)

**In:** minimal car profile · used-car anchors **[D]** · add/edit/delete service
(multi-tag, optional odometer) · timeline · service detail · search (workshop +
notes + job) with a no-results state · filter by job · stats (total, this year,
count, avg/year) · distance-based predictions with soft time caption **[D]** ·
prominent backup/restore · light/dark · installable + offline (PWA).

**Out (future):** multiple vehicles, photos/invoices, PDF/CSV export, cloud sync,
fuel/tire/warranty/registration/inspection tracking, VIN/OBD, AI insights, full
time-based rules, editable-intervals UI.

## 10. Workflows

- **User:** open → (first run: explainer + optional profile/anchors) → add service
  → review timeline/predictions → search before visits → backup (nudged).
- **System:** UI event → validate → update in-memory state (with `updatedAt`) →
  persist (temp-key-then-swap) → recompute predictions/stats via pure `calc.js`
  (given an injected `today`) → re-render.
- **Storage:** one namespaced key holds a versioned JSON object; every write is
  wrapped and quota-safe; migrations run on load if `version` is behind.
- **Reminder / prediction [R][D]:**
  - **Current km** (per active car) = highest odometer among non-excluded,
    non-deleted entries, **outlier-aware**, recomputed from state on every change,
    and shown on screen. Entries with unknown odometer are excluded.
  - **Last done (job)** = the non-deleted entry carrying that job with the
    **highest odometer**, tie-broken by (date desc, id) — never array order. If no
    logged entry exists, fall back to the user's optional **anchor** for that item.
  - next due = lastDoneOdo + interval.km; remaining = nextDue − currentKm.
  - **Due-soon** = remaining ≤ `min(0.10 × interval.km, 1000 km)`.
  - **Soft time caption [D]:** items with a `timeHintMonths` show "also due by
    time (~every N months) — check your manual". Time does **not** drive the
    number in v1; it only cautions.
  - No baseline and no anchor → "Not logged yet — add your last <job> to predict".
- **Exception:** invalid/empty required fields blocked inline; odometer checked
  **both directions** and **date-aware** (only warns when km disagrees with its
  date neighbours), so back-filled receipts don't false-warn; full/blocked storage
  shows a persistent error, never silent loss.
- **Recovery:** corrupt/missing data → empty app (never crash). Restore is
  transactional (see §15). A pre-upgrade copy is kept so a bad migration is
  recoverable.

## 11. System Architecture

Framework-free PWA, `rem-money` recipe. Modules (each single-purpose, pure ones
fully unit-tested):

- `schema.js` **[R]** — the one registry of job tags + default intervals; every
  other module reads tags/intervals from here (no scattering).
- `format.js` — date/km/currency formatting.
- `validate.js` — input + import validation (pure).
- `migrate.js` — stepwise schema migrations (pure).
- `calc.js` — predictions + stats (pure; receives `today` as a parameter). **[R]**
- `select.js` **[R]** — accessors (e.g. `getActiveCar`) so views never read the
  raw shape directly; this is what makes multi-vehicle additive later.
- `store.js` — persistence + CRUD; generates IDs (`crypto.randomUUID()`); its
  public interface is storage-agnostic. **[R]**
- `components/` — `sheet.js` (accessible dialog), `toast.js`, `confirmDialog.js`,
  `serviceSheet.js`, `settingsSheet.js`.
- `views/home.js` — the single screen.
- `app.js` — bootstrap/wiring; `styles/main.css` — design tokens + themes.

**Build (`scripts/build.js`):** produces `dist/` = `index.html` + **same-origin
JS files** + `sw.js` + icons + `manifest.webmanifest`. **[R]** CSS is inlined;
**JS is kept as separate same-origin files (not inlined)** so the security policy
can be `script-src 'self'` (fully inlined scripts would force `'unsafe-inline'`,
re-opening injection). Build **stamps a content-hash version** into `sw.js`
(used as the cache name) so every deploy updates.

**Quality gates:** `node --test` on pure modules; a "pure lint" (no `Date.now()`/
`Math.random()` in `calc/validate/migrate/format/schema`); **a grep gate that
fails the build on `innerHTML`/`insertAdjacentHTML`/`document.write` in `src/`**;
**a check that `dist/` references no off-origin URLs.** **[R]**

**Deploy:** GitHub Action → test → build → publish `dist/` to Pages on push.

## 11b. PWA & Service Worker (locked decisions) [R]

1. **Update strategy:** SW `skipWaiting()` + `clients.claim()`; the page reloads
   once on `controllerchange`. Register with `updateViaCache:'none'`.
2. **Versioning:** build stamps a content hash into `sw.js`; it is the cache name;
   `activate` deletes all caches whose name ≠ current.
3. **Cache strategy:** cache-first for the small app shell (safe because the
   version bump forces refresh).
4. **Sub-path safety:** all manifest/SW/icon paths are **relative** (`start_url`
   and `scope` = `"./"`); SW registered by relative path — required because the app
   lives at `…github.io/car-service/`.
5. **iPhone:** include Apple meta tags + `apple-touch-icon` (180×180); show manual
   "Share → Add to Home Screen" guidance on iOS (no install prompt there).
6. **Durability:** call `navigator.storage.persist()` on first save; a load-time
   storage probe shows a persistent banner in private mode ("data won't be saved").
7. **Writes:** temp-key-then-swap so a failed large write never corrupts the good
   record; on quota error keep the change in memory and prompt "export a backup
   now"; theme-cache write failures are non-fatal.

## 12. Data Model (Balanced future-proofing) [R][D]

Root is car-nested and record-versioned so multi-vehicle, sync, and time-rules
become additive:

```jsonc
{
  "version": 2,
  "activeCarId": "uuid",
  "cars": [
    {
      "id": "uuid",
      "profile": { "name": "", "make": "", "model": "", "year": 2020, "plate": "" },
      "entries": [
        {
          "id": "uuid",
          "date": "YYYY-MM-DD",
          "odometer": 52000,          // integer >= 0, OR null = unknown
          "workshop": "",
          "cost": 250.00,             // number >= 0
          "tags": ["oil", "air_filter"],
          "notes": "",
          "createdAt": "ISO",         // for future sync
          "updatedAt": "ISO",
          "deletedAt": null           // soft delete; filtered everywhere
        }
      ],
      "intervals": {                  // object values, time-ready
        "oil":          { "km": 10000 },
        "air_filter":   { "km": 20000 },
        "cabin_filter": { "km": 20000, "timeHintMonths": 12 },
        "brake_fluid":  { "km": 40000, "timeHintMonths": 24 },
        "spark_plugs":  { "km": 100000 }
      },
      "baselines": {                  // optional used-car anchors [D]
        "brake_fluid": { "odometer": 35000, "date": "2024-05-01" }
      }
    }
  ],
  "settings": { "theme": "light", "currencyLabel": "AED" }
}
```

- **IDs:** `crypto.randomUUID()` in `store.js`; on import, IDs are **regenerated**.
  Never derived from array position/counter.
- **Job tags:** one flat set from `schema.js`. Predicted (interval): `oil`,
  `air_filter`, `cabin_filter`, `brake_fluid`, `spark_plugs`. Log-only: `tires`,
  `brakes`, `battery`, `transmission`, `suspension`, `engine`, + `custom:*`. Tags
  are normalized (trim/lowercase/slug); the built-in names are reserved.

## 13. localStorage Structure

- Key `car-service:data` → the object in §12; a `-preupgrade` copy kept before any
  migration. **[R]**
- `car-service:theme-cache` → tiny, for instant first paint; mirrored on restore.
- All access via `store.js`; every write wrapped and quota-recoverable.

## 14. Automation Opportunities

Predictions, current mileage, stats, and migrations are all computed
automatically. Backup nudges are automatic (after N entries / N days).

## 15. Trust Boundary & Sanitization (rewritten) [R]

Import is deliberately untrusted input, so it is treated as hostile:

1. **Rendering:** all user-derived strings (workshop, notes, custom tags, profile,
   currency label) rendered with `textContent` only — never `innerHTML`. One
   audited escape helper; the build's grep gate enforces it.
2. **Import/restore is transactional:** read → `JSON.parse` with a reviver that
   **drops `__proto__`/`constructor`/`prototype`** → verify an **envelope**
   `{ app:"car-service", schemaVersion, exportedAt, data }` (reject foreign files,
   missing/non-integer version, or a **newer** schema than we understand) →
   rebuild state **field-by-field against an allow-list** (finite numbers in range,
   `YYYY-MM-DD` dates, known/normalized tags, regenerated IDs, unknown keys
   dropped) → run migrations on the **clone** → validate again → **snapshot current
   data** → **confirm** → commit. The live key is never touched until commit.
3. **Content-Security-Policy** (`<meta>`, since Pages sets no headers):
   `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
   img-src 'self' data:; connect-src 'none'; font-src 'self'; manifest-src 'self';
   base-uri 'none'; form-action 'none'; object-src 'none'`. `connect-src 'none'`
   mechanically enforces "nothing leaves your device".
4. **Zero off-origin resources, ever** (self-host fonts/icons) — locked and
   build-checked; preserves offline + privacy.
5. **Backup contains PII** (plate, workshops, notes): the export screen says so.

## 16. Scalability Review (corrected) [R]

The Balanced model makes the top roadmap items **additive**, not rebuilds:

- **Multiple vehicles:** push another car into `cars[]`, switch `activeCarId`, add a
  selector — consumers already go through `select.js`, so calc/views don't change.
- **Cloud sync:** per-record `id`/`createdAt`/`updatedAt`/`deletedAt` already exist,
  so last-write-wins + tombstones are possible without a migration.
- **Time-based rules:** interval values are already objects; add `timeMonths` and
  compute `min(kmDue, dateDue)` — `calc.js` already receives `today`.
- **Photos (deferred):** honestly flagged — binaries need IndexedDB, not the JSON
  blob. `store.js`'s storage-agnostic interface eases this, but it remains a real
  addition (a blob store + bundle backup), **not** claimed as free.

## 17. Risk Assessment (re-rated) [R]

| Risk | Severity | Mitigation |
|---|---|---|
| SW staleness → stuck on old version | **High** | Content-hash version, skipWaiting + reload, cache cleanup (§11b) |
| Passive iOS storage eviction (~7 days) | **High** | Install-to-home-screen guidance, `storage.persist()`, prominent backup + nudges |
| User clears storage / new device | High | First-class backup/restore, snapshot before restore |
| High/low odometer typo poisons predictions | High | Bidirectional, date-aware guard; outlier-aware current km; excludable reading |
| Bad/hostile import wipes or attacks app | High | Transactional validate-before-commit; envelope + allow-list + `__proto__` strip; CSP |
| localStorage quota (single blob) | **Medium** | Temp-key swap; keep change in memory; prompt backup |
| Stored XSS via user text | Medium | `textContent`-only + grep gate + CSP |
| Corrupt JSON / failed migration | Low | Load empty + offer restore; keep pre-upgrade copy |

## 18. Edge Cases

Empty/first-run (no NaN — stats show "—"); item never logged and no anchor →
actionable "add your last <job>"; unknown-odometer entries excluded; odometer
disagreeing with its date neighbours warns (not blocks); future-dated service warns;
duplicate-looking entry softly flagged; long notes truncated on card, full in
detail; restore confirms + snapshots first; double-submit prevented.

## 19. MVP Scope

Everything in §9 "In". Single car (multi-ready). Distance predictions + time
caption. Used-car anchors. Installable + offline. Prominent backup/restore.
Light/dark. English only.

## 20. Future Roadmap (architecture-ready)

Multiple vehicles → time-based rules → editable intervals UI → CSV/PDF/printable
report → photos (IndexedDB) → cloud sync → fuel/tire/warranty/registration/
inspection → VIN/OBD → AI insights → analytics.

## 21. Decisions Log

1. Right-sized process.
2. Light + dark, light default. *(resolved a brief contradiction)*
3. One entry per visit, multiple job tags.
4. Current mileage = highest odometer on record (now outlier-aware). **[R]**
5. Distance-only predictions **+ soft time caption**. **[D]**
6. Backup/restore included, made first-class on the home screen. **[R]**
7. Minimal car profile.
8. `rem-money` build recipe (JS kept same-origin, not inlined, for CSP). **[R]**
9. Currency AED editable; clean modular split; English only.
10. **Balanced future-proofing:** car-nested model, UUIDs + timestamps + soft
    delete, object intervals, `select.js`/`schema.js`. **[D]**
11. **Used-car "last done before logging" anchors.** **[D]**
12. Accessibility, transactional restore, PWA update strategy, CSP, and the full
    minor list — adopted from the adversarial review. **[R]**

## Build Sequence (verifiable steps)

1. **Skeleton + design tokens (accessible) + storage + PWA shell** → confirm it
   opens, installs on a phone, works offline, and updates cleanly on redeploy
   (package early per build-cadence rule).
2. **Add/edit/delete (undo) + service detail + timeline** → confirm persistence
   and accessible sheets.
3. **Prediction engine + Next-due (icon+text status) + anchors** — with `calc.js`
   tests (out-of-order, typos, empty, ties, anchor fallback).
4. **Search, filters, stats** (guarded maths).
5. **Transactional backup/restore + storage.persist + nudges + polish + deploy
   workflow.**

Each step verified in a real browser (and on a phone for install/offline) before
the next.
