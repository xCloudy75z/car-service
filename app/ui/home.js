// Home / History view: car header + Next-due strip + service timeline.
// Returns a DocumentFragment; the controller (app.js) mounts it into #app.

import { el, carHeader, dueStrip, timeline } from "./render.js";
import { activeEntries } from "../select.js";

// handlers: { onGear(), onEdit(id), onDelete(id) }
export function renderHome(car, currency, handlers) {
  const frag = document.createDocumentFragment();
  frag.appendChild(carHeader(car, currency, handlers.onGear));
  frag.appendChild(el("h2", { class: "slab", text: "Next due" }));
  frag.appendChild(dueStrip(car));
  frag.appendChild(el("h2", { class: "slab", text: "Service history" }));
  frag.appendChild(timeline(activeEntries(car), currency, handlers));
  return frag;
}
