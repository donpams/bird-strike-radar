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

// ---------------------------------------------------------------------------------------
// Continuous version of the diverging scale, used so colours glide between months.
// Anchors sit at the centres of the bins above, on a log scale. Night mode uses brighter
// steps so the scale keeps its contrast against the dark basemap.
const ANCHORS = {
  light: [
    [0.35, [0x3f, 0x55, 0xc9]],
    [0.65, [0x8c, 0x98, 0xdf]],
    [1.0, [0xbd, 0xbc, 0xb5]],
    [1.55, [0xe0, 0x7b, 0x39]],
    [2.6, [0xd7, 0x30, 0x1f]],
  ],
  dark: [
    [0.35, [0x5b, 0x7c, 0xff]],
    [0.65, [0x86, 0x9c, 0xd8]],
    [1.0, [0x6f, 0x74, 0x7e]],
    [1.55, [0xff, 0x9a, 0x4a]],
    [2.6, [0xff, 0x4d, 0x3a]],
  ],
};
export const SCALE_MIN = 0.35;
export const SCALE_MAX = 2.6;

export function relColor(rel, theme = "light") {
  const anchors = ANCHORS[theme] || ANCHORS.light;
  if (rel == null || Number.isNaN(rel)) return theme === "dark" ? "#3a3f47" : "#dddcd6";
  const x = Math.min(Math.max(rel, SCALE_MIN), SCALE_MAX);
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a, ca] = anchors[i];
    const [b, cb] = anchors[i + 1];
    if (x <= b) {
      const f = (Math.log(x) - Math.log(a)) / (Math.log(b) - Math.log(a));
      const c = ca.map((v, k) => Math.round(v + (cb[k] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(${anchors[anchors.length - 1][1].join(",")})`;
}

// Position (0-1) of a relative rate along the legend bar
export const legendPos = (rel) =>
  (Math.log(rel) - Math.log(SCALE_MIN)) / (Math.log(SCALE_MAX) - Math.log(SCALE_MIN));

export const legendGradient = (theme = "light") =>
  `linear-gradient(90deg, ${(ANCHORS[theme] || ANCHORS.light)
    .map(([r, c]) => `rgb(${c.join(",")}) ${(legendPos(r) * 100).toFixed(1)}%`)
    .join(", ")})`;

// Interpolate between month i and i+1 (wrapping Dec -> Jan) in log space
export function lerpLog(a, b, f) {
  if (a == null || b == null || a <= 0 || b <= 0) return f < 0.5 ? a : b;
  return Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f);
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Stable pseudo-random phase per airport so they don't all breathe in sync
export function phaseOf(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}
