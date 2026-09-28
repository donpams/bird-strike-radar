"""Where files live. Every script imports paths from here, so nothing is hard-coded twice."""

from pathlib import Path

# src/bird_strike_radar/paths.py -> repo root is two levels up from this package
ROOT = Path(__file__).resolve().parents[2]

RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
REPORTS = ROOT / "reports"

RAW_STRIKES_CSV = RAW / "faa" / "strikes.csv"
RAW_ATADS_DIR = RAW / "atads"
RAW_AIRPORTS_CSV = RAW / "ourairports" / "airports.csv"

STRIKES_PARQUET = PROCESSED / "strikes.parquet"
ATADS_PARQUET = PROCESSED / "atads_monthly.parquet"
AIRPORTS_PARQUET = PROCESSED / "airports.parquet"
STUDY_AIRPORTS_PARQUET = PROCESSED / "study_airports.parquet"


def ensure_dirs() -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
