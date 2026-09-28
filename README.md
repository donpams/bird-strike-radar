# Bird Strike Radar

An interactive map of bird-strike risk at US commercial airports, treated as a **system safety problem**:
a model estimates the likelihood of a damaging strike by airport, month, time of day and altitude band,
with uncertainty, and classifies it with the public MIL-STD-882E risk matrix.

Built only on public data. Not affiliated with any employer or program. **Not for operational use.**

## Data sources

| Source | What it gives | Where it goes |
|---|---|---|
| [FAA National Wildlife Strike Database](https://wildlife.faa.gov/) | Strike reports, 1990-present | `data/raw/faa/` |
| [FAA ATADS](https://www.aspm.faa.gov/opsnet/sys/Airport.asp) | Monthly tower operations per airport | `data/raw/atads/` |
| [OurAirports](https://ourairports.com/data/) | Coordinates and ICAO/FAA id crosswalk | `data/raw/ourairports/` |
| [MIL-STD-882E w/ Change 1](https://safety.army.mil/) | Risk assessment matrix | `docs/refs/` |

Raw and processed data are not committed. See the download steps in `docs/` (coming soon).

## Run it

```bash
uv sync
uv run python -m bird_strike_radar.pipeline   # raw -> data/processed/*.parquet + reports/
uv run pytest
```

## Progress

- [x] Week 0: repo, data downloads
- [x] Week 1: ingest, airport selection, [data quality report](reports/week1_data_quality.md)
- [ ] Week 2: baseline rates + MIL-STD-882E risk logic
- [ ] Week 3: minimum map on GitHub Pages
