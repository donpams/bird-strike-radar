// Mission Planner maths. Pure functions (no React, no DOM) so they can be unit tested with
// `npm test`. Every number here comes from the published model estimates in radar.json.
//
// For a plan of N operations (each take-off or landing = 1) at airport a in month m:
//   expected damaging strikes      = rate[a, m] * N / 10,000
//   chance of at least one         = 1 - exp(-expected)               (Poisson approximation)
//   chance of >= 1 of severity k   = 1 - exp(-expected * share_k)
// and the MIL-STD-882E probability level is read from that chance using the same Appendix A
// thresholds as the map, but with the plan itself as the exposure. 882E asks the analyst to
// define the exposure; the map uses 10,000 operations, the planner uses your plan.

export const PROB_THRESHOLDS = [
  ["A", 1e-1],
  ["B", 1e-2],
  ["C", 1e-3],
  ["D", 1e-6],
];
export const probLevel = (p) => (PROB_THRESHOLDS.find(([, t]) => p >= t) || ["E"])[0];

const RISK_ORDER = ["High", "Serious", "Medium", "Low"];
export const worstRisk = (risks) => RISK_ORDER.find((r) => risks.includes(r));

export const atLeastOne = (expected) => -Math.expm1(-expected); // accurate for tiny values

// Expected count and chance of at least one, at the estimate and at both ends of its 90% interval
export function planOutcome(monthRec, ops) {
  const k = ops / 1e4;
  const exp = { mean: monthRec.r * k, lo: monthRec.lo * k, hi: monthRec.hi * k };
  return {
    expected: exp,
    pAny: { mean: atLeastOne(exp.mean), lo: atLeastOne(exp.lo), hi: atLeastOne(exp.hi) },
  };
}

// 882E cells for the plan: one probability level per severity column, plus the overall risk
export function planMatrix(rate, ops, severity, matrix) {
  const expected = (rate * ops) / 1e4;
  const levels = severity.map((s) => probLevel(atLeastOne(expected * s.share)));
  const risks = levels.map((L, j) => matrix[L][j]);
  return { levels, risk: worstRisk(risks), pBySeverity: severity.map((s) => atLeastOne(expected * s.share)) };
}

// "About 1 in N": for communicating small probabilities
export function oneIn(p) {
  if (!(p > 0)) return null;
  const n = 1 / p;
  if (n < 1.5) return null;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag; // two significant figures
}

// Two estimates are only "clearly different" if their 90% intervals don't overlap
export const clearlyDifferent = (a, b) => a.hi < b.lo || b.hi < a.lo;

// Same airport, same plan, every month: which months are clearly better or worse?
export function monthOptions(airport, month) {
  const cur = airport.m[month];
  return airport.m.map((rec, i) => ({
    month: i,
    rate: rec.r,
    change: rec.r / cur.r - 1,
    clear: i !== month && clearlyDifferent(rec, cur),
  }));
}

const R_KM = 6371;
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

// Nearby study airports in the same month, lowest estimated rate first
export function nearbyOptions(airports, airport, month, radiusKm = 250, limit = 4) {
  const cur = airport.m[month];
  return airports
    .filter((a) => a.icao !== airport.icao)
    .map((a) => ({ airport: a, km: distanceKm(airport, a), rec: a.m[month] }))
    .filter((o) => o.km <= radiusKm)
    .sort((x, y) => x.rec.r - y.rec.r)
    .slice(0, limit)
    .map((o) => ({ ...o, change: o.rec.r / cur.r - 1, clear: clearlyDifferent(o.rec, cur) }));
}

export const OPS_PRESETS = [
  { ops: 2, label: "1 round trip" },
  { ops: 60, label: "30 round trips" },
  { ops: 1000, label: "1,000 ops" },
  { ops: 10000, label: "10,000 ops" },
];
export const MAX_OPS = 1_000_000;
export const clampOps = (v) => Math.min(MAX_OPS, Math.max(1, Math.round(Number(v) || 0)));
