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


def run() -> dict:
    b = pd.read_parquet(BASELINE_PARQUET)
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
    }
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    WEB_DATA.write_text(json.dumps(out, separators=(",", ":")))
    kb = WEB_DATA.stat().st_size / 1024
    print(f"web export: {len(airports)} airports, {kb:.0f} KB -> {WEB_DATA.relative_to(paths.ROOT)}")
    return out


if __name__ == "__main__":
    run()
