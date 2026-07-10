// Pure prediction + stats engine.
// Never calls Date.now()/Math.random(); receives `todayISO` where "now" is needed.

import { DEFAULT_INTERVALS, dueSoonKm } from "./schema.js";
import { activeEntries } from "./select.js";

const hasNumericOdo = (e) => typeof e.odometer === "number" && Number.isFinite(e.odometer);

// Highest odometer among non-deleted entries with a numeric odometer; else 0.
export function currentKm(car) {
  const ents = activeEntries(car).filter(hasNumericOdo);
  if (ents.length === 0) return 0;
  return ents.reduce((max, e) => (e.odometer > max ? e.odometer : max), -Infinity);
}

// The non-deleted entry carrying `tag` with the highest odometer,
// tie-broken by (later date, then id). Falls back to the car's baseline
// anchor (marked anchor:true); else null.
export function lastDone(car, tag) {
  const ents = activeEntries(car).filter(
    (e) => Array.isArray(e.tags) && e.tags.includes(tag) && hasNumericOdo(e)
  );
  if (ents.length > 0) {
    ents.sort((a, b) => {
      if (b.odometer !== a.odometer) return b.odometer - a.odometer; // highest odo first
      const ad = a.date || "";
      const bd = b.date || "";
      if (ad !== bd) return ad < bd ? 1 : -1; // later date first
      return String(a.id) < String(b.id) ? 1 : -1; // higher id first (deterministic)
    });
    return ents[0];
  }
  const base = car.baselines && car.baselines[tag];
  if (base && typeof base.odometer === "number" && Number.isFinite(base.odometer)) {
    return { odometer: base.odometer, date: base.date || null, id: `baseline:${tag}`, anchor: true };
  }
  return null;
}

const intervalFor = (car, tag) =>
  (car.intervals && car.intervals[tag]) || DEFAULT_INTERVALS[tag] || null;

// { status:'ok'|'soon'|'over'|'none', remaining, nextDue, pct, anchor, timeHintMonths }
export function predict(car, tag) {
  const interval = intervalFor(car, tag);
  const timeHintMonths = (interval && typeof interval.timeHintMonths === "number") ? interval.timeHintMonths : null;
  const ld = lastDone(car, tag);

  if (!ld || !interval || typeof interval.km !== "number") {
    return { status: "none", remaining: null, nextDue: null, pct: null, anchor: false, timeHintMonths };
  }

  const nextDue = ld.odometer + interval.km;
  const cur = currentKm(car);
  const remaining = nextDue - cur;
  const threshold = dueSoonKm(interval.km);

  let status;
  if (remaining < 0) status = "over";
  else if (remaining <= threshold) status = "soon";
  else status = "ok";

  const used = interval.km - remaining; // = cur - ld.odometer
  let pct = interval.km > 0 ? used / interval.km : 0;
  if (!Number.isFinite(pct)) pct = 0;
  pct = Math.max(0, Math.min(1, pct));

  return { status, remaining, nextDue, pct, anchor: !!ld.anchor, timeHintMonths };
}

const numCost = (e) => (typeof e.cost === "number" && Number.isFinite(e.cost) ? e.cost : 0);
const DAY_MS = 86400000;

// { total, thisYear, count, avgPerYear|null } — never NaN/Infinity.
export function stats(car, todayISO) {
  const ents = activeEntries(car);
  const count = ents.length;
  const total = ents.reduce((s, e) => s + numCost(e), 0);

  const year = String(todayISO || "").slice(0, 4);
  const thisYear = ents.reduce(
    (s, e) => s + (typeof e.date === "string" && e.date.slice(0, 4) === year ? numCost(e) : 0),
    0
  );

  let avgPerYear = null;
  if (count >= 1) {
    const times = ents
      .filter((e) => typeof e.date === "string")
      .map((e) => Date.parse(e.date))
      .filter((t) => Number.isFinite(t));
    if (times.length >= 1) {
      const spanDays = (Math.max(...times) - Math.min(...times)) / DAY_MS;
      if (spanDays >= 1) {
        const denom = Math.max(1, spanDays / 365.25);
        avgPerYear = total / denom;
      }
    }
  }

  return { total, thisYear, count, avgPerYear };
}
