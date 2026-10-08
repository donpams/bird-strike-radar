"""Fast checks for the Week 4 hierarchical model (no full MCMC run)."""

import jax
import numpy as np
import pandas as pd
from numpyro.infer import Predictive

from bird_strike_radar import hier_model as hm


def test_flyway_assignment():
    assert hm.flyway_of("CA", -118.4) == "Pacific"
    assert hm.flyway_of("TX", -97.0) == "Central"
    assert hm.flyway_of("IL", -87.9) == "Mississippi"
    assert hm.flyway_of("NY", -73.8) == "Atlantic"
    # Split states: west of the Continental Divide goes Pacific
    assert hm.flyway_of("CO", -108.5) == "Pacific"
    assert hm.flyway_of("CO", -104.7) == "Central"


def _tiny_design():
    panel = pd.DataFrame(
        [(icao, yr, mo, 5000 + 100 * mo, 0) for icao in ["KAAA", "KBBB", "KCCC"] for yr in (2020, 2021) for mo in range(1, 13)],
        columns=["icao", "year", "month", "total_ops", "damaging"],
    )
    airports = pd.DataFrame({"icao": ["KAAA", "KBBB", "KCCC"], "state": ["CA", "TX", "NY"], "lon": [-118.0, -97.0, -73.0]})
    return hm.design(panel, airports)


def test_design_shapes():
    d = _tiny_design()
    assert d["n_a"] == 3 and d["n_y"] == 2
    assert len(d["a"]) == len(d["m"]) == len(d["y"]) == 72
    assert d["m"].min() == 0 and d["m"].max() == 11
    assert list(d["flyway"]) == ["Pacific", "Central", "Atlantic"]


def test_prior_predictive_runs_and_centres_effects():
    d = _tiny_design()
    pred = Predictive(hm.model, num_samples=20)(
        jax.random.PRNGKey(0), a=d["a"], y=d["y"], m=d["m"], f_of_a=d["f_of_a"], yz=d["yz"], log_E=d["log_E"],
        n_a=d["n_a"], n_y=d["n_y"],
    )
    assert pred["count"].shape == (20, 72)
    assert (np.asarray(pred["count"]) >= 0).all()
    # Seasonal and year effects are centred so the intercept owns the overall level
    assert np.allclose(np.asarray(pred["season"]).mean(axis=-1), 0, atol=1e-5)
    assert np.allclose(np.asarray(pred["year"]).mean(axis=-1), 0, atol=1e-5)


def test_reference_rate_uses_reference_years():
    d = _tiny_design()
    s = {k: np.zeros((1,) + shape) for k, shape in
         {"b0": (), "season": (12,), "flyseason": (4, 12), "airport": (3,), "aseason": (3, 12), "year": (2,), "trend": (3,)}.items()}
    s["year"] = np.array([[0.0, 1.0]])
    lr = hm.reference_log_rate(s, d, ref_years=(2021, 2021))
    assert np.allclose(lr, 1.0)  # only the 2021 year effect is used
