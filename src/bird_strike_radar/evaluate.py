"""Week 5: does the model predict years it has never seen?

Temporal holdout: every model is fitted on 2010-2022 only, then asked to forecast the damaging
strikes at each airport in each month of 2023-2025. Traffic (operations) in the test years is
treated as known, because a planner would know the schedule; strikes are what we forecast.

Models compared (all fitted on the training years only):
  national     one rate per calendar month for every airport (the "know nothing about airports" reference)
  raw          each airport-month's own training rate, no pooling
  week2        the Week 2 empirical-Bayes baseline (pooled per month, no time trend)
  week2_level  Week 2 scaled by how much the national rate in the last 3 training years exceeds the
               training average (a cheap fix for reporting growth; separates "trend" from "structure")
  week4        the Week 4 hierarchical model, with the year random walk and airport trends extended
               forward into the test years (uncertainty about future years is included)

Scores (higher/closer is better):
  log score    average log probability each model gave to what actually happened, per airport-year-month.
               The main score: it rewards being right AND being honest about uncertainty.
  coverage     share of airport-months (3-year totals) whose observed count fell inside the 90% range;
               reported separately for airport-months expecting >= 2 strikes, where it is informative
  PIT tails    share of observed totals in each model's bottom/top 5% (ideal 5% each)
  total        forecast vs observed damaging strikes across all study airports, 2023-2025
  top-10% lift observed test rate in the 10% of airport-months each model ranked riskiest,
               divided by the overall test rate

Output: data/processed/eval_cells.parquet (airport-month results), data/processed/eval_summary.json
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
from scipy import special, stats

from . import hier_model as hm
from . import paths
from .baseline import build_panel, fit_gamma_prior

TRAIN_YEARS = (2010, 2022)
TEST_YEARS = (2023, 2025)
LEVEL_YEARS = 3  # week2_level: last N training years define "current level"
EVAL_CELLS = paths.PROCESSED / "eval_cells.parquet"
EVAL_JSON = paths.PROCESSED / "eval_summary.json"
MODELS = ["national", "raw", "week2", "week2_level", "week4"]
LABELS = {"national": "National monthly rate", "raw": "Raw (own data only)", "week2": "Week 2 baseline",
          "week2_level": "Week 2 + recent level", "week4": "Week 4 hierarchical"}


# --------------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------------
def split(panel: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = panel[panel.year.between(*TRAIN_YEARS)].copy()
    test = panel[panel.year.between(*TEST_YEARS)].copy()
    # Only forecast airport-months the models have seen in training
    seen = train[["icao", "month"]].drop_duplicates()
    test = test.merge(seen, on=["icao", "month"])
    return train, test


def nb_logpmf(y, n, p):
    """log P(Y=y) for a negative binomial with scipy's (n, p) parameterisation, vectorised."""
    return special.gammaln(y + n) - special.gammaln(n) - special.gammaln(y + 1) + n * np.log(p) + y * np.log1p(-p)


def randomized_pit(draws: np.ndarray, y: np.ndarray, rng) -> np.ndarray:
    """Randomised PIT for counts: uniform on [F(y-1), F(y)]. Uniform if the forecast is calibrated.

    draws [D, N] predictive samples, y [N] observed.
    """
    below = (draws < y[None]).mean(axis=0)
    at_or_below = (draws <= y[None]).mean(axis=0)
    return below + rng.uniform(size=len(y)) * (at_or_below - below)


def _totals(test: pd.DataFrame, cell_draws: np.ndarray, keys: pd.DataFrame) -> np.ndarray:
    """Sum per-cell draws [D, N_cells] to airport-month totals [D, N_keys] (the 3 test years)."""
    key_idx = test[["icao", "month"]].merge(keys[["icao", "month"]].reset_index(), on=["icao", "month"], how="left")
    out = np.zeros((len(keys), cell_draws.shape[0]))
    np.add.at(out, key_idx["index"].to_numpy(), cell_draws.T)
    return out.T


# --------------------------------------------------------------------------------------------
# Forecasts from each model: per test cell (airport-year-month) a log score, and predictive draws
# --------------------------------------------------------------------------------------------
def forecast_gamma_poisson(train, test, rng, D, scale=1.0, pooled=True):
    """Week 2-style forecasts. pooled=False gives the raw (no pooling) rate instead."""
    am = train.groupby(["icao", "month"], as_index=False).agg(y=("damaging", "sum"), ops=("total_ops", "sum"))
    am["E"] = am.ops / 1e4
    parts = []
    for m, g in am.groupby("month"):
        g = g.copy()
        if pooled:
            a, b = fit_gamma_prior(g.y.to_numpy(float), g.E.to_numpy(float))
            g["post_a"], g["post_b"] = a + g.y, (b + g.E) / scale  # scaling the rate = dividing the rate parameter
        parts.append(g)
    am = pd.concat(parts)
    t = test.merge(am, on=["icao", "month"], how="left", suffixes=("", "_tr"))
    E = t.total_ops.to_numpy() / 1e4
    y = t.damaging.to_numpy()
    if pooled:
        a, b = t.post_a.to_numpy(), t.post_b.to_numpy()
        logscore = nb_logpmf(y, a, b / (b + E))
        rate = rng.gamma(a[None], 1 / b[None], size=(D, len(t)))
    else:
        r = (t.y / t.E).to_numpy()
        logscore = stats.poisson.logpmf(y, r * E)
        rate = np.broadcast_to(r, (D, len(t)))
    draws = rng.poisson(rate * E[None])
    mean_rate = rate.mean(axis=0)
    return logscore, draws, mean_rate


def forecast_national(train, test, rng, D):
    nat = train.groupby("month").apply(lambda g: g.damaging.sum() / (g.total_ops.sum() / 1e4), include_groups=False)
    r = test.month.map(nat).to_numpy()
    E = test.total_ops.to_numpy() / 1e4
    logscore = stats.poisson.logpmf(test.damaging.to_numpy(), r * E)
    draws = rng.poisson(np.broadcast_to(r * E, (D, len(test))))
    return logscore, draws, r


def recent_level_factor(train) -> float:
    last = train[train.year > TRAIN_YEARS[1] - LEVEL_YEARS]
    return (last.damaging.sum() / last.total_ops.sum()) / (train.damaging.sum() / train.total_ops.sum())


def fit_hierarchical(train, airports, num_warmup=800, num_samples=800, num_chains=None, seed=1):
    if num_chains is None:
        num_chains = max(2, min(4, os.cpu_count() or 2))
    d = hm.design(train, airports)
    mcmc = hm.fit(d, num_warmup=num_warmup, num_samples=num_samples, num_chains=num_chains, seed=seed, progress=False)
    div = int(mcmc.get_extra_fields()["diverging"].sum())
    return d, hm.flatten_samples(mcmc), div


def forecast_hierarchical(d, s, test, rng, D):
    """Extend the year random walk and the airport trends into the test years."""
    n_draws = len(s["b0"])
    pick = rng.choice(n_draws, size=D, replace=n_draws < D)
    s = {k: v[pick] for k, v in s.items()}
    train_years = np.array(d["years"])
    test_years = np.arange(TEST_YEARS[0], TEST_YEARS[1] + 1)
    # Random walk: each future year adds a fresh step with the learned spread s_year
    innov = rng.normal(size=(D, len(test_years))) * s["s_year"][:, None]
    year_f = s["year"][:, -1][:, None] + np.cumsum(innov, axis=1)  # [D, n_test_years]
    yz_f = (test_years - train_years.mean()) / train_years.std()  # same scaling as in training

    a_index = {c: i for i, c in enumerate(d["icaos"])}
    a = test.icao.map(a_index).to_numpy()
    k = (test.year - TEST_YEARS[0]).to_numpy()
    m = test.month.to_numpy() - 1
    f = d["f_of_a"][a]
    lr = (s["b0"][:, None] + s["season"][:, m] + s["flyseason"][:, f, m] + s["airport"][:, a]
          + s["aseason"][:, a, m] + year_f[:, k] + s["trend"][:, a] * yz_f[k])
    E = test.total_ops.to_numpy() / 1e4
    mu = np.exp(lr) * E[None]
    phi = s["phi"][:, None]
    y = test.damaging.to_numpy()
    # Log score: average the probability over posterior draws, then take the log
    lp = nb_logpmf(y[None], phi, phi / (phi + mu))
    logscore = special.logsumexp(lp, axis=0) - np.log(D)
    draws = rng.poisson(rng.gamma(phi, mu / phi))
    return logscore, draws, np.exp(lr).mean(axis=0)


# --------------------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------------------
def score_model(name, logscore, draws, mean_rate, test, keys, rng):
    tot = _totals(test, draws, keys)
    y = keys.observed.to_numpy()
    lo, hi = np.quantile(tot, 0.05, axis=0), np.quantile(tot, 0.95, axis=0)
    pit = randomized_pit(tot, y, rng)
    # Predicted rate per airport-month (ops-weighted over test years) for ranking
    t = test.assign(pred=mean_rate * test.total_ops / 1e4)
    pred_rate = (t.groupby(["icao", "month"]).pred.sum() / (t.groupby(["icao", "month"]).total_ops.sum() / 1e4))
    pred_rate = pred_rate.reindex(pd.MultiIndex.from_frame(keys[["icao", "month"]])).to_numpy()
    top = pred_rate >= np.quantile(pred_rate, 0.9)
    overall = y.sum() / keys.E.sum()
    finite = np.isfinite(logscore)
    cells = pd.DataFrame({f"{name}_mean": tot.mean(axis=0), f"{name}_lo": lo, f"{name}_hi": hi,
                          f"{name}_pit": pit, f"{name}_rate": pred_rate})
    metrics = {
        "log_score": float(logscore.mean()) if finite.all() else float("-inf"),
        "impossible_cells": int((~finite).sum()),
        "coverage90": float(((y >= lo) & (y <= hi)).mean()),
        # Most airport-months expect 0-1 strikes, where any sensible 90% range covers almost everything.
        # The informative check is on airport-months where the model expects at least 2.
        "coverage90_busy": float(((y >= lo) & (y <= hi))[tot.mean(axis=0) >= 2].mean()),
        "busy_cells": int((tot.mean(axis=0) >= 2).sum()),
        "pit_low": float((pit < 0.05).mean()),
        "pit_high": float((pit > 0.95).mean()),
        "forecast_total": float(tot.sum(axis=1).mean()),
        "forecast_total_lo": float(np.quantile(tot.sum(axis=1), 0.05)),
        "forecast_total_hi": float(np.quantile(tot.sum(axis=1), 0.95)),
        "top10_lift": float((y[top].sum() / keys.E[top].sum()) / overall),
        "spearman": float(stats.spearmanr(pred_rate, y / keys.E).statistic),
    }
    return cells, metrics, logscore


def run(D=2000, seed=0, num_warmup=800, num_samples=800) -> dict:
    rng = np.random.default_rng(seed)
    panel, _, _ = build_panel()
    airports = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    train, test = split(panel)
    test = test.reset_index(drop=True)
    keys = (test.groupby(["icao", "month"], as_index=False)
            .agg(observed=("damaging", "sum"), ops=("total_ops", "sum")))
    keys["E"] = keys.ops / 1e4

    level = recent_level_factor(train)
    print(f"evaluation: train {TRAIN_YEARS}, test {TEST_YEARS}; fitting hierarchical model on training years...")
    d, s, divergences = fit_hierarchical(train, airports, num_warmup=num_warmup, num_samples=num_samples)

    forecasts = {
        "national": forecast_national(train, test, rng, D),
        "raw": forecast_gamma_poisson(train, test, rng, D, pooled=False),
        "week2": forecast_gamma_poisson(train, test, rng, D),
        "week2_level": forecast_gamma_poisson(train, test, rng, D, scale=level),
        "week4": forecast_hierarchical(d, s, test, rng, D),
    }
    cells, metrics, cell_scores = [keys], {}, {}
    yearly = {}
    for name, (ls, draws, rate) in forecasts.items():
        c, mtr, ls = score_model(name, ls, draws, rate, test, keys, rng)
        cells.append(c)
        metrics[name] = mtr
        cell_scores[name] = ls
        # National forecast by test year (damaging strikes per 10k ops)
        per_year = {}
        for yr in range(TEST_YEARS[0], TEST_YEARS[1] + 1):
            sel = (test.year == yr).to_numpy()
            ops = test.total_ops[sel].sum() / 1e4
            v = draws[:, sel].sum(axis=1) / ops
            per_year[yr] = [float(v.mean()), float(np.quantile(v, 0.05)), float(np.quantile(v, 0.95))]
        yearly[name] = per_year
    out = pd.concat(cells, axis=1)
    out.to_parquet(EVAL_CELLS, index=False)

    # Where week4 beats week2 cell by cell (paired comparison, with a standard error)
    diff = cell_scores["week4"] - cell_scores["week2"]
    observed_years = (panel.groupby("year").damaging.sum() / (panel.groupby("year").total_ops.sum() / 1e4))
    summary = {
        "train_years": TRAIN_YEARS, "test_years": TEST_YEARS, "cells": int(len(test)),
        "airport_months": int(len(keys)), "observed_total": int(keys.observed.sum()),
        "level_factor": level, "week4_divergences": divergences,
        "week4_minus_week2_logscore": {"mean": float(diff.mean()), "se": float(diff.std(ddof=1) / np.sqrt(len(diff))),
                                       "share_cells_better": float((diff > 0).mean())},
        "metrics": metrics, "yearly_forecast": yearly,
        "observed_by_year": {int(k): float(v) for k, v in observed_years.items()},
    }
    EVAL_JSON.write_text(json.dumps(summary, indent=2))
    m4, m2 = metrics["week4"], metrics["week2"]
    print(f"evaluation: log score week4 {m4['log_score']:.4f} vs week2 {m2['log_score']:.4f}; "
          f"coverage week4 {m4['coverage90']:.0%}; total forecast {m4['forecast_total']:.0f} vs observed "
          f"{summary['observed_total']} -> {EVAL_CELLS.relative_to(paths.ROOT)}")
    return summary


if __name__ == "__main__":
    run()
