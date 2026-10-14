import { useEffect } from "react";
import { X } from "lucide-react";
import { fmtInt } from "../scale.js";

const REPO = "https://github.com/donpams/bird-strike-radar";
const DOC = (path) => `${REPO}/blob/main/${path}`;
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const signedPct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const LABELS = {
  national: "National monthly rate",
  raw: "Raw (own data only)",
  week2: "Simple pooled baseline",
  week2_level: "Baseline + recent level",
  week4: "Hierarchical model (on the map)",
};

// Observed national damaging-strike rate by year, with each model's forecast for the held-out years
function ForecastChart({ r }) {
  const W = 640;
  const H = 220;
  const pad = { l: 54, r: 12, t: 14, b: 30 };
  const years = Object.keys(r.observedByYear).map(Number).sort((a, b) => a - b);
  const obs = years.map((y) => r.observedByYear[y]);
  const all = [...obs, ...Object.values(r.forecastByYear).flatMap((m) => Object.values(m).flat())];
  const lo = Math.floor(Math.min(...all) * 100) / 100;
  const hi = Math.ceil(Math.max(...all) * 100) / 100;
  const x = (y) => pad.l + ((y - years[0]) / (years.at(-1) - years[0])) * (W - pad.l - pad.r);
  const yv = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.01) ticks.push(Number(v.toFixed(2)));
  const [t0, t1] = r.testYears;
  const series = [
    { key: "week2", cls: "rs-w2", dx: -5, label: "Simple baseline forecast" },
    { key: "week4", cls: "rs-w4", dx: 5, label: "Hierarchical forecast" },
  ];
  return (
    <figure className="rs-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Observed national damaging-strike rate by year, with forecasts for the held-out years">
        <rect x={x(t0) - 12} y={pad.t} width={x(t1) - x(t0) + 24} height={H - pad.t - pad.b} className="rs-holdout" />
        <text x={x(t0) - 8} y={pad.t + 11} className="rs-lab">held out</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={yv(v)} y2={yv(v)} className="rs-grid" />
            <text x={pad.l - 6} y={yv(v) + 3} className="rs-lab end">{v.toFixed(2)}</text>
          </g>
        ))}
        {years.filter((y) => y % 3 === 1 || y === years.at(-1)).map((y) => (
          <text key={y} x={x(y)} y={H - 8} className={`rs-lab ${y === years.at(-1) ? "end" : "mid"}`}>{y}</text>
        ))}
        <polyline points={years.map((y, i) => `${x(y)},${yv(obs[i])}`).join(" ")} className="rs-obs" />
        {years.map((y, i) => <circle key={y} cx={x(y)} cy={yv(obs[i])} r="2.6" className="rs-obs-dot" />)}
        {series.map((s) =>
          Object.entries(r.forecastByYear[s.key]).map(([y, [m, l, h]]) => (
            <g key={`${s.key}${y}`} className={s.cls}>
              <line x1={x(+y) + s.dx} x2={x(+y) + s.dx} y1={yv(l)} y2={yv(h)} />
              <rect x={x(+y) + s.dx - 3} y={yv(m) - 3} width="6" height="6" />
            </g>
          )),
        )}
      </svg>
      <figcaption>
        <span><i className="k-obs" />Observed</span>
        {series.map((s) => <span key={s.key}><i className={`k-${s.cls}`} />{s.label} (90%)</span>)}
        <span className="dim">Damaging strikes per 10,000 operations, all study airports</span>
      </figcaption>
    </figure>
  );
}

function Stat({ value, label, note }) {
  return (
    <div className="rs-stat">
      <p className="big">{value}</p>
      <p className="label">{label}</p>
      {note && <p className="dim">{note}</p>}
    </div>
  );
}

export default function Results({ data, onClose }) {
  const r = data.results;
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!r) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Results" onClick={onClose}>
        <div className="glass table-card rs-card" onClick={(e) => e.stopPropagation()}>
          <p className="prose">The evaluation hasn't been run for this data yet.</p>
        </div>
      </div>
    );
  }

  const M = r.models;
  const w4 = M.week4;
  const w2 = M.week2;
  const nat = M.national.log_score;
  const g2 = w2.log_score - nat;
  const g4 = w4.log_score - nat;
  const d = r.week4VsWeek2;
  const covers = (m) => m.forecast_total_lo <= r.observedTotal && r.observedTotal <= m.forecast_total_hi;
  const [t0, t1] = r.testYears;
  const lastObs = r.observedByYear[t1];
  const lastFc = r.forecastByYear.week4[t1];
  const missedLast = lastObs > lastFc[2] || lastObs < lastFc[1];
  const sim = r.simulation;
  const cells = data.airports.flatMap((a) => a.m);
  const riskShare = (lvl) => cells.filter((m) => m.risk === lvl).length / cells.length;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Results: how well does it work?" onClick={onClose}>
      <article className="glass table-card rs-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="label">Results</p>
            <h2>Does the model actually work?</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close results"><X size={18} /></button>
        </header>

        <div className="rs-body">
          <p className="prose lede">
            The real test of a forecast is years it has never seen. Every model was fitted on{" "}
            <b>{r.trainYears[0]}–{r.trainYears[1]}</b> only, then asked to forecast damaging strikes at every airport,
            in every month, for <b>{t0}–{t1}</b>. {fmtInt(r.observedTotal)} damaging strikes actually happened.
          </p>

          <div className="rs-stats">
            <Stat
              value={`${fmtInt(w4.forecast_total)}`}
              label={`Forecast strikes, ${t0}–${t1}`}
              note={`90% ${fmtInt(w4.forecast_total_lo)}–${fmtInt(w4.forecast_total_hi)} · actual ${fmtInt(r.observedTotal)} ${covers(w4) ? "✓" : "✗"}`}
            />
            <Stat
              value={pct(w4.coverage90_busy)}
              label="90% ranges that held"
              note={`busy airport-months (simple baseline: ${pct(w2.coverage90_busy)})`}
            />
            <Stat
              value={`${(g4 / g2).toFixed(2)}×`}
              label="Skill vs simple baseline"
              note={`gain over a national-average forecast: +${(g4 * 1000).toFixed(1)} vs +${(g2 * 1000).toFixed(1)}; ${(d.mean / d.se).toFixed(0)} standard errors apart`}
            />
          </div>

          <h3>Forecasting the years it never saw</h3>
          <ForecastChart r={r} />
          <p className="prose">
            The simple baseline assumes the future looks like the long-run average, so its range sits too low and
            misses the real total ({fmtInt(w2.forecast_total_lo)}–{fmtInt(w2.forecast_total_hi)}). The hierarchical model
            carries the recent trend forward and admits it can't know next year exactly.
            {missedLast && (
              <> <b>Its miss:</b> {t1} jumped above its 90% range, so its forecasts lean low. That's reported, not hidden.</>
            )}
          </p>

          <h3>All five forecasts, scored</h3>
          <div className="table-scroll">
            <table className="rs-table">
              <thead>
                <tr>
                  <th>Forecast</th>
                  <th className="num" title="Average log-probability given to what actually happened, relative to the national-rate forecast, per 1,000 airport-year-months">Score vs national</th>
                  <th className="num" title="Share of airport-months expecting 2+ strikes whose actual count fell inside the 90% range">90% ranges held</th>
                  <th className="num">Total forecast (90%)</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(LABELS).filter((k) => M[k]).map((k) => (
                  <tr key={k} className={k === "week4" ? "is-best" : ""}>
                    <td>{LABELS[k]}</td>
                    <td className="num">
                      {M[k].log_score == null ? `fails (${M[k].impossible_cells} "impossible")` : `${((M[k].log_score - nat) * 1000 >= 0 ? "+" : "")}${((M[k].log_score - nat) * 1000).toFixed(1)}`}
                    </td>
                    <td className="num">{pct(M[k].coverage90_busy)} <span className="dim">of {M[k].busy_cells}</span></td>
                    <td className="num">
                      {fmtInt(M[k].forecast_total)} <span className="dim">({fmtInt(M[k].forecast_total_lo)}–{fmtInt(M[k].forecast_total_hi)})</span>{" "}
                      {covers(M[k]) ? "✓" : "✗"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="prose small dim">
            The score rewards being right <i>and</i> honest about uncertainty. Raw per-airport rates gave{" "}
            {M.raw?.impossible_cells} airport-months a 0% chance, and every one of them then had a strike, which is the
            clearest case for pooling.
          </p>

          {sim && (
            <>
              <h3>Checked against a known answer first</h3>
              <p className="prose">
                Before touching real data, I simulated strikes from known "true" rates at the real airports and traffic,
                then asked both models to recover them.
              </p>
              <div className="rs-stats four">
                <Stat value={pct(sim.hier.coverage90)} label="Truth inside 90% range" note="target ≈ 90%" />
                <Stat value={pct(sim.hier.typical_error)} label="Typical error" note={`simple baseline ${pct(sim.baseline.typical_error)}`} />
                <Stat value={signedPct(sim.hier.bias)} label="Average bias" note={`simple baseline ${signedPct(sim.baseline.bias)}`} />
                <Stat value={sim.hier.rank_corr.toFixed(2)} label="Rank agreement" note={`simple baseline ${sim.baseline.rank_corr.toFixed(2)}`} />
              </div>
            </>
          )}

          <h3>Sampler health on the real data</h3>
          <p className="prose">
            <b>{r.sampler.divergences}</b> divergences, worst R-hat <b>{r.sampler.worstRhat.toFixed(3)}</b> (want &lt; 1.01),
            smallest effective sample size <b>{fmtInt(r.sampler.minEss)}</b>. The fitted model also reproduces the share of
            zero months, the largest month and how clumpy the counts are.
          </p>

          <h3>What MIL-STD-882E says</h3>
          <p className="prose">
            With the standard's thresholds left unmodified, every airport-month is <b>Serious</b> ({pct(riskShare("Serious"))})
            or <b>High</b> ({pct(riskShare("High"))}) per 10,000 operations: a rare but credible catastrophic outcome is
            enough. Re-tuning the thresholds to spread the map across four colours would be fitting the ruler to the
            data, so the map colours by rate relative to national instead. The Mission Planner shows how the level
            changes with the exposure you define.
          </p>

          <h3>What this doesn't prove</h3>
          <ul className="prose rs-list">
            <li>Reporting is voluntary. Forecasting <i>reported</i> strikes well isn't the same as measuring hazard.</li>
            <li>It's one short test window, starting right after the COVID traffic dip.</li>
            <li>Time of day, altitude and aircraft type aren't modelled yet.</li>
          </ul>

          <p className="rs-links">
            <a href={DOC("docs/WHAT_COULD_GO_WRONG.md")} target="_blank" rel="noreferrer">What could go wrong, and how I tested it</a>
            <a href={DOC("reports/week5_evaluation.md")} target="_blank" rel="noreferrer">Full evaluation</a>
            <a href={DOC("reports/week4_hierarchical_model.md")} target="_blank" rel="noreferrer">The model</a>
            <a href={REPO} target="_blank" rel="noreferrer">Code</a>
          </p>
        </div>
      </article>
    </div>
  );
}
