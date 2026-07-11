// Home / History view: car header + Next-due strip + search/filters + timeline.
// Returns a DocumentFragment; the controller (app.js) mounts it into #app.
//
// Search + chip filtering are handled LOCALLY here: on input/chip change we
// rebuild ONLY the list container (never the app-level render()), so the search
// caret is never lost mid-typing and the header / Next-due strip stay put.

import { el, carHeader, dueStrip, timeline } from "./render.js";
import { activeEntries, filterEntries } from "../select.js";
import { JOBS } from "../schema.js";

const jobLabel = (t) => (JOBS[t] ? JOBS[t].label : t);
const jobIcon = (t) => (JOBS[t] ? JOBS[t].icon : "🔧");

// Distinct "no search match" state (visually separate from the first-run empty).
function noMatch() {
  return el("div", { class: "empty no-match" }, [
    el("div", { class: "empty-ic", attrs: { "aria-hidden": "true" }, text: "🔍" }),
    el("p", { text: "No services match — try a different word or tap “All”." })
  ]);
}

// Gentle, non-modal "you haven't backed up" reminder. Tapping it opens Settings.
function backupNudge(onNudge) {
  return el("button", {
    class: "nudge",
    attrs: { type: "button", "aria-label": "Not backed up yet — open Settings to keep a safe copy" }
  }, [
    el("span", { class: "nudge-ic", attrs: { "aria-hidden": "true" }, text: "🛟" }),
    el("span", { class: "nudge-tx", text: "Not backed up yet — keep a safe copy" }),
    el("span", { class: "nudge-go", attrs: { "aria-hidden": "true" }, text: "›" })
  ]);
}

// handlers: { onGear(), onEdit(id), onDelete(id), needsBackup?, onNudge?() }
export function renderHome(car, currency, handlers) {
  const frag = document.createDocumentFragment();
  frag.appendChild(carHeader(car, currency, handlers.onGear));
  if (handlers.needsBackup && typeof handlers.onNudge === "function") {
    const nudge = backupNudge();
    nudge.addEventListener("click", handlers.onNudge);
    frag.appendChild(nudge);
  }
  frag.appendChild(el("h2", { class: "slab", text: "Next due" }));
  frag.appendChild(dueStrip(car));
  frag.appendChild(el("h2", { class: "slab", text: "Service history" }));

  const all = activeEntries(car);

  // Local view state — lives only for this mounted view (app.render() rebuilds fresh).
  let query = "";
  let tag = null;

  const listHost = el("div", { class: "list-host" });
  const live = el("div", { class: "sr-only", attrs: { role: "status", "aria-live": "polite" } });

  // Only show search + chips once there's something to search.
  if (all.length > 0) {
    const search = el("input", {
      class: "search",
      attrs: {
        type: "search", id: "hist-search", autocomplete: "off",
        placeholder: "Search workshop, notes, job…", "aria-label": "Search services"
      }
    });
    search.addEventListener("input", () => { query = search.value; refresh(); });

    const chips = el("div", { class: "chips", attrs: { role: "group", "aria-label": "Filter by job" } });
    const chipEls = [];

    function syncChips() {
      for (const { node, value } of chipEls) {
        const on = tag === value;
        node.classList.toggle("on", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    function addChip(value, children) {
      const on = tag === value;
      const node = el("button", {
        class: "chip" + (on ? " on" : ""),
        attrs: { type: "button", "aria-pressed": on ? "true" : "false" }
      }, children);
      node.addEventListener("click", () => {
        tag = tag === value ? null : value;   // tapping an active chip clears it
        syncChips();
        refresh();
      });
      chipEls.push({ node, value });
      chips.appendChild(node);
    }

    addChip(null, "All");
    for (const t of Object.keys(JOBS)) {
      if (!all.some((e) => Array.isArray(e.tags) && e.tags.includes(t))) continue;
      addChip(t, [
        el("span", { attrs: { "aria-hidden": "true" }, text: jobIcon(t) + " " }),
        document.createTextNode(jobLabel(t))
      ]);
    }

    frag.appendChild(search);
    frag.appendChild(chips);
  }

  // Rebuild ONLY the list node. Called on every input/chip change.
  function refresh() {
    if (all.length === 0) {
      listHost.replaceChildren(timeline([], currency, handlers)); // first-run empty state
      return;
    }
    const filtered = filterEntries(all, { query, tag });
    if (filtered.length === 0) {
      listHost.replaceChildren(noMatch());
      live.textContent = "No services match your search.";
    } else {
      listHost.replaceChildren(timeline(filtered, currency, handlers));
      live.textContent = `${filtered.length} service${filtered.length === 1 ? "" : "s"} shown.`;
    }
  }

  frag.appendChild(live);
  frag.appendChild(listHost);
  refresh(); // runs while frag is still detached → no spurious live announcement on first paint
  return frag;
}
