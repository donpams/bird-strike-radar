"""Turn the yearly ATADS exports into one tidy table of monthly operations per airport.

Input : data/raw/atads/atads_airport_ops_YYYY.xls   (HTML tables despite the .xls name)
Output: data/processed/atads_monthly.parquet

One row per (FAA location id, year, month). "Operations" = takeoffs + landings counted by
the control tower. Only towered airports appear, and only while the tower is open.
"""

from __future__ import annotations

import re

import pandas as pd

from . import paths

COLUMNS = [
    "faa_lid",
    "period",
    "itin_air_carrier",
    "itin_air_taxi",
    "itin_general_aviation",
    "itin_military",
    "itin_total",
    "local_civil",
    "local_military",
    "local_total",
    "total_ops",
]


def parse_file(path) -> pd.DataFrame:
    table = pd.read_html(path, flavor="lxml")[0]
    df = table.iloc[:, : len(COLUMNS)].copy()
    df.columns = COLUMNS

    df["faa_lid"] = df["faa_lid"].astype(str).str.strip()
    period = df["period"].astype(str).str.strip()
    # Keep only real data rows ("MM/YYYY"); drops "Sub-Total for X" and the grand "Total:" row
    ok = period.str.fullmatch(r"\d{2}/\d{4}")
    df = df[ok].copy()
    df["month"] = period[ok].str.slice(0, 2).astype(int)
    df["year"] = period[ok].str.slice(3, 7).astype(int)

    for c in COLUMNS[2:]:
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(",", ""), errors="coerce").astype("Int64")

    # Sanity check: the export's own totals must add up
    itin = df[["itin_air_carrier", "itin_air_taxi", "itin_general_aviation", "itin_military"]].sum(axis=1)
    bad = (itin != df["itin_total"]) | (df["itin_total"] + df["local_total"] != df["total_ops"])
    if bad.any():
        raise ValueError(f"{path.name}: {bad.sum()} rows whose totals don't add up")

    return df.drop(columns="period")[["faa_lid", "year", "month", *COLUMNS[2:]]]


def run() -> pd.DataFrame:
    paths.ensure_dirs()
    files = sorted(paths.RAW_ATADS_DIR.glob("atads_airport_ops_*.xls"))
    if not files:
        raise FileNotFoundError(f"No ATADS files in {paths.RAW_ATADS_DIR}")

    frames = []
    for f in files:
        df = parse_file(f)
        expected_year = int(re.search(r"(\d{4})", f.stem).group(1))
        years = set(df["year"].unique())
        if years != {expected_year}:
            raise ValueError(f"{f.name} contains years {sorted(years)}, expected {expected_year}")
        frames.append(df)

    out = pd.concat(frames, ignore_index=True)
    dupes = out.duplicated(["faa_lid", "year", "month"])
    if dupes.any():
        raise ValueError(f"{dupes.sum()} duplicate airport-months across files")

    out.to_parquet(paths.ATADS_PARQUET, index=False)
    print(
        f"atads: {len(out):,} airport-months, {out.faa_lid.nunique()} airports, "
        f"{out.year.min()}-{out.year.max()} -> {paths.ATADS_PARQUET.relative_to(paths.ROOT)}"
    )
    return out


if __name__ == "__main__":
    run()
