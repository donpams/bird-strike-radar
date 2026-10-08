"""Run every step in order:  uv run python -m bird_strike_radar.pipeline"""

from . import (
    baseline,
    evaluate,
    export_web,
    fit_hier,
    ingest_airports,
    ingest_atads,
    ingest_strikes,
    report_week1,
    report_week2,
    report_week4,
    report_week5,
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
    # Week 4: Bayesian hierarchical model (a few minutes; set SKIP_HIER=1 to reuse the last fit)
    import os

    if not os.environ.get("SKIP_HIER"):
        fit_hier.run()
    report_week4.run()
    # Week 5: temporal holdout (fit 2010-2022, forecast 2023-2025). Refits the hierarchical model,
    # so it is also skipped by SKIP_HIER=1 (the report then uses the last evaluation)
    if not os.environ.get("SKIP_HIER"):
        evaluate.run()
    report_week5.run()
    # Static data for the web map (web/public/data/radar.json), from the best available model
    export_web.run()


if __name__ == "__main__":
    main()
