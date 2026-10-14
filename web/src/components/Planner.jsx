import { useEffect, useState } from "react";
import { ArrowRight, Info, X } from "lucide-react";
import { CopyLink, Num, RiskMatrix } from "./Panels.jsx";
import { fmtInt, fmtRate, MONTHS, MONTHS_LONG, RISK_COLORS } from "../scale.js";
import {
  clampOps, monthOptions, nearbyOptions, oneIn, OPS_PRESETS, planMatrix, planOutcome,
} from "../planner.js";

// Expected counts and probabilities span many orders of magnitude, so format by size
const sig2 = (x) => Number(x.toPrecision(2)).toLocaleString("en-US", { maximumSignificantDigits: 2 });
export const fmtCount = (x) => (x == null ? "n/a" : x >= 10 ? fmtInt(x) : x >= 1e-5 ? sig2(x) : "<0.00001");
export function fmtPct(p) {
  if (p == null) return "n/a";
  if (p >= 0.995) return ">99%";
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 1e-7) return `${sig2(p * 100)}%`;
  return "<0.00001%";
}
const fmtChange = (c) => `${c > 0 ? "+" : "−"}${Math.abs(Math.round(c * 100))}%`;

function OpsInput({ ops, onOps }) {
  const [text, setText] = useState(String(ops));
  useEffect(() => setText(String(ops)), [ops]);
  const commit = () => onOps(clampOps(text));
  return (
    <div className="pl-ops">
      <label className="label" htmlFor="pl-ops">Operations in the plan</label>
      <div className="pl-ops-row">
        <input
          id="pl-ops"
          className="pl-input mono"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          aria-describedby="pl-ops-help"
        />
        <span className="dim" id="pl-ops-help">each take-off or landing = 1</span>
      </div>
      <div className="pl-presets" role="group" aria-label="Common plan sizes">
        {OPS_PRESETS.map((p) => (
          <button key={p.ops} className={`pl-preset ${p.ops === ops ? "on" : ""}`} onClick={() => onOps(p.ops)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Expected damaging strikes for this plan in each month; click a bar to move the timeline
function MonthBars({ airport, month, ops, onMonth }) {
  const opts = monthOptions(airport, month);
  const k = ops / 1e4;
  const max = Math.max(...airport.m.map((m) => m.hi)) * k;
  const best = opts.reduce((a, b) => (b.rate < a.rate ? b : a));
  return (
    <div className="pl-block">
      <p className="label">Same plan, other months</p>
      <div className="pl-bars" role="list">
        {opts.map((o) => {
          const rec = airport.m[o.month];
          const cls = o.month === month ? "now" : o.clear ? (o.change < 0 ? "lower" : "higher") : "";
          return (
            <button
              key={o.month}
              role="listitem"
              className={`pl-bar ${cls}`}
              onClick={() => onMonth(o.month)}
              title={`${MONTHS_LONG[o.month]}: ${fmtCount(rec.r * k)} expected (90% ${fmtCount(rec.lo * k)}–${fmtCount(rec.hi * k)})`}
            >
              <span className="pl-bar-range" style={{ bottom: `calc(14px + (100% - 14px) * ${(rec.lo * k) / max})`, height: `calc((100% - 14px) * ${((rec.hi - rec.lo) * k) / max})` }} />
              <span className="pl-bar-fill" style={{ height: `calc((100% - 14px) * ${(rec.r * k) / max})` }} />
              <span className="pl-bar-lab">{MONTHS[o.month][0]}</span>
            </button>
          );
        })}
      </div>
      <p className="prose small">
        {best.month === month ? (
          <>{MONTHS_LONG[month]} is already this airport's lowest month.</>
        ) : (
          <>
            Lowest: <b>{MONTHS_LONG[best.month]}</b>, {fmtChange(best.change)} expected strikes
            {best.clear ? " (clearly lower)." : ", but the intervals overlap, so it isn't clearly lower."}
          </>
        )}{" "}
        <span className="dim">Solid colour = clearly different from {MONTHS[month]}.</span>
      </p>
    </div>
  );
}

function Nearby({ data, airport, month, onPick }) {
  const opts = nearbyOptions(data.airports, airport, month);
  if (!opts.length) return null;
  return (
    <div className="pl-block">
      <p className="label">Nearby airports, {MONTHS[month]} (within 250 km)</p>
      <ul className="pl-near">
        {opts.map((o) => (
          <li key={o.airport.icao}>
            <button onClick={() => onPick(o.airport.icao)} title={`Plan at ${o.airport.name}`}>
              <span className="code">{o.airport.icao}</span>
              <span className="nm">{o.airport.city}, {o.airport.state} <em>{Math.round(o.km)} km</em></span>
              <span className={`chg ${o.clear ? (o.change < 0 ? "lower" : "higher") : ""}`}>{fmtChange(o.change)}</span>
              <ArrowRight size={13} />
            </button>
          </li>
        ))}
      </ul>
      <p className="prose small dim">Bold change = clearly different. Strike risk is only one input to choosing an airport.</p>
    </div>
  );
}

export default function Planner({ data, airport, month, ops, onOps, onMonth, onPick, onClose }) {
  const m = airport?.m[month];
  const out = m && planOutcome(m, ops);
  const plan = m && planMatrix(m.r, ops, data.severity, data.matrix);
  const planLo = m && planMatrix(m.lo, ops, data.severity, data.matrix);
  const planHi = m && planMatrix(m.hi, ops, data.severity, data.matrix);
  const n = out && oneIn(out.pAny.mean);

  return (
    <aside className="glass inspector planner" aria-live="polite">
      <div className="insp-head">
        <p className="label">Mission Planner{airport ? ` · ${airport.icao} · ${MONTHS_LONG[month]}` : ""}</p>
        <div className="insp-actions">
          <CopyLink />
          <button className="icon-btn" onClick={onClose} aria-label="Close the planner">
            <X size={15} />
          </button>
        </div>
      </div>

      {!airport ? (
        <div className="fade">
          <h2>Plan operations at an airport</h2>
          <p className="prose">
            Pick an airport on the map or with search, choose the month on the timeline, and enter how many take-offs and
            landings you're planning. The planner turns the model's rate into the chance of a damaging strike for <i>your</i>{" "}
            plan, and shows where it sits on the MIL-STD-882E matrix.
          </p>
          <p className="prose soft">Try a busy airport in October, then the same plan in June.</p>
        </div>
      ) : (
        <div className="fade" key={airport.icao}>
          <h2>{airport.name}</h2>
          <OpsInput ops={ops} onOps={onOps} />

          <div className="readout">
            <div>
              <p className="label">Expected damaging</p>
              <p className="big"><Num value={out.expected.mean} format={fmtCount} /></p>
              <p className="dim">90% {fmtCount(out.expected.lo)}–{fmtCount(out.expected.hi)}</p>
            </div>
            <div>
              <p className="label">Chance of ≥ 1</p>
              <p className="big"><Num value={out.pAny.mean} format={fmtPct} /></p>
              <p className="dim">{n ? `about 1 in ${fmtInt(n)} plans` : `90% ${fmtPct(out.pAny.lo)}–${fmtPct(out.pAny.hi)}`}</p>
            </div>
          </div>
          <p className="prose small dim pl-basis">
            {fmtRate(m.r)} damaging strikes per 10,000 operations ({MONTHS[month]}, current conditions) × {fmtInt(ops)} operations.
          </p>

          <div className="risk-line">
            <p className="label">882E for this plan</p>
            <span className="chip" style={{ "--c": RISK_COLORS[plan.risk] }}>{plan.risk}</span>
            {planLo.risk !== planHi.risk && <span className="dim">range {planLo.risk}–{planHi.risk}</span>}
          </div>
          <RiskMatrix
            data={data}
            levels={plan.levels}
            caption={
              <>
                Exposure = your plan ({fmtInt(ops)} operations). The map uses 10,000 operations, where this airport-month is{" "}
                <b>{m.risk}</b>. 882E asks you to define the exposure, and the answer depends on it.
              </>
            }
          />

          <MonthBars airport={airport} month={month} ops={ops} onMonth={onMonth} />
          <Nearby data={data} airport={airport} month={month} onPick={onPick} />

          <details className="pl-assume">
            <summary><Info size={13} /> What this assumes</summary>
            <ul>
              <li>Rates are for <b>reported, known-damaging</b> strikes at recent (2023–25) reporting levels; unknown-damage
                reports are excluded, so this is a slight underestimate.</li>
              <li>Every operation at the airport is treated alike. Time of day, altitude, aircraft type and runway aren't
                modelled, and they matter.</li>
              <li>Strikes are treated as independent (Poisson). Real strikes cluster a little, which slightly lowers the
                chance of at least one for the same expected count.</li>
              <li>Severity shares are national, not airport-specific.</li>
              <li>Not for operational use: a teaching tool built on public data.</li>
            </ul>
          </details>
        </div>
      )}
    </aside>
  );
}
