// Colour and formatting rules shared by the map, legend, panel and table.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Diverging scale on "rate relative to the national rate for the same month".
// Two warm steps above, a neutral grey around 1x, two cool steps below.
export const BINS = [
  { min: 2, label: "2x or more", color: "#d7301f" },
  { min: 1.25, label: "1.25-2x", color: "#e07b39" },
  { min: 0.8, label: "About national", color: "#bdbcb5" },
  { min: 0.5, label: "0.5-0.8x", color: "#8f9ae0" },
  { min: 0, label: "Under 0.5x", color: "#4f5fcf" },
];

export function binColor(rel) {
  if (rel == null || Number.isNaN(rel)) return "#dddcd6";
  return BINS.find((b) => rel >= b.min).color;
}

// MIL-STD-882E risk level colours (match the matrix)
export const RISK_COLORS = {
  High: "#d7301f",
  Serious: "#e07b39",
  Medium: "#5b6bd6",
  Low: "#c9cdf2",
};

export const SEVERITY_NAMES = ["Catastrophic", "Critical", "Marginal", "Negligible"];
export const LEVELS = ["A", "B", "C", "D", "E"];

export const fmtRate = (x) => (x == null ? "n/a" : x < 0.1 ? x.toFixed(3) : x.toFixed(2));
export const fmtRel = (x) => (x == null ? "n/a" : `${x < 1 ? x.toFixed(2) : x.toFixed(1)}x`);
export const fmtInt = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));

// "Distinguishable" = the whole 90% interval sits above or below the national rate.
export const isDistinct = (m) => m.rlo > 1 || m.rhi < 1;

export function rawRelative(m, nationalRate) {
  return nationalRate > 0 ? m.raw / nationalRate : null;
}
