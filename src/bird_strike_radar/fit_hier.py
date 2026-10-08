"""Week 4: fit the hierarchical model to the real data and produce map-ready estimates.

Output:
  data/processed/hier_airport_month.parquet   same columns as the Week 2 baseline table, so the
                                              web export can use either
  data/processed/hier_diagnostics.json        sampler health (R-hat, effective sample size, divergences)
  data/processed/hier_effects.parquet         flyway seasonality and year effects, for the report
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from numpyro.diagnostics import summary

from . import hier_model as hm
from . import mil882, paths
from .baseline import BASELINE_PARQUET, SEVERITY_PARQUET, build_panel, risk_columns

HIER_PARQUET = paths.PROCESSED / "hier_airport_month.parquet"
DIAG_JSON = paths.PROCESSED / "hier_diagnostics.json"
EFFECTS_PARQUET = paths.PROCESSED / "hier_effects.parquet"
HYPER = ["b0", "s_season", "s_flyseason", "s_airport", "s_aseason", "s_year", "s_trend", "phi"]


def diagnostics(mcmc) -> dict:
    s = mcmc.get_samples(group_by_chain=True)
    sm = summary({k: v for k, v in s.items() if not k.startswith("z_")})
    worst_rhat = max(float(np.nanmax(v["r_hat"])) for v in sm.values())
    min_ess = min(float(np.nanmin(v["n_eff"])) for v in sm.values())
    return {
        "divergences": int(mcmc.get_extra_fields()["diverging"].sum()),
        "worst_r_hat": worst_rhat,
        "min_ess": min_ess,
        "hyper": {k: {"mean": float(np.mean(sm[k]["mean"])), "r_hat": float(np.max(sm[k]["r_hat"])),
                      "ess": float(np.min(sm[k]["n_eff"]))} for k in HYPER},
    }


def posterior_predictive(samples: dict, d: dict, panel: pd.DataFrame, n=200, seed=0) -> dict:
    """Simulate replicated datasets from the posterior and compare simple statistics with the data."""
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(samples["b0"]), size=n, replace=False)
    a, y, m = d["a"], d["y"], d["m"]
    obs = d["count"]
    stats_rep = {"zeros": [], "max": [], "total": [], "var_to_mean": []}
    for i in idx:
        lr = (samples["b0"][i] + samples["season"][i][m] + samples["flyseason"][i][d["f_of_a"][a], m]
              + samples["airport"][i][a] + samples["aseason"][i][a, m] + samples["year"][i][y]
              + samples["trend"][i][a] * d["yz"][y])
        mu = np.exp(lr + d["log_E"])
        phi = samples["phi"][i]
        rep = rng.poisson(rng.gamma(phi, mu / phi))
        stats_rep["zeros"].append((rep == 0).mean())
        stats_rep["max"].append(rep.max())
        stats_rep["total"].append(rep.sum())
        stats_rep["var_to_mean"].append(rep.var() / rep.mean())
    obs_stats = {"zeros": (obs == 0).mean(), "max": obs.max(), "total": obs.sum(), "var_to_mean": obs.var() / obs.mean()}
    return {k: {"observed": float(obs_stats[k]), "rep_lo": float(np.quantile(v, 0.05)),
                "rep_hi": float(np.quantile(v, 0.95)), "p": float(np.mean(np.array(v) >= obs_stats[k]))}
            for k, v in stats_rep.items()}


def run(num_warmup=1000, num_samples=1000, num_chains=None, seed=0) -> pd.DataFrame:
    # One chain per CPU core (max 4): more chains than cores just competes for memory and time
    if num_chains is None:
        import os
        num_chains = max(2, min(4, os.cpu_count() or 2))
    panel, _, _ = build_panel()
    airports = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    d = hm.design(panel, airports)
    mcmc = hm.fit(d, num_warmup=num_warmup, num_samples=num_samples, num_chains=num_chains, seed=seed, progress=False)
    samples = hm.flatten_samples(mcmc)
    diag = diagnostics(mcmc)
    diag["ppc"] = posterior_predictive(samples, d, panel)

    # Map estimates at current (reference-year) conditions
    recent = panel[panel.year.between(*hm.REFERENCE_YEARS)]
    w = (recent.pivot_table(index="icao", columns="month", values="total_ops", aggfunc="mean")
         .reindex(index=d["icaos"], columns=range(1, 13)).fillna(0))
    est = hm.summarise(samples, d, w.to_numpy())

    # How much each estimate leans on the shared (national/flyway) structure: posterior variance
    # of the airport-specific part relative to its prior variance (the normal-normal shrinkage factor)
    log_rate = hm.reference_log_rate(samples, d)
    yz_ref = d["yz"][(np.array(d["years"]) >= hm.REFERENCE_YEARS[0])].mean()
    prior_var = samples["s_airport"] ** 2 + samples["s_aseason"] ** 2 + (samples["s_trend"] * yz_ref) ** 2
    airport_part = log_rate - log_rate.mean(axis=1, keepdims=True)
    shrink = np.clip(airport_part.var(axis=0) / prior_var.mean(), 0, 1)  # [A, 12]
    est["shrinkage"] = [shrink[d["icaos"].index(c), mo - 1] for c, mo in zip(est.icao, est.month)]

    # Keep the observed counts and raw rates from Week 2 for the "raw" view and the evidence text
    base = pd.read_parquet(BASELINE_PARQUET)[
        ["icao", "month", "damaging", "reports", "ops", "years", "typical_month_ops", "exposure", "rate_raw", "reports_per_10k"]
    ]
    out = est.merge(base, on=["icao", "month"], how="left")
    out["expected_damaging_typical_month"] = out.rate_mean * out.typical_month_ops / mil882.EXPOSURE_OPS

    mix = pd.read_parquet(SEVERITY_PARQUET)
    out = pd.concat(
        [out, risk_columns(out.rate_mean, mix),
         risk_columns(out.rate_lo, mix, "_lo")[["risk_lo"]],
         risk_columns(out.rate_hi, mix, "_hi")[["risk_hi"]]],
        axis=1,
    )
    out.to_parquet(HIER_PARQUET, index=False)

    # Effects for the report: flyway seasonal curves and the national year trend
    eff = []
    for fi, f in enumerate(hm.FLYWAYS):
        curve = samples["b0"][:, None] + samples["season"] + samples["flyseason"][:, fi, :]
        for mo in range(12):
            eff.append(dict(kind="flyway_season", group=f, x=mo + 1, mean=float(np.exp(curve[:, mo]).mean()),
                            lo=float(np.quantile(np.exp(curve[:, mo]), 0.05)), hi=float(np.quantile(np.exp(curve[:, mo]), 0.95))))
    for yi, yr in enumerate(d["years"]):
        v = np.exp(samples["year"][:, yi])
        eff.append(dict(kind="year", group="national", x=yr, mean=float(v.mean()),
                        lo=float(np.quantile(v, 0.05)), hi=float(np.quantile(v, 0.95))))
    pd.DataFrame(eff).to_parquet(EFFECTS_PARQUET, index=False)

    DIAG_JSON.write_text(json.dumps(diag, indent=2))
    print(
        f"hierarchical model: {len(out):,} airport-months -> {HIER_PARQUET.relative_to(paths.ROOT)} | "
        f"divergences {diag['divergences']}, worst R-hat {diag['worst_r_hat']:.3f}, min ESS {diag['min_ess']:.0f}"
    )
    return out


if __name__ == "__main__":
    run()
