"""Clean the FAA National Wildlife Strike Database export into one tidy Parquet file.

Input : data/raw/faa/strikes.csv   (from `mdb-export Public.accdb STRIKE_REPORTS`)
Output: data/processed/strikes.parquet

Decisions made here (all documented in reports/week1_data_quality.md):
  * Columns that identify people or specific flights are dropped, never written downstream.
  * Year and month come from INCIDENT_YEAR / INCIDENT_MONTH. INCIDENT_DATE uses a
    two-digit year ("10/08/25"), which is ambiguous back to 1990, so we only take the day from it.
  * DAMAGE_LEVEL blank means "unknown", which is NOT the same as "no damage".
    `damaging` is True for M, M?, S, D; False for N; missing (<NA>) when unknown.
  * Altitude bands are fixed here so every later step uses the same bins.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import paths

# Personal or flight-identifying fields. Dropped at load time so they can never leak
# into processed data, the website, or a commit.
PII_COLUMNS = [
    "REPORTED_NAME",  # name of the person who filed the report
    "REPORTED_TITLE",
    "PERSON",
    "REMARKS",  # free text, can contain names
    "COMMENTS",  # free text, can contain names / owners
    "REG",  # aircraft tail number
    "FLT",  # flight number
    "IMAGE",
    "TRANSFER",  # unused per FAA read_me
]

DAMAGING_CODES = {"M", "M?", "S", "D"}

# Altitude bands (feet above ground level). Chosen so each band maps to a distinct
# phase of terminal-area flight: on the runway, initial climb / short final,
# pattern altitude, and above the typical traffic pattern.
ALT_BANDS = [
    ("ground", 0, 0),
    ("0-500 ft", 1, 500),
    ("500-3,000 ft", 501, 3000),
    ("above 3,000 ft", 3001, np.inf),
]

LIGHT_ORDER = ["Dawn", "Day", "Dusk", "Night"]


def _blank_to_na(s: pd.Series) -> pd.Series:
    s = s.str.strip()
    return s.mask(s == "")


def _to_num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(_blank_to_na(s), errors="coerce")


def altitude_band(height_ft: pd.Series) -> pd.Series:
    out = pd.Series(pd.NA, index=height_ft.index, dtype="string")
    for name, lo, hi in ALT_BANDS:
        out[(height_ft >= lo) & (height_ft <= hi)] = name
    return pd.Categorical(out, categories=[b[0] for b in ALT_BANDS], ordered=True)


def load_raw(csv_path=paths.RAW_STRIKES_CSV) -> pd.DataFrame:
    # Read everything as text first: the export mixes blanks, codes and numbers,
    # and letting pandas guess types silently turns codes like "M?" into NaN.
    return pd.read_csv(csv_path, dtype=str, keep_default_na=False)


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.drop(columns=[c for c in PII_COLUMNS if c in raw.columns])

    out = pd.DataFrame(index=df.index)
    out["record_id"] = _to_num(df["INDEX_NR"]).astype("Int64")

    # --- when ---------------------------------------------------------------
    out["year"] = _to_num(df["INCIDENT_YEAR"]).astype("Int64")
    out["month"] = _to_num(df["INCIDENT_MONTH"]).astype("Int64")
    day = pd.to_numeric(df["INCIDENT_DATE"].str.slice(3, 5), errors="coerce")
    out["date"] = pd.to_datetime(
        dict(year=out["year"], month=out["month"], day=day), errors="coerce"
    )
    hhmm = _blank_to_na(df["TIME"])
    out["hour_local"] = pd.to_numeric(hhmm.str.slice(0, 2), errors="coerce").astype("Int64")
    out.loc[~out["hour_local"].between(0, 23), "hour_local"] = pd.NA
    out["light"] = pd.Categorical(_blank_to_na(df["TIME_OF_DAY"]), categories=LIGHT_ORDER)

    # --- where --------------------------------------------------------------
    airport = _blank_to_na(df["AIRPORT_ID"]).str.upper()
    # ZZZZ is the FAA's code for "no airport / unknown" (mostly en route strikes)
    out["airport_icao"] = airport.mask(airport == "ZZZZ")
    out["airport_name"] = _blank_to_na(df["AIRPORT"])
    out["state"] = _blank_to_na(df["STATE"])
    out["phase"] = _blank_to_na(df["PHASE_OF_FLIGHT"])
    out["height_ft"] = _to_num(df["HEIGHT"])
    out["speed_kt"] = _to_num(df["SPEED"])
    out["distance_nm"] = _to_num(df["DISTANCE"])
    out["alt_band"] = altitude_band(out["height_ft"])

    # --- aircraft -----------------------------------------------------------
    operator = _blank_to_na(df["OPERATOR"])
    out["operator"] = operator.mask(operator.str.upper() == "UNKNOWN")  # aircraft never identified
    out["ac_class"] = _blank_to_na(df["AC_CLASS"])  # A = airplane, B = helicopter
    out["ac_mass"] = _to_num(df["AC_MASS"]).astype("Int64")  # 1 (<=2,250 kg) .. 5 (>272,000 kg)
    out["num_engines"] = _to_num(df["NUM_ENGS"]).astype("Int64")
    out["engine_type"] = _blank_to_na(df["TYPE_ENG"])

    # --- outcome ------------------------------------------------------------
    dmg = _blank_to_na(df["DAMAGE_LEVEL"]).fillna("U")  # U = unknown (blank in source)
    out["damage_level"] = pd.Categorical(dmg, categories=["N", "M", "M?", "S", "D", "U"])
    out["damaging"] = pd.array(
        np.where(dmg == "U", None, dmg.isin(DAMAGING_CODES)), dtype="boolean"
    )
    out["indicated_damage"] = _to_num(df["INDICATED_DAMAGE"]).astype("Int64").astype("boolean")
    out["effect"] = _blank_to_na(df["EFFECT"])
    out["injuries"] = _to_num(df["NR_INJURIES"]).fillna(0).astype("Int64")
    out["fatalities"] = _to_num(df["NR_FATALITIES"]).fillna(0).astype("Int64")
    out["cost_repairs_usd_adj"] = _to_num(df["COST_REPAIRS_INFL_ADJ"])
    out["cost_other_usd_adj"] = _to_num(df["COST_OTHER_INFL_ADJ"])
    out["aircraft_out_of_service_hr"] = _to_num(df["AOS"])

    # --- wildlife -----------------------------------------------------------
    out["species_id"] = _blank_to_na(df["SPECIES_ID"])
    out["species"] = _blank_to_na(df["SPECIES"])
    out["size"] = pd.Categorical(
        _blank_to_na(df["SIZE"]), categories=["Small", "Medium", "Large"], ordered=True
    )
    out["num_struck"] = _blank_to_na(df["NUM_STRUCK"])  # ranges like "2-10", keep as text
    out["warned"] = _blank_to_na(df["WARNED"])

    # --- reporting behaviour (useful later for the "reporting bias" adjustment) ----
    out["source"] = _blank_to_na(df["SOURCE"])
    out["last_update"] = pd.to_datetime(df["LUPDATE"], format="%m/%d/%y %H:%M:%S", errors="coerce")

    return out


def run() -> pd.DataFrame:
    paths.ensure_dirs()
    df = clean(load_raw())
    df.to_parquet(paths.STRIKES_PARQUET, index=False)
    print(f"strikes: {len(df):,} rows -> {paths.STRIKES_PARQUET.relative_to(paths.ROOT)}")
    return df


if __name__ == "__main__":
    run()
