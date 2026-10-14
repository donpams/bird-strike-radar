// Run with:  npm test   (Node's built-in test runner, no extra dependencies)
import assert from "node:assert/strict";
import test from "node:test";
import {
  atLeastOne, clampOps, clearlyDifferent, monthOptions, nearbyOptions, oneIn, planMatrix, planOutcome, probLevel,
} from "./planner.js";

const MATRIX = {
  A: ["High", "High", "Serious", "Medium"],
  B: ["High", "High", "Serious", "Medium"],
  C: ["High", "Serious", "Medium", "Low"],
  D: ["Serious", "Medium", "Medium", "Low"],
  E: ["Medium", "Medium", "Medium", "Low"],
};
const SEVERITY = [{ share: 0.00257 }, { share: 0.04307 }, { share: 0.25327 }, { share: 0.70109 }];

test("probability levels use the Appendix A thresholds", () => {
  assert.equal(probLevel(0.5), "A");
  assert.equal(probLevel(0.1), "A");
  assert.equal(probLevel(0.05), "B");
  assert.equal(probLevel(0.001), "C");
  assert.equal(probLevel(1e-5), "D");
  assert.equal(probLevel(1e-7), "E");
});

test("chance of at least one is accurate for tiny and large expectations", () => {
  assert.ok(Math.abs(atLeastOne(1e-9) - 1e-9) < 1e-15);
  assert.ok(Math.abs(atLeastOne(1) - (1 - Math.exp(-1))) < 1e-12);
});

test("plan outcome scales with operations and keeps the interval order", () => {
  const rec = { r: 0.1, lo: 0.05, hi: 0.2 };
  const o = planOutcome(rec, 10000);
  assert.ok(Math.abs(o.expected.mean - 0.1) < 1e-12);
  assert.ok(o.pAny.lo < o.pAny.mean && o.pAny.mean < o.pAny.hi);
  assert.ok(Math.abs(planOutcome(rec, 20000).expected.mean - 0.2) < 1e-12);
});

test("the same airport is lower risk for a small plan than per 10,000 operations", () => {
  const per10k = planMatrix(0.11, 10000, SEVERITY, MATRIX);
  const oneTrip = planMatrix(0.11, 2, SEVERITY, MATRIX);
  assert.equal(per10k.risk, "Serious"); // matches the map's typical airport-month
  assert.equal(oneTrip.risk, "Medium"); // catastrophic column drops to Improbable
  assert.deepEqual(oneTrip.levels, ["E", "E", "D", "D"]);
});

test("one-in-N rounds to two significant figures", () => {
  assert.equal(oneIn(0.001234), 810);
  assert.equal(oneIn(0.5), 2);
  assert.equal(oneIn(0.9), null);
  assert.equal(oneIn(0), null);
});

test("intervals must not overlap to count as clearly different", () => {
  assert.equal(clearlyDifferent({ lo: 1, hi: 2 }, { lo: 2.5, hi: 3 }), true);
  assert.equal(clearlyDifferent({ lo: 1, hi: 2.6 }, { lo: 2.5, hi: 3 }), false);
});

test("month options flag only clearly different months", () => {
  const airport = { m: Array.from({ length: 12 }, (_, i) => ({ r: i === 3 ? 0.5 : 0.1, lo: i === 3 ? 0.4 : 0.08, hi: i === 3 ? 0.6 : 0.12 })) };
  const opts = monthOptions(airport, 0);
  assert.equal(opts[3].clear, true);
  assert.equal(opts[5].clear, false);
  assert.equal(opts[0].clear, false); // never compare a month with itself
});

test("nearby options stay within the radius and sort by rate", () => {
  const rec = (r) => Array.from({ length: 12 }, () => ({ r, lo: r * 0.8, hi: r * 1.2 }));
  const home = { icao: "KAAA", lat: 40, lon: -100, m: rec(0.2) };
  const all = [
    home,
    { icao: "KNEAR", lat: 40.5, lon: -100, m: rec(0.3) },
    { icao: "KLOW", lat: 41, lon: -100.5, m: rec(0.05) },
    { icao: "KFAR", lat: 30, lon: -80, m: rec(0.01) },
  ];
  const near = nearbyOptions(all, home, 0);
  assert.deepEqual(near.map((o) => o.airport.icao), ["KLOW", "KNEAR"]);
  assert.equal(near[0].clear, true);
});

test("operations input is clamped to a sane range", () => {
  assert.equal(clampOps("abc"), 1);
  assert.equal(clampOps(-5), 1);
  assert.equal(clampOps(2.4), 2);
  assert.equal(clampOps(5e9), 1_000_000);
});

test("at 10,000 operations the planner agrees with the Python pipeline for every airport-month", async () => {
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(new URL("../public/data/radar.json", import.meta.url), "utf8"));
  let checked = 0;
  for (const a of data.airports) {
    for (const m of a.m) {
      const p = planMatrix(m.r, data.meta.exposureOps, data.severity, data.matrix);
      assert.equal(p.risk, m.risk, `${a.icao}: planner ${p.risk} vs pipeline ${m.risk}`);
      assert.deepEqual(p.levels, m.lv, `${a.icao}: levels differ`);
      checked++;
    }
  }
  assert.equal(checked, data.airports.length * 12);
});
