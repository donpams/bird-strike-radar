"""Week 4: Bayesian hierarchical model of damaging bird strikes (NumPyro).

One model for every airport, month and year at once, instead of the Week 2 approach of
12 separate monthly fits:

    damaging[a, y, m] ~ NegativeBinomial(mean = rate[a, y, m] * ops[a, y, m] / 10,000, dispersion = phi)

    log rate[a, y, m] = b0                       national level
                      + season[m]                national seasonality
                      + flyway_season[f(a), m]   each flyway's own seasonal shape
                      + airport[a]               airport level
                      + airport_season[a, m]     airport's own seasonal quirks (e.g. winter flocks)
                      + year[y]                  national year-to-year changes (random walk)
                      + airport_trend[a] * t     airport-specific drift over time

Every group-level effect is drawn from a distribution whose spread is learned from the data
(partial pooling). Airports with little traffic borrow strength from their flyway and from the
nation; busy airports are driven mostly by their own counts.

Why each piece is there:
  * flyway_season: migration timing differs by flyway, so a single national curve is too crude.
  * airport_season: some airports have local patterns (wintering waterfowl, nesting colonies).
  * year: reporting has grown over time; without this the model would read reporting growth
    as rising hazard and blur the seasonal and airport effects.
  * airport_trend: some airports changed their reporting (or hazard) more than others. From
    strike reports alone the two can't be separated, so this is documented as a limitation.
  * NegativeBinomial rather than Poisson: counts are "clumpier" than Poisson (one flock can
    produce several damaging strikes), and ignoring that would make intervals too narrow.

What the map shows: the estimated rate at "current conditions", i.e. the year effects averaged
over REFERENCE_YEARS (2023-2025), so the numbers describe recent risk rather than a 16-year
average that mixes in older, lower reporting.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Let up to 4 chains run in parallel on CPU cores; must be set before JAX initialises.
import numpyro  # noqa: E402

numpyro.set_host_device_count(4)

import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402

from . import paths  # noqa: E402

REFERENCE_YEARS = (2023, 2025)
FLYWAYS = ["Pacific", "Central", "Mississippi", "Atlantic"]

# USFWS administrative flyways by state. Four states straddle the Continental Divide; their
# airports west of -108 deg longitude go to the Pacific Flyway (an approximation, documented).
_STATE_FLYWAY = {
    **dict.fromkeys(["AK", "AZ", "CA", "HI", "ID", "NV", "OR", "UT", "WA"], "Pacific"),
    **dict.fromkeys(["ND", "SD", "NE", "KS", "OK", "TX", "MT", "WY", "CO", "NM"], "Central"),
    **dict.fromkeys(["MN", "WI", "IA", "IL", "MO", "AR", "LA", "MS", "AL", "TN", "KY", "IN", "OH", "MI"], "Mississippi"),
    **dict.fromkeys(
        ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA", "DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "PR"],
        "Atlantic",
    ),
}
_SPLIT_STATES = {"MT", "WY", "CO", "NM"}


def flyway_of(state: str, lon: float) -> str:
    if state in _SPLIT_STATES and lon < -108:
        return "Pacific"
    return _STATE_FLYWAY.get(state, "Central")


# --------------------------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------------------------
def design(panel: pd.DataFrame, airports: pd.DataFrame) -> dict:
    """Integer indices + exposure for the model, from the Week 2 panel (airport x year x month)."""
    airports = airports.set_index("icao")
    icaos = sorted(panel.icao.unique())
    a_index = {c: i for i, c in enumerate(icaos)}
    years = sorted(panel.year.unique())
    y_index = {y: i for i, y in enumerate(years)}
    fly = [flyway_of(airports.loc[c, "state"], airports.loc[c, "lon"]) for c in icaos]
    f_index = np.array([FLYWAYS.index(f) for f in fly])
    yz = (np.array(years) - np.mean(years)) / (np.std(years) or 1)  # standardised year for trends
    return {
        "icaos": icaos,
        "years": years,
        "flyway": fly,
        "a": panel.icao.map(a_index).to_numpy(),
        "y": panel.year.map(y_index).to_numpy(),
        "m": panel.month.to_numpy() - 1,
        "f_of_a": f_index,
        "yz": yz,
        "log_E": np.log(panel.total_ops.to_numpy() / 1e4),
        "count": panel.damaging.to_numpy() if "damaging" in panel else None,
        "n_a": len(icaos),
        "n_y": len(years),
    }


# --------------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------------
def _centred(x, axis=-1):
    return x - jnp.mean(x, axis=axis, keepdims=True)


def model(a, y, m, f_of_a, yz, log_E, n_a, n_y, count=None):
    # Spreads of each group of effects (learned from data)
    s_season = numpyro.sample("s_season", dist.HalfNormal(1.0))
    s_flyseason = numpyro.sample("s_flyseason", dist.HalfNormal(0.5))
    s_airport = numpyro.sample("s_airport", dist.HalfNormal(1.0))
    s_aseason = numpyro.sample("s_aseason", dist.HalfNormal(0.5))
    s_year = numpyro.sample("s_year", dist.HalfNormal(0.3))
    s_trend = numpyro.sample("s_trend", dist.HalfNormal(0.3))
    phi = numpyro.sample("phi", dist.Gamma(2.0, 0.2))  # NegBin dispersion; large phi -> Poisson

    b0 = numpyro.sample("b0", dist.Normal(np.log(0.1), 1.0))

    # Non-centred parameterisation (z * sigma) keeps the sampler efficient with sparse data.
    # Seasonal and year effects are centred so the intercepts own the overall level.
    season = numpyro.deterministic("season", _centred(numpyro.sample("z_season", dist.Normal(0, 1).expand([12])) * s_season))
    flyseason = numpyro.deterministic(
        "flyseason", _centred(numpyro.sample("z_flyseason", dist.Normal(0, 1).expand([4, 12])) * s_flyseason)
    )
    airport = numpyro.deterministic("airport", numpyro.sample("z_airport", dist.Normal(0, 1).expand([n_a])) * s_airport)
    aseason = numpyro.deterministic(
        "aseason", _centred(numpyro.sample("z_aseason", dist.Normal(0, 1).expand([n_a, 12])) * s_aseason)
    )
    # Year effects as a random walk: next year is this year plus a small step
    year = numpyro.deterministic(
        "year", _centred(jnp.cumsum(numpyro.sample("z_year", dist.Normal(0, 1).expand([n_y])) * s_year))
    )
    trend = numpyro.deterministic("trend", numpyro.sample("z_trend", dist.Normal(0, 1).expand([n_a])) * s_trend)

    log_rate = (
        b0 + season[m] + flyseason[f_of_a[a], m] + airport[a] + aseason[a, m] + year[y] + trend[a] * yz[y]
    )
    mu = jnp.exp(log_rate + log_E)
    numpyro.sample("count", dist.NegativeBinomial2(mu, phi), obs=count)


def fit(d: dict, num_warmup=600, num_samples=600, num_chains=4, seed=0, progress=True) -> MCMC:
    kernel = NUTS(model, target_accept_prob=0.85, max_tree_depth=8)
    mcmc = MCMC(kernel, num_warmup=num_warmup, num_samples=num_samples, num_chains=num_chains,
                chain_method="parallel", progress_bar=progress)
    mcmc.run(
        jax.random.PRNGKey(seed),
        a=jnp.asarray(d["a"]), y=jnp.asarray(d["y"]), m=jnp.asarray(d["m"]),
        f_of_a=jnp.asarray(d["f_of_a"]), yz=jnp.asarray(d["yz"]), log_E=jnp.asarray(d["log_E"]),
        n_a=d["n_a"], n_y=d["n_y"],
        count=None if d["count"] is None else jnp.asarray(d["count"]),
    )
    return mcmc


# --------------------------------------------------------------------------------------------
# Quantities the map needs
# --------------------------------------------------------------------------------------------
def reference_log_rate(samples: dict, d: dict, ref_years=REFERENCE_YEARS) -> np.ndarray:
    """log rate per 10k ops for every airport x month, at reference-year conditions.

    Returns array [draws, n_airports, 12].
    """
    yrs = np.array(d["years"])
    ref = (yrs >= ref_years[0]) & (yrs <= ref_years[1])
    year_ref = samples["year"][:, ref].mean(axis=1)  # [draws]
    yz_ref = d["yz"][ref].mean()
    f = d["f_of_a"]
    return (
        samples["b0"][:, None, None]
        + samples["season"][:, None, :]
        + samples["flyseason"][:, f, :]
        + samples["airport"][:, :, None]
        + samples["aseason"]
        + year_ref[:, None, None]
        + samples["trend"][:, :, None] * yz_ref
    )


def summarise(samples: dict, d: dict, ops_weights: np.ndarray) -> pd.DataFrame:
    """Posterior mean and 90% interval of rate and rate-relative-to-national per airport-month.

    `ops_weights` [n_airports, 12]: recent operations, used to define the national rate as
    expected damaging strikes / operations across all study airports (same as Week 2).
    """
    rate = np.exp(reference_log_rate(samples, d))  # [draws, A, 12]
    w = ops_weights / ops_weights.sum(axis=0, keepdims=True)
    national = (rate * w[None]).sum(axis=1)  # [draws, 12]
    rel = rate / national[:, None, :]
    q = lambda x, p: np.quantile(x, p, axis=0)  # noqa: E731
    rows = []
    for ai, icao in enumerate(d["icaos"]):
        for mo in range(12):
            r = rate[:, ai, mo]
            rr = rel[:, ai, mo]
            rows.append(
                dict(
                    icao=icao, month=mo + 1, flyway=d["flyway"][ai],
                    rate_mean=r.mean(), rate_lo=q(r, 0.05), rate_hi=q(r, 0.95),
                    relative_rate=rr.mean(), relative_lo=q(rr, 0.05), relative_hi=q(rr, 0.95),
                    p_above_national=(rr > 1).mean(),
                )
            )
    out = pd.DataFrame(rows)
    nat = pd.DataFrame({"month": np.arange(1, 13), "national_rate": national.mean(axis=0),
                        "national_lo": q(national, 0.05), "national_hi": q(national, 0.95)})
    return out.merge(nat, on="month")


def flatten_samples(mcmc: MCMC) -> dict:
    return {k: np.asarray(v) for k, v in mcmc.get_samples().items()}
