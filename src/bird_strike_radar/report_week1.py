"""Week 1 data-quality report: what's in the data, what's missing, and what that means.

Output: reports/week1_data_quality.md  +  reports/figures/week1_*.png
Run after the ingest steps (see pipeline.py).
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from . import paths  # noqa: E402
from .study_airports import MIN_COMMERCIAL_OPS, MIN_YEARS, STUDY_YEARS  # noqa: E402

FIG_DIR = paths.REPORTS / "figures"

# Chart styling: one hue per series, recessive axes, no chart junk
BLUE, ORANGE = "#2a78d6", "#eb6834"
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"
plt.rcParams.update(
    {
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK_2,
        "axes.titlecolor": INK,
        "axes.titlesize": 11,
        "axes.titleweight": "regular",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "axes.axisbelow": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
        "xtick.color": INK_2,
        "ytick.color": INK_2,
        "font.size": 9,
        "legend.frameon": False,
    }
)


def _save(fig, name: str) -> str:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(FIG_DIR / name, dpi=160)
    plt.close(fig)
    return f"figures/{name}"


def _md_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(str(v) for v in r.values) + " |")
    return "\n".join(lines)


def build() -> str:
    s = pd.read_parquet(paths.STRIKES_PARQUET)
    atads = pd.read_parquet(paths.ATADS_PARQUET)
    study = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    y0, y1 = STUDY_YEARS

    win = s[s.year.between(y0, y1)]
    st = study[study.in_study]
    at_study = win[win.airport_icao.isin(st.icao)]

    # ---------- headline numbers ----------
    n_all, n_win, n_study = len(s), len(win), len(at_study)
    n_dmg_study = int(at_study.damaging.sum())
    unk_share = win.damaging.isna().mean()

    # ---------- missingness ----------
    fields = {
        "Airport": "airport_icao",
        "Damage level": "damaging",
        "Time of day (light)": "light",
        "Local hour": "hour_local",
        "Height AGL": "height_ft",
        "Phase of flight": "phase",
        "Species": "species",
        "Aircraft mass class": "ac_mass",
        "Speed": "speed_kt",
    }
    miss = pd.DataFrame(
        {
            "Field": list(fields),
            "Missing (all strikes)": [f"{win[c].isna().mean():.0%}" for c in fields.values()],
            "Missing (study airports)": [f"{at_study[c].isna().mean():.0%}" for c in fields.values()],
            "Missing (damaging, study)": [
                f"{at_study[at_study.damaging.fillna(False)][c].isna().mean():.0%}" if c != "damaging" else "n/a"
                for c in fields.values()
            ],
        }
    )
    order = at_study[list(fields.values())].isna().mean().sort_values()
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    labels = [k for k, v in fields.items() for c in order.index if v == c]
    labels = [next(k for k, v in fields.items() if v == c) for c in order.index]
    ax.barh(labels, order.values * 100, color=BLUE, height=0.6)
    ax.set_xlabel("% of strike reports with the field blank (study airports, 2010-2025)")
    ax.set_xlim(0, 100)
    ax.grid(axis="y", visible=False)
    for i, v in enumerate(order.values):
        ax.text(v * 100 + 1, i, f"{v:.0%}", va="center", color=INK_2, fontsize=8)
    ax.set_title("Most reports leave height and time of day blank", loc="left")
    fig_missing = _save(fig, "week1_missingness.png")

    # ---------- exposure-normalised trend ----------
    ops = (
        atads.merge(st[["faa_lid"]], on="faa_lid")
        .query("@y0 <= year <= @y1")
        .groupby("year")["total_ops"]
        .sum()
    )
    yearly = at_study.groupby("year").agg(reports=("record_id", "size"), damaging=("damaging", "sum"))
    yearly["ops"] = ops
    yearly["reports_per_10k"] = yearly.reports / yearly.ops * 1e4
    yearly["damaging_per_10k"] = yearly.damaging / yearly.ops * 1e4
    yearly["unknown_damage_share"] = at_study.groupby("year").damaging.apply(lambda x: x.isna().mean())

    fig, axes = plt.subplots(1, 2, figsize=(8.6, 3.0))
    axes[0].plot(yearly.index, yearly.reports_per_10k, color=BLUE, lw=2, marker="o", ms=4)
    axes[0].set_title("All strike reports per 10,000 operations", loc="left")
    axes[1].plot(yearly.index, yearly.damaging_per_10k, color=ORANGE, lw=2, marker="o", ms=4)
    axes[1].set_title("Damaging strikes per 10,000 operations", loc="left")
    for ax in axes:
        ax.set_ylim(bottom=0)
        ax.grid(axis="x", visible=False)
    fig_trend = _save(fig, "week1_rates_by_year.png")

    # ---------- seasonality ----------
    ops_m = (
        atads.merge(st[["faa_lid"]], on="faa_lid").query("@y0 <= year <= @y1").groupby("month")["total_ops"].sum()
    )
    by_m = at_study.groupby("month").agg(reports=("record_id", "size"), damaging=("damaging", "sum"))
    by_m["damaging_per_10k"] = by_m.damaging / ops_m * 1e4
    fig, ax = plt.subplots(figsize=(6.4, 2.8))
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    ax.bar(months, by_m.damaging_per_10k.values, color=BLUE, width=0.62)
    ax.set_title("Damaging strikes per 10,000 operations, by month (study airports)", loc="left")
    ax.grid(axis="x", visible=False)
    fig_season = _save(fig, "week1_seasonality.png")

    # ---------- damage level mix ----------
    dmg = (
        at_study.damage_level.value_counts()
        .reindex(["N", "M", "M?", "S", "D", "U"])
        .rename(
            {
                "N": "N - none",
                "M": "M - minor",
                "M?": "M? - damaged, extent unknown",
                "S": "S - substantial",
                "D": "D - destroyed",
                "U": "(blank) - unknown",
            }
        )
    )
    dmg_tbl = pd.DataFrame({"Damage level": dmg.index, "Reports": dmg.map("{:,}".format).values,
                            "Share": (dmg / dmg.sum()).map("{:.1%}".format).values})

    # ---------- biggest airports ----------
    top = (
        at_study.groupby("airport_icao").agg(reports=("record_id", "size"), damaging=("damaging", "sum"))
        .join(st.set_index("icao")[["name", "median_total_ops"]])
    )
    top["damaging per 10k ops (median yr)"] = (top.damaging / (y1 - y0 + 1) / top.median_total_ops * 1e4).round(2)
    top = top.sort_values("reports", ascending=False).head(10).reset_index()
    top = top.rename(columns={"airport_icao": "Airport", "name": "Name", "reports": "Reports", "damaging": "Damaging"})
    top = top[["Airport", "Name", "Reports", "Damaging", "damaging per 10k ops (median yr)"]]

    partial = s[s.year > y1].year.unique().tolist()
    unk = win[win.damaging.isna()]
    unk_no_aircraft = unk.operator.isna().mean()

    md = f"""# Week 1 - Data quality report

_Generated by `src/bird_strike_radar/report_week1.py`. Re-run the pipeline to refresh._

## Headline numbers

- Raw strike reports in the FAA export: **{n_all:,}** (1990 to {int(s.year.max())}).
- Study window {y0}-{y1}: **{n_win:,}** reports. Years after {y1} ({", ".join(map(str, sorted(partial)))}) are excluded
  because they are still filling in with late reports.
- Study airports: **{len(st)}** of {len(study)} towered airports
  (scheduled service, median commercial ops >= {MIN_COMMERCIAL_OPS:,}/yr, >= {MIN_YEARS} years of tower data).
- Reports at study airports: **{n_study:,}** ({n_study / n_win:.0%} of the window), of which
  **{n_dmg_study:,}** are damaging (M, M?, S or D).
- Reports with **unknown** damage level in the window: **{unk_share:.0%}**. These are treated as missing,
  not as "no damage".

## Decisions made this week

| Decision | Choice | Why |
|---|---|---|
| Outcome | "Damaging strike" = damage level M, M?, S or D | Damaging strikes are reported far more completely than harmless ones, so the reporting bias is smallest here. |
| Unknown damage | Kept as missing (`<NA>`) | The FAA's own `INDICATED_DAMAGE` flag codes blanks as 0; treating them as "no damage" would silently lower every rate. |
| Dates | Year/month from `INCIDENT_YEAR`/`INCIDENT_MONTH`; day from `INCIDENT_DATE` | `INCIDENT_DATE` uses a two-digit year. |
| Airport ids | ICAO in strikes, FAA LID in ATADS, joined through OurAirports | Renamed airports (e.g. PBI) matched through the `K`+LID fallback. |
| Study airports | Rule above; strike counts never used to select | Selecting on the outcome would bias every downstream rate. |
| Altitude bands | ground / 0-500 / 500-3,000 / above 3,000 ft AGL | Separates runway, initial climb/short final, traffic pattern, above pattern. |
| Personal data | Reporter names/titles, remarks, comments, tail and flight numbers dropped at load | Never needed; never written to `data/processed/`. |
| Coordinates | From OurAirports | `AIRPORT_LATITUDE`/`LONGITUDE` are empty in this export. |

## Key finding: "unknown damage" mostly means "no aircraft identified"

{unk_no_aircraft:.0%} of reports with a blank damage level also have no identified operator. These are
mostly carcasses found on or near the runway, where nobody knows which aircraft hit the bird, so nobody
can say whether it was damaged. Two consequences:

- They still count as strikes (useful for the "all strikes" layer), but they can't inform the damage model.
- Damaging reports are much more complete than the rest (see the last column below). Whoever files a
  damaging report fills in the form; carcass reports leave most of it blank. So missingness is **not
  random**, and conditional shares (e.g. "what fraction of damaging strikes happen above 500 ft")
  must be computed from damaging reports only, never from all reports.

## Missing fields

{_md_table(miss)}

![Missingness]({fig_missing})

**What this means for the model:** height and time of day are blank in a large share of reports,
so the altitude-band and time-of-day breakdowns will be estimated from the subset that has them,
and the uncertainty shown on the map has to reflect that. Check whether missingness is itself related to
damage (the third column) before assuming it is random.

## Damage level mix (study airports, {y0}-{y1})

{_md_table(dmg_tbl)}

## Rates over time

![Rates by year]({fig_trend})

All reports per operation rise much faster than damaging strikes per operation. That gap is the
**reporting-behaviour trend** the model needs a year term for: more harmless strikes are being reported,
not necessarily more strikes happening. 2020-21 traffic is distorted by COVID.

## Seasonality

![Seasonality]({fig_season})

The late-summer / autumn peak is the migration signal the time slider will animate.

## Airports with the most reports

{_md_table(top)}

Raw report counts mostly track traffic volume and reporting culture. That's why the map will offer
"raw reports" vs "estimated true risk" rather than showing counts alone.

## Open questions for Week 2

1. Denominator for the damage model: known-damage reports only, or all reports with an imputation for unknowns?
2. How much of the reporting trend differs by airport (e.g. airports with a staff wildlife biologist)?
3. Do we need an aircraft-mass split, since larger aircraft report differently and take different damage?
"""
    return md


def run() -> None:
    paths.ensure_dirs()
    md = build()
    out = paths.REPORTS / "week1_data_quality.md"
    out.write_text(md)
    print(f"report -> {out.relative_to(paths.ROOT)}")


if __name__ == "__main__":
    run()
