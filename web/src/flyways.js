// The four North American flyways, drawn as soft corridors with a slow "flow" line.
// Centre lines are hand-placed and APPROXIMATE (the real flyways are broad, overlapping
// administrative regions, not lines), so the map labels them that way.
// Coordinates run south -> north; in autumn the flow is reversed.

export const FLYWAYS = [
  { id: "pacific", name: "Pacific Flyway", label: [-121.6, 46.6], coords: [[-115.2, 30.5], [-117.6, 33.6], [-119.6, 36.6], [-121.4, 40.2], [-122.2, 44.6], [-122.6, 48.6]] },
  { id: "central", name: "Central Flyway", label: [-101.4, 45.2], coords: [[-98.4, 26.6], [-97.6, 30.6], [-98.6, 35.2], [-100.2, 39.8], [-101.8, 44.2], [-102.6, 48.8]] },
  { id: "mississippi", name: "Mississippi Flyway", label: [-89.4, 42.6], coords: [[-90.2, 29.4], [-90.8, 32.6], [-90.2, 36.2], [-89.8, 39.8], [-90.6, 43.6], [-92.4, 47.6]] },
  { id: "atlantic", name: "Atlantic Flyway", label: [-74.2, 39.4], coords: [[-81.2, 27.6], [-80.6, 31.4], [-78.6, 34.6], [-76.4, 37.8], [-74.2, 40.6], [-71.2, 43.6]] },
];

export const SPRING = new Set([2, 3, 4]); // Mar-May: northbound
export const AUTUMN = new Set([7, 8, 9, 10]); // Aug-Nov: southbound

export const seasonOf = (month) => (SPRING.has(month) ? "north" : AUTUMN.has(month) ? "south" : "none");

// Smooth each centre line with a Catmull-Rom spline so the corridors read as gentle curves
export function smooth(points, steps = 10) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((k) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
      ));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function flywayGeoJSON(direction) {
  return {
    type: "FeatureCollection",
    features: FLYWAYS.map((f) => {
      const line = smooth(f.coords);
      return {
        type: "Feature",
        properties: { id: f.id, name: f.name },
        geometry: { type: "LineString", coordinates: direction === "south" ? [...line].reverse() : line },
      };
    }),
  };
}

// MapLibre animates a dashed line by stepping through dash patterns (from the MapLibre docs)
export const DASH_SEQUENCE = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
