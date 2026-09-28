import { useEffect, useState } from "react";
import {
  Bird, CalendarDays, ChevronsLeft, ChevronsRight, Clock, Flame, House, Info, Map as MapIcon,
  Pause, Play, Route, Sheet, Table2, X,
} from "lucide-react";
import {
  BINS, fmtInt, fmtRate, fmtRel, isDistinct, LEVELS, MONTHS, MONTHS_LONG, RISK_COLORS, SEVERITY_NAMES,
} from "../scale.js";

const REPO = "https://github.com/donpams/bird-strike-radar";
const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------- title card
export function TitleCard({ collapsed, onToggle }) {
  return (
    <div className="card title-card">
      <h1>Bird Strike Radar</h1>
      <button className="icon-btn" onClick={onToggle} aria-label={collapsed ? "Expand panel" : "Collapse panel"}>
        {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- toolbar
const TOOLS = [
  { id: "estimated", icon: Flame, label: "Estimated risk (pooled model)" },
  { id: "raw", icon: MapIcon, label: "Raw reports (each airport's own data)" },
  { id: "planner", icon: Route, label: "Mission Planner (coming soon)", disabled: true },
  { id: "table", icon: Table2, label: "Data table" },
  { id: "home", icon: House, label: "Reset view" },
];

export function Toolbar({ active, onTool }) {
  return (
    <nav className="card toolbar" aria-label="Tools">
      {TOOLS.map(({ id, icon: Icon, label, disabled }) => (
        <button
          key={id}
          className={`tool ${active === id ? "is-active" : ""}`}
          onClick={() => !disabled && onTool(id)}
          disabled={disabled}
          title={label}
          aria-label={label}
          aria-pressed={active === id}
        >
          <Icon size={19} strokeWidth={1.6} />
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- 882E matrix
const probLevel = (p) => (p >= 0.1 ? "A" : p >= 0.01 ? "B" : p >= 0.001 ? "C" : p >= 1e-6 ? "D" : "E");

export function nationalLevels(data, month) {
  const rate = data.national.rate[month];
  return data.severity.map((s) => probLevel(1 - Math.exp(-rate * s.share)));
}

export function RiskMatrix({ data, levels }) {
  return (
    <div className="matrix" role="table" aria-label="MIL-STD-882E risk assessment matrix">
      <div className="matrix-grid">
        <div />
        {SEVERITY_NAMES.map((s, j) => (
          <div key={s} className="mx-col" role="columnheader">{s}<span> ({j + 1})</span></div>
        ))}
        {LEVELS.map((L) => (
          <MatrixRow key={L} L={L} data={data} levels={levels} />
        ))}
      </div>
      <p className="caption">
        Highlighted cells: likelihood of at least one strike of each severity in{" "}
        {fmtInt(data.meta.exposureOps)} operations. The worst cell sets the overall risk.
      </p>
    </div>
  );
}

function MatrixRow({ L, data, levels }) {
  return (
    <>
      <div className="mx-row" role="rowheader" title={data.probability[L]}>
        {data.probability[L]} <span>({L})</span>
      </div>
      {data.matrix[L].map((risk, j) => {
        const hit = levels[j] === L;
        return (
          <div
            key={j}
            role="cell"
            className={`mx-cell ${hit ? "is-hit" : ""}`}
            style={{ "--c": RISK_COLORS[risk] }}
            title={`${SEVERITY_NAMES[j]} x ${data.probability[L]}: ${risk}`}
          >
            {hit ? risk : ""}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- detail panel
export function DetailPanel({ data, airport, month, mode, onClear, onShowTable }) {
  const nat = data.national.rate[month];
  const m = airport?.m[month];
  const aboveCount = data.airports.filter((a) => a.m[month].rlo > 1).length;
  const levels = m ? m.lv : nationalLevels(data, month);
  const overall = m
    ? m.risk
    : ["High", "Serious", "Medium", "Low"].find((r) => levels.some((L, j) => data.matrix[L][j] === r));

  return (
    <section className="card detail" aria-live="polite">
      <header className="detail-head">
        <Bird size={22} className="accent" strokeWidth={1.8} />
        <h2>{airport ? airport.name : "National overview"}</h2>
        {airport && (
          <button className="icon-btn small" onClick={onClear} aria-label="Back to national overview">
            <X size={16} />
          </button>
        )}
      </header>
      {airport && <p className="sub">{airport.icao} &middot; {airport.city}, {airport.state}</p>}

      <h3>Summary</h3>
      {!airport ? (
        <p className="muted">
          Estimated damaging bird strikes per {fmtInt(data.meta.exposureOps)} operations at{" "}
          {data.meta.airportCount} US commercial airports in {MONTHS_LONG[month]}: <b>{fmtRate(nat)}</b> nationally.{" "}
          {aboveCount} airports are clearly above that this month. Circles are sized by traffic and coloured against
          the national rate. Click one for detail.
        </p>
      ) : (
        <>
          <p className="muted">
            {MONTHS_LONG[month]}: an estimated <b>{fmtRate(m.r)}</b> damaging strikes per{" "}
            {fmtInt(data.meta.exposureOps)} operations (90% interval {fmtRate(m.lo)}-{fmtRate(m.hi)}),{" "}
            <b>{fmtRel(m.rel)}</b> the national rate.{" "}
            {isDistinct(m)
              ? m.rel > 1 ? "Clearly above national." : "Clearly below national."
              : "Not distinguishable from the national rate."}
          </p>
          {mode === "raw" && (
            <p className="muted small">
              Raw (own data only): {fmtRate(m.raw)} from {m.d} damaging strikes in {fmtInt(m.ops)} operations,{" "}
              {MONTHS[month]} {data.meta.years[0]}-{data.meta.years[1]}.
            </p>
          )}
        </>
      )}

      <div className="risk-line">
        <span>MIL-STD-882E risk</span>
        <span className="chip" style={{ "--c": RISK_COLORS[overall] }}>{overall}</span>
        {m && m.riskLo !== m.riskHi && <span className="muted small">range {m.riskLo}-{m.riskHi}</span>}
      </div>
      <RiskMatrix data={data} levels={levels} />

      <h3>Details</h3>
      <ul className="details">
        <li><Info size={20} strokeWidth={1.4} /><div>{fmtDate(data.meta.generated)}<small>Model updated</small></div></li>
        <li><Clock size={20} strokeWidth={1.4} /><div>{fmtDate(data.meta.strikeDataDownloaded)}<small>FAA strike data downloaded</small></div></li>
        <li><CalendarDays size={20} strokeWidth={1.4} /><div>{data.meta.years[0]}-{data.meta.years[1]}<small>Study years</small></div></li>
        <li>
          <Sheet size={20} strokeWidth={1.4} />
          <div>
            Records: {fmtInt(airport ? m.n : data.meta.reports)}
            <small>{airport ? `strike reports in ${MONTHS[month]}, all years` : "strike reports at study airports"}</small>
            <button className="link" onClick={onShowTable}>View data table</button>
          </div>
        </li>
      </ul>
      <p className="disclaimer">
        Public FAA data only. Reporting is voluntary, so rates reflect reporting as well as hazard.
        Not for operational use. <a href={REPO} target="_blank" rel="noreferrer">Method &amp; code</a>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- legend
export function Legend({ mode, month }) {
  return (
    <div className="card legend">
      <h4>{mode === "raw" ? "Raw" : "Estimated"} damaging-strike rate vs national ({MONTHS[month]})</h4>
      <div className="swatches">
        {BINS.map((b) => (
          <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>
        ))}
      </div>
      <p>
        {mode === "raw"
          ? "Each airport's own counts, no pooling: small airports swing wildly."
          : "Faded: 90% interval overlaps the national rate. Size = traffic."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- month slider
export function MonthSlider({ month, onChange }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => onChange((m) => (m + 1) % 12), 1100);
    return () => clearInterval(t);
  }, [playing, onChange]);

  return (
    <div className="card slider">
      <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play months"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="slider-body">
        <div className="slider-label">{MONTHS_LONG[month]}</div>
        <input
          type="range" min="0" max="11" step="1" value={month}
          onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)); }}
          aria-label="Month"
        />
        <div className="ticks">{MONTHS.map((m) => <span key={m}>{m[0]}</span>)}</div>
      </div>
    </div>
  );
}
