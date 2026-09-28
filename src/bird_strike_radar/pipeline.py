"""Run every step in order:  uv run python -m bird_strike_radar.pipeline"""

from . import (
    baseline,
    ingest_airports,
    ingest_atads,
    ingest_strikes,
    report_week1,
    report_week2,
    study_airports,
)


def main() -> None:
    # Week 1: raw -> clean tables
    ingest_strikes.run()
    ingest_atads.run()
    ingest_airports.run()
    study_airports.run()
    report_week1.run()
    # Week 2: baseline rates + MIL-STD-882E risk
    baseline.run()
    report_week2.run()


if __name__ == "__main__":
    main()
