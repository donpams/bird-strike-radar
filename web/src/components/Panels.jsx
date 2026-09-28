import { useEffect, useRef, useState } from "react";
import {
  Flame, House, Map as MapIcon, Moon, PanelRightClose, PanelRightOpen, Pause, Play, Route, Sun, SunMoon,
  Table2, X,
} from "lucide-react";
import {
  fmtInt, fmtRate, fmtRel, isDistinct, legendGradient, legendPos, LEVELS, MONTHS, MONTHS_LONG,
  prefersReducedMotion, RISK_COLORS, SEVERITY_NAMES,
} from "../scale.js";

const REPO = "https://github.com/donpams/bird-strike-radar";
const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Numbers glide to their new value instead of snapping (skipped for reduced motion)
function useTween(value, ms = 450) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value == null || prefersReducedMotion()) {
      setV(value);
      from.current = value;
      return;
    }
    const a = from.current ?? value;
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const f = Math.min(1, (now - start) / ms);
      const cur = a + (value - a) * (1 - Math.pow(1 - f, 3));
      from.current = cur;
      setV(cur);
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}
const Num = ({ value, format }) => <>{format(useTween(value))}</>;

// ---------------------------------------------------------------- brand (top-left)
function RadarMark() {
  return (
    <svg className="radar-mark" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" className="ring" />
      <circle cx="20" cy="20" r="12" className="ring" />
      <circle cx="20" cy="20" r="6" className="ring" />
      <g className="sweep">
        <path d="M20 20 L38 20 A18 18 0 0 0 32.7 7.3 Z" fill="url(#sweep)" />
        <line x1="20" y1="20" x2="38" y2="20" className="beam" />
      </g>
      <circle cx="28.5" cy="13" r="1.8" className="blip" />
    </svg>
  );
}

export function Brand({ data }) {
  return (
    <header className="glass brand">
      <RadarMark />
      <div>
        <h1>Bird Strike Radar</h1>
        <p className="kicker">
          {data ? `${data.meta.airportCount} US airports · ${data.meta.years[0]}–${data.meta.years[1]}` : "Loading…"}
        </p>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- dock (top-centre)
const TOOLS = [
  { id: "estimated", icon: Flame, label: "Estimated", title: "Estimated risk (pooled model)" },
  { id: "raw", icon: MapIcon, label: "Raw", title: "Raw reports (each airport's own data)" },
  { id: "planner", icon: Route, label: "Planner", title: "Mission Planner (coming soon)", disabled: true },
  { id: "table", icon: Table2, label: "Table", title: "Data table" },
];
const THEME_ICON = { auto: SunMoon, light: Sun, dark: Moon };
const THEME_LABEL = { auto: "Auto", light: "Day", dark: "Night" };
const THEME_TITLE = { auto: "Auto: day or night by your clock", light: "Day", dark: "Night" };

export function Dock({ active, onTool, themeMode, onTheme, inspectorOpen, onToggleInspector }) {
  const ThemeIcon = THEME_ICON[themeMode];
  return (
    <nav className="glass dock" aria-label="Tools">
      <div className="seg" role="group" aria-label="View">
        {TOOLS.map(({ id, icon: Icon, label, title, disabled }) => (
          <button
            key={id}
            className={`seg-btn ${active === id ? "is-active" : ""}`}
            onClick={() => !disabled && onTool(id)}
            disabled={disabled}
            title={title}
            aria-pressed={active === id}
          >
            <Icon size={16} strokeWidth={1.8} />
            <span>{label}</span>
            {disabled && <em>soon</em>}
          </button>
        ))}
      </div>
      <span className="dock-sep" />
      <button
        className="dock-btn"
        onClick={onTheme}
        title={`${THEME_TITLE[themeMode]} (click to change)`}
        aria-label={`Theme: ${THEME_TITLE[themeMode]}`}
      >
        <ThemeIcon size={17} strokeWidth={1.8} />
        <span className="dock-btn-label">{THEME_LABEL[themeMode]}</span>
      </button>
      <button className="dock-btn" onClick={() => onTool("home")} title="Reset view" aria-label="Reset view">
        <House size={17} strokeWidth={1.8} />
      </button>
      <button
        className="dock-btn"
        onClick={onToggleInspector}
        title={inspectorOpen ? "Hide panel" : "Show panel"}
        aria-label={inspectorOpen ? "Hide panel" : "Show panel"}
      >
        {inspectorOpen ? <PanelRightClose size={17} strokeWidth={1.8} /> : <PanelRightOpen size={17} strokeWidth={1.8} />}
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------- 882E matrix
const probLevel = (p) => (p >= 0.1 ? "A" : p >= 0.01 ? "B" : p >= 0.001 ? "C" : p >= 1e-6 ? "D" : "E");
function nationalLevels(data, month) {
  const rate = data.national.rate[month];
  return data.severity.map((s) => probLevel(1 - Math.exp(-rate * s.share)));
}
const SEV_SHORT = ["Cat", "Crit", "Marg", "Negl"];

function RiskMatrix({ data, levels }) {
  return (
    <div className="matrix" role="table" aria-label="MIL-STD-882E risk assessment matrix">
      <div className="matrix-grid">
        <div />
        {SEV_SHORT.map((s, j) => (
          <div key={s} className="mx-col" role="columnheader" title={SEVERITY_NAMES[j]}>
            {s}<span>{j + 1}</span>
          </div>
        ))}
        {LEVELS.map((L) => (
          <MatrixRow key={L} L={L} data={data} levels={levels} />
        ))}
      </div>
      <p className="caption">
        One cell per severity: likelihood of at least one such strike in {fmtInt(data.meta.exposureOps)} operations.
        The worst cell sets the overall risk.
      </p>
    </div>
  );
}

function MatrixRow({ L, data, levels }) {
  return (
    <>
      <div className="mx-row" role="rowheader" title={data.probability[L]}>
        <span>{L}</span>{data.probability[L]}
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

// ---------------------------------------------------------------- inspector (right)
export function Inspector({ data, airport, month, mode, onClear, onShowTable }) {
  const nat = data.national.rate[month];
  const m = airport?.m[month];
  const aboveCount = data.airports.filter((a) => a.m[month].rlo > 1).length;
  const levels = m ? m.lv : nationalLevels(data, month);
  const overall = m
    ? m.risk
    : ["High", "Serious", "Medium", "Low"].find((r) => levels.some((L, j) => data.matrix[L][j] === r));

  return (
    <aside className="glass inspector" aria-live="polite">
      <div className="insp-head">
        <p className="label">{airport ? `${airport.icao} · ${airport.city}, ${airport.state}` : "National overview"}</p>
        {airport && (
          <button className="icon-btn" onClick={onClear} aria-label="Back to national overview">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="fade" key={airport ? airport.icao : "national"}>
        <h2>{airport ? airport.name : `${MONTHS_LONG[month]} across the US`}</h2>

        <div className="readout">
          <div>
            <p className="label">Damaging / 10k ops</p>
            <p className="big"><Num value={m ? m.r : nat} format={fmtRate} /></p>
            <p className="dim">
              {m ? <>90% <Num value={m.lo} format={fmtRate} />–<Num value={m.hi} format={fmtRate} /></> : "national rate"}
            </p>
          </div>
          <div>
            <p className="label">{m ? "vs national" : "Clearly above"}</p>
            <p className="big">{m ? <Num value={m.rel} format={fmtRel} /> : aboveCount}</p>
            <p className="dim">
              {m ? (isDistinct(m) ? (m.rel > 1 ? "clearly above" : "clearly below") : "within the noise") : "airports this month"}
            </p>
          </div>
        </div>

        <p className="prose">
          {!airport ? (
            <>
              Circles are sized by traffic and coloured against the national rate for {MONTHS_LONG[month]}. Pulsing
              rings mark airports whose whole 90% interval sits above it. Select one to inspect it.
            </>
          ) : mode === "raw" ? (
            <>
              Raw (own data only): {fmtRate(m.raw)} from {m.d} damaging strikes in {fmtInt(m.ops)} operations,{" "}
              {MONTHS[month]} {data.meta.years[0]}–{data.meta.years[1]}.
            </>
          ) : (
            <>
              Estimated with partial pooling across all {data.meta.airportCount} airports: {Math.round(m.sh * 100)}% of
              this estimate comes from the national prior, the rest from {airport.icao}'s own {m.d} damaging strikes.
            </>
          )}
        </p>

        <div className="risk-line">
          <p className="label">MIL-STD-882E</p>
          <span className="chip" style={{ "--c": RISK_COLORS[overall] }}>{overall}</span>
          {m && m.riskLo !== m.riskHi && <span className="dim">range {m.riskLo}–{m.riskHi}</span>}
        </div>
        <RiskMatrix data={data} levels={levels} />
      </div>

      <dl className="plate">
        <dt>Model run</dt>
        <dd>{fmtDate(data.meta.generated)}</dd>
        <dt>FAA data</dt>
        <dd>{fmtDate(data.meta.strikeDataDownloaded)}</dd>
        <dt>Window</dt>
        <dd>{data.meta.years[0]}–{data.meta.years[1]}</dd>
        <dt>Records</dt>
        <dd>
          {fmtInt(airport ? m.n : data.meta.reports)}{" "}
          <button className="link" onClick={onShowTable}>open table</button>
        </dd>
      </dl>
      <p className="disclaimer">
        Public FAA data only. Reporting is voluntary, so rates reflect reporting as well as hazard. Not for operational
        use. <a href={REPO} target="_blank" rel="noreferrer">Method &amp; code</a>
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------- legend (bottom-left)
const TICKS = [0.5, 0.8, 1, 1.25, 2];

export function Legend({ mode, month, theme }) {
  return (
    <div className="glass legend">
      <p className="label">{mode === "raw" ? "Raw" : "Estimated"} rate vs national · {MONTHS[month]}</p>
      <div className="gradient" style={{ background: legendGradient(theme) }} aria-hidden="true" />
      <div className="gradient-ticks" aria-label="Scale: under 0.5x to 2x or more the national rate">
        {TICKS.map((v) => (
          <span key={v} className={v === 0.8 || v === 1.25 ? "minor" : ""} style={{ left: `${legendPos(v) * 100}%` }}>
            {v === 1 ? "1x" : v === 0.8 || v === 1.25 ? "" : `${v}x`}
          </span>
        ))}
      </div>
      <p className="legend-note">
        {mode === "raw"
          ? "Own counts, no pooling: small airports swing wildly."
          : "Rings: clearly above national · faded: within the noise · size: traffic"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- timeline (bottom-centre)
const MS_PER_MONTH = 1400;
const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);

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

export function Timeline({ month, national, onChange, onFloat }) {
  const [x, setX] = useState(month);
  const [playing, setPlaying] = useState(false);
  const xRef = useRef(month);
  const anim = useRef(0);

  const apply = (v) => {
    const w = ((v % 12) + 12) % 12;
    xRef.current = w;
    setX(w);
    onFloat(w);
    onChange(Math.round(w) % 12);
  };

  // Glide to a whole month (after dragging or keyboard steps)
  const glideTo = (target, ms = 380) => {
    cancelAnimationFrame(anim.current);
    const from = xRef.current;
    let to = target;
    if (to - from > 6) to -= 12;
    if (from - to > 6) to += 12;
    const start = performance.now();
    const step = (now) => {
      const f = Math.min(1, (now - start) / ms);
      apply(from + (to - from) * ease(f));
      if (f < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  // Continuous playback: each month eases into the next, with a short hold on each one
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
    <div className="glass timeline">
      <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play months"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="tl-body">
        <div className="tl-head">
          <span className="month-name" key={shown}>{MONTHS_LONG[shown]}</span>
          <span className="dim">
            national <b className="mono">{fmtRate(national[shown])}</b> / 10k ops
          </span>
        </div>
        <div className="track">
          <Sparkline rates={national} />
          <input
            type="range"
            min="0"
            max="11.99"
            step="0.01"
            value={x}
            onChange={(e) => {
              setPlaying(false);
              cancelAnimationFrame(anim.current);
              apply(Number(e.target.value));
            }}
            onPointerUp={() => glideTo(Math.round(xRef.current) % 12)}
            onKeyUp={() => glideTo(Math.round(xRef.current) % 12)}
            aria-label="Month"
            aria-valuetext={MONTHS_LONG[shown]}
          />
        </div>
        <div className="ticks">
          {MONTHS.map((m, i) => (
            <span key={m} className={i === shown ? "on" : ""}>{m.toUpperCase()}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- HUD readout (bottom-right)
export function Hud({ hudRef }) {
  return (
    <div className="hud" aria-hidden="true">
      <span ref={hudRef}>—</span>
    </div>
  );
}
