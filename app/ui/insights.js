// Insights tab: four stat tiles (from calc.stats) + a "Where the money went"
// cost-by-job breakdown (from calc.costByJob). textContent-only, zero innerHTML —
// mirrors the Maintenance tab's structure (title/sub + cards).

import { stats, costByJob } from "../calc.js";
import { jobMeta } from "../select.js";
import { fmtMoney } from "../format.js";
import { el } from "./render.js";

function statTile(k, v) {
  return el("div", { class: "stat" }, [
    el("div", { class: "k", text: k }),
    el("div", { class: "v mono", text: v })
  ]);
}

// renderInsights(car, currency, todayISO) → DOM node for the Insights tab.
export function renderInsights(car, currency, todayISO) {
  const wrap = el("div", { class: "insights" });
  wrap.appendChild(el("h1", { class: "mtitle", text: "Insights" }));
  wrap.appendChild(el("p", { class: "msub", text: "What this car has cost you so far." }));

  const s = stats(car, todayISO);
  wrap.appendChild(
    el("div", { class: "stats" }, [
      statTile("Total spent", fmtMoney(s.total, currency)),
      statTile("This year", fmtMoney(s.thisYear, currency)),
      statTile("Services", String(s.count)),
      statTile("Avg / year", s.avgPerYear == null ? "—" : fmtMoney(s.avgPerYear, currency))
    ])
  );

  wrap.appendChild(
    el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "Where the money went" })
  );

  const rows = costByJob(car);
  if (rows.length === 0) {
    wrap.appendChild(
      el("div", { class: "empty" }, [
        el("div", { class: "empty-ic", attrs: { "aria-hidden": "true" }, text: "💸" }),
        el("p", { text: "No spending logged yet — add a service with a cost to see the breakdown." })
      ])
    );
    return wrap;
  }

  const max = rows.reduce((m, r) => (r.total > m ? r.total : m), 0);
  const card = el("div", { class: "stat costs" });
  for (const r of rows) {
    const pct = max > 0 ? Math.round((r.total / max) * 100) : 0;
    const { label, icon } = jobMeta(car, r.tag);
    card.appendChild(
      el("div", { class: "cbrow", attrs: { "aria-label": `${label}: ${fmtMoney(r.total, currency)}` } }, [
        el("div", { class: "cbhead" }, [
          el("span", { class: "cbnm" }, [
            el("span", { attrs: { "aria-hidden": "true" }, text: icon + " " }),
            document.createTextNode(label)
          ]),
          el("span", { class: "cbamt mono", text: fmtMoney(r.total, currency) })
        ]),
        el("div", { class: "bar", attrs: { "aria-hidden": "true" } }, [
          el("i", { attrs: { style: `width:${pct}%` } })
        ])
      ])
    );
  }
  wrap.appendChild(card);
  return wrap;
}
