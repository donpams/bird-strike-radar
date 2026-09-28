"""Run every Week 1 step in order:  uv run python -m bird_strike_radar.pipeline"""

from . import ingest_airports, ingest_atads, ingest_strikes, report_week1, study_airports


def main() -> None:
    ingest_strikes.run()
    ingest_atads.run()
    ingest_airports.run()
    study_airports.run()
    report_week1.run()


if __name__ == "__main__":
    main()
