import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import { DetailPanel, Legend, MonthSlider, TitleCard, Toolbar } from "./components/Panels.jsx";
import DataTable from "./components/DataTable.jsx";

const DATA_URL = `${import.meta.env.BASE_URL}data/radar.json`;
const START_MONTH = 9; // October (0-based): the autumn migration peak

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(START_MONTH);
  const [mode, setMode] = useState("estimated"); // "estimated" | "raw"
  const [selected, setSelected] = useState(null); // ICAO or null
  // Start collapsed on phones so the map is visible first
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 720);
  const [showTable, setShowTable] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const mapRef = useRef(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const airport = useMemo(
    () => (data && selected ? data.airports.find((a) => a.icao === selected) : null),
    [data, selected],
  );

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
        selected={selected}
        onSelect={(icao) => {
          setSelected(icao);
          setCollapsed(false);
        }}
        resetKey={resetKey}
      />

      <div className={`left-stack ${collapsed ? "is-collapsed" : ""}`}>
        <TitleCard collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        {!collapsed && data && (
          <div className="panel-row">
            <DetailPanel
              data={data}
              airport={airport}
              month={month}
              mode={mode}
              onClear={() => setSelected(null)}
              onShowTable={() => setShowTable(true)}
            />
            <Toolbar active={showTable ? "table" : mode} onTool={onTool} />
          </div>
        )}
      </div>

      {data && <Legend mode={mode} month={month} />}
      {data && (
        <MonthSlider
          month={month}
          national={data.national.rate}
          onChange={setMonth}
          onFloat={(x) => mapRef.current?.setMonthFloat(x)}
        />
      )}

      {showTable && data && (
        <DataTable
          data={data}
          month={month}
          onClose={() => setShowTable(false)}
          onPick={(icao) => {
            setSelected(icao);
            setShowTable(false);
          }}
        />
      )}
    </div>
  );
}
