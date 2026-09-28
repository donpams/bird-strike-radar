import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import { Brand, Dock, Hud, Inspector, Legend, Timeline } from "./components/Panels.jsx";
import DataTable from "./components/DataTable.jsx";
import { useTheme } from "./theme.js";

const DATA_URL = `${import.meta.env.BASE_URL}data/radar.json`;
const START_MONTH = 9; // October (0-based): the autumn migration peak

const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(START_MONTH);
  const [mode, setMode] = useState("estimated"); // "estimated" | "raw"
  const [selected, setSelected] = useState(null); // ICAO or null
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
      <div className={`theme-fade ${fading ? "on" : ""}`} aria-hidden="true" />

      <Brand data={data} />
      <Dock
        active={showTable ? "table" : mode}
        onTool={onTool}
        themeMode={themeMode}
        onTheme={cycle}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
      />

      {data && inspectorOpen && (
        <Inspector
          data={data}
          airport={airport}
          month={month}
          mode={mode}
          onClear={() => setSelected(null)}
          onShowTable={() => setShowTable(true)}
        />
      )}
      {data && <Legend mode={mode} month={month} theme={theme} />}
      {data && (
        <Timeline
          month={month}
          national={data.national.rate}
          onChange={setMonth}
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
