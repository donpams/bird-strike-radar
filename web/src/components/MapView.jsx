import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { binColor, fmtRate, fmtRel, isDistinct, MONTHS, rawRelative } from "../scale.js";

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const HOME = { center: [-96.5, 38.5], zoom: window.innerWidth < 720 ? 2.4 : 3.6 };

// Build a GeoJSON snapshot for one month + mode. Colours are computed here, not in the
// style, so the legend, table and map share one rule (scale.js).
function toGeoJSON(data, month, mode) {
  const nat = data.national.rate[month];
  return {
    type: "FeatureCollection",
    features: data.airports.map((a) => {
      const m = a.m[month];
      const rel = mode === "raw" ? rawRelative(m, nat) : m.rel;
      return {
        type: "Feature",
        id: a.icao,
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          icao: a.icao,
          name: a.name,
          ops: a.opsYear,
          color: binColor(rel),
          // Honest uncertainty: fade airports we can't tell apart from the national rate
          opacity: mode === "raw" || isDistinct(m) ? 0.9 : 0.38,
          label: mode === "raw" ? `${fmtRate(m.raw)} raw` : `${fmtRate(m.r)} est.`,
          rel: fmtRel(rel),
        },
      };
    }),
  };
}

export default function MapView({ data, month, mode, selected, onSelect, resetKey }) {
  const box = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const popup = useRef(null);

  // Create the map once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      ...HOME,
      minZoom: 2,
      maxZoom: 11,
      attributionControl: { compact: false },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    // Keep the map's visual centre clear of the left-hand cards on wide screens
    if (window.innerWidth > 720) m.setPadding({ left: 400, top: 0, right: 0, bottom: 90 });
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    map.current = m;
    return () => m.remove();
  }, []);

  // Add the airport layers once both the map and the data are ready
  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    const add = () => {
      if (m.getSource("airports")) return;
      m.addSource("airports", { type: "geojson", data: toGeoJSON(data, month, mode) });
      const radius = ["interpolate", ["linear"], ["sqrt", ["get", "ops"]], 150, 3.5, 700, 13];
      m.addLayer({
        id: "airports",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, radius, 8, ["*", 2, radius]],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
        },
      });
      m.addLayer({
        id: "airport-selected",
        type: "circle",
        source: "airports",
        filter: ["==", ["get", "icao"], ""],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["+", radius, 4], 8, ["+", ["*", 2, radius], 5]],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#3d2bd9",
          "circle-stroke-width": 2.5,
        },
      });
      m.on("mousemove", "airports", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const p = e.features[0].properties;
        popup.current
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<strong>${p.icao}</strong> ${p.name}<br/>${p.label} per 10k ops &middot; ${p.rel} national`)
          .addTo(m);
      });
      m.on("mouseleave", "airports", () => {
        m.getCanvas().style.cursor = "";
        popup.current.remove();
      });
      m.on("click", "airports", (e) => onSelect(e.features[0].properties.icao));
      ready.current = true;
    };
    if (m.isStyleLoaded()) add();
    else m.once("load", add);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Update colours when month or mode changes
  useEffect(() => {
    const src = map.current?.getSource("airports");
    if (src && data) src.setData(toGeoJSON(data, month, mode));
  }, [data, month, mode]);

  // Highlight + fly to the selected airport
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter("airport-selected", ["==", ["get", "icao"], selected || ""]);
    const a = data?.airports.find((x) => x.icao === selected);
    if (a) m.flyTo({ center: [a.lon, a.lat], zoom: Math.max(m.getZoom(), 6), speed: 1.2 });
  }, [selected, data]);

  // Home button
  useEffect(() => {
    if (resetKey && map.current) map.current.flyTo({ ...HOME, speed: 1.4 });
  }, [resetKey]);

  return <div ref={box} className="map" role="application" aria-label={`Map of airports, ${MONTHS[month]}`} />;
}
