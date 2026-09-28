"""Week 2 report: baseline rates, shrinkage, severity mix and where airports land on the 882E matrix.

Output: reports/week2_baseline_and_risk.md + reports/figures/week2_*.png
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import mil882, paths
from .baseline import BASELINE_PARQUET, CREDIBLE, SEVERITY_PARQUET, build_panel
from .report_week1 import BLUE, GRID, INK, INK_2, _md_table, _save
from .severity import classify

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
# Risk-level colours (match the map legend: red / orange / indigo / lavender)
RISK_COLORS = {"High": "#d7301f", "Serious": "#e07b39", "Medium": "#5b6bd6", "Low": "#c9cdf2"}
RAW_GRAY = "#a3a29c"


def fig_shrinkage(b: pd.DataFrame, month: int) -> str:
    g = b[b.month == month]
    fig, ax = plt.subplots(figsize=(7.0, 3.6))
    ax.scatter(g.ops, g.rate_raw, s=18, facecolors="none", edgecolors=RAW_GRAY, linewidths=1, label="Raw rate (own data only)")
    ax.scatter(g.ops, g.rate_mean, s=18, color=BLUE, label="Empirical-Bayes estimate")
    ax.axhline(g.national_rate.iloc[0], color=INK_2, lw=1, ls="--")
    ax.text(g.ops.max(), g.national_rate.iloc[0], "  national", va="center", color=INK_2, fontsize=8)
    ax.set_xscale("log")
    ax.set_xlabel(f"{MONTHS[month - 1]} operations, 2010-2025 total (log scale)")
    ax.set_ylabel("Damaging strikes per 10k ops")
    ax.set_title(f"Small airports get pulled toward the national rate ({MONTHS[month - 1]})", loc="left")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(axis="x", visible=False)
    return _save(fig, "week2_shrinkage.png")


def fig_intervals(b: pd.DataFrame, month: int, n: int = 20) -> str:
    g = b[b.month == month].sort_values("rate_mean", ascending=False).head(n).iloc[::-1]
    fig, ax = plt.subplots(figsize=(6.6, 5.0))
    y = np.arange(len(g))
    ax.hlines(y, g.rate_lo, g.rate_hi, color=BLUE, lw=2)
    ax.scatter(g.rate_mean, y, color=BLUE, s=24, zorder=3, edgecolors="white", linewidths=1.2)
    ax.axvline(g.national_rate.iloc[0], color=INK_2, lw=1, ls="--")
    ax.set_yticks(y, g.icao)
    ax.set_xlabel("Damaging strikes per 10k ops (dot = estimate, bar = 90% credible interval)")
    ax.set_title(f"Highest estimated rates, {MONTHS[month - 1]}", loc="left")
    ax.grid(axis="y", visible=False)
    return _save(fig, "week2_top_intervals.png")


def fig_matrix(b: pd.DataFrame) -> str:
    levels = ["A", "B", "C", "D", "E"]
    fig, ax = plt.subplots(figsize=(6.6, 4.0))
    for i, L in enumerate(levels):
        for j, k in enumerate([1, 2, 3, 4]):
            risk = mil882.risk_level(L, k)
            n = int((b[f"level_sev{k}"] == L).sum())
            ax.add_patch(plt.Rectangle((j, 4 - i), 0.96, 0.92, color=RISK_COLORS[risk], alpha=1.0 if n else 0.28))
            label = f"{risk}\n{n:,}" if n else risk
            ax.text(j + 0.48, 4 - i + 0.46, label, ha="center", va="center", fontsize=8,
                    color="white" if (n and risk in ("High", "Serious", "Medium")) else INK)
    ax.set_xlim(0, 4)
    ax.set_ylim(0, 5)
    ax.set_xticks(np.arange(4) + 0.48, [f"{mil882.SEVERITY[k]} ({k})" for k in (1, 2, 3, 4)])
    ax.set_yticks(np.arange(5) + 0.46, [f"{mil882.PROBABILITY[L]} ({L})" for L in levels[::-1]])
    ax.tick_params(length=0)
    ax.grid(False)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_title("Where the 3,192 airport-months land, per severity column", loc="left")
    return _save(fig, "week2_matrix.png")


def build() -> str:
    b = pd.read_parquet(BASELINE_PARQUET)
    mix = pd.read_parquet(SEVERITY_PARQUET)
    panel, orphan, dmg = build_panel()
    peak = int(b.groupby("month").national_rate.first().idxmax())

    # severity evidence
    d = dmg.copy()
    d["severity"] = classify(d)
    ev = d.groupby(d.damage_level.astype(str), observed=True).agg(
        reports=("record_id", "size"), severity_known=("severity", lambda x: x.notna().mean())
    )
    ev = ev.reindex(["M", "M?", "S", "D"]).dropna()
    ev_tbl = pd.DataFrame({"FAA damage level": ev.index, "Damaging reports": ev.reports.astype(int).map("{:,}".format).values,
                           "Severity determinable (cost/injury known)": ev.severity_known.map("{:.0%}".format).values})
    mix_tbl = pd.DataFrame({
        "882E severity": [f"{r.category} ({r.severity})" for r in mix.itertuples()],
        "Share of damaging strikes": [f"{s:.2%}" for s in mix.share],
        "Reports with this severity known": mix.reports_with_known_severity.values,
    })

    risk_counts = b.risk.value_counts().reindex(mil882.RISK_ORDER[::-1]).fillna(0).astype(int)
    risk_tbl = pd.DataFrame({"Overall risk": risk_counts.index, "Airport-months": risk_counts.map("{:,}".format).values})
    distinct = ((b.relative_lo > 1) | (b.relative_hi < 1)).mean()
    uncertain_cls = (b.risk_lo != b.risk_hi).mean()

    top = (
        b.groupby("icao").apply(lambda g: pd.Series({
            "Raw annual damaging / 10k ops": (g.damaging.sum() / g.exposure.sum()),
            "Peak month": MONTHS[int(g.loc[g.rate_mean.idxmax(), "month"]) - 1],
            "Peak estimate": g.rate_mean.max(),
            "Months rated High": int((g.risk == "High").sum()),
        }), include_groups=False)
        .sort_values("Raw annual damaging / 10k ops", ascending=False).head(10).round(3).reset_index()
        .rename(columns={"icao": "Airport"})
    )

    ex = b.sort_values("rate_mean", ascending=False).iloc[0]
    ex_rows = pd.DataFrame({
        "Severity": [mil882.SEVERITY[k] for k in (1, 2, 3, 4)],
        "P(>=1 in 10k ops)": [f"{ex[f'p_sev{k}']:.2e}" for k in (1, 2, 3, 4)],
        "Level": [f"{mil882.PROBABILITY[ex[f'level_sev{k}']]} ({ex[f'level_sev{k}']})" for k in (1, 2, 3, 4)],
        "Risk": [ex[f"risk_sev{k}"] for k in (1, 2, 3, 4)],
    })

    f1, f2, f3 = fig_shrinkage(b, peak), fig_intervals(b, peak), fig_matrix(b)

    return f"""# Week 2 - Baseline rates and MIL-STD-882E risk

_Generated by `src/bird_strike_radar/report_week2.py`._

## What was built

1. **Empirical-Bayes rate model** (`baseline.py`). For each calendar month, a Gamma prior describing
   "a typical study airport" is fitted from all {b.icao.nunique()} airports, then each airport's damaging-strike
   rate per 10,000 operations is updated with its own data. Output: estimate + {int((CREDIBLE[1]-CREDIBLE[0])*100)}% credible interval
   for {len(b):,} airport-months.
2. **Severity mapping** (`severity.py`). FAA outcomes -> MIL-STD-882E Table I categories using the table's own
   dollar bands (inflation-adjusted repair + other costs), injuries and fatalities.
3. **882E risk logic** (`mil882.py`). Tables I-III transcribed from the standard and unit-tested cell by cell.
   Probability levels use the Appendix A (Table A-II) example thresholds, unmodified.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Numerator (Option A) | Known damaging strikes only | Unknown-damage reports are mostly carcass finds; including them needs an unverifiable imputation. Rates are a slight, documented underestimate. |
| Exposure unit | {mil882.EXPOSURE_OPS:,} operations | 882E requires the denominator to be defined. A fixed number of operations compares airports fairly regardless of size (~1 month at the median study airport). |
| Probability thresholds | Table A-II as published | Tailoring the bins to spread the map would be fitting the ruler to the data. |
| Overall risk | Worst risk across the four severity columns | A hazard with several credible outcomes is assessed at each; the worst governs. |
| Map colour | Estimated rate relative to national, same month | The 882E category barely varies (see below); the continuous rate is where airports differ. |
| Unknown severity | Distributed using P(severity given damage level) from reports with known cost | Only ~{d.severity.notna().mean():.0%} of damaging reports have a cost or injury recorded. |

## Severity mix of damaging strikes

{_md_table(mix_tbl)}

Evidence behind it:

{_md_table(ev_tbl)}

**Caveat:** costs are probably recorded more often for expensive events, which would make this mix lean severe.
The Catastrophic share rests on very few cases and a weak prior, so treat it as "credible but rare",
which is also how 882E treats it.

## Shrinkage

![Shrinkage]({f1})

Hollow grey = each airport's raw rate; blue = the estimate after partial pooling. Airports with little traffic
get pulled strongly toward the national line; high-traffic airports keep most of their own signal.

![Top intervals]({f2})

Only **{distinct:.0%}** of airport-months have a 90% interval entirely above or below the national rate.
Most month-to-month airport differences on the map are **within the noise**, and the interface has to say so.

## Where airports land on the risk matrix

![Matrix]({f3})

{_md_table(risk_tbl)}

**Key finding:** under the unmodified standard, almost every commercial airport-month is **Serious**.
The Catastrophic column alone guarantees it: Catastrophic x Remote is Serious, and "Remote" spans three
orders of magnitude (10^-3 to 10^-6). Airports reach **High** only when $1M+ (Critical) strikes become
Probable per 10k operations. {uncertain_cls:.0%} of airport-months could be in a different overall
risk level at the ends of their credible interval.

This is the standard working as intended, since every airport carries a rare but credible catastrophic
outcome, and it's why the map colours by the continuous rate while the matrix shows the categorical assessment.

### Worked example: {ex.icao}, {MONTHS[int(ex.month) - 1]} (highest estimated rate)

Damaging rate estimate {ex.rate_mean:.2f} per 10k ops (90% CI {ex.rate_lo:.2f}-{ex.rate_hi:.2f}),
{ex.relative_rate:.1f}x the national {MONTHS[int(ex.month) - 1]} rate.

{_md_table(ex_rows)}

Overall: **{ex.risk}**.

## Airports with the highest annual damaging rates

{_md_table(top)}

Raw annual rates are unshrunk, so small airports (e.g. a single bad year at a regional airport) can rank high
here but not on the map. KSMF stands out on every measure. Whether that's more hazard (Central Valley
waterfowl in winter) or more thorough reporting is exactly the question the Week 4 model and the
"raw vs estimated" toggle have to be honest about: **from strike reports alone, the two can't be fully separated.**

## Next

- Week 3: the minimum map (React + MapLibre on GitHub Pages) reading an exported JSON of this table.
- Week 4: replace per-month independent priors with the hierarchical model (airport, region x month, year trend).
- Data note: {int(orphan.damaging.sum())} damaging strikes fell in months with no tower count and were excluded.
"""


def run() -> None:
    paths.ensure_dirs()
    out = paths.REPORTS / "week2_baseline_and_risk.md"
    out.write_text(build())
    print(f"report -> {out.relative_to(paths.ROOT)}")


if __name__ == "__main__":
    run()
