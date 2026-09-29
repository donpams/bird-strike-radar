import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import { Brand, Dock, Hud, Inspector, Legend, Timeline } from "./components/Panels.jsx";
import DataTable from "./components/DataTable.jsx";
import Birds from "./components/Birds.jsx";
import { useTheme } from "./theme.js";
import Search from "./components/Search.jsx";
import Tour from "./components/Tour.jsx";
import { buildTour } from "./tour.js";
import { readHash, writeHash } from "./url.js";

const DATA_URL = `${import.meta.env.BASE_URL}data/radar.json`;
const START_MONTH = 9; // October (0-based): the autumn migration peak

const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // A shared link (#m=dec&a=KDEN&v=raw) sets the starting view
  const initial = useMemo(readHash, []);
  const [month, setMonth] = useState(initial.month ?? START_MONTH);
  const [mode, setMode] = useState(initial.mode ?? "estimated"); // "estimated" | "raw"
  const [selected, setSelected] = useState(initial.airport); // ICAO or null
  const [tourStep, setTourStep] = useState(null);
  // Requests for the timeline to glide to a month (tour, chart clicks)
  const [jump, setJump] = useState({ month: initial.month ?? START_MONTH, n: 0 });
  const requestMonth = (m) => setJump((j) => ({ month: m, n: j.n + 1 }));
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 720);
  const [showTable, setShowTable] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [fading, setFading] = useState(false);
  const { mode: themeMode, theme, cycle } = useTheme();
  const mapRef = useRef(null);
  const hudRef = useRef(null);
  const lastCursor = useRef(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  // Brief cross-fade whenever day/night flips, so the basemap swap isn't a hard cut
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    setFading(true);
    const t = setTimeout(() => setFading(false), 700);
    return () => clearTimeout(t);
  }, [theme]);

  // Drop an airport code from a link that isn't in the study set
  useEffect(() => {
    if (data && selected && !data.airports.some((a) => a.icao === selected)) setSelected(null);
  }, [data, selected]);

  // Keep the URL in sync so any view can be shared
  useEffect(() => {
    writeHash({ month, airport: selected, mode });
  }, [month, selected, mode]);

  const tour = useMemo(() => (data ? buildTour(data) : []), [data]);
  const goToStep = (i) => {
    const s = tour[i];
    if (!s) return;
    setTourStep(i);
    setMode(s.mode);
    setSelected(s.airport);
    requestMonth(s.month);
    if (!s.airport) setResetKey((k) => k + 1);
    setInspectorOpen(window.innerWidth >= 720 || !!s.airport);
  };

  const airport = useMemo(
    () => (data && selected ? data.airports.find((a) => a.icao === selected) : null),
    [data, selected],
  );

  // Cursor + zoom readout, written straight to the DOM (no re-render per mouse move)
  const onCursor = useCallback((lngLat, zoom) => {
    if (lngLat) lastCursor.current = lngLat;
    const c = lastCursor.current;
    if (!hudRef.current) return;
    hudRef.current.textContent = c
      ? `${fmtCoord(c.lat, "N", "S")}  ${fmtCoord(c.lng, "E", "W")}  ·  Z${zoom.toFixed(1)}`
      : `Z${zoom.toFixed(1)}`;
  }, []);

  const onTool = (tool) => {
    if (tool === "estimated" || tool === "raw") setMode(tool);
    if (tool === "table") setShowTable(true);
    if (tool === "home") {
      setSelected(null);
      setResetKey((k) => k + 1);
    }
  };

  if (error) return <div className="fatal">Couldn't load the data ({error}).</div>;

  return (
    <div className="app">
      <MapView
        ref={mapRef}
        data={data}
        month={month}
        mode={mode}
        theme={theme}
        selected={selected}
        onSelect={(icao) => {
          setSelected(icao);
          setInspectorOpen(true);
        }}
        resetKey={resetKey}
        onCursor={onCursor}
      />
      {data && <Birds month={month} national={data.national.rate} theme={theme} />}
      <div className={`theme-fade ${fading ? "on" : ""}`} aria-hidden="true" />

      <Brand data={data} />
      <Dock
        active={showTable ? "table" : mode}
        onTool={onTool}
        themeMode={themeMode}
        onTheme={cycle}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
        touring={tourStep !== null}
        onTour={() => (tourStep === null ? goToStep(0) : setTourStep(null))}
      />
      {data && (
        <Search
          airports={data.airports}
          onPick={(icao) => {
            setSelected(icao);
            setInspectorOpen(true);
          }}
        />
      )}
      {tourStep !== null && tour.length > 0 && (
        <Tour steps={tour} step={tourStep} onStep={goToStep} onClose={() => setTourStep(null)} />
      )}

      {data && inspectorOpen && (
        <Inspector
          data={data}
          airport={airport}
          month={month}
          mode={mode}
          onClear={() => setSelected(null)}
          onShowTable={() => setShowTable(true)}
          onMonth={requestMonth}
        />
      )}
      {data && <Legend mode={mode} month={month} theme={theme} />}
      {data && (
        <Timeline
          month={month}
          national={data.national.rate}
          onChange={setMonth}
          jump={jump}
          onFloat={(x) => mapRef.current?.setMonthFloat(x)}
        />
      )}
      <Hud hudRef={hudRef} />

      {showTable && data && (
        <DataTable
          data={data}
          month={month}
          theme={theme}
          onClose={() => setShowTable(false)}
          onPick={(icao) => {
            setSelected(icao);
            setInspectorOpen(true);
            setShowTable(false);
          }}
        />
      )}
    </div>
  );
}
