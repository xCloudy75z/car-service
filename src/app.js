// Bootstrap + wiring. Owns the current tab, re-renders from store state on every
// change (calc is always recomputed — no cached derived values), and drives the
// Add/Edit and Settings dialogs.

import { createStore } from "./store.js";
import { getActiveCar, activeEntries, allJobs } from "./select.js";
import { JOBS, DEFAULT_INTERVALS } from "./schema.js";
import { validateEntry, coerceNumber, safeJsonParse } from "./validate.js";
import { currentKm } from "./calc.js";
import { fmtKm } from "./format.js";
import { el } from "./ui/render.js";
import { renderHome } from "./ui/home.js";
import { renderMaintenance } from "./ui/maintenance.js";
import { renderInsights } from "./ui/insights.js";
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
  // Keep the tabpanel labelled by whichever tab is active (ARIA tab pattern).
  app.setAttribute("aria-labelledby", "tab-" + currentTab);

  const fab = document.getElementById("fab");
  fab.hidden = currentTab !== "history";

  if (currentTab === "history") {
    const needsBackup = !(state.settings && state.settings.lastBackupAt) && activeEntries(car).length > 0;
    app.appendChild(
      renderHome(car, currency(), {
        onGear: openSettings,
        onSwitch: openCarSwitcher,
        carCount: state.cars.length,
        onEdit: (id) => openAdd(id),
        onDelete,
        needsBackup,
        onNudge: openSettings
      })
    );
  } else if (currentTab === "due") {
    app.appendChild(renderMaintenance(car, { onSetAnchor: openAnchor }));
  } else {
    app.appendChild(renderInsights(car, currency(), todayISO()));
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

// ---- Used-car anchor sheet -------------------------------------------------

function openAnchor(tag) {
  const car = getActiveCar(store.getState());
  const existing = (car.baselines && car.baselines[tag]) || null;
  const job = JOBS[tag] || { label: tag };

  openSheet({
    title: "Last done — " + job.label,
    initialFocus: "#f-anchor-odo",
    render(body, ctl) {
      const odoEl = el("input", {
        attrs: {
          inputmode: "numeric", id: "f-anchor-odo", placeholder: "e.g. 60000",
          value: existing && existing.odometer != null ? String(existing.odometer) : ""
        }
      });
      const dateEl = el("input", {
        attrs: { type: "date", id: "f-anchor-date", value: existing && existing.date ? existing.date : "" }
      });

      const saveBtn = el("button", {
        class: "btn btn-primary", attrs: { type: "button", style: "margin-top:18px" }, text: "Save"
      });
      function save() {
        const v = coerceNumber(odoEl.value);
        if (!Number.isFinite(v) || v < 0) {
          toast("Enter the odometer reading from when this was last done.", { type: "error" });
          return;
        }
        store.setBaseline(tag, { odometer: v, date: dateEl.value.trim() === "" ? undefined : dateEl.value });
        if (store.lastError) {
          toast("Couldn't save that anchor — please try again.", { type: "error" });
          return;
        }
        ctl.close();
        render();
        toast("Saved");
      }
      saveBtn.addEventListener("click", save);

      body.append(
        el("p", {
          class: "tiny faint", attrs: { style: "margin:2px 2px 4px" },
          text: "For a used car: roughly when was this last done? We predict from here until you log a real service."
        }),
        field("Odometer when last done (km)", odoEl),
        field("Date", dateEl, "optional"),
        saveBtn
      );

      if (existing) {
        const clearBtn = el("button", {
          class: "btn btn-lite", attrs: { type: "button", style: "margin-top:10px" }, text: "Clear anchor"
        });
        clearBtn.addEventListener("click", () => {
          store.clearBaseline(tag);
          if (store.lastError) {
            toast("Couldn't clear that anchor — please try again.", { type: "error" });
            return;
          }
          ctl.close();
          render();
          toast("Anchor cleared");
        });
        body.appendChild(clearBtn);
      }
    }
  });
}

// ---- Backup & restore ------------------------------------------------------

// Human relative time for the "Last backed up" line. Clock lives in app.js.
function backupStatus(iso) {
  if (!iso) return "Never backed up yet";
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "Never backed up yet";
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(then)) / 86400000);
  if (days <= 0) return "Last backed up: today";
  if (days === 1) return "Last backed up: yesterday";
  if (days < 30) return `Last backed up: ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Last backed up: ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `Last backed up: ${years} year${years === 1 ? "" : "s"} ago`;
}

// Serialise the current state into a downloaded JSON file. A blob/object URL +
// a[download] is a user-initiated download, not a network request (CSP-safe).
function downloadBackup() {
  const env = store.exportBackup();
  let url = null;
  try {
    const json = JSON.stringify(env, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    url = URL.createObjectURL(blob);
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const fname = `car-service-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Backup saved · check your downloads");
  } catch (_) {
    toast("Couldn't create the backup file. Please try again.", { type: "error" });
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

// Read a user-picked file, parse it defensively, preview it, then confirm.
function restoreFromFile(file) {
  const reader = new FileReader();
  reader.onerror = () => toast("Couldn't read that file. Please try again.", { type: "error" });
  reader.onload = () => {
    let parsed;
    try {
      parsed = safeJsonParse(reader.result);
    } catch (_) {
      toast("That file isn't valid JSON — pick a Car Service backup.", { type: "error" });
      return;
    }
    const preview = store.previewImport(parsed);
    if (!preview.ok) {
      toast(preview.error || "That backup can't be restored.", { type: "error" });
      return;
    }
    confirmRestore(parsed, preview.entryCount);
  };
  reader.readAsText(file);
}

// Confirmation dialog before we replace the user's live data.
function confirmRestore(parsed, entryCount) {
  const n = entryCount === 1 ? "1 service" : `${entryCount} services`;
  openSheet({
    title: "Restore from backup?",
    render(body, ctl) {
      const warn = el("p", { class: "tiny faint", attrs: { style: "margin:2px 2px 14px" },
        text: `This will replace your current data with this backup (${n}). Your current data is snapshotted, so you can undo right after.` });

      const confirm = el("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "Replace my data" });
      confirm.addEventListener("click", () => {
        const res = store.commitImport(parsed);
        ctl.close();
        if (!res.ok) {
          toast(res.error || "Restore failed — your data is unchanged.", { type: "error" });
          return;
        }
        currentTab = "history";
        render();
        undoToast("Data restored — Undo", () => {
          store.undoRestore();
          render();
          toast("Restore undone — your previous data is back.");
        });
      });

      const cancel = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:10px" }, text: "Cancel" });
      cancel.addEventListener("click", () => ctl.close());

      body.append(warn, confirm, cancel);
    }
  });
}

// ---- Cars: switcher + profile form -----------------------------------------

// Display helpers shared by the switcher rows and the Garage list.
function carName(car) {
  const p = (car && car.profile) || {};
  return p.name && String(p.name).trim() ? String(p.name).trim() : "Unnamed car";
}
function carMakeModel(car) {
  const p = (car && car.profile) || {};
  return (
    [p.year, p.make, p.model].filter((x) => x != null && String(x).trim() !== "").map(String).join(" ") || "—"
  );
}

// Car switcher dialog — one <button> per car, active row marked aria-current + ✓,
// disambiguated by make/model/plate/current km. Picking one switches + re-renders,
// then moves focus to the rebuilt header switch pill.
function openCarSwitcher() {
  const state = store.getState();

  openSheet({
    title: "Your cars",
    render(body, ctl) {
      for (const c of state.cars) {
        const active = c.id === state.activeCarId;
        const p = c.profile || {};
        const bits = [carMakeModel(c)];
        if (p.plate && String(p.plate).trim()) bits.push(String(p.plate).trim());
        bits.push(fmtKm(currentKm(c)));
        const sub = bits.filter((x) => x && x !== "—").join(" · ") || "No details yet";

        const row = el("button", {
          class: "carpick" + (active ? " active" : ""),
          attrs: { type: "button", ...(active ? { "aria-current": "true" } : {}) }
        }, [
          el("div", { class: "cp-top" }, [
            el("span", { class: "cp-name", text: carName(c) }),
            active ? el("span", { class: "cp-tick", attrs: { "aria-hidden": "true" }, text: "✓" }) : null
          ]),
          el("div", { class: "cp-sub", text: sub })
        ]);
        row.addEventListener("click", () => {
          store.switchCar(c.id);
          if (store.lastError) {
            toast("Couldn't switch cars — please try again.", { type: "error" });
            return;
          }
          ctl.close();
          currentTab = "history";
          render();
          // Focus the freshly-built control (the detached trigger the sheet would
          // otherwise restore to is gone after render()).
          const pill = document.querySelector(".carhead .nick-switch") || document.querySelector(".carhead .gear");
          if (pill) pill.focus();
        });
        body.appendChild(row);
      }

      const addBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:14px" }, text: "＋ Add car" });
      addBtn.addEventListener("click", () => {
        ctl.close();
        openCarForm();
      });
      body.appendChild(addBtn);
    }
  });
}

// Add / edit a car profile. `id` omitted → add mode (new car becomes active).
// `afterSave` runs once the save closes+re-renders (used to reopen Settings).
function openCarForm(id, afterSave) {
  const editing = id ? store.getState().cars.find((c) => c.id === id) : null;
  const p = (editing && editing.profile) || {};

  openSheet({
    title: editing ? "Edit car" : "Add car",
    initialFocus: "#f-car-name",
    render(body, ctl) {
      const nameEl = el("input", { attrs: { id: "f-car-name", placeholder: "e.g. Daily / Land Cruiser", value: p.name || "" } });
      const makeEl = el("input", { attrs: { id: "f-car-make", placeholder: "e.g. Toyota", value: p.make || "" } });
      const modelEl = el("input", { attrs: { id: "f-car-model", placeholder: "e.g. Corolla", value: p.model || "" } });
      const yearEl = el("input", { attrs: { inputmode: "numeric", id: "f-car-year", placeholder: "e.g. 2019", value: p.year != null ? String(p.year) : "" } });
      const plateEl = el("input", { attrs: { id: "f-car-plate", placeholder: "e.g. A 12345", value: p.plate || "" } });

      const saveBtn = el("button", { class: "btn btn-primary", attrs: { type: "button", style: "margin-top:18px" },
        text: editing ? "Save changes" : "Add car" });

      function save() {
        const values = {
          name: nameEl.value,
          make: makeEl.value,
          model: modelEl.value,
          year: yearEl.value,
          plate: plateEl.value
        };
        if (editing) store.updateCarProfile(editing.id, values);
        else store.addCar(values);

        if (store.lastError) {
          toast("Storage is full — couldn't save this car. Free some space or back up, then try again.", { type: "error" });
          return;
        }

        ctl.close();
        currentTab = "history";
        render();
        toast(editing ? "Car updated" : "Car added");
        if (typeof afterSave === "function") afterSave();
      }
      saveBtn.addEventListener("click", save);

      body.append(
        field("Name", nameEl, "optional"),
        el("div", { class: "row" }, [field("Make", makeEl), field("Model", modelEl)]),
        el("div", { class: "row" }, [field("Year", yearEl, "optional"), field("Plate", plateEl, "optional")]),
        saveBtn
      );
    }
  });
}

// ---- Settings sheet (garage + backup) --------------------------------------

function profileRow(name, value) {
  return el("div", { class: "setrow" }, [
    el("div", { class: "l" }, [
      el("div", { class: "n", text: name }),
      el("div", { class: "d", text: value })
    ])
  ]);
}

// One car row in the Garage list: name (+ active badge) · make/model, Edit, Delete.
// Delete is hidden when only one car remains. `ctl`/`body` let sub-actions rebuild
// the Settings body in place from fresh state (never a stale car).
function garageRow(car, ctl, body) {
  const state = store.getState();
  const active = car.id === state.activeCarId;

  const nameLine = el("div", { class: "n" }, [
    document.createTextNode(carName(car)),
    active ? el("span", { class: "badge-active", text: "Active" }) : null
  ]);
  const left = el("div", { class: "l" }, [nameLine, el("div", { class: "d", text: carMakeModel(car) })]);

  const editBtn = el("button", { class: "mini", attrs: { type: "button" }, text: "Edit" });
  editBtn.addEventListener("click", () => openCarForm(car.id, openSettings));
  const acts = el("div", { class: "gactions" }, [editBtn]);

  if (state.cars.length > 1) {
    const delBtn = el("button", { class: "mini del", attrs: { type: "button" }, text: "Delete" });
    delBtn.addEventListener("click", () => renderDeleteCarConfirm(body, ctl, car.id));
    acts.appendChild(delBtn);
  }

  return el("div", { class: "garagerow" }, [left, acts]);
}

// Inline delete-confirm rendered INTO the Settings body (keeps one sheet, so we
// can rebuild the garage list in place). Shows the service count and, if the user
// has never backed up and the car has history, an extra escalation line.
function renderDeleteCarConfirm(body, ctl, id) {
  const state = store.getState();
  const car = state.cars.find((c) => c.id === id);
  if (!car) { renderSettingsBody(body, ctl); return; }

  const count = activeEntries(car).length;
  const svc = count === 1 ? "1 service" : `${count} services`;
  const neverBackedUp = !((state.settings && state.settings.lastBackupAt)) && count > 0;

  body.replaceChildren();

  const confirmBtn = el("button", { class: "btn btn-danger", attrs: { type: "button", style: "margin-top:16px" }, text: "Delete this car" });
  confirmBtn.addEventListener("click", () => {
    store.deleteCar(id);
    if (store.lastError) {
      toast("Couldn't delete that car — please try again.", { type: "error" });
      renderSettingsBody(body, ctl);
      return;
    }
    render(); // active car may have changed
    renderSettingsBody(body, ctl); // rebuild garage list from fresh state
    undoToast("Car deleted", () => {
      store.undoLast();
      render();
      if (store.lastError) toast("Couldn't restore that car — please try again.", { type: "error" });
      else if (body.isConnected) renderSettingsBody(body, ctl);
    });
  });

  const cancelBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:10px" }, text: "Keep this car" });
  cancelBtn.addEventListener("click", () => renderSettingsBody(body, ctl));

  body.append(
    ...[
      el("h2", { class: "slab", text: "Delete car" }),
      el("p", { attrs: { style: "margin:2px 2px 4px;font-weight:600" }, text: `Delete “${carName(car)}”?` }),
      el("p", { class: "tiny muted", attrs: { style: "margin:0 2px 4px" }, text: `This car has ${svc}.` }),
      neverBackedUp
        ? el("div", { class: "warn", attrs: { role: "status", style: "margin-top:10px" } }, [
            el("span", { attrs: { "aria-hidden": "true" }, text: "⚠️ " }),
            document.createTextNode("This can't be undone and you've never backed up — back up first?")
          ])
        : null,
      confirmBtn,
      cancelBtn
    ].filter(Boolean)  // native append() stringifies null → "null"; drop the empty escalation slot
  );

  cancelBtn.focus();
}

// ---- Service intervals editor (active car) ---------------------------------

// One stacked card per job: icon + label on top; on a second line a km field
// (revealed only when the job predicts) and a real role="switch" toggle. The
// toggle is a live reflection of interval PRESENCE — a job is ON iff it has an
// interval. Turning it ON only *arms* the card (reveals + focuses the km field);
// nothing is persisted until a valid km commits, so we never write a NaN row or
// desync the toggle from stored state.
function intervalCard(car, key, meta, body, ctl) {
  const hasInterval = !!(car.intervals && car.intervals[key]);
  const kmVal = hasInterval ? car.intervals[key].km : null;
  const defKm = DEFAULT_INTERVALS[key] ? DEFAULT_INTERVALS[key].km : null;

  const kmInput = el("input", {
    class: "intv-km-input mono",
    attrs: {
      type: "text", inputmode: "numeric", autocomplete: "off",
      "aria-label": "Distance in km for " + meta.label,
      value: kmVal != null ? String(kmVal) : "",
      placeholder: defKm != null ? String(defKm) : "e.g. 30000"
    }
  });
  const kmWrap = el("div", { class: "intv-km" }, [
    kmInput,
    el("span", { class: "intv-unit", attrs: { "aria-hidden": "true" }, text: "km" })
  ]);
  kmWrap.hidden = !hasInterval;

  const toggle = el("button", {
    class: "switch",
    attrs: {
      type: "button", role: "switch",
      "aria-checked": hasInterval ? "true" : "false",
      "aria-label": "Predict " + meta.label
    }
  }, [el("span", { class: "switch-knob", attrs: { "aria-hidden": "true" } })]);

  const hint = el("div", { class: "intv-warn", attrs: { role: "status", hidden: true } });

  // `armed` = toggle flipped ON but not yet persisted (awaiting a valid km).
  let armed = false;
  // `cancelGuard` = the km blur was caused by pressing THIS card's toggle to turn
  // it off; skip the blur-commit so the click can revert cleanly (no accidental save).
  let cancelGuard = false;

  const setChecked = (on) => toggle.setAttribute("aria-checked", on ? "true" : "false");
  const showHint = (msg) => { hint.textContent = msg; hint.hidden = false; };
  const clearHint = () => { hint.hidden = true; };
  const INVALID = "Enter a distance in km, like 10000.";

  // After any persisted change: re-render the app (Next-due / Maintenance reflect
  // it) AND rebuild the Settings body from fresh state so the editor is never
  // stale. Scroll position is preserved so editing deep in the list doesn't jump.
  function rerenderAll() {
    render();
    const sc = body.scrollTop;
    renderSettingsBody(body, ctl);
    body.scrollTop = sc;
  }

  toggle.addEventListener("mousedown", () => {
    // Only guard when this press will turn an ON toggle off (the cancel case).
    if (toggle.getAttribute("aria-checked") === "true") cancelGuard = true;
  });

  toggle.addEventListener("click", () => {
    const isOn = toggle.getAttribute("aria-checked") === "true";
    if (isOn) {
      if (armed) {
        // Was only armed (never persisted) → revert UI, nothing to remove.
        armed = false;
        setChecked(false);
        kmWrap.hidden = true;
        clearHint();
      } else {
        store.removeInterval(key);
        if (store.lastError) { toast("Couldn't turn that off — please try again.", { type: "error" }); return; }
        rerenderAll();
      }
    } else {
      // Arm: reveal + prefill the built-in default (if any) + focus. Not persisted yet.
      armed = true;
      setChecked(true);
      clearHint();
      kmWrap.hidden = false;
      if (kmInput.value.trim() === "" && defKm != null) kmInput.value = String(defKm);
      kmInput.focus();
      kmInput.select();
    }
    cancelGuard = false;
  });

  kmInput.addEventListener("input", () => {
    const raw = kmInput.value.trim();
    if (raw === "") { clearHint(); return; }
    const v = coerceNumber(kmInput.value);
    if (Number.isFinite(v) && v > 0) clearHint();
    else showHint(INVALID);
  });

  kmInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); kmInput.blur(); }
  });

  kmInput.addEventListener("blur", () => {
    if (cancelGuard) { cancelGuard = false; return; }
    const v = coerceNumber(kmInput.value);
    const valid = Number.isFinite(v) && v > 0;
    if (armed) {
      if (!valid) {
        // Empty/invalid on an armed card → keep it OFF (no NaN row, no desync).
        armed = false;
        setChecked(false);
        kmWrap.hidden = true;
        clearHint();
        return;
      }
      store.setInterval(key, Math.round(v));
      if (store.lastError) { toast("Couldn't save that distance — please try again.", { type: "error" }); return; }
      armed = false;
      rerenderAll();
    } else if (hasInterval) {
      // Editing the km of an already-ON job.
      if (!valid) { showHint(INVALID); return; } // don't write bad data
      if (Math.round(v) === kmVal) { clearHint(); return; } // unchanged — skip write
      store.setInterval(key, Math.round(v)); // MERGES → preserves a time caption (e.g. brake_fluid)
      if (store.lastError) { toast("Couldn't save that distance — please try again.", { type: "error" }); return; }
      rerenderAll();
    }
  });

  const head = el("div", { class: "intv-head" }, [
    el("span", { class: "intv-ico", attrs: { "aria-hidden": "true" }, text: meta.icon }),
    el("span", { class: "intv-label", text: meta.label })
  ]);
  const ctlRow = el("div", { class: "intv-ctl" }, [kmWrap, toggle]);

  return el("div", { class: "intv-card" }, [head, ctlRow, hint]);
}

// The whole Service intervals section: grouped stacked cards (Built-in / Custom —
// only Built-in has entries in 6b, but the grouping is written so 6c custom items
// slot straight in) plus a "Reset to defaults" button.
function renderIntervalsSection(body, ctl) {
  const car = getActiveCar(store.getState());
  const jobs = allJobs(car);
  const keys = Object.keys(jobs);
  const wrap = el("div", { class: "intervals" });

  function group(headingText, groupKeys) {
    if (groupKeys.length === 0) return;
    wrap.appendChild(el("div", { class: "intv-group", text: headingText }));
    for (const key of groupKeys) wrap.appendChild(intervalCard(car, key, jobs[key], body, ctl));
  }
  group("Built-in", keys.filter((k) => jobs[k].builtin));
  group("Custom", keys.filter((k) => !jobs[k].builtin));

  const resetBtn = el("button", {
    class: "btn btn-lite", attrs: { type: "button", style: "margin-top:12px" }, text: "Reset to defaults"
  });
  resetBtn.addEventListener("click", () => renderResetIntervalsConfirm(body, ctl));
  wrap.appendChild(resetBtn);

  return wrap;
}

// Inline confirm (rendered INTO the Settings body, like the delete-car confirm)
// before resetting the active car's distances to the defaults.
function renderResetIntervalsConfirm(body, ctl) {
  body.replaceChildren();

  const confirmBtn = el("button", { class: "btn btn-danger", attrs: { type: "button", style: "margin-top:16px" }, text: "Reset to defaults" });
  confirmBtn.addEventListener("click", () => {
    store.resetIntervals();
    if (store.lastError) {
      toast("Couldn't reset — please try again.", { type: "error" });
      renderSettingsBody(body, ctl);
      return;
    }
    render();
    renderSettingsBody(body, ctl);
    toast("Distances reset to defaults");
  });

  const cancelBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:10px" }, text: "Keep my distances" });
  cancelBtn.addEventListener("click", () => renderSettingsBody(body, ctl));

  body.append(
    el("h2", { class: "slab", text: "Reset intervals" }),
    el("p", { attrs: { style: "margin:2px 2px 4px;font-weight:600" }, text: "Reset all distances to the defaults?" }),
    el("p", { class: "tiny muted", attrs: { style: "margin:0 2px 4px" }, text: "Your custom items are kept but stop predicting until you re-add a distance." }),
    confirmBtn,
    cancelBtn
  );

  cancelBtn.focus();
}

// Rebuildable Settings body — always reads fresh state, so a rebuild after any
// garage mutation (delete/undo) can never show or write a stale car.
function renderSettingsBody(body, ctl) {
  const state = store.getState();
  body.replaceChildren();

  const lastAt = (state.settings && state.settings.lastBackupAt) || null;
  const backup = el("div", { class: "backup" }, [
    el("div", { class: "ic", attrs: { "aria-hidden": "true" }, text: "🛟" }),
    el("div", { attrs: { style: "flex:1" } }, [
      el("div", { attrs: { style: "font-weight:700;font-size:14px" }, text: "Keep a safe copy" }),
      el("div", { class: "tiny muted backup-status", text: backupStatus(lastAt) }),
      el("div", { class: "tiny faint", attrs: { style: "margin-top:3px" },
        text: "Your backup file contains your car details, workshops and notes — keep it private." })
    ])
  ]);

  const backupBtn = el("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "Back up now" });
  backupBtn.addEventListener("click", () => {
    downloadBackup();
    const s = backup.querySelector(".backup-status");
    if (s) s.textContent = backupStatus((store.getState().settings || {}).lastBackupAt);
  });

  // Hidden file input drives "Restore from file".
  const fileInput = el("input", {
    attrs: { type: "file", accept: "application/json,.json", style: "display:none", "aria-hidden": "true", tabindex: "-1" }
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) restoreFromFile(f);
    fileInput.value = ""; // allow re-picking the same file
  });
  const restoreBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:10px" }, text: "Restore from file" });
  restoreBtn.addEventListener("click", () => fileInput.click());

  // Your Garage — every car, with Edit + (unless it's the last car) Delete.
  const garage = el("div", { class: "garage" });
  for (const c of state.cars) garage.appendChild(garageRow(c, ctl, body));

  const addCarBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:12px" }, text: "＋ Add car" });
  addCarBtn.addEventListener("click", () => openCarForm(undefined, openSettings));

  const updateBtn = el("button", { class: "btn btn-lite", attrs: { type: "button", style: "margin-top:12px" }, text: "Check for updates" });
  updateBtn.addEventListener("click", checkForUpdates);

  body.append(
    backup,
    backupBtn,
    restoreBtn,
    fileInput,
    el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "Your Garage" }),
    garage,
    addCarBtn,
    el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "Service intervals" }),
    renderIntervalsSection(body, ctl),
    el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "Preferences" }),
    profileRow("Currency", currency()),
    el("h2", { class: "slab", attrs: { style: "margin-top:20px" }, text: "App" }),
    profileRow("Version", versionLabel()),
    updateBtn
  );
}

function openSettings() {
  openSheet({
    title: "Settings",
    render(body, ctl) {
      renderSettingsBody(body, ctl);
    }
  });
}

// ---- Boot ------------------------------------------------------------------

function boot() {
  store.load();
  document.getElementById("fab").addEventListener("click", () => openAdd());
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((btn) =>
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      render();
    })
  );
  // Roving Left/Right/Home/End moves between tabs (ARIA tablist keyboard support).
  const tablist = document.querySelector(".tabbar");
  if (tablist) {
    tablist.addEventListener("keydown", (e) => {
      const idx = tabs.findIndex((t) => t.dataset.tab === currentTab);
      if (idx < 0) return;
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next == null) return;
      e.preventDefault();
      currentTab = tabs[next].dataset.tab;
      render();
      tabs[next].focus();
    });
  }
  render();
  if (store.lastError) {
    toast("This browser is blocking local storage (private mode?). You can still use the app, but changes won't be saved.", { type: "error" });
  }
}

boot();
