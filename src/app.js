// Bootstrap + wiring. Owns the current tab, re-renders from store state on every
// change (calc is always recomputed — no cached derived values), and drives the
// Add/Edit and Settings dialogs.

import { createStore } from "./store.js";
import { getActiveCar, activeEntries } from "./select.js";
import { JOBS } from "./schema.js";
import { validateEntry, coerceNumber } from "./validate.js";
import { currentKm } from "./calc.js";
import { el, placeholder } from "./ui/render.js";
import { renderHome } from "./ui/home.js";
import { openSheet } from "./ui/sheet.js";
import { toast, undoToast } from "./ui/toast.js";
import { BUILD } from "./build-info.js";

const store = createStore();
let currentTab = "history";

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fmtN = (n) => Math.round(Number(n)).toLocaleString("en-US");
const currency = () => store.getState().settings.currencyLabel || "AED";

// ---- Version + in-place update --------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtBuilt(iso) {
  if (!iso) return "dev build";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const versionLabel = () => `${String(BUILD.version || "dev").slice(0, 7)} · built ${fmtBuilt(BUILD.builtAt)}`;

// Force the service worker to fetch the newest build. If there is one, it installs,
// takes over, and register-sw.js reloads the page — no re-download, no re-install.
async function checkForUpdates() {
  if (!("serviceWorker" in navigator)) {
    toast("This browser has no in-place update — just reload the page.");
    return;
  }
  toast("Checking for updates…");
  let reg = null;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch (_) {}
  if (!reg) { toast("Not installed yet — reload the page to get the latest."); return; }
  try { await reg.update(); } catch (_) {}
  if (reg.installing || reg.waiting) {
    if (reg.waiting) reg.waiting.postMessage("skipWaiting");
    toast("New version found — updating…");
  } else {
    toast("You're on the latest version.");
  }
}

// ---- Rendering -------------------------------------------------------------

function render() {
  const state = store.getState();
  const car = getActiveCar(state);
  const app = document.getElementById("app");
  app.replaceChildren();

  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === currentTab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });

  const fab = document.getElementById("fab");
  fab.hidden = currentTab !== "history";

  if (currentTab === "history") {
    app.appendChild(
      renderHome(car, currency(), { onGear: openSettings, onEdit: (id) => openAdd(id), onDelete })
    );
  } else if (currentTab === "due") {
    app.appendChild(
      placeholder("Maintenance", "Full prediction rows with progress bars and time reminders are coming next.", "🔧")
    );
  } else {
    app.appendChild(
      placeholder("Insights", "Your spending trends and cost-by-job breakdown are coming next.", "📊")
    );
  }
}

// ---- Delete + undo ---------------------------------------------------------

function onDelete(id) {
  store.deleteEntry(id);
  render();
  if (store.lastError) {
    toast("Couldn't save that change — your history is safe in memory. Please back up soon.", { type: "error" });
    return;
  }
  undoToast("Service deleted", () => {
    store.updateEntry(id, { deletedAt: null });
    render();
    if (store.lastError) toast("Couldn't restore — please try again.", { type: "error" });
    else toast("Service restored");
  });
}

// ---- Add / Edit sheet ------------------------------------------------------

function odoWarning(rawValue, car, dateStr) {
  if (rawValue == null || String(rawValue).trim() === "") return null;
  const v = coerceNumber(rawValue);
  if (!Number.isFinite(v)) return null;
  const cur = currentKm(car);
  if (cur > 0 && v > cur + 50000) {
    return `That's a big jump from ${fmtN(cur)} km — double-check for a typo.`;
  }
  if (cur > 0 && v < cur) {
    // Date-aware: an older date with a lower reading is a normal back-dated receipt.
    const withOdo = activeEntries(car).filter((e) => typeof e.odometer === "number");
    const latest = withOdo.sort((a, b) => (b.odometer - a.odometer))[0];
    if (latest && dateStr && String(dateStr) < String(latest.date || "")) {
      return `Lower than your current ${fmtN(cur)} km, but this date is older — looks like a back-dated receipt, that's fine.`;
    }
    if (cur - v > 2000) {
      return `Lower than your current reading (${fmtN(cur)} km). Fine for an old receipt — just checking.`;
    }
  }
  return null;
}

function field(labelText, control, hintText) {
  const lab = el("label", {}, [
    document.createTextNode(labelText),
    hintText ? el("span", { class: "faint", attrs: { style: "font-weight:500" }, text: " · " + hintText }) : null
  ]);
  lab.appendChild(control);
  return lab;
}

function openAdd(id) {
  const car = getActiveCar(store.getState());
  const editing = id ? activeEntries(car).find((e) => e.id === id) : null;
  const picked = new Set(editing ? editing.tags : []);
  const cur = currentKm(car);

  openSheet({
    title: editing ? "Edit service" : "Add service",
    initialFocus: "#f-date",
    render(body, ctl) {
      const dateEl = el("input", { attrs: { type: "date", id: "f-date", value: editing ? editing.date : todayISO() } });
      const odoEl = el("input", {
        attrs: { inputmode: "numeric", id: "f-odo", placeholder: cur > 0 ? fmtN(cur) : "e.g. 60000",
          value: editing && editing.odometer != null ? String(editing.odometer) : "" }
      });
      const shopEl = el("input", { attrs: { id: "f-shop", placeholder: "e.g. Speedy Lube", value: editing ? editing.workshop : "" } });
      const costEl = el("input", { attrs: { inputmode: "decimal", id: "f-cost", placeholder: "0", value: editing ? String(editing.cost) : "" } });
      const notesEl = el("textarea", { attrs: { id: "f-notes", rows: "2", placeholder: "Anything worth remembering…" } });
      notesEl.value = editing ? editing.notes : "";

      const warn = el("div", { class: "warn", attrs: { role: "status", hidden: true } });
      function refreshWarn() {
        const msg = odoWarning(odoEl.value, car, dateEl.value);
        if (msg) {
          warn.replaceChildren(
            el("span", { attrs: { "aria-hidden": "true" }, text: "⚠️ " }),
            document.createTextNode(msg)
          );
          warn.hidden = false;
        } else {
          warn.hidden = true;
        }
      }
      odoEl.addEventListener("input", refreshWarn);
      dateEl.addEventListener("change", refreshWarn);

      const jobpick = el("div", { class: "jobpick" });
      for (const t of Object.keys(JOBS)) {
        const chip = el("button", {
          class: "jp",
          attrs: { type: "button", "aria-pressed": picked.has(t) ? "true" : "false", "data-t": t }
        }, [
          el("span", { attrs: { "aria-hidden": "true" }, text: JOBS[t].icon + " " }),
          document.createTextNode(JOBS[t].label)
        ]);
        chip.addEventListener("click", () => {
          if (picked.has(t)) picked.delete(t);
          else picked.add(t);
          chip.setAttribute("aria-pressed", picked.has(t) ? "true" : "false");
        });
        jobpick.appendChild(chip);
      }

      const saveBtn = el("button", { class: "btn btn-primary", attrs: { type: "button", style: "margin-top:18px" },
        text: editing ? "Save changes" : "Save service" });

      function save() {
        const input = {
          date: dateEl.value,
          odometer: odoEl.value.trim() === "" ? null : odoEl.value,
          workshop: shopEl.value,
          cost: costEl.value,
          tags: [...picked],
          notes: notesEl.value
        };
        const res = validateEntry(input);
        if (!res.ok) {
          const first = res.errors.date || res.errors.odometer || res.errors.cost || "Please check the form.";
          toast(first, { type: "error" });
          return;
        }
        if (picked.size === 0) {
          toast("Tick at least one job so predictions know what was done.", { type: "error" });
          return;
        }

        if (editing) store.updateEntry(editing.id, res.value);
        else store.addEntry(res.value);

        if (store.lastError) {
          // Keep the sheet + form data so the user can retry after freeing space.
          toast("Storage is full — couldn't save. Your entry is still here; free some space or back up, then try again.", { type: "error" });
          return;
        }

        ctl.close();
        currentTab = "history";
        render();
        toast(editing ? "Changes saved" : "Service saved · predictions updated");
      }
      saveBtn.addEventListener("click", save);

      body.append(
        el("div", { class: "row" }, [field("Date", dateEl), field("Odometer (km)", odoEl, "optional")]),
        warn,
        el("div", { class: "row" }, [field("Workshop", shopEl), field("Cost (" + currency() + ")", costEl)]),
        field("What was done?", jobpick, "tick all that apply"),
        field("Notes", notesEl, "optional"),
        saveBtn
      );
      if (!editing) {
        body.appendChild(
          el("p", { class: "tiny faint", attrs: { style: "text-align:center;margin-top:10px" },
            text: "Ticking a job resets its “next due” clock automatically." })
        );
      }
    }
  });
}

// ---- Settings sheet (read-only profile + backup stub) ----------------------

function profileRow(name, value) {
  return el("div", { class: "setrow" }, [
    el("div", { class: "l" }, [
      el("div", { class: "n", text: name }),
      el("div", { class: "d", text: value })
    ])
  ]);
}

function openSettings() {
  const state = store.getState();
  const car = getActiveCar(state);
  const p = car.profile || {};

  openSheet({
    title: "Settings",
    render(body) {
      const backup = el("div", { class: "backup" }, [
        el("div", { class: "ic", attrs: { "aria-hidden": "true" }, text: "🛟" }),
        el("div", { attrs: { style: "flex:1" } }, [
          el("div", { attrs: { style: "font-weight:700;font-size:14px" }, text: "Everything is saved on this device" }),
          el("div", { class: "tiny muted", text: "Backup & restore arrives in a later update." })
        ])
      ]);
      const backupBtn = el("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "Back up now" });
      backupBtn.addEventListener("click", () => toast("Backup & restore is coming in a later update."));

      const name = p.name && String(p.name).trim() ? String(p.name).trim() : "Not named yet";
      const makeModel = [p.year, p.make, p.model].filter((x) => x != null && String(x).trim() !== "").map(String).join(" ") || "—";
      const plate = p.plate && String(p.plate).trim() ? String(p.plate).trim() : "—";

      const updateBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:12px" }, text: "Check for updates" });
      updateBtn.addEventListener("click", checkForUpdates);

      body.append(
        backup,
        backupBtn,
        el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "Car profile" }),
        profileRow(name, makeModel),
        profileRow("Plate", plate),
        profileRow("Currency", currency()),
        el("p", { class: "tiny faint", attrs: { style: "text-align:center;margin-top:16px" },
          text: "Editing your car profile arrives in a later update." }),
        el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "App" }),
        profileRow("Version", versionLabel()),
        updateBtn
      );
    }
  });
}

// ---- Boot ------------------------------------------------------------------

function boot() {
  store.load();
  document.getElementById("fab").addEventListener("click", () => openAdd());
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      render();
    })
  );
  render();
  if (store.lastError) {
    toast("This browser is blocking local storage (private mode?). You can still use the app, but changes won't be saved.", { type: "error" });
  }
}

boot();
