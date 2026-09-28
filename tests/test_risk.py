"""Tests for the MIL-STD-882E tables, severity mapping and the empirical-Bayes prior fit."""

import numpy as np
import pandas as pd
import pytest

from bird_strike_radar import mil882
from bird_strike_radar.baseline import fit_gamma_prior
from bird_strike_radar.severity import classify, severity_from_cost


# ---------- MIL-STD-882E Table III, checked cell by cell against the PDF (p. 13) ----------
@pytest.mark.parametrize(
    "level, expected",
    [
        ("A", ["High", "High", "Serious", "Medium"]),
        ("B", ["High", "High", "Serious", "Medium"]),
        ("C", ["High", "Serious", "Medium", "Low"]),
        ("D", ["Serious", "Medium", "Medium", "Low"]),
        ("E", ["Medium", "Medium", "Medium", "Low"]),
    ],
)
def test_risk_matrix_matches_standard(level, expected):
    assert [mil882.risk_level(level, s) for s in (1, 2, 3, 4)] == expected


@pytest.mark.parametrize(
    "p, level",
    [(0.5, "A"), (0.1, "A"), (0.0999, "B"), (0.01, "B"), (0.005, "C"), (0.001, "C"),
     (0.000999, "D"), (1e-6, "D"), (9.9e-7, "E"), (0.0, "E")],
)
def test_probability_levels_table_a2_boundaries(p, level):
    assert mil882.probability_level(p) == level


def test_probability_level_rejects_bad_input():
    with pytest.raises(ValueError):
        mil882.probability_level(1.5)


def test_worst_risk():
    assert mil882.worst(["Low", "Serious", "Medium"]) == "Serious"


# ---------- Severity from FAA fields (Table I dollar bands and injury criteria) ----------
def test_cost_bands():
    assert [severity_from_cost(c) for c in (10e6, 9.99e6, 1e6, 999_999, 100_000, 99_999, 0)] == [1, 2, 2, 3, 3, 4, 4]


def _strikes(**cols):
    base = dict(cost_repairs_usd_adj=[np.nan], cost_other_usd_adj=[np.nan], injuries=[0], fatalities=[0])
    base.update({k: [v] for k, v in cols.items()})
    return pd.DataFrame(base)


def test_unknown_cost_and_no_injury_is_unknown_severity():
    assert pd.isna(classify(_strikes())[0])


def test_injuries_and_fatalities_only_make_it_worse():
    assert classify(_strikes(cost_repairs_usd_adj=5_000, injuries=1))[0] == 3
    assert classify(_strikes(cost_repairs_usd_adj=5e6, injuries=1))[0] == 2  # cost already worse
    assert classify(_strikes(injuries=3))[0] == 2
    assert classify(_strikes(cost_repairs_usd_adj=10, fatalities=1))[0] == 1


def test_repair_and_other_costs_are_added():
    assert classify(_strikes(cost_repairs_usd_adj=60_000, cost_other_usd_adj=50_000))[0] == 3


# ---------- Empirical Bayes: the prior fit recovers known parameters from simulated data ----------
def test_gamma_prior_recovers_simulated_parameters():
    rng = np.random.default_rng(7)
    alpha, beta = 2.0, 20.0  # true mean rate 0.1 per exposure unit
    e = rng.uniform(1, 60, size=4000)
    rates = rng.gamma(alpha, 1 / beta, size=e.size)
    y = rng.poisson(rates * e)
    a_hat, b_hat = fit_gamma_prior(y.astype(float), e)
    assert a_hat / b_hat == pytest.approx(alpha / beta, rel=0.05)
    assert a_hat == pytest.approx(alpha, rel=0.25)
