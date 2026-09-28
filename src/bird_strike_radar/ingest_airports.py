"""Airport reference table: coordinates plus a crosswalk between the two ID systems.

The strike database uses ICAO ids (KDEN, PANC, PHNL, TJSJ); ATADS uses 3-letter FAA
location ids (DEN, ANC, HNL, SJU). OurAirports carries both, so it is the join key.

Gotcha: a few airports have been renamed/re-identified since the data was recorded
(e.g. OurAirports now lists Palm Beach as local code DJT, but its ident is still KPBI).
So we match an FAA id first on `local_code`, then on ident == "K" + id.

Input : data/raw/ourairports/airports.csv
Output: data/processed/airports.parquet   (one row per airport, keyed by `icao`)
"""

from __future__ import annotations

import pandas as pd

from . import paths

COUNTRIES = {"US", "PR"}  # 50 states + DC, plus Puerto Rico (has Part 139 airports)
AIRPORT_TYPES = {"large_airport", "medium_airport", "small_airport"}


def _blank(s: pd.Series) -> pd.Series:
    s = s.str.strip()
    return s.mask(s == "")


def run() -> pd.DataFrame:
    paths.ensure_dirs()
    a = pd.read_csv(paths.RAW_AIRPORTS_CSV, dtype=str, keep_default_na=False)
    a = a[a.iso_country.isin(COUNTRIES) & a.type.isin(AIRPORT_TYPES)].copy()

    out = pd.DataFrame(
        {
            "icao": a.ident,
            "faa_lid": _blank(a.local_code),
            "iata": _blank(a.iata_code),
            "name": a.name,
            "city": _blank(a.municipality),
            "state": a.iso_region.str.split("-").str[-1],
            "type": a.type,
            "scheduled_service": a.scheduled_service.eq("yes"),
            "lat": pd.to_numeric(a.latitude_deg),
            "lon": pd.to_numeric(a.longitude_deg),
            "elevation_ft": pd.to_numeric(a.elevation_ft, errors="coerce"),
        }
    ).reset_index(drop=True)

    out.to_parquet(paths.AIRPORTS_PARQUET, index=False)
    print(f"airports: {len(out):,} rows -> {paths.AIRPORTS_PARQUET.relative_to(paths.ROOT)}")
    return out


def lid_to_icao(lids: pd.Series, airports: pd.DataFrame) -> pd.Series:
    """Map FAA location ids (ATADS) to ICAO idents (strike database)."""
    by_local = airports.dropna(subset=["faa_lid"]).drop_duplicates("faa_lid").set_index("faa_lid")["icao"]
    known = set(airports["icao"])
    first = lids.map(by_local)
    fallback = ("K" + lids).where(("K" + lids).isin(known))
    return first.fillna(fallback)


if __name__ == "__main__":
    run()
