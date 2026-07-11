// Accessors so views/calc never read the raw state shape directly.
// This is what makes multi-vehicle additive later.

import { JOBS } from "./schema.js";

export const activeEntries = (car) => (car.entries || []).filter((e) => !e.deletedAt);

export const getActiveCar = (state) =>
  state.cars.find((c) => c.id === state.activeCarId) || state.cars[0];

// Pure text/tag filter for the History list. No clock, no DOM.
// Keeps an entry when: (no tag OR it carries `tag`) AND
// (no query OR the query is a case-insensitive substring of its workshop,
// notes, or any of its job labels resolved via JOBS).
export const filterEntries = (entries, { query = "", tag = null } = {}) => {
  const q = String(query || "").trim().toLowerCase();
  return (entries || []).filter((e) => {
    if (tag && !(Array.isArray(e.tags) && e.tags.includes(tag))) return false;
    if (!q) return true;
    const hay = [];
    if (e.workshop) hay.push(String(e.workshop));
    if (e.notes) hay.push(String(e.notes));
    for (const t of e.tags || []) hay.push(JOBS[t] ? JOBS[t].label : String(t));
    return hay.join("  ").toLowerCase().includes(q);
  });
};
