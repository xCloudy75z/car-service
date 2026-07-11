// Pure-ish DOM builders. Every user-derived string lands via textContent /
// createTextNode — never innerHTML — so injection is impossible by construction.

import { JOBS } from "../schema.js";
import { predict, currentKm, predictedKeys } from "../calc.js";
import { jobMeta } from "../select.js";
import { fmtKm, fmtMoney, fmtDate } from "../format.js";

// Tiny element helper. `children` may be nodes or strings (→ text nodes).
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text; // safe: textContent
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, String(v));
    }
  }
  if (opts.on) for (const [ev, fn] of Object.entries(opts.on)) node.addEventListener(ev, fn);
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// ---- Inline SVG icons (crisp + perfectly centered, unlike emoji glyphs) ----
const SVGNS = "http://www.w3.org/2000/svg";
function svgNode(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}
function iconSvg(children) {
  const s = svgNode("svg", {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.9", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
  });
  for (const c of children) s.appendChild(c);
  return s;
}
function gearIcon() {
  return iconSvg([
    svgNode("circle", { cx: 12, cy: 12, r: 3 }),
    svgNode("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
  ]);
}

const fmtN = (n) => Math.round(Number(n)).toLocaleString("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateNice(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return fmtDate(iso);
  const [y, m, d] = iso.split("-");
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}

// Stable job ordering shared by the Next-due strip and the Maintenance tab:
// first by status (over→soon→ok→none), then a canonical index — built-ins in
// JOBS order, then custom jobs by label. Items expose { tag, label, status }.
const JOB_KEYS = Object.keys(JOBS);
const STATUS_ORDER = { over: 0, soon: 1, ok: 2, none: 3 };
export function compareJobRows(a, b) {
  const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (so !== 0) return so;
  const ai = JOB_KEYS.indexOf(a.tag);
  const bi = JOB_KEYS.indexOf(b.tag);
  const aBuiltin = ai !== -1;
  const bBuiltin = bi !== -1;
  if (aBuiltin && bBuiltin) return ai - bi;
  if (aBuiltin) return -1; // built-ins before customs
  if (bBuiltin) return 1;
  return String(a.label).localeCompare(String(b.label)); // customs by label
}

// Icon + words + machine-readable aria text for a prediction result.
export function statusInfo(p) {
  if (p.status === "over") {
    const over = fmtN(-p.remaining);
    return { cls: "s-over", mark: "!", word: "Overdue", sub: `${over} km over`, aria: `Overdue by ${over} kilometres` };
  }
  if (p.status === "soon") {
    const rem = fmtN(p.remaining);
    return { cls: "s-soon", mark: "▲", word: "Due soon", sub: `in ${rem} km`, aria: `Due soon, in ${rem} kilometres` };
  }
  if (p.status === "ok") {
    const rem = fmtN(p.remaining);
    return { cls: "s-ok", mark: "✓", word: "OK", sub: `in ${rem} km`, aria: `OK, next in ${rem} kilometres` };
  }
  return { cls: "s-none", mark: "○", word: "Not logged", sub: "add to predict", aria: "Not logged yet" };
}

// Build the "✓ OK" style pill (visible mark hidden from AT; full meaning on parent aria-label).
function statusPill(s) {
  return el("span", { class: "st" }, [
    el("span", { attrs: { "aria-hidden": "true" }, text: s.mark }),
    document.createTextNode(" " + s.word)
  ]);
}

// carHeader(car, currency, onGear, onSwitch?, carCount?)
// When carCount > 1, the car name becomes a SEPARATE pill button (sibling of the
// gear — never nested) that opens the car switcher. With one car it's a plain
// heading, so single-car users see exactly the same header as before.
export function carHeader(car, currency, onGear, onSwitch, carCount = 1) {
  const p = car.profile || {};
  const nick = p.name && String(p.name).trim() ? String(p.name).trim() : "My Garage";

  const parts = [p.year, p.make, p.model]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).trim());
  let sub = parts.join(" ");
  if (p.plate && String(p.plate).trim()) sub = sub ? `${sub} · ${String(p.plate).trim()}` : String(p.plate).trim();
  if (!sub) sub = "Tap the gear to add your car details";

  const nameNode =
    carCount > 1 && typeof onSwitch === "function"
      ? el(
          "button",
          {
            class: "nick nick-switch",
            attrs: { type: "button", "aria-label": `Switch car — current: ${nick}` },
            on: { click: onSwitch }
          },
          [
            el("span", { class: "nick-name", text: nick }),
            el("span", { class: "nick-chev", attrs: { "aria-hidden": "true" }, text: "▾" })
          ]
        )
      : el("div", { class: "nick", text: nick });

  const cur = currentKm(car);
  return el("section", { class: "carhead", attrs: { "aria-label": "Vehicle summary" } }, [
    el("button", { class: "gear", attrs: { type: "button", "aria-label": "Settings" }, on: { click: onGear } }, [gearIcon()]),
    nameNode,
    el("div", { class: "mm", text: sub }),
    el("div", { class: "odo" }, [
      el("span", { class: "odo-v mono", text: cur > 0 ? fmtN(cur) : "—" }),
      el("span", { class: "odo-k", text: "km · current" })
    ])
  ]);
}

// Horizontal strip of this car's predicted jobs (keys in car.intervals),
// sorted overdue → soon → ok → none with the stable canonical tiebreak.
// When the car predicts nothing, renders an explicit empty-state node.
export function dueStrip(car) {
  const items = predictedKeys(car)
    .map((tag) => {
      const { label, icon } = jobMeta(car, tag);
      const p = predict(car, tag);
      return { tag, label, icon, p, status: p.status };
    })
    .sort(compareJobRows);

  const strip = el("div", { class: "strip", attrs: { role: "list", "aria-label": "Upcoming maintenance" } });
  if (items.length === 0) {
    strip.classList.add("strip-empty");
    strip.appendChild(
      el("div", { class: "due-empty", attrs: { role: "listitem" }, text: "No predicted items yet — add intervals in Settings." })
    );
    return strip;
  }
  for (const { label, icon, p } of items) {
    const s = statusInfo(p);
    strip.appendChild(
      el("div", { class: "due " + s.cls, attrs: { role: "listitem", "aria-label": `${label}: ${s.aria}` } }, [
        el("div", { class: "due-ico", attrs: { "aria-hidden": "true" }, text: icon }),
        el("div", { class: "due-nm", text: label }),
        statusPill(s),
        el("div", { class: "due-sub", attrs: { "aria-hidden": "true" }, text: s.sub })
      ])
    );
  }
  return strip;
}

function jobsRow(tags, car) {
  return el(
    "div",
    { class: "jobs" },
    (tags || []).map((t) => {
      const { label, icon } = jobMeta(car, t);
      return el("span", { class: "jtag" }, [
        el("span", { attrs: { "aria-hidden": "true" }, text: icon + " " }),
        document.createTextNode(label)
      ]);
    })
  );
}

const dot = () => el("span", { class: "dot", attrs: { "aria-hidden": "true" } });

// One expandable service card. handlers: { onEdit(id), onDelete(id) }.
// `car` resolves job labels/icons so custom items render their real names.
export function entryCard(entry, currency, handlers, car) {
  const detailId = "detail-" + String(entry.id);
  const tagLabels = (entry.tags || []).map((t) => jobMeta(car, t).label).join(" · ") || "Service";

  const summary = el(
    "button",
    { class: "entry-summary", attrs: { type: "button", "aria-expanded": "false", "aria-controls": detailId } },
    [
      el("div", { class: "r1" }, [
        el("span", { class: "tagline", text: tagLabels }),
        el("span", { class: "cost mono", text: fmtMoney(entry.cost, currency) })
      ]),
      el("div", { class: "r2" }, [
        el("span", { class: "mono", text: entry.odometer != null ? fmtKm(entry.odometer) : "no odometer" }),
        dot(),
        el("span", { text: fmtDateNice(entry.date) }),
        dot(),
        el("span", { text: entry.workshop && entry.workshop.trim() ? entry.workshop.trim() : "—" })
      ]),
      jobsRow(entry.tags, car)
    ]
  );

  const detail = el("div", { class: "entry-detail", attrs: { id: detailId, hidden: true } });
  if (entry.notes && entry.notes.trim()) {
    detail.appendChild(
      el("div", { class: "notes" }, [
        el("span", { attrs: { "aria-hidden": "true" }, text: "📝 " }),
        document.createTextNode(entry.notes.trim())
      ])
    );
  }
  detail.appendChild(
    el("div", { class: "actions" }, [
      el("button", { class: "mini", attrs: { type: "button" }, on: { click: () => handlers.onEdit(entry.id) } }, "Edit"),
      el("button", { class: "mini del", attrs: { type: "button" }, on: { click: () => handlers.onDelete(entry.id) } }, "Delete")
    ])
  );

  const card = el("article", { class: "entry" }, [summary, detail]);
  summary.addEventListener("click", () => {
    const open = card.classList.toggle("open");
    summary.setAttribute("aria-expanded", open ? "true" : "false");
    detail.hidden = !open;
  });
  return card;
}

// Full timeline (sorted newest first) or a friendly empty state.
// `car` is threaded to entryCard so custom-job labels resolve on each card.
export function timeline(entries, currency, handlers, car) {
  const wrap = el("div", { class: "timeline" });
  if (!entries || entries.length === 0) {
    wrap.appendChild(
      el("div", { class: "empty" }, [
        el("div", { class: "empty-ic", attrs: { "aria-hidden": "true" }, text: "🗒️" }),
        el("p", { text: "No services yet — tap + to add your first." })
      ])
    );
    return wrap;
  }
  const list = entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const e of list) wrap.appendChild(entryCard(e, currency, handlers, car));
  return wrap;
}

export function placeholder(title, msg, icon) {
  return el("div", { class: "placeholder" }, [
    el("div", { class: "ph-ic", attrs: { "aria-hidden": "true" }, text: icon }),
    el("h1", { class: "ph-title", text: title }),
    el("p", { class: "ph-msg", text: msg })
  ]);
}
