"""Week 2 baseline: empirical-Bayes damaging-strike rates + MIL-STD-882E risk per airport and month.

Model (one per calendar month m):
    y[a]    = damaging strikes at airport a in month m, summed over the study years
    E[a]    = operations at airport a in month m over the same years, in units of 10,000
    rate[a] ~ Gamma(alpha_m, beta_m)                  <- shared prior: "a typical airport in month m"
    y[a]    ~ Poisson(rate[a] * E[a])

The prior is fitted from all airports (maximising the negative-binomial marginal likelihood), then
each airport's posterior is Gamma(alpha_m + y, beta_m + E). Small airports with few operations get
pulled toward the national monthly rate; big airports are mostly driven by their own data. That
"shrinkage" is what stops a small airport with one unlucky strike from topping the map.

Outcome definition (Option A, decided 2026-09-28): only strikes with a KNOWN damaging level
(M, M?, S, D) count. Unknown-damage reports are excluded from the numerator, so rates are a slight,
documented underestimate.

Output: data/processed/baseline_airport_month.parquet, data/processed/severity_mix.parquet
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import optimize, special, stats

from . import mil882, paths, severity
from .study_airports import STUDY_YEARS

BASELINE_PARQUET = paths.PROCESSED / "baseline_airport_month.parquet"
SEVERITY_PARQUET = paths.PROCESSED / "severity_mix.parquet"
CREDIBLE = (0.05, 0.95)  # 90% credible interval
RECENT_YEARS = (2023, 2025)  # traffic level used for "expected strikes in a typical month"


def build_panel() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Airport x year x month panel of operations and strike counts, study airports only."""
    strikes = pd.read_parquet(paths.STRIKES_PARQUET)
    atads = pd.read_parquet(paths.ATADS_PARQUET)
    study = pd.read_parquet(paths.STUDY_AIRPORTS_PARQUET)
    study = study[study.in_study]

    y0, y1 = STUDY_YEARS
    ops = (
        atads.merge(study[["faa_lid", "icao"]], on="faa_lid")
        .query("@y0 <= year <= @y1 and total_ops > 0")[["icao", "year", "month", "total_ops"]]
    )
    s = strikes[strikes.year.between(y0, y1) & strikes.airport_icao.isin(study.icao)]
    counts = s.groupby(["airport_icao", "year", "month"]).agg(
        reports=("record_id", "size"), damaging=("damaging", lambda x: int(x.fillna(False).sum()))
    )
    counts.index = counts.index.set_names(["icao", "year", "month"])
    counts = counts.reset_index().astype({"year": int, "month": int})
    # Left join from operations: a strike in a month with no tower count has no exposure, so it can't
    # contribute to a rate. Those strikes are counted and reported, not silently dropped.
    panel = ops.merge(counts, on=["icao", "year", "month"], how="left").fillna({"reports": 0, "damaging": 0})
    orphan = counts.merge(ops, on=["icao", "year", "month"], how="left", indicator=True)
    orphan = orphan[orphan["_merge"] == "left_only"]
    damaging_strikes = s[s.damaging.fillna(False)]
    return panel.astype({"reports": int, "damaging": int}), orphan, damaging_strikes


def _neg_log_marginal(log_params: np.ndarray, y: np.ndarray, e: np.ndarray) -> float:
    a, b = np.exp(log_params)
    ll = (
        special.gammaln(y + a)
        - special.gammaln(a)
        - special.gammaln(y + 1)
        + a * np.log(b / (b + e))
        + y * np.log(e / (b + e))
    )
    return -ll.sum()


def fit_gamma_prior(y: np.ndarray, e: np.ndarray) -> tuple[float, float]:
    """Maximum-marginal-likelihood Gamma(alpha, beta) prior for Poisson rates with exposures e."""
    mean = y.sum() / e.sum()
    start = np.log([1.0, 1.0 / max(mean, 1e-6)])
    res = optimize.minimize(_neg_log_marginal, start, args=(y, e), method="Nelder-Mead",
                            options={"xatol": 1e-6, "fatol": 1e-8, "maxiter": 5000})
    if not res.success:
        raise RuntimeError(f"prior fit failed: {res.message}")
    a, b = np.exp(res.x)
    return float(a), float(b)


def risk_columns(rate: pd.Series, mix: pd.DataFrame, suffix: str = "") -> pd.DataFrame:
    """882E probability level and risk for each severity, given damaging rate per 10k ops."""
    out = {}
    for _, row in mix.iterrows():
        k = int(row.severity)
        p = 1 - np.exp(-rate * row.share)  # P(>= 1 severity-k mishap in 10,000 ops)
        lvl = p.map(mil882.probability_level)
        out[f"p_sev{k}{suffix}"] = p
        out[f"level_sev{k}{suffix}"] = lvl
        out[f"risk_sev{k}{suffix}"] = lvl.map(lambda L, k=k: mil882.risk_level(L, k))
    df = pd.DataFrame(out, index=rate.index)
    df[f"risk{suffix}"] = df[[f"risk_sev{k}{suffix}" for k in mix.severity]].apply(mil882.worst, axis=1)
    return df


def run() -> pd.DataFrame:
    paths.ensure_dirs()
    panel, orphan, damaging_strikes = build_panel()

    mix, cond = severity.severity_mix(damaging_strikes)
    mix.to_parquet(SEVERITY_PARQUET, index=False)

    am = panel.groupby(["icao", "month"], as_index=False).agg(
        damaging=("damaging", "sum"), reports=("reports", "sum"), ops=("total_ops", "sum"), years=("year", "nunique")
    )
    recent = panel[panel.year.between(*RECENT_YEARS)].groupby(["icao", "month"]).total_ops.mean()
    am = am.join(recent.rename("typical_month_ops"), on=["icao", "month"])
    am["exposure"] = am.ops / mil882.EXPOSURE_OPS

    parts = []
    for m, g in am.groupby("month"):
        a, b = fit_gamma_prior(g.damaging.to_numpy(float), g.exposure.to_numpy(float))
        g = g.copy()
        g["prior_alpha"], g["prior_beta"] = a, b
        post_a, post_b = a + g.damaging, b + g.exposure
        g["rate_raw"] = g.damaging / g.exposure
        g["rate_mean"] = post_a / post_b
        g["rate_lo"] = stats.gamma.ppf(CREDIBLE[0], post_a, scale=1 / post_b)
        g["rate_hi"] = stats.gamma.ppf(CREDIBLE[1], post_a, scale=1 / post_b)
        g["shrinkage"] = b / (b + g.exposure)  # 0 = all own data, 1 = all prior
        # Map colour: how this airport compares with all study airports pooled, same month
        g["national_rate"] = g.damaging.sum() / g.exposure.sum()
        g["relative_rate"] = g.rate_mean / g.national_rate
        g["relative_lo"] = g.rate_lo / g.national_rate
        g["relative_hi"] = g.rate_hi / g.national_rate
        parts.append(g)
    out = pd.concat(parts, ignore_index=True)

    out["reports_per_10k"] = out.reports / out.exposure
    out["expected_damaging_typical_month"] = out.rate_mean * out.typical_month_ops / mil882.EXPOSURE_OPS

    out = pd.concat(
        [
            out,
            risk_columns(out.rate_mean, mix),
            risk_columns(out.rate_lo, mix, "_lo")[["risk_lo"]],
            risk_columns(out.rate_hi, mix, "_hi")[["risk_hi"]],
        ],
        axis=1,
    )
    out.to_parquet(BASELINE_PARQUET, index=False)

    n_orphan = int(orphan.damaging.sum())
    print(
        f"baseline: {out.icao.nunique()} airports x 12 months -> {BASELINE_PARQUET.relative_to(paths.ROOT)} "
        f"({n_orphan} damaging strikes fell in months with no tower count and were excluded)"
    )
    return out


if __name__ == "__main__":
    run()
