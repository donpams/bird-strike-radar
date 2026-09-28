"""Small, fast tests on hand-made rows, so they run without the real data."""

import pandas as pd

from bird_strike_radar.ingest_strikes import PII_COLUMNS, clean


def _raw(**overrides):
    row = {c: "" for c in [
        "INDEX_NR", "INCIDENT_DATE", "INCIDENT_MONTH", "INCIDENT_YEAR", "TIME", "TIME_OF_DAY",
        "AIRPORT_ID", "AIRPORT", "STATE", "PHASE_OF_FLIGHT", "HEIGHT", "SPEED", "DISTANCE",
        "OPERATOR", "AC_CLASS", "AC_MASS", "NUM_ENGS", "TYPE_ENG", "DAMAGE_LEVEL",
        "INDICATED_DAMAGE", "EFFECT", "NR_INJURIES", "NR_FATALITIES", "COST_REPAIRS_INFL_ADJ",
        "AOS", "SPECIES_ID", "SPECIES", "SIZE", "NUM_STRUCK", "WARNED", "SOURCE", "LUPDATE",
        *PII_COLUMNS,
    ]}
    row.update(INDEX_NR="1", INCIDENT_DATE="10/08/95 00:00:00", INCIDENT_MONTH="10",
               INCIDENT_YEAR="1995", INDICATED_DAMAGE="0", REPORTED_NAME="Jane Doe")
    row.update(overrides)
    return pd.DataFrame([row])


def test_pii_is_dropped():
    out = clean(_raw())
    assert not set(PII_COLUMNS) & set(out.columns)
    assert "Jane Doe" not in out.astype(str).to_numpy().ravel()


def test_two_digit_year_is_not_trusted():
    out = clean(_raw())
    assert out.loc[0, "date"] == pd.Timestamp("1995-10-08")


def test_blank_damage_is_unknown_not_none():
    assert pd.isna(clean(_raw(DAMAGE_LEVEL=""))["damaging"][0])
    assert clean(_raw(DAMAGE_LEVEL="N"))["damaging"][0] == False  # noqa: E712
    for code in ["M", "M?", "S", "D"]:
        assert clean(_raw(DAMAGE_LEVEL=code))["damaging"][0] == True  # noqa: E712


def test_zzzz_airport_and_unknown_operator_become_missing():
    out = clean(_raw(AIRPORT_ID="ZZZZ", OPERATOR="UNKNOWN"))
    assert pd.isna(out.loc[0, "airport_icao"]) and pd.isna(out.loc[0, "operator"])


def test_altitude_bands():
    heights = ["0", "1", "500", "501", "3000", "3001", ""]
    expected = ["ground", "0-500 ft", "0-500 ft", "500-3,000 ft", "500-3,000 ft", "above 3,000 ft", None]
    got = [clean(_raw(HEIGHT=h))["alt_band"][0] for h in heights]
    assert [None if pd.isna(g) else g for g in got] == expected
