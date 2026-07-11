// Maintenance tab: one prediction row per PREDICTED job, plus used-car anchors.
// `maintenanceRows(car)` is a PURE data helper (no clock, no DOM) — the renderer
// turns those rows into DOM via the shared `el` helper (textContent only, zero innerHTML).

import { predict, currentKm, predictedKeys, intervalFor } from "../calc.js";
import { jobMeta } from "../select.js";
import { el, statusInfo, compareJobRows } from "./render.js";

const fmtN = (n) => Math.round(Number(n)).toLocaleString("en-US");

// Ordered rows [{ tag, label, icon, p, caption }] for every job this car
// predicts (keys in car.intervals), sorted overdue → soon → ok → none with the
// stable canonical tiebreak (built-ins in JOBS order, then customs by label).
// `caption` is set whenever the interval carries a `timeHintMonths` hint, else null.
export function maintenanceRows(car) {
  return predictedKeys(car)
    .map((tag) => {
      const p = predict(car, tag);
      const { label, icon } = jobMeta(car, tag);
      const hint = p.timeHintMonths;
      const caption =
        typeof hint === "number"
          ? `also due by time (~every ${hint} months) — check your manual`
          : null;
      return { tag, label, icon, p, caption, status: p.status };
    })
    .sort(compareJobRows);
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

  const rows = maintenanceRows(car);
  if (rows.length === 0) {
    wrap.appendChild(
      el("div", { class: "empty" }, [
        el("div", { class: "empty-ic", attrs: { "aria-hidden": "true" }, text: "🧰" }),
        el("p", { text: "No predicted items yet — add intervals in Settings." })
      ])
    );
  }
  for (const row of rows) {
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
