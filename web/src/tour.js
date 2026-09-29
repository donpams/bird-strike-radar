// Guided tour. Every stop is chosen by a rule applied to the data, never a hard-coded airport,
// so the tour stays honest when the model or data changes.
import { fmtRel, MONTHS_LONG } from "./scale.js";

const circ = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));
const short = (name) => name.replace(/ International Airport| Regional Airport| Airport.*$/, "");

export function buildTour(data) {
  const nat = data.national.rate;
  const peak = nat.indexOf(Math.max(...nat));
  const low = nat.indexOf(Math.min(...nat));
  const steps = [];

  // 1. The seasonal wave
  steps.push({
    title: "The migration wave",
    month: peak,
    airport: null,
    mode: "estimated",
    text: `Damaging strikes per operation follow the birds. Nationally they bottom out in ${MONTHS_LONG[low]} and peak in ${MONTHS_LONG[peak]}, about ${(nat[peak] / nat[low]).toFixed(1)}x higher. The faint teal corridors are the four major flyways; press play on the timeline to watch the season move.`,
  });

  // 2. Traffic is not risk: the busiest airport
  const busiest = [...data.airports].sort((a, b) => b.opsYear - a.opsYear)[0];
  const bm = busiest.m[peak];
  steps.push({
    title: "Busy isn't the same as risky",
    month: peak,
    airport: busiest.icao,
    mode: "estimated",
    text: `${short(busiest.name)} has the most traffic of any study airport, so it files many strike reports. Per 10,000 operations, though, its ${MONTHS_LONG[peak]} rate is ${fmtRel(bm.rel)} the national rate. Every number here is divided by traffic so that size and risk stay separate.`,
  });

  // 3. Uncertainty: how few airports are distinguishable
  const distinct = data.airports.filter((a) => a.m[peak].rlo > 1 || a.m[peak].rhi < 1).length;
  steps.push({
    title: "Most of the map is noise",
    month: peak,
    airport: null,
    mode: "estimated",
    text: `Only ${distinct} of ${data.airports.length} airports have a 90% interval clearly above or below the national rate in ${MONTHS_LONG[peak]}. The faded circles aren't "safe" or "risky"; there isn't enough data to tell them apart from average.`,
  });

  // 4. A local pattern: strongest clearly-above peak far from the national peak
  let local = null;
  for (const a of data.airports) {
    const rs = a.m.map((m) => m.r);
    const p = rs.indexOf(Math.max(...rs));
    if (a.m[p].rlo > 1 && circ(p, peak) >= 3 && (!local || a.m[p].rel > local.rel)) local = { a, p, rel: a.m[p].rel };
  }
  if (local) {
    steps.push({
      title: "A local pattern",
      month: local.p,
      airport: local.a.icao,
      mode: "estimated",
      text: `${short(local.a.name)} peaks in ${MONTHS_LONG[local.p]}, ${circ(local.p, peak)} months away from the national peak, at ${fmtRel(local.rel)} the national rate. That points to something local, such as nesting or wintering birds nearby. The strike data alone can't say which.`,
    });
  }

  // 5. Why pooling matters: a small airport whose raw rate is extreme
  let noisy = null;
  data.airports.forEach((a) =>
    a.m.forEach((m, i) => {
      const rr = m.raw / nat[i];
      if (m.sh >= 0.6 && m.d >= 1 && rr >= 3 && (!noisy || rr > noisy.rr)) noisy = { a, i, rr, m };
    }),
  );
  if (noisy) {
    steps.push({
      title: "Why the estimates are pooled",
      month: noisy.i,
      airport: noisy.a.icao,
      mode: "raw",
      text: `In raw mode, ${noisy.m.d} damaging strike${noisy.m.d === 1 ? "" : "s"} at low-traffic ${short(noisy.a.name)} make its ${MONTHS_LONG[noisy.i]} rate look ${fmtRel(noisy.rr)} the national rate. With so little traffic that's mostly luck, so the model leans on the national pattern and estimates ${fmtRel(noisy.m.rel)} instead.`,
    });
  }

  // 6. The risk matrix
  steps.push({
    title: "What “Serious” means",
    month: peak,
    airport: null,
    mode: "estimated",
    text: "Under MIL-STD-882E almost every airport-month rates Serious, because a rare but credible catastrophic outcome is enough on its own. The matrix in the panel shows that formal rating; the map's colours show where airports actually differ. Explore from here.",
  });
  return steps;
}
