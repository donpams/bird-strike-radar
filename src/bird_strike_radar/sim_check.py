"""Can the model recover a truth we know? (simulation-based check, Week 4)

1. Take the REAL design: the same 266 airports, months, years and traffic as the actual data.
2. Invent "true" parameters (realistic sizes, close to what the real fit finds).
3. Simulate damaging-strike counts from the model with those parameters.
4. Fit the hierarchical model, and the Week 2 baseline, to the simulated counts.
5. Compare each estimate with the truth we planted.

Passing this doesn't prove the model is right about the real world. It proves the code and
the inference work: if the world looked like the model, we'd get the right answer with honest
uncertainty. Real-world accuracy is tested in Week 5 (fit to 2010-2022, predict 2023-2025).

Output: reports/week4_simulation_check.md
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from . import hier_model as hm
from . import paths
from .baseline import build_panel, fit_gamma_prior

TRUTH = dict(b0=np.log(0.07), s_season=0.33, s_flyseason=0.17, s_airport=0.7, s_aseason=0.35,
             s_year=0.055, s_trend=0.09, phi=12.0)


def simulate(d: dict, seed: int = 1) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    t = TRUTH
    c = lambda x: x - x.mean(axis=-1, keepdims=True)  # noqa: E731
    p = {
        "b0": np.array([t["b0"]]),
        "season": c(rng.normal(0, t["s_season"], 12))[None],
        "flyseason": c(rng.normal(0, t["s_flyseason"], (4, 12)))[None],
        "airport": rng.normal(0, t["s_airport"], d["n_a"])[None],
        "aseason": c(rng.normal(0, t["s_aseason"], (d["n_a"], 12)))[None],
        "year": c(np.cumsum(rng.normal(0, t["s_year"], d["n_y"])))[None],
        "trend": rng.normal(0, t["s_trend"], d["n_a"])[None],
    }
    a, y, m = d["a"], d["y"], d["m"]
    log_rate = (p["b0"][0] + p["season"][0][m] + p["flyseason"][0][d["f_of_a"][a], m] + p["airport"][0][a]
                + p["aseason"][0][a, m] + p["year"][0][y] + p["trend"][0][a] * d["yz"][y])
    mu = np.exp(log_rate + d["log_E"])
    # NegBin2 as a gamma-Poisson mixture
    lam = rng.gamma(t["phi"], mu / t["phi"])
    return rng.poisson(lam), p


def baseline_estimates(panel: pd.DataFrame, counts: np.ndarray) -> pd.DataFrame:
    """Week 2 empirical-Bayes method applied to the simulated counts."""
    q = panel.assign(damaging=counts).groupby(["icao", "month"], as_index=False).agg(
        y=("damaging", "sum"), E=("total_ops", lambda s: s.sum() / 1e4))
    out = []
    for mo, g in q.groupby("month"):
        a, b = fit_gamma_prior(g.y.to_numpy(float), g.E.to_numpy(float))
        pa, pb = a + g.y, b + g.E
        out.append(g.assign(rate_mean=pa / pb, rate_lo=stats.gamma.ppf(0.05, pa, scale=1 / pb),
                            rate_hi=stats.gamma.ppf(0.95, pa, scale=1 / pb)))
    return pd.concat(out)


def score(est: pd.DataFrame, truth: pd.DataFrame) -> dict:
    j = est.merge(truth, on=["icao", "month"])
    err = np.log(j.rate_mean) - np.log(j.true_rate)
    return {
        "coverage_90": float(((j.true_rate >= j.rate_lo) & (j.true_rate <= j.rate_hi)).mean()),
        "median_abs_log_error": float(np.median(np.abs(err))),
        "mean_log_bias": float(err.mean()),
        "rank_corr": float(stats.spearmanr(j.rate_mean, j.true_rate).statistic),
        "median_interval_width": float(np.median(j.rate_hi / j.rate_lo)),
    }


def run(num_warmup=800, num_samples=800, num_chains=4, seed=1) -> dict:
    panel, _, _ = build_panel()
    airports = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    d = hm.design(panel, airports)
    counts, true_p = simulate(d, seed)

    # The truth at reference-year conditions, airport x month
    true_log = hm.reference_log_rate(true_p, d)[0]
    truth = pd.DataFrame([dict(icao=c, month=mo + 1, true_rate=float(np.exp(true_log[i, mo])))
                          for i, c in enumerate(d["icaos"]) for mo in range(12)])

    d_sim = {**d, "count": counts}
    mcmc = hm.fit(d_sim, num_warmup=num_warmup, num_samples=num_samples, num_chains=num_chains, seed=seed,
                  progress=False)
    samples = hm.flatten_samples(mcmc)
    recent = panel[panel.year.between(*hm.REFERENCE_YEARS)]
    w = recent.pivot_table(index="icao", columns="month", values="total_ops", aggfunc="mean").reindex(d["icaos"]).fillna(0)
    est = hm.summarise(samples, d, w.to_numpy())
    base = baseline_estimates(panel, counts)

    # Compare against the values actually REALISED in this simulation, not the generating
    # settings: with only 12 months or 16 years, the realised spread can differ a lot from the
    # setting, and the model can only learn what the data contain.
    realised = {
        "b0": float(true_p["b0"][0] + true_p["airport"][0].mean()),
        "s_season": float(true_p["season"][0].std(ddof=1)),
        "s_flyseason": float(true_p["flyseason"][0].std(ddof=1)),
        "s_airport": float(true_p["airport"][0].std(ddof=1)),
        "s_aseason": float(true_p["aseason"][0].std(ddof=1)),
        "s_year": float(np.diff(true_p["year"][0]).std(ddof=1)),
        "s_trend": float(true_p["trend"][0].std(ddof=1)),
        "phi": TRUTH["phi"],
    }
    post = {**samples, "b0": samples["b0"] + samples["airport"].mean(axis=1)}
    hyper = {k: (float(np.mean(post[k])), float(np.quantile(post[k], 0.05)), float(np.quantile(post[k], 0.95)),
                 realised[k]) for k in TRUTH}
    res = {"hier": score(est, truth), "baseline": score(base, truth), "hyper": hyper,
           "divergences": int(mcmc.get_extra_fields()["diverging"].sum()), "n_counts": int(counts.sum())}
    write_report(res)
    return res


def write_report(res: dict) -> None:
    h, b = res["hier"], res["baseline"]
    rows = [
        ("90% interval contains the truth", f"{h['coverage_90']:.0%}", f"{b['coverage_90']:.0%}", "should be close to 90%"),
        ("Typical error (median |log ratio|)", f"{np.expm1(h['median_abs_log_error']):.0%}",
         f"{np.expm1(b['median_abs_log_error']):.0%}", "lower is better"),
        ("Average bias", f"{np.expm1(h['mean_log_bias']):+.0%}", f"{np.expm1(b['mean_log_bias']):+.0%}", "close to 0"),
        ("Rank correlation with truth", f"{h['rank_corr']:.2f}", f"{b['rank_corr']:.2f}", "higher is better"),
        ("Typical interval width (hi/lo)", f"{h['median_interval_width']:.1f}x", f"{b['median_interval_width']:.1f}x", "narrower, if coverage holds"),
    ]
    hyp = "\n".join(
        f"| `{k}` | {t:.3g} | {m:.3g} | {lo:.3g}-{hi:.3g} | {'yes' if lo <= t <= hi else '**no**'} |"
        for k, (m, lo, hi, t) in res["hyper"].items()
    )
    md = f"""# Week 4 - Simulation check: can the model recover a known truth?

_Generated by `src/bird_strike_radar/sim_check.py`._

Counts were simulated from the hierarchical model using the **real** airports, months, years and
traffic, with known "true" parameters ({res['n_counts']:,} damaging strikes in total, similar to the
real 5,511). Both models were then fitted to the simulated counts and compared with the truth for every
airport-month at current (2023-2025) conditions.

| Check | Hierarchical (Week 4) | Baseline (Week 2) | Target |
|---|---|---|---|
""" + "\n".join(f"| {a} | {x} | {y} | {z} |" for a, x, y, z in rows) + f"""

Sampler divergences: **{res['divergences']}** (should be 0).

## Are the model's structural parameters recovered?

`b0` is compared as the overall level (intercept plus the average airport effect), and each spread
is compared with the spread actually realised in the simulated draws.

| Parameter | True (as realised) | Posterior mean | 90% interval | Truth inside? |
|---|---|---|---|---|
{hyp}

## Reading this

- The Week 2 baseline averages over all 16 years, so it describes an "average year" rather than
  current conditions. When reporting grows over time, that shows up as a systematic bias against
  today's rates, and its intervals are too narrow to cover the truth.
- The hierarchical model has an explicit year term and shares information across flyways and
  months, so it should be both less biased and honestly uncertain (coverage near 90%).
- This checks the machinery, not the real world. Week 5 tests real-world accuracy by fitting to
  2010-2022 and predicting 2023-2025.
"""
    paths.REPORTS.mkdir(exist_ok=True)
    (paths.REPORTS / "week4_simulation_check.md").write_text(md)
    print(f"report -> {(paths.REPORTS / 'week4_simulation_check.md').relative_to(paths.ROOT)}")


if __name__ == "__main__":
    import json

    print(json.dumps(run(), indent=2, default=float))
