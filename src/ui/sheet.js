// Accessible slide-up dialog: role="dialog" + aria-modal, focus moves in,
// focus trap, Esc closes, focus returns to the trigger, background made inert.
// Only one sheet is open at a time.

let active = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (elm) => elm.offsetParent !== null || elm === document.activeElement
  );
}

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// openSheet({ title, render(bodyEl, ctl), onClose, initialFocus })
//   ctl = { close(), setTitle(text) }
export function openSheet({ title, render, onClose, initialFocus }) {
  closeSheet(); // enforce single sheet

  const appRoot = document.getElementById("app-root");
  const layer = document.getElementById("sheet-layer");
  const prevFocus = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";

  const panel = document.createElement("div");
  panel.className = "sheet";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const titleId = "sheet-title";
  const head = document.createElement("div");
  head.className = "sh-head";
  const h = document.createElement("h2");
  h.className = "sh-title";
  h.id = titleId;
  h.textContent = title; // safe
  const x = document.createElement("button");
  x.type = "button";
  x.className = "sh-x";
  x.setAttribute("aria-label", "Close");
  x.textContent = "✕";
  head.append(h, x);
  panel.setAttribute("aria-labelledby", titleId);

  const body = document.createElement("div");
  body.className = "sh-body";

  panel.append(head, body);
  backdrop.appendChild(panel);
  layer.appendChild(backdrop);

  const ctl = { close: () => closeSheet(), setTitle: (t) => { h.textContent = t; } };
  render(body, ctl);

  // Make the rest of the app inert while the dialog is open.
  if (appRoot) {
    appRoot.setAttribute("inert", "");
    appRoot.setAttribute("aria-hidden", "true");
  }

  requestAnimationFrame(() => {
    backdrop.classList.add("show");
    panel.classList.add("show");
  });

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
    } else if (e.key === "Tab") {
      const f = focusable(panel);
      if (f.length === 0) {
        e.preventDefault();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  function onBackdrop(e) {
    if (e.target === backdrop) closeSheet();
  }

  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", onBackdrop);
  x.addEventListener("click", () => closeSheet());

  const target = (initialFocus && panel.querySelector(initialFocus)) || focusable(panel)[0] || x;
  setTimeout(() => target && target.focus(), 60);

  active = { backdrop, panel, prevFocus, onKey, appRoot, onClose };
}

export function closeSheet() {
  if (!active) return;
  const a = active;
  active = null;

  document.removeEventListener("keydown", a.onKey, true);
  if (a.appRoot) {
    a.appRoot.removeAttribute("inert");
    a.appRoot.removeAttribute("aria-hidden");
  }
  a.backdrop.classList.remove("show");
  a.panel.classList.remove("show");

  const finish = () => {
    a.backdrop.remove();
    if (a.prevFocus && typeof a.prevFocus.focus === "function") a.prevFocus.focus();
    if (a.onClose) a.onClose();
  };

  if (prefersReducedMotion()) finish();
  else setTimeout(finish, 330);
}
