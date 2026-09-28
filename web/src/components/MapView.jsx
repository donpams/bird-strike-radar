import { useEffect, useImperativeHandle, useRef } from "react";
import maplibregl from "maplibre-gl";
import { fmtRate, fmtRel, lerpLog, MONTHS, phaseOf, prefersReducedMotion, rawRelative, relColor } from "../scale.js";

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const PHONE = typeof window !== "undefined" && window.innerWidth < 720;
const HOME = { center: [-96.5, 38.5], zoom: PHONE ? 2.4 : 3.6 };

// Circle size by traffic, doubled between zoom 3 and 8
const BASE = ["interpolate", ["linear"], ["sqrt", ["get", "ops"]], 150, 3.5, 700, 13];
const byZoom = (r3, r8) => ["interpolate", ["linear"], ["zoom"], 3, r3, 8, r8];

// Paint expressions that depend on a time literal t (seconds). Updated ~30x per second.
//  * every dot "breathes" +/-6% with its own phase
//  * airports clearly above the national rate also emit a ripple ring
function breathe(t) {
  const k = ["+", 1, ["*", 0.06, ["sin", ["+", t * 1.6, ["get", "phase"]]]]];
  return byZoom(["*", BASE, k], ["*", 2, BASE, k]);
}
function ripple(t) {
  // sawtooth 0 -> 1 every ~2.6 s, offset per airport
  return ["%", ["+", t / 2.6, ["/", ["get", "phase"], 6.283]], 1];
}
function rippleRadius(t) {
  const grow = ["+", 1, ["*", 1.4, ripple(t)]];
  return byZoom(["*", BASE, grow], ["*", 2, BASE, grow]);
}
function rippleOpacity(t) {
  return ["*", ["get", "hot"], 0.55, ["-", 1, ripple(t)]];
}

// GeoJSON for a fractional month x in [0, 12): values interpolate between month i and i+1
function frame(data, x, mode) {
  const i = Math.floor(x) % 12;
  const j = (i + 1) % 12;
  const f = x - Math.floor(x);
  const natI = data.national.rate[i];
  const natJ = data.national.rate[j];
  return {
    type: "FeatureCollection",
    features: data.airports.map((a) => {
      const mi = a.m[i];
      const mj = a.m[j];
      const relI = mode === "raw" ? rawRelative(mi, natI) : mi.rel;
      const relJ = mode === "raw" ? rawRelative(mj, natJ) : mj.rel;
      const rel = lerpLog(relI, relJ, f);
      // "clearly above national" (whole 90% interval above 1), eased between months
      const hotI = mode === "estimated" && mi.rlo > 1 ? 1 : 0;
      const hotJ = mode === "estimated" && mj.rlo > 1 ? 1 : 0;
      const distI = mode === "raw" || mi.rlo > 1 || mi.rhi < 1 ? 1 : 0;
      const distJ = mode === "raw" || mj.rlo > 1 || mj.rhi < 1 ? 1 : 0;
      const m = f < 0.5 ? mi : mj;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          icao: a.icao,
          name: a.name,
          ops: a.opsYear,
          phase: phaseOf(a.icao),
          color: relColor(rel),
          opacity: 0.38 + 0.52 * (distI + (distJ - distI) * f),
          hot: hotI + (hotJ - hotI) * f,
          label: mode === "raw" ? `${fmtRate(m.raw)} raw` : `${fmtRate(m.r)} est.`,
          rel: fmtRel(rel),
        },
      };
    }),
  };
}

export default function MapView({ ref, data, month, mode, selected, onSelect, resetKey }) {
  const box = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const popup = useRef(null);
  const monthF = useRef(month);
  const modeRef = useRef(mode);
  const hovered = useRef(null);

  const redraw = () => {
    const src = map.current?.getSource("airports");
    if (src && data) src.setData(frame(data, monthF.current, modeRef.current));
  };

  // Let the month slider push fractional months straight to the map (no React re-render per frame)
  useImperativeHandle(ref, () => ({
    setMonthFloat(x) {
      monthF.current = ((x % 12) + 12) % 12;
      redraw();
    },
  }));

  // Create the map once, starting a little wider and easing in
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: HOME.center,
      zoom: HOME.zoom - 0.8,
      minZoom: 2,
      maxZoom: 11,
      attributionControl: { compact: false },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (!PHONE) m.setPadding({ left: 400, top: 0, right: 0, bottom: 90 });
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    m.once("load", () => m.easeTo({ ...HOME, duration: prefersReducedMotion() ? 0 : 2200 }));
    map.current = m;
    return () => m.remove();
  }, []);

  // Add the airport layers once both the map and the data are ready, then start the pulse loop
  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    let raf = 0;
    const add = () => {
      if (m.getSource("airports")) return;
      m.addSource("airports", { type: "geojson", data: frame(data, monthF.current, modeRef.current) });
      m.addLayer({
        id: "airport-ripple",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": rippleRadius(0),
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": rippleOpacity(0),
        },
      });
      m.addLayer({
        id: "airports",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": breathe(0),
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
        },
      });
      m.addLayer({
        id: "airport-hover",
        type: "circle",
        source: "airports",
        filter: ["==", ["get", "icao"], ""],
        paint: {
          "circle-radius": byZoom(["+", BASE, 3], ["+", ["*", 2, BASE], 4]),
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#1d1d1f",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      });
      m.addLayer({
        id: "airport-selected",
        type: "circle",
        source: "airports",
        filter: ["==", ["get", "icao"], ""],
        paint: {
          "circle-radius": byZoom(["+", BASE, 4], ["+", ["*", 2, BASE], 5]),
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#3d2bd9",
          "circle-stroke-width": 2.5,
        },
      });

      m.on("mousemove", "airports", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const p = e.features[0].properties;
        if (hovered.current !== p.icao) {
          hovered.current = p.icao;
          m.setFilter("airport-hover", ["==", ["get", "icao"], p.icao]);
        }
        popup.current
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<strong>${p.icao}</strong> ${p.name}<br/>${p.label} per 10k ops &middot; ${p.rel} national`)
          .addTo(m);
      });
      m.on("mouseleave", "airports", () => {
        m.getCanvas().style.cursor = "";
        hovered.current = null;
        m.setFilter("airport-hover", ["==", ["get", "icao"], ""]);
        popup.current.remove();
      });
      m.on("click", "airports", (e) => onSelect(e.features[0].properties.icao));
      ready.current = true;

      // Pulse loop (~30 fps). Skipped entirely for people who prefer reduced motion.
      if (prefersReducedMotion()) return;
      let last = 0;
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        if (now - last < 33) return;
        last = now;
        const t = now / 1000;
        m.setPaintProperty("airports", "circle-radius", breathe(t));
        m.setPaintProperty("airport-ripple", "circle-radius", rippleRadius(t));
        m.setPaintProperty("airport-ripple", "circle-stroke-opacity", rippleOpacity(t));
      };
      raf = requestAnimationFrame(tick);
    };
    if (m.isStyleLoaded()) add();
    else m.once("load", add);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Mode change: redraw at the current fractional month
  useEffect(() => {
    modeRef.current = mode;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Highlight + fly to the selected airport
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter("airport-selected", ["==", ["get", "icao"], selected || ""]);
    const a = data?.airports.find((x) => x.icao === selected);
    if (a) m.flyTo({ center: [a.lon, a.lat], zoom: Math.max(m.getZoom(), 6), speed: 1.1, curve: 1.5 });
  }, [selected, data]);

  // Home button
  useEffect(() => {
    if (resetKey && map.current) map.current.flyTo({ ...HOME, speed: 1.2 });
  }, [resetKey]);

  return <div ref={box} className="map" role="application" aria-label={`Map of airports, ${MONTHS[month]}`} />;
}
