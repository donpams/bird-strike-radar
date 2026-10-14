"""Export the model results as one small static JSON file for the web map.

Output: web/public/data/radar.json   (committed to git; aggregates only, no personal data)

Shape:
{
  "meta":      {...dates, counts, definitions...},
  "national":  {"rate": [12 monthly rates], "reports_rate": [...]},
  "severity":  [{"severity": 1, "category": "Catastrophic", "share": 0.0026}, ...],
  "airports":  [{"icao": "KDEN", "name": ..., "lat": ..., "lon": ..., "ops_year": ...,
                 "m": [ {month 1 record}, ..., {month 12 record} ]}, ...]
}
Month records use short keys to keep the file small (see MONTH_FIELDS).
"""

from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from . import mil882, paths
from .baseline import BASELINE_PARQUET, CREDIBLE, SEVERITY_PARQUET
from .study_airports import MIN_COMMERCIAL_OPS, STUDY_YEARS

WEB_DATA = paths.ROOT / "web" / "public" / "data" / "radar.json"

# short key -> column in the baseline table
MONTH_FIELDS = {
    "r": "rate_mean",  # estimated damaging strikes per 10k ops
    "lo": "rate_lo",
    "hi": "rate_hi",
    "raw": "rate_raw",  # own data only, no pooling
    "rel": "relative_rate",  # estimate / national same month
    "rlo": "relative_lo",
    "rhi": "relative_hi",
    "d": "damaging",  # damaging strikes, all study years
    "n": "reports",  # all strike reports, all study years
    "ops": "ops",  # operations, all study years
    "sh": "shrinkage",
    "exp": "expected_damaging_typical_month",
    "risk": "risk",
    "riskLo": "risk_lo",
    "riskHi": "risk_hi",
}


def _round(v, nd=4):
    if isinstance(v, (float, np.floating)):
        return None if np.isnan(v) else float(round(v, nd))
    if isinstance(v, (np.integer,)):
        return int(v)
    if v is pd.NA:
        return None
    return v


def _source():
    """Use the Week 4 hierarchical estimates when they exist, otherwise the Week 2 baseline."""
    from .fit_hier import HIER_PARQUET

    if HIER_PARQUET.exists():
        return pd.read_parquet(HIER_PARQUET), "Bayesian hierarchical model (Week 4)"
    return pd.read_parquet(BASELINE_PARQUET), "Empirical-Bayes baseline (Week 2)"


def _results() -> dict | None:
    """Headline evaluation numbers for the site's results page, if the model checks have been run."""
    from .evaluate import EVAL_JSON
    from .fit_hier import DIAG_JSON
    from .sim_check import SIM_JSON

    if not (EVAL_JSON.exists() and DIAG_JSON.exists()):
        return None
    ev = json.loads(EVAL_JSON.read_text())
    diag = json.loads(DIAG_JSON.read_text())
    keep = ("log_score", "impossible_cells", "coverage90_busy", "busy_cells", "pit_low", "pit_high",
            "forecast_total", "forecast_total_lo", "forecast_total_hi", "top10_lift")

    def num(v):
        return None if v is None or not np.isfinite(v) else round(float(v), 5)

    return {
        "trainYears": ev["train_years"],
        "testYears": ev["test_years"],
        "cells": ev["cells"],
        "observedTotal": ev["observed_total"],
        "observedByYear": {int(k): round(v, 5) for k, v in ev["observed_by_year"].items()},
        "forecastByYear": {m: {int(y): [round(x, 5) for x in v] for y, v in ev["yearly_forecast"][m].items()}
                           for m in ("week2", "week4")},
        "models": {m: {k: num(ev["metrics"][m][k]) for k in keep} for m in ev["metrics"]},
        "week4VsWeek2": {k: round(v, 6) for k, v in ev["week4_minus_week2_logscore"].items()},
        "sampler": {"divergences": diag["divergences"], "worstRhat": round(diag["worst_r_hat"], 4),
                    "minEss": round(diag["min_ess"])},
        "simulation": json.loads(SIM_JSON.read_text()) if SIM_JSON.exists() else None,
    }


def run() -> dict:
    b, model_label = _source()
    mix = pd.read_parquet(SEVERITY_PARQUET)
    study = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    study = study[study.in_study].set_index("icao")
    strikes_mtime = date.fromtimestamp(paths.RAW_STRIKES_CSV.stat().st_mtime).isoformat()

    airports = []
    for icao, g in b.sort_values("month").groupby("icao"):
        s = study.loc[icao]
        months = []
        for _, row in g.iterrows():
            rec = {k: _round(row[c]) for k, c in MONTH_FIELDS.items()}
            # Rates keep 6 significant digits: the planner re-derives 882E levels from them, and
            # rounding to 4 decimals could flip a level that sits right on a threshold
            for k in ("r", "lo", "hi"):
                v = row[MONTH_FIELDS[k]]
                rec[k] = None if pd.isna(v) else float(f"{v:.6g}")
            # per-severity probability level (A-E) -> the four highlighted matrix cells
            rec["lv"] = [row[f"level_sev{k}"] for k in (1, 2, 3, 4)]
            months.append(rec)
        airports.append(
            {
                "icao": icao,
                "name": s["name"],
                "city": s["city"],
                "state": s["state"],
                "lat": round(float(s["lat"]), 5),
                "lon": round(float(s["lon"]), 5),
                "opsYear": int(s["median_total_ops"]),
                "m": months,
            }
        )

    national = b.groupby("month").agg(rate=("national_rate", "first"), reports=("reports", "sum"), ops=("ops", "sum"))
    out = {
        "meta": {
            "title": "Bird Strike Radar",
            "generated": date.today().isoformat(),
            "strikeDataDownloaded": strikes_mtime,
            "years": list(STUDY_YEARS),
            "airportCount": len(airports),
            "damagingStrikes": int(b.damaging.sum()),
            "reports": int(b.reports.sum()),
            "exposureOps": mil882.EXPOSURE_OPS,
            "credible": list(CREDIBLE),
            "minCommercialOps": MIN_COMMERCIAL_OPS,
            "definition": "Damaging strike = FAA damage level M, M?, S or D; unknown damage excluded.",
            "model": model_label,
        },
        "national": {
            "rate": [round(float(x), 5) for x in national.rate],
            "reportsRate": [round(float(x), 4) for x in national.reports / national.ops * mil882.EXPOSURE_OPS],
        },
        "severity": [
            {"severity": int(r.severity), "category": r.category, "share": round(float(r.share), 5)}
            for r in mix.itertuples()
        ],
        "matrix": {L: [mil882.RISK_MATRIX[L][k] for k in (1, 2, 3, 4)] for L in "ABCDE"},
        "probability": {L: name for L, name in mil882.PROBABILITY.items()},
        "airports": airports,
        "results": _results(),
    }
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    WEB_DATA.write_text(json.dumps(out, separators=(",", ":")))
    kb = WEB_DATA.stat().st_size / 1024
    print(f"web export: {len(airports)} airports, {kb:.0f} KB -> {WEB_DATA.relative_to(paths.ROOT)}")
    return out


if __name__ == "__main__":
    run()
