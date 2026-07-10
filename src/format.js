// Pure formatting helpers. No Date.now()/Math.random().

// The single audited HTML escape helper. Used wherever a string must land in markup.
export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const fmtKm = (n) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toLocaleString("en-US")} km`;

export const fmtMoney = (n, label = "AED") => {
  if (n == null || !Number.isFinite(Number(n))) return `${label} —`;
  return `${label} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtDate = (iso) => (typeof iso === "string" && iso.length > 0 ? iso : "—");
