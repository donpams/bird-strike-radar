import { useEffect, useRef, useState } from "react";
import {
  Bird, CalendarDays, ChevronsLeft, ChevronsRight, Clock, Flame, House, Info, Map as MapIcon,
  Pause, Play, Route, Sheet, Table2, X,
} from "lucide-react";
import {
  fmtInt, LEGEND_GRADIENT, legendPos, prefersReducedMotion, fmtRate, fmtRel, isDistinct, LEVELS, MONTHS, MONTHS_LONG, RISK_COLORS, SEVERITY_NAMES,
} from "../scale.js";

const REPO = "https://github.com/donpams/bird-strike-radar";

// Numbers glide to their new value instead of snapping (skipped for reduced motion)
function useTween(value, ms = 450) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value == null || prefersReducedMotion()) { setV(value); from.current = value; return; }
    const a = from.current ?? value;
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const f = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - f, 3);
      const cur = a + (value - a) * e;
      from.current = cur;
      setV(cur);
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

function Num({ value, format }) {
  return <>{format(useTween(value))}</>;
}
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

      <div className="fade" key={airport ? airport.icao : "national"}>
      <h3>Summary</h3>
      {!airport ? (
        <p className="muted">
          Estimated damaging bird strikes per {fmtInt(data.meta.exposureOps)} operations at{" "}
          {data.meta.airportCount} US commercial airports in {MONTHS_LONG[month]}: <b><Num value={nat} format={fmtRate} /></b> nationally.{" "}
          {aboveCount} airports are clearly above that this month. Circles are sized by traffic and coloured against
          the national rate. Click one for detail.
        </p>
      ) : (
        <>
          <p className="muted">
            {MONTHS_LONG[month]}: an estimated <b><Num value={m.r} format={fmtRate} /></b> damaging strikes per{" "}
            {fmtInt(data.meta.exposureOps)} operations (90% interval <Num value={m.lo} format={fmtRate} />-<Num value={m.hi} format={fmtRate} />),{" "}
            <b><Num value={m.rel} format={fmtRel} /></b> the national rate.{" "}
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
      </div>

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
const TICKS = [0.5, 0.8, 1, 1.25, 2];

export function Legend({ mode, month }) {
  return (
    <div className="card legend">
      <h4>{mode === "raw" ? "Raw" : "Estimated"} damaging-strike rate vs national ({MONTHS[month]})</h4>
      <div className="gradient" style={{ background: LEGEND_GRADIENT }} aria-hidden="true" />
      <div className="gradient-ticks" aria-label="Scale: under 0.5x to 2x or more the national rate">
        {TICKS.map((v) => (
          <span key={v} className={v === 0.8 || v === 1.25 ? "minor" : ""} style={{ left: `${legendPos(v) * 100}%` }}>
            {v === 1 ? "national" : v === 0.8 || v === 1.25 ? "" : `${v}x`}
          </span>
        ))}
      </div>
      <p>
        {mode === "raw"
          ? "Each airport's own counts, no pooling: small airports swing wildly."
          : "Rings pulse where the rate is clearly above national. Faded: within the noise. Size = traffic."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- month slider
const MS_PER_MONTH = 1400; // playback speed
const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2); // easeInOutCubic

// National seasonality drawn behind the track: a small "alive" hint of the migration peaks
function Sparkline({ rates }) {
  const max = Math.max(...rates);
  const pts = [...rates, rates[0]].map((r, i) => [(i / 12) * 100, 28 - (r / max) * 24]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L100,30 L0,30 Z`} className="spark-area" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MonthSlider({ month, national, onChange, onFloat }) {
  const [x, setX] = useState(month); // fractional month shown by the thumb
  const [playing, setPlaying] = useState(false);
  const xRef = useRef(month);
  const anim = useRef(0);

  const apply = (v) => {
    const w = ((v % 12) + 12) % 12;
    xRef.current = w;
    setX(w);
    onFloat(w);
    const m = Math.round(w) % 12;
    if (m !== month) onChange(m);
  };

  // Smoothly glide to a whole month (used after dragging and for keyboard steps)
  const glideTo = (target, ms = 380) => {
    cancelAnimationFrame(anim.current);
    const from = xRef.current;
    let to = target;
    if (to - from > 6) to -= 12; // take the short way round Dec <-> Jan
    if (from - to > 6) to += 12;
    const start = performance.now();
    const step = (now) => {
      const f = Math.min(1, (now - start) / ms);
      apply(from + (to - from) * ease(f));
      if (f < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  // Continuous playback: each month eases into the next, with a short hold on each month
  useEffect(() => {
    if (!playing) return;
    let start = performance.now();
    let from = Math.round(xRef.current);
    const hold = prefersReducedMotion() ? 0 : 0.25;
    const step = (now) => {
      let f = (now - start) / MS_PER_MONTH;
      if (f >= 1) {
        from = (from + 1) % 12;
        start = now;
        f = 0;
      }
      const g = f < hold ? 0 : (f - hold) / (1 - hold);
      apply(from + ease(g));
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(anim.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  const shown = Math.round(x) % 12;
  return (
    <div className="card slider">
      <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play months"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="slider-body">
        <div className="slider-label">
          <span className="month-name" key={shown}>{MONTHS_LONG[shown]}</span>
          <span className="muted small">national {fmtRate(national[shown])} per 10k ops</span>
        </div>
        <div className="track">
          <Sparkline rates={national} />
          <input
            type="range" min="0" max="11.99" step="0.01" value={x}
            onChange={(e) => { setPlaying(false); cancelAnimationFrame(anim.current); apply(Number(e.target.value)); }}
            onPointerUp={() => glideTo(Math.round(xRef.current) % 12)}
            onKeyUp={() => glideTo(Math.round(xRef.current) % 12)}
            aria-label="Month"
            aria-valuetext={MONTHS_LONG[shown]}
          />
        </div>
        <div className="ticks">{MONTHS.map((m) => <span key={m}>{m[0]}</span>)}</div>
      </div>
    </div>
  );
}
