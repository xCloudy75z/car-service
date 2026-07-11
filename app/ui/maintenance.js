// Maintenance tab: one prediction row per PREDICTED job, plus used-car anchors.
// `maintenanceRows(car)` is a PURE data helper (no clock, no DOM) — the renderer
// turns those rows into DOM via the shared `el` helper (textContent only, zero innerHTML).

import { JOBS, DEFAULT_INTERVALS } from "../schema.js";
import { predict, currentKm } from "../calc.js";
import { el, statusInfo } from "./render.js";

const fmtN = (n) => Math.round(Number(n)).toLocaleString("en-US");

const intervalFor = (car, tag) =>
  (car.intervals && car.intervals[tag]) || DEFAULT_INTERVALS[tag] || null;

// Ordered rows [{ tag, label, icon, p, caption }] for every predicted job,
// sorted overdue → soon → ok → none (same order map as render.js dueStrip).
// `caption` is set whenever the interval carries a `timeHintMonths` hint, else null.
export function maintenanceRows(car) {
  const order = { over: 0, soon: 1, ok: 2, none: 3 };
  return Object.keys(JOBS)
    .filter((t) => JOBS[t].predicted)
    .map((tag) => {
      const p = predict(car, tag);
      const hint = p.timeHintMonths;
      const caption =
        typeof hint === "number"
          ? `also due by time (~every ${hint} months) — check your manual`
          : null;
      return { tag, label: JOBS[tag].label, icon: JOBS[tag].icon, p, caption };
    })
    .sort((a, b) => order[a.p.status] - order[b.p.status]);
}

// The "✓ OK" style pill — built exactly like render.js: an aria-hidden mark span
// then a space + the word. Colour comes from the status class on the parent .mrow.
function statusPill(s) {
  return el("span", { class: "st" }, [
    el("span", { attrs: { "aria-hidden": "true" }, text: s.mark }),
    document.createTextNode(" " + s.word)
  ]);
}

function anchorButton(label, tag, onSetAnchor) {
  return el(
    "button",
    { class: "mini", attrs: { type: "button" }, on: { click: () => onSetAnchor && onSetAnchor(tag) } },
    label
  );
}

function maintenanceCard(car, row, onSetAnchor) {
  const { tag, label, icon, p, caption } = row;
  const s = statusInfo(p);

  const card = el("article", {
    class: "mrow " + s.cls,
    attrs: { "aria-label": `${label}: ${s.aria}` }
  });

  card.appendChild(
    el("div", { class: "h" }, [
      el("span", { class: "ico", attrs: { "aria-hidden": "true" }, text: icon }),
      el("span", { class: "nm", text: label }),
      statusPill(s)
    ])
  );

  if (p.status !== "none") {
    const fill = el("i", { attrs: { style: `width:${Math.round(p.pct * 100)}%` } });
    card.appendChild(el("div", { class: "bar", attrs: { "aria-hidden": "true" } }, [fill]));

    const km = intervalFor(car, tag);
    const everyTxt = km && typeof km.km === "number" ? `every ${fmtN(km.km)} km` : "";
    card.appendChild(
      el("div", { class: "meta" }, [
        el("span", { text: `${s.word} · ${s.sub}` }),
        el("span", { text: everyTxt })
      ])
    );
  } else {
    card.appendChild(el("div", { class: "anchor", text: "No history yet" }));
    card.appendChild(anchorButton("Set last done", tag, onSetAnchor));
  }

  // A prediction that came from a used-car anchor: note it + let the user edit it.
  if (p.anchor) {
    card.appendChild(el("div", { class: "anchor", text: "↳ from a ‘before I started logging’ anchor" }));
    card.appendChild(anchorButton("Edit anchor", tag, onSetAnchor));
  }

  if (caption) {
    card.appendChild(
      el("div", { class: "cap" }, [
        el("span", { attrs: { "aria-hidden": "true" }, text: "⏱ " }),
        document.createTextNode(caption)
      ])
    );
  }

  return card;
}

// renderMaintenance(car, { onSetAnchor }) → DOM node for the Maintenance tab.
export function renderMaintenance(car, { onSetAnchor } = {}) {
  const wrap = el("div", { class: "maint" });
  const cur = currentKm(car);

  wrap.appendChild(el("h1", { class: "mtitle", text: "Maintenance" }));
  wrap.appendChild(
    el("p", { class: "msub" }, [
      document.createTextNode("Based on current mileage "),
      el("b", { class: "mono", text: (cur > 0 ? fmtN(cur) : "—") + " km" }),
      document.createTextNode(" — from your latest entry.")
    ])
  );

  for (const row of maintenanceRows(car)) {
    wrap.appendChild(maintenanceCard(car, row, onSetAnchor));
  }

  wrap.appendChild(
    el("p", {
      class: "tiny faint",
      attrs: { style: "text-align:center;margin-top:6px" },
      text: "Predictions use only services logged here. Add a “last done” anchor for a used car."
    })
  );
  return wrap;
}
