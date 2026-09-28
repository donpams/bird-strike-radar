import { useEffect, useImperativeHandle, useRef } from "react";
import maplibregl from "maplibre-gl";
import { fmtRate, fmtRel, lerpLog, MONTHS, phaseOf, prefersReducedMotion, rawRelative, relColor } from "../scale.js";

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const PHONE = typeof window !== "undefined" && window.innerWidth < 720;
const W = typeof window !== "undefined" ? window.innerWidth : 1440;
const HOME = { center: [-96.5, 38.5], zoom: PHONE ? 2.4 : W < 1300 ? 3.15 : 3.6 };
// Keep the visual centre clear of the inspector (right) and timeline (bottom) on wide screens
const PADDING = PHONE ? { top: 60, right: 0, bottom: 90, left: 0 } : { top: 70, right: 380, bottom: 110, left: 0 };

// Circle size by traffic, doubled between zoom 3 and 8
const BASE = ["interpolate", ["linear"], ["sqrt", ["get", "ops"]], 150, 3.5, 700, 13];
const byZoom = (r3, r8) => ["interpolate", ["linear"], ["zoom"], 3, r3, 8, r8];

// Paint expressions driven by a time literal t (seconds), updated ~30x per second:
//  * every dot "breathes" +/-6% with its own phase
//  * airports clearly above the national rate also emit a ripple ring (and glow at night)
function breathe(t) {
  const k = ["+", 1, ["*", 0.06, ["sin", ["+", t * 1.6, ["get", "phase"]]]]];
  return byZoom(["*", BASE, k], ["*", 2, BASE, k]);
}
const ripple = (t) => ["%", ["+", t / 2.6, ["/", ["get", "phase"], 6.283]], 1];
function rippleRadius(t) {
  const grow = ["+", 1, ["*", 1.4, ripple(t)]];
  return byZoom(["*", BASE, grow], ["*", 2, BASE, grow]);
}
const rippleOpacity = (t) => ["*", ["get", "hot"], 0.6, ["-", 1, ripple(t)]];

// GeoJSON for a fractional month x in [0, 12): values interpolate between month i and i+1
function frame(data, x, mode, theme) {
  const i = Math.floor(x) % 12;
  const j = (i + 1) % 12;
  const f = x - Math.floor(x);
  const natI = data.national.rate[i];
  const natJ = data.national.rate[j];
  const faded = theme === "dark" ? 0.3 : 0.38;
  return {
    type: "FeatureCollection",
    features: data.airports.map((a) => {
      const mi = a.m[i];
      const mj = a.m[j];
      const relI = mode === "raw" ? rawRelative(mi, natI) : mi.rel;
      const relJ = mode === "raw" ? rawRelative(mj, natJ) : mj.rel;
      const rel = lerpLog(relI, relJ, f);
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
          color: relColor(rel, theme),
          opacity: faded + (0.92 - faded) * (distI + (distJ - distI) * f),
          hot: hotI + (hotJ - hotI) * f,
          label: mode === "raw" ? `${fmtRate(m.raw)} raw` : `${fmtRate(m.r)} est.`,
          rel: fmtRel(rel),
        },
      };
    }),
  };
}

export default function MapView({ ref, data, month, mode, theme, selected, onSelect, resetKey, onCursor }) {
  const box = useRef(null);
  const map = useRef(null);
  const popup = useRef(null);
  const monthF = useRef(month);
  const state = useRef({ mode, theme, selected });
  const hovered = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data; // handlers registered once read the latest data through this ref

  const redraw = () => {
    const src = map.current?.getSource("airports");
    const d = dataRef.current;
    if (src && d) src.setData(frame(d, monthF.current, state.current.mode, state.current.theme));
  };

  useImperativeHandle(ref, () => ({
    setMonthFloat(x) {
      monthF.current = ((x % 12) + 12) % 12;
      redraw();
    },
  }));

  // (Re)build the airport layers. Called on first load and after every basemap swap,
  // because setStyle() replaces all layers.
  const addLayers = () => {
    const m = map.current;
    const data = dataRef.current;
    if (!m || !data || m.getSource("airports")) return;
    const dark = state.current.theme === "dark";
    m.addSource("airports", { type: "geojson", data: frame(data, monthF.current, state.current.mode, state.current.theme) });
    if (dark) {
      // Soft glow under the hot spots at night
      m.addLayer({
        id: "airport-glow",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": byZoom(["*", BASE, 2.6], ["*", 5, BASE]),
          "circle-color": ["get", "color"],
          "circle-blur": 1,
          "circle-opacity": ["*", 0.35, ["get", "hot"]],
        },
      });
    }
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
        "circle-stroke-color": dark ? "#0b0e13" : "#ffffff",
        "circle-stroke-width": 1.2,
      },
    });
    const ringColor = dark ? "#e6edf3" : "#12161c";
    m.addLayer({
      id: "airport-hover",
      type: "circle",
      source: "airports",
      filter: ["==", ["get", "icao"], hovered.current || ""],
      paint: {
        "circle-radius": byZoom(["+", BASE, 3], ["+", ["*", 2, BASE], 4]),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ringColor,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.55,
      },
    });
    m.addLayer({
      id: "airport-selected",
      type: "circle",
      source: "airports",
      filter: ["==", ["get", "icao"], state.current.selected || ""],
      paint: {
        "circle-radius": byZoom(["+", BASE, 4], ["+", ["*", 2, BASE], 5]),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": dark ? "#2dd4bf" : "#0e8f86",
        "circle-stroke-width": 2.5,
      },
    });
  };

  // Create the map once, starting a little wider and easing in
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLES[theme] || STYLES.light,
      center: HOME.center,
      zoom: HOME.zoom - 0.8,
      minZoom: 2,
      maxZoom: 11,
      attributionControl: { compact: false },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    m.setPadding(PADDING);
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    map.current = m;

    m.once("load", () => m.easeTo({ ...HOME, duration: prefersReducedMotion() ? 0 : 2200 }));
    m.on("style.load", addLayers);
    m.on("mousemove", (e) => onCursor?.(e.lngLat, m.getZoom()));
    m.on("zoom", () => onCursor?.(null, m.getZoom()));

    // Interaction handlers are registered once on the layer id; they survive style swaps
    m.on("mousemove", "airports", (e) => {
      m.getCanvas().style.cursor = "pointer";
      const p = e.features[0].properties;
      if (hovered.current !== p.icao) {
        hovered.current = p.icao;
        m.setFilter("airport-hover", ["==", ["get", "icao"], p.icao]);
      }
      popup.current
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<strong>${p.icao}</strong> ${p.name}<br/><span class="pop-num">${p.label}</span> per 10k ops &middot; ${p.rel} national`)
        .addTo(m);
    });
    m.on("mouseleave", "airports", () => {
      m.getCanvas().style.cursor = "";
      hovered.current = null;
      m.setFilter("airport-hover", ["==", ["get", "icao"], ""]);
      popup.current.remove();
    });
    m.on("click", "airports", (e) => onSelect(e.features[0].properties.icao));

    // Pulse loop (~30 fps). Skipped entirely for people who prefer reduced motion.
    let raf = 0;
    if (!prefersReducedMotion()) {
      let last = 0;
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        if (now - last < 33 || !m.getLayer("airports")) return;
        last = now;
        const t = now / 1000;
        m.setPaintProperty("airports", "circle-radius", breathe(t));
        m.setPaintProperty("airport-ripple", "circle-radius", rippleRadius(t));
        m.setPaintProperty("airport-ripple", "circle-stroke-opacity", rippleOpacity(t));
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data arrives after the map: add layers if the style is already there
  useEffect(() => {
    if (data && map.current?.isStyleLoaded()) addLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Mode change: recolour at the current fractional month
  useEffect(() => {
    state.current.mode = mode;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Theme change: swap basemap; layers are rebuilt on "style.load"
  useEffect(() => {
    const m = map.current;
    if (!m || state.current.theme === theme) return;
    state.current.theme = theme;
    m.setStyle(STYLES[theme], { diff: false });
  }, [theme]);

  // Highlight + fly to the selected airport
  useEffect(() => {
    state.current.selected = selected;
    const m = map.current;
    if (!m || !m.getLayer("airport-selected")) return;
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
