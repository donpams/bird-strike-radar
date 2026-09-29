// Shareable state in the URL hash, e.g.  #m=dec&a=KDEN&v=raw
// Theme stays a per-viewer preference and is not put in links.
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function readHash() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const m = MONTH_KEYS.indexOf((p.get("m") || "").toLowerCase());
  const a = (p.get("a") || "").toUpperCase();
  const v = p.get("v");
  return {
    month: m >= 0 ? m : null,
    airport: /^[A-Z0-9]{3,4}$/.test(a) ? a : null,
    mode: v === "raw" ? "raw" : v === "est" ? "estimated" : null,
  };
}

export function writeHash({ month, airport, mode }) {
  const p = new URLSearchParams();
  p.set("m", MONTH_KEYS[month]);
  if (airport) p.set("a", airport);
  if (mode === "raw") p.set("v", "raw");
  const next = `#${p.toString()}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
}
