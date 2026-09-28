"""Choose which airports the model covers ("commercial airports").

Rule (decided in Week 1, see reports/week1_data_quality.md):
  1. The airport has a control tower in ATADS (otherwise we have no traffic count to
     normalise by, and "estimated true risk" is impossible).
  2. OurAirports flags it as having scheduled passenger service.
  3. Median annual commercial operations (air carrier + air taxi) >= MIN_COMMERCIAL_OPS.
     Air taxi is included because most regional jets and turboprops under 60 seats are
     counted as air taxi, not air carrier.
  4. At least MIN_YEARS years of tower data in the study window.

Deliberately NOT used: number of strike reports. Selecting airports on the outcome we
are trying to model would bias every rate we estimate afterwards.
"""

from __future__ import annotations

import pandas as pd

from . import paths
from .ingest_airports import lid_to_icao

STUDY_YEARS = (2010, 2025)
MIN_COMMERCIAL_OPS = 5_000  # about 7 commercial departures a day
MIN_YEARS = 8


def run() -> pd.DataFrame:
    atads = pd.read_parquet(paths.ATADS_PARQUET)
    airports = pd.read_parquet(paths.AIRPORTS_PARQUET)

    a = atads[atads.year.between(*STUDY_YEARS)]
    yearly = (
        a.assign(commercial=a.itin_air_carrier + a.itin_air_taxi)
        .groupby(["faa_lid", "year"], as_index=False)
        .agg(commercial=("commercial", "sum"), total=("total_ops", "sum"), months=("month", "size"))
    )
    # Only full years count toward the median, so partially-reported years don't drag it down
    full = yearly[yearly.months == 12]
    summary = full.groupby("faa_lid").agg(
        median_commercial_ops=("commercial", "median"),
        median_total_ops=("total", "median"),
        years_of_data=("year", "nunique"),
    )
    summary = summary.reset_index()
    summary["icao"] = lid_to_icao(summary["faa_lid"], airports)

    meta = airports.drop(columns="faa_lid").drop_duplicates("icao")
    summary = summary.merge(meta, on="icao", how="left")

    summary["in_study"] = (
        summary["icao"].notna()
        & summary["scheduled_service"].fillna(False).astype(bool)
        & (summary["median_commercial_ops"] >= MIN_COMMERCIAL_OPS)
        & (summary["years_of_data"] >= MIN_YEARS)
    )

    summary.to_parquet(paths.STUDY_AIRPORTS_PARQUET, index=False)
    n = int(summary["in_study"].sum())
    print(
        f"study airports: {n} of {len(summary)} towered airports "
        f"-> {paths.STUDY_AIRPORTS_PARQUET.relative_to(paths.ROOT)}"
    )
    return summary


if __name__ == "__main__":
    run()
