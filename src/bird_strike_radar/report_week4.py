"""Week 4 report: the hierarchical model vs the Week 2 baseline.

Output: reports/week4_hierarchical_model.md + reports/figures/week4_*.png
"""

from __future__ import annotations

import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import hier_model as hm
from . import paths
from .baseline import BASELINE_PARQUET
from .fit_hier import DIAG_JSON, EFFECTS_PARQUET, HIER_PARQUET
from .report_week1 import BLUE, INK_2, ORANGE, _md_table, _save

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
# Flyway series colours: first four slots of the validated categorical palette, fixed order
FLY_COLORS = {"Pacific": "#2a78d6", "Central": "#eb6834", "Mississippi": "#1baf7a", "Atlantic": "#4a3aa7"}


def fig_flyways(eff: pd.DataFrame) -> str:
    fig, ax = plt.subplots(figsize=(7.0, 3.4))
    ends = {}
    for f in hm.FLYWAYS:
        g = eff[(eff.kind == "flyway_season") & (eff.group == f)].sort_values("x")
        ax.fill_between(g.x, g.lo, g.hi, color=FLY_COLORS[f], alpha=0.12, linewidth=0)
        ax.plot(g.x, g["mean"], color=FLY_COLORS[f], lw=2)
        ends[f] = float(g["mean"].iloc[-1])
    ax.set_xticks(range(1, 13), MONTHS)
    ax.set_xlim(0.7, 13.6)
    ax.set_ylim(bottom=0)
    # End labels: nudge apart so lines that finish close together don't overlap
    gap = 0.07 * ax.get_ylim()[1]
    placed = []
    for f, yv in sorted(ends.items(), key=lambda kv: kv[1]):
        if placed and yv - placed[-1] < gap:
            yv = placed[-1] + gap
        placed.append(yv)
        ax.text(12.15, yv, f, color=FLY_COLORS[f], va="center", fontsize=8)
    ax.set_ylabel("Damaging strikes per 10k ops\n(typical airport, average year)")
    ax.set_title("Each flyway has its own seasonal shape", loc="left")
    ax.grid(axis="x", visible=False)
    return _save(fig, "week4_flyway_seasons.png")


def fig_years(eff: pd.DataFrame) -> str:
    g = eff[eff.kind == "year"].sort_values("x")
    fig, ax = plt.subplots(figsize=(6.4, 2.9))
    ax.fill_between(g.x, g.lo, g.hi, color=BLUE, alpha=0.15, linewidth=0)
    ax.plot(g.x, g["mean"], color=BLUE, lw=2, marker="o", ms=3.5)
    ax.axhline(1, color=INK_2, lw=1, ls="--")
    ax.axvspan(hm.REFERENCE_YEARS[0] - 0.5, hm.REFERENCE_YEARS[1] + 0.5, color=ORANGE, alpha=0.08, linewidth=0)
    ax.text(hm.REFERENCE_YEARS[0] - 0.4, ax.get_ylim()[1] * 0.97, "map uses these years", color=INK_2, fontsize=8, va="top")
    ax.set_ylabel("Multiplier vs average year")
    ax.set_title("Year effect: reporting and/or hazard change over time", loc="left")
    ax.grid(axis="x", visible=False)
    return _save(fig, "week4_year_effect.png")


def fig_compare(h: pd.DataFrame, b: pd.DataFrame) -> str:
    j = h.merge(b[["icao", "month", "rate_mean", "rate_lo", "rate_hi"]], on=["icao", "month"], suffixes=("", "_b"))
    fig, axes = plt.subplots(1, 2, figsize=(8.6, 3.4))
    ax = axes[0]
    ax.scatter(j.rate_mean_b, j.rate_mean, s=6, color=BLUE, alpha=0.35, linewidths=0)
    lim = [min(j.rate_mean.min(), j.rate_mean_b.min()) * 0.9, max(j.rate_mean.max(), j.rate_mean_b.max()) * 1.1]
    ax.plot(lim, lim, color=INK_2, lw=1, ls="--")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Week 2 baseline (per 10k ops)")
    ax.set_ylabel("Week 4 hierarchical")
    ax.set_title("Estimates per airport-month", loc="left")
    ax = axes[1]
    wb = np.log(j.rate_hi_b / j.rate_lo_b)
    wh = np.log(j.rate_hi / j.rate_lo)
    bins = np.linspace(0, max(wb.max(), wh.max()), 40)
    ax.hist(wb, bins=bins, color=ORANGE, alpha=0.6, label="Week 2")
    ax.hist(wh, bins=bins, color=BLUE, alpha=0.6, label="Week 4")
    ax.set_xlabel("90% interval width (log hi/lo)")
    ax.set_title("Uncertainty", loc="left")
    ax.legend(fontsize=8)
    for a in axes:
        a.grid(visible=False)
    return _save(fig, "week4_vs_baseline.png")


def build() -> str:
    h = pd.read_parquet(HIER_PARQUET)
    b = pd.read_parquet(BASELINE_PARQUET)
    eff = pd.read_parquet(EFFECTS_PARQUET)
    diag = json.loads(DIAG_JSON.read_text())

    j = h.merge(b[["icao", "month", "rate_mean", "risk", "relative_lo", "relative_hi"]], on=["icao", "month"], suffixes=("", "_b"))
    changed_risk = (j.risk != j.risk_b).mean()
    dist_h = ((h.relative_lo > 1) | (h.relative_hi < 1)).mean()
    dist_b = ((b.relative_lo > 1) | (b.relative_hi < 1)).mean()
    ratio = (j.rate_mean / j.rate_mean_b)

    hyper = diag["hyper"]
    hyp_tbl = pd.DataFrame(
        {"Parameter": list(hyper), "Posterior mean": [f"{v['mean']:.3g}" for v in hyper.values()],
         "R-hat": [f"{v['r_hat']:.3f}" for v in hyper.values()], "Effective samples": [f"{v['ess']:.0f}" for v in hyper.values()]}
    )
    ppc = diag["ppc"]
    ppc_tbl = pd.DataFrame(
        {"Statistic": ["Share of airport-months with zero damaging strikes", "Largest single airport-month count",
                       "Total damaging strikes", "Variance / mean (clumpiness)"],
         "Observed": [f"{ppc['zeros']['observed']:.1%}", f"{ppc['max']['observed']:.0f}", f"{ppc['total']['observed']:,.0f}",
                      f"{ppc['var_to_mean']['observed']:.2f}"],
         "Model's 90% range": [f"{ppc['zeros']['rep_lo']:.1%}-{ppc['zeros']['rep_hi']:.1%}",
                               f"{ppc['max']['rep_lo']:.0f}-{ppc['max']['rep_hi']:.0f}",
                               f"{ppc['total']['rep_lo']:,.0f}-{ppc['total']['rep_hi']:,.0f}",
                               f"{ppc['var_to_mean']['rep_lo']:.2f}-{ppc['var_to_mean']['rep_hi']:.2f}"],
         "Consistent?": ["yes" if 0.05 <= v["p"] <= 0.95 else "**no**" for v in (ppc["zeros"], ppc["max"], ppc["total"], ppc["var_to_mean"])]}
    )

    top = (h.sort_values("relative_rate", ascending=False).drop_duplicates("icao").head(10)
           [["icao", "month", "relative_rate", "relative_lo", "relative_hi", "p_above_national"]])
    top["month"] = top.month.map(lambda m: MONTHS[m - 1])
    top = top.round(2).rename(columns={"icao": "Airport", "month": "Peak month", "relative_rate": "x national",
                                       "relative_lo": "90% lo", "relative_hi": "90% hi", "p_above_national": "P(above national)"})

    f1, f2, f3 = fig_flyways(eff), fig_years(eff), fig_compare(h, b)
    ok = diag["divergences"] == 0 and diag["worst_r_hat"] < 1.01

    return f"""# Week 4 - Bayesian hierarchical model

_Generated by `src/bird_strike_radar/report_week4.py`._

## The model in one paragraph

All {h.icao.nunique()} airports, 12 months and 16 years are fitted together. Each airport-month-year's damaging-strike
count is negative-binomial around (rate x traffic). The log rate is the sum of: a national level, national
seasonality, a **flyway-specific seasonal shape**, an airport level, the airport's own seasonal quirks,
a **national year effect** (random walk) and an **airport-specific trend**. Every group of effects has a learned
spread, so sparse airports borrow strength from their flyway and the nation. The map shows rates at current
conditions, i.e. the year effect averaged over {hm.REFERENCE_YEARS[0]}-{hm.REFERENCE_YEARS[1]}.

## Did the sampler work?

{"All checks pass." if ok else "**Some checks need attention (see below).**"} Divergences: **{diag['divergences']}**,
worst R-hat: **{diag['worst_r_hat']:.3f}** (want < 1.01), smallest effective sample size: **{diag['min_ess']:.0f}**.

{_md_table(hyp_tbl)}

## Does the model reproduce the data? (posterior predictive check)

{_md_table(ppc_tbl)}

## What the model learned

![Flyway seasons]({f1})

![Year effect]({f2})

The year effect is the clearest sign of changing reporting: if the hazard itself were stable, this curve
would be flat. The map uses the {hm.REFERENCE_YEARS[0]}-{hm.REFERENCE_YEARS[1]} level, so it describes recent conditions
rather than a 16-year average.

## Compared with the Week 2 baseline

![Comparison]({f3})

- Median ratio Week 4 / Week 2: **{ratio.median():.2f}** ({'estimates move up toward current, higher-reporting conditions' if ratio.median() > 1.02 else 'estimates move down' if ratio.median() < 0.98 else 'typical estimates barely move; the gains are in precision and in the outliers'}).
- Airport-months whose 882E overall risk changed: **{changed_risk:.0%}**.
- Airport-months clearly above or below national: **{dist_h:.0%}** (Week 2: {dist_b:.0%}). The Week 2 baseline
  fitted each month separately; this model shares each airport's information across all 12 months and 16 years,
  so its intervals are much narrower. The simulation check shows that narrowing is earned: coverage stays near 90%.
- The simulation check (`week4_simulation_check.md`) shows the hierarchical model recovers planted truth with
  about 90% interval coverage and lower error than the baseline.

## Most clearly elevated airport-months

{_md_table(top)}

## Limitations carried forward

- Reporting and hazard still can't be fully separated. The airport-specific trend absorbs airports whose
  reporting changed, but an airport that has always reported thoroughly still looks riskier.
- Flyway assignment by state (with a longitude split for MT/WY/CO/NM) is approximate.
- Real-world accuracy is not tested here; that's Week 5 (fit 2010-2022, predict 2023-2025).
"""


def run() -> None:
    out = paths.REPORTS / "week4_hierarchical_model.md"
    out.write_text(build())
    print(f"report -> {out.relative_to(paths.ROOT)}")


if __name__ == "__main__":
    run()
