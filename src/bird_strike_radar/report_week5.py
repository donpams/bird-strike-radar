"""Week 5 report: temporal holdout evaluation (fit 2010-2022, forecast 2023-2025).

Output: reports/week5_evaluation.md + reports/figures/week5_*.png
"""

from __future__ import annotations

import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import paths
from .evaluate import EVAL_CELLS, EVAL_JSON, LABELS, MODELS, TEST_YEARS, TRAIN_YEARS
from .report_week1 import BLUE, INK_2, ORANGE, _md_table, _save

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fig_years(s: dict) -> str:
    obs = pd.Series(s["observed_by_year"]).sort_index()
    obs.index = obs.index.astype(int)
    fig, ax = plt.subplots(figsize=(7.0, 3.2))
    ax.axvspan(TEST_YEARS[0] - 0.5, TEST_YEARS[1] + 0.5, color=INK_2, alpha=0.06, linewidth=0)
    ax.plot(obs.index, obs.values, color=INK_2, lw=1.5, marker="o", ms=3.5, label="Observed", zorder=3)
    for name, color, dx in (("week2", ORANGE, -0.12), ("week4", BLUE, 0.12)):
        yf = {int(k): v for k, v in s["yearly_forecast"][name].items()}
        xs = np.array(sorted(yf)) + dx
        mean = np.array([yf[k][0] for k in sorted(yf)])
        lo = np.array([yf[k][1] for k in sorted(yf)])
        hi = np.array([yf[k][2] for k in sorted(yf)])
        ax.errorbar(xs, mean, yerr=[mean - lo, hi - mean], fmt="s", ms=4, color=color, capsize=2, lw=1.2,
                    label=f"{LABELS[name]} forecast (90%)")
    ax.text(TEST_YEARS[0] - 0.4, ax.get_ylim()[1], "held out", color=INK_2, fontsize=8, va="top")
    ax.set_ylabel("Damaging strikes per 10k ops\n(all study airports)")
    ax.set_title("Forecasting years the models never saw", loc="left")
    ax.legend(fontsize=7.5, frameon=False, loc="upper left")
    ax.grid(axis="x", visible=False)
    return _save(fig, "week5_forecast_years.png")


def fig_calibration(c: pd.DataFrame) -> str:
    fig, ax = plt.subplots(figsize=(4.6, 4.0))
    hi = 0
    for name, color in (("week2", ORANGE), ("week4", BLUE)):
        pred = c[f"{name}_mean"]
        bins = pd.qcut(pred.rank(method="first"), 10, labels=False)
        g = c.assign(pred=pred, bin=bins).groupby("bin").agg(pred=("pred", "mean"), obs=("observed", "mean"))
        ax.plot(g.pred, g.obs, marker="o", ms=4, color=color, lw=1.5, label=LABELS[name])
        hi = max(hi, g.pred.max(), g.obs.max())
    ax.plot([0, hi * 1.05], [0, hi * 1.05], color=INK_2, lw=1, ls="--", label="Perfect calibration")
    ax.set_xlabel("Forecast damaging strikes per airport-month\n(2023-25 total, decile average)")
    ax.set_ylabel("Observed (decile average)")
    ax.set_title("Calibration", loc="left")
    ax.legend(fontsize=7.5, frameon=False)
    return _save(fig, "week5_calibration.png")


def fig_pit(c: pd.DataFrame) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.8), sharey=True)
    for ax, (name, color) in zip(axes, (("week2", ORANGE), ("week4", BLUE))):
        ax.hist(c[f"{name}_pit"], bins=np.linspace(0, 1, 11), color=color, alpha=0.75, density=True)
        ax.axhline(1, color=INK_2, lw=1, ls="--")
        ax.set_title(LABELS[name], loc="left")
        ax.grid(axis="x", visible=False)
    axes[0].set_ylabel("Density (flat = calibrated)")
    fig.supxlabel("Where the observed count fell in the forecast (PIT): right edge = more strikes than forecast",
                  fontsize=8.5, color=INK_2)
    return _save(fig, "week5_pit.png")


def _fmt_total(m: dict) -> str:
    return f"{m['forecast_total']:,.0f} ({m['forecast_total_lo']:,.0f}-{m['forecast_total_hi']:,.0f})"


def build() -> str:
    s = json.loads(EVAL_JSON.read_text())
    c = pd.read_parquet(EVAL_CELLS)
    M = s["metrics"]
    nat = M["national"]["log_score"]

    def gain(name):
        v = M[name]["log_score"]
        if not np.isfinite(v):
            return f"impossible ({M[name]['impossible_cells']} airport-months given 0% chance)"
        return f"{(v - nat) * 1000:+.1f}"

    def total_ok(name):
        m = M[name]
        return "yes" if m["forecast_total_lo"] <= s["observed_total"] <= m["forecast_total_hi"] else "**no**"

    score = pd.DataFrame({
        "Model": [LABELS[k] for k in MODELS],
        "Log score vs national (per 1,000 cells)": [gain(k) for k in MODELS],
        f"90% range covers ({M['week4']['busy_cells']} busiest airport-months)": [f"{M[k]['coverage90_busy']:.0%}" for k in MODELS],
        "Below 5% / above 95%": [f"{M[k]['pit_low']:.1%} / {M[k]['pit_high']:.1%}" for k in MODELS],
        "Forecast total (90%)": [_fmt_total(M[k]) for k in MODELS],
        "Covers observed?": [total_ok(k) for k in MODELS],
        "Top-10% lift": [f"{M[k]['top10_lift']:.2f}x" for k in MODELS],
    })

    d = s["week4_minus_week2_logscore"]
    g2 = M["week2"]["log_score"] - nat
    g4 = M["week4"]["log_score"] - nat
    gl = M["week2_level"]["log_score"] - nat
    z = d["mean"] / d["se"]

    # Failure cases: held-out airport-months the hierarchical model found most surprising
    c = c.copy()
    c["surprise"] = np.log((c.observed + 0.5) / (c.week4_mean + 0.5))
    tails = c[(c.week4_pit < 0.025) | (c.week4_pit > 0.975)]
    worst = tails.reindex(tails.surprise.abs().sort_values(ascending=False).index).head(10)
    fail = pd.DataFrame({
        "Airport": worst.icao, "Month": worst.month.map(lambda m: MONTHS[m - 1]),
        "Forecast (90%)": [f"{r.week4_mean:.2g} ({r.week4_lo:.0f}-{r.week4_hi:.0f})" for r in worst.itertuples()],
        "Observed 2023-25": worst.observed.astype(int),
        "Direction": np.where(worst.surprise > 0, "under-forecast", "over-forecast"),
    })
    n_tail = len(tails)
    expected_tail = 0.05 * len(c)
    under = int((tails.surprise > 0).sum())

    frac = (gl - g2) / (g4 - g2) if g4 != g2 else float("nan")
    if frac < 0.5:
        trend_line = (f"**Most of the advantage is not the trend.** Giving Week 2 a crude \"recent level\" fix recovers only "
                      f"{frac:.0%} of the gap; the rest comes from the structure (flyway seasons, airport seasonality, "
                      "airport trends).")
    else:
        trend_line = (f"**Much of the advantage is the trend.** Giving Week 2 a crude \"recent level\" fix recovers "
                      f"{frac:.0%} of the gap to Week 4.")
    # Test years whose observed national rate fell outside Week 4's 90% forecast
    yf = s["yearly_forecast"]["week4"]
    missed = [int(y) for y, (mn, lo, hi) in yf.items() if not lo <= s["observed_by_year"][str(y)] <= hi]
    if missed:
        year_line = (f" One caveat: the observed national rate in {', '.join(map(str, missed))} came in above Week 4's 90% "
                     "range for that year. The national rate (reporting, hazard or both) jumped faster than the random walk expected, and that is "
                     "the main reason most of the failure cases below are under-forecasts.")
    else:
        year_line = " Every test year's national rate fell inside Week 4's 90% range."

    f1, f2, f3 = fig_years(s), fig_calibration(c), fig_pit(c)
    obs_total = s["observed_total"]

    return f"""# Week 5 - Does the model predict years it hasn't seen?

_Generated by `src/bird_strike_radar/report_week5.py`._

## The test

Every model was fitted on **{TRAIN_YEARS[0]}-{TRAIN_YEARS[1]} only**, then asked to forecast damaging strikes at each
study airport, in each month, for **{TEST_YEARS[0]}-{TEST_YEARS[1]}** ({s['cells']:,} airport-year-months; {obs_total:,} damaging
strikes actually happened). Traffic in the test years is treated as known (a planner knows the schedule);
strikes are what is forecast. The hierarchical model was refitted from scratch on the training years
({s['week4_divergences']} divergences), and its year random walk and airport trends were extended into the
future with their own uncertainty.

## Scorecard

{_md_table(score)}

How to read it:
- **Log score** is the main score: the average log-probability each model gave to what actually happened.
  It rewards being right *and* being honest about uncertainty. Shown as the gain over the national-rate
  model per 1,000 airport-year-months; higher is better.
- **Coverage** is checked on the airport-months expecting 2+ strikes. Most airport-months expect 0-1, where any
  sensible range covers almost everything, so the all-cell number ({M['week4']['coverage90']:.0%} for Week 4) says little.
- **Below 5% / above 95%** should each be about 5% if the forecasts are calibrated.
- **Top-10% lift**: in the 10% of airport-months each model ranked riskiest, how many times the average
  rate actually occurred.

## What it means

- **The hierarchical model wins on the main score.** It beats the Week 2 baseline in a cell-by-cell comparison
  by {d['mean'] * 1000:.1f} ± {d['se'] * 1000:.1f} per 1,000 cells (about {z:.0f} standard errors). Of the gain from knowing
  *which airport* you're at (beyond the national rate), Week 4 captures {g4 / g2:.2f}x what Week 2 does.
- {trend_line}
- **The volume forecast is honest.** {obs_total:,} damaging strikes happened. Week 4 forecast
  {_fmt_total(M['week4'])}{', which contains the truth' if total_ok('week4') == 'yes' else ', which misses it'}; Week 2 forecast
  {_fmt_total(M['week2'])}{', which contains the truth' if total_ok('week2') == 'yes' else ' and is confidently wrong'}. Week 2 assumes the future
  looks like the 13-year average; Week 4 carries recent reporting growth forward and admits it can't
  know next year's level precisely.{year_line}
- **Raw rates fail outright.** An airport-month with no damaging strikes in training gets a raw rate of zero,
  i.e. "impossible", and {M['raw']['impossible_cells']} of those then had a strike. That is the clearest argument for pooling.
- **Ranking is modest for every model.** A 3-year window is short and damaging strikes are rare, so observed
  airport-month rates are noisy. Still, the 10% of airport-months Week 4 ranked riskiest saw
  {M['week4']['top10_lift']:.1f}x the average rate. Raw rates rank slightly better ({M['raw']['top10_lift']:.1f}x) but would have
  called {M['raw']['impossible_cells']} airport-months impossible that then had strikes: good at ranking, dangerous as a forecast.

![Forecast by year]({f1})

![Calibration]({f2})

![PIT]({f3})

## Failure cases

{n_tail} held-out airport-months fell in Week 4's outer 2.5% tails (about {expected_tail:.0f} expected by chance with
perfect calibration); {under} of them were under-forecasts. The biggest surprises:

{_md_table(fail)}

These are where the tool would have misled a user. The usual causes are a one-off cluster (a single flock
producing several damaging strikes), a change in an airport's reporting, or a genuine change in its wildlife
situation. Strike data alone can't tell these apart; checking the narratives for these cases is a manual next step.

## Limitations of this evaluation

- Study airports were chosen using traffic from all years, including 2023-2025. That uses exposure only,
  never strike counts, so it doesn't leak the outcome, but it does assume each airport is still operating.
- Test traffic is treated as known. A real forecast would also be uncertain about operations.
- Three test years is a single, short window, and it starts right after the COVID traffic dip.
- Good forecasts of *reported* damaging strikes are not proof of good forecasts of *hazard*: if reporting
  keeps changing, a model can predict reports well while hazard moves differently.
"""


def run() -> None:
    out = paths.REPORTS / "week5_evaluation.md"
    out.write_text(build())
    print(f"report -> {out.relative_to(paths.ROOT)}")


if __name__ == "__main__":
    run()
