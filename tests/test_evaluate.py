"""Checks for the Week 5 evaluation helpers (no MCMC)."""

import numpy as np
import pandas as pd
from scipy import stats

from bird_strike_radar import evaluate as ev


def test_split_has_no_overlap_and_test_cells_were_seen():
    panel = pd.DataFrame(
        [(c, y, m, 1000, 0) for c in ["KAAA", "KBBB"] for y in range(2010, 2026) for m in range(1, 13)]
        + [("KNEW", 2024, 5, 1000, 1)],
        columns=["icao", "year", "month", "total_ops", "damaging"],
    )
    train, test = ev.split(panel)
    assert train.year.max() <= ev.TRAIN_YEARS[1] < ev.TEST_YEARS[0] <= test.year.min()
    assert "KNEW" not in set(test.icao)  # never seen in training -> not scored


def test_nb_logpmf_matches_scipy():
    y = np.array([0, 1, 3, 10])
    n, p = 2.5, 0.4
    assert np.allclose(ev.nb_logpmf(y, n, p), stats.nbinom.logpmf(y, n, p))


def test_randomized_pit_is_uniform_when_forecast_is_right():
    rng = np.random.default_rng(0)
    mu = rng.uniform(0.2, 5, size=4000)
    y = rng.poisson(mu)
    draws = rng.poisson(mu, size=(3000, len(mu)))
    pit = ev.randomized_pit(draws, y, rng)
    # Each decile should hold about 10% of the observations
    counts = np.histogram(pit, bins=10, range=(0, 1))[0] / len(pit)
    assert np.all(np.abs(counts - 0.1) < 0.025)


def test_randomized_pit_flags_an_underforecast():
    rng = np.random.default_rng(1)
    y = rng.poisson(4.0, size=3000)
    draws = rng.poisson(1.0, size=(2000, 3000))  # forecast far too low
    pit = ev.randomized_pit(draws, y, rng)
    assert (pit > 0.95).mean() > 0.5


def test_totals_sum_over_years():
    test = pd.DataFrame({"icao": ["A", "A", "B"], "month": [1, 1, 1]})
    keys = pd.DataFrame({"icao": ["A", "B"], "month": [1, 1]})
    draws = np.array([[1, 2, 5], [0, 1, 3]])
    assert np.array_equal(ev._totals(test, draws, keys), [[3, 5], [1, 3]])
