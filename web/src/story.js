// Month-specific text for the inspector. Two ingredients:
//  1. A short seasonal note (general bird-migration context, phrased cautiously)
//  2. Sentences computed from the data for that month, so every month reads differently
import { fmtRate, fmtRel, MONTHS_LONG } from "./scale.js";

export const SEASON = [
  { tag: "Winter", note: "Most migrants have settled for the winter. Wintering waterfowl and gulls gather near open water and farm fields, some of it close to airfields." },
  { tag: "Late winter", note: "A winter lull: few birds are on the move before the first northbound flights of the year." },
  { tag: "Spring migration begins", note: "Waterfowl and early migrants start moving north, often in large flocks along the major flyways." },
  { tag: "Spring migration", note: "Northbound migration is in full swing, producing the smaller of the year's two peaks." },
  { tag: "Late spring", note: "The last songbird migrants pass through as local birds settle into nesting." },
  { tag: "Breeding season", note: "Birds are busy nesting and move less, which usually makes this one of the lowest months per operation." },
  { tag: "Fledging", note: "Young birds leave the nest. Inexperienced juveniles are less wary of aircraft and start turning up around airfields." },
  { tag: "Late summer", note: "The bird population is at its annual high with this year's young, and the first shorebirds are already heading south." },
  { tag: "Fall migration", note: "Southbound migration is underway, with large numbers of birds crossing the country, many of them at night." },
  { tag: "Fall migration peak", note: "The heart of fall migration, with waves of southbound birds and rates close to their annual high." },
  { tag: "Late fall migration", note: "Waterfowl and other late migrants move south ahead of the cold, keeping rates close to the autumn high." },
  { tag: "Early winter", note: "Migration winds down, though wintering flocks remain in the south and along the coasts." },
];

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Rank of `value` among `values` (1 = highest)
const rankOf = (values, value) => [...values].sort((a, b) => b - a).indexOf(value) + 1;

export function nationalStory(data, month) {
  const rates = data.national.rate;
  const rate = rates[month];
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const pct = Math.round(((rate - mean) / mean) * 100);
  const rank = rankOf(rates, rate);

  const above = data.airports
    .filter((a) => a.m[month].rlo > 1)
    .sort((a, b) => b.m[month].rel - a.m[month].rel);
  const top = above[0];

  // Which region carries the "hot" airports this month? (rough split by longitude)
  const west = above.filter((a) => a.lon < -104).length;
  const east = above.filter((a) => a.lon > -90).length;
  const where =
    above.length < 3 ? null : west > east * 1.5 ? "mostly in the West" : east > west * 1.5 ? "mostly in the East" : "spread across the country";

  const vsAvg =
    Math.abs(pct) < 5
      ? "right around the year's average"
      : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"} the year's average`;
  const rankText = rank === 1 ? "the highest month of the year" : rank === 12 ? "the lowest month of the year" : rank >= 9 ? `one of the quieter months (${ordinal(rank)} of 12)` : `the ${ordinal(rank)}-highest of 12 months`;

  const lines = [
    `Nationally, ${fmtRate(rate)} damaging strikes per 10,000 operations: ${vsAvg}, ${rankText}.`,
  ];
  if (above.length === 0) {
    lines.push("No airport is clearly above the national rate this month; every difference on the map is within the noise.");
  } else {
    lines.push(
      `${above.length} airport${above.length === 1 ? " is" : "s are"} clearly above national${where ? `, ${where}` : ""}. ` +
        `The standout is ${top.name.replace(/ International Airport| Airport/, "")} at ${fmtRel(top.m[month].rel)} the national rate.`,
    );
  }
  return { season: SEASON[month], lines };
}

export function airportStory(airport, data, month) {
  const rs = airport.m.map((m) => m.r);
  const peak = rs.indexOf(Math.max(...rs));
  const low = rs.indexOf(Math.min(...rs));
  const rank = rankOf(rs, rs[month]);
  const m = airport.m[month];
  const nationalPeak = data.national.rate.indexOf(Math.max(...data.national.rate));

  let seasonal;
  if (month === peak) seasonal = `${MONTHS_LONG[month]} is ${airport.icao}'s riskiest month of the year.`;
  else if (month === low) seasonal = `${MONTHS_LONG[month]} is ${airport.icao}'s quietest month; its peak comes in ${MONTHS_LONG[peak]}.`;
  else if (rank >= 9) seasonal = `One of ${airport.icao}'s quieter months (${ordinal(rank)} of 12); its peak is ${MONTHS_LONG[peak]}.`;
  else seasonal = `This is ${airport.icao}'s ${ordinal(rank)}-highest month; its peak is ${MONTHS_LONG[peak]}.`;

  // Only flag peaks at least 3 months from the national peak (Sep vs Nov is still fall migration)
  const gap = Math.min(Math.abs(peak - nationalPeak), 12 - Math.abs(peak - nationalPeak));
  const offSeason = gap >= 3 && airport.m[peak].rlo > 1;
  const pattern = offSeason
    ? `Unlike the national pattern (peaking in ${MONTHS_LONG[nationalPeak]}), its risk is highest in ${MONTHS_LONG[peak]}: a local hazard worth a closer look.`
    : null;

  const evidence =
    m.d === 0
      ? `No damaging strikes were recorded here in any ${MONTHS_LONG[month]} of the study window, so the estimate leans mostly on the national and flyway pattern.`
      : `${m.d} damaging strike${m.d === 1 ? "" : "s"} across all ${MONTHS_LONG[month]}s in the study window; the estimate leans ${m.sh > 0.6 ? "mostly" : m.sh > 0.3 ? "partly" : "only a little"} on the national and flyway pattern.`;

  return { lines: [seasonal, pattern, evidence].filter(Boolean) };
}
