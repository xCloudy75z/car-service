// Toast + undo. Success announces politely and auto-dismisses; errors announce
// assertively and stay until dismissed (so the user never misses a failed write).
// The two live-region hosts live outside #app-root (see index.html) so they keep
// announcing even when a modal sheet makes the background inert.

let timer = null;
let currentEl = null;

function host(type) {
  return document.getElementById(type === "error" ? "toast-assertive" : "toast-polite");
}

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// toast(message, { type: 'success'|'error', duration, action:{label,onClick} })
export function toast(message, opts = {}) {
  const type = opts.type || "success";
  const duration = opts.duration != null ? opts.duration : type === "error" ? 0 : 2600;

  dismiss();

  const card = document.createElement("div");
  card.className = "toast" + (type === "error" ? " toast-error" : "");

  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message; // safe
  card.appendChild(msg);

  if (opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => {
      dismiss();
      opts.action.onClick();
    });
    card.appendChild(b);
  } else if (type === "error") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = "Dismiss";
    b.addEventListener("click", () => dismiss());
    card.appendChild(b);
  }

  host(type).appendChild(card);
  currentEl = card;
  requestAnimationFrame(() => card.classList.add("show"));

  if (duration > 0) timer = setTimeout(() => dismiss(), duration);
  return card;
}

// Delete confirmation with a 6-second window to undo.
export function undoToast(message, onUndo, duration = 6000) {
  return toast(message, { type: "success", duration, action: { label: "Undo", onClick: onUndo } });
}

export function dismiss() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!currentEl) return;
  const elm = currentEl;
  currentEl = null;
  elm.classList.remove("show");
  if (prefersReducedMotion()) elm.remove();
  else setTimeout(() => elm.remove(), 250);
}
