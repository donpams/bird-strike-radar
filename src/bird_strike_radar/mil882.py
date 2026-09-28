"""MIL-STD-882E (w/ Change 1, 27 Sep 2023) risk assessment, transcribed from the public standard.

Sources (docs/refs/MIL-STD-882E-change-1.pdf):
  * Table I   - Severity categories        (p. 12)
  * Table II  - Probability levels         (p. 12)
  * Table III - Risk assessment matrix     (p. 13)
  * Table A-II - Example quantitative probability levels (Appendix A, p. 92, guidance only)

The standard requires every program to define its exposure ("denominator") when it uses
quantitative probability levels (4.3.3.e and the Table A-II footnote). Ours is EXPOSURE_OPS below.
"""

from __future__ import annotations

import math

# ---- Table I: severity (1 = worst) -----------------------------------------------------
SEVERITY = {1: "Catastrophic", 2: "Critical", 3: "Marginal", 4: "Negligible"}

# Monetary-loss thresholds from Table I (USD). Injury criteria are handled in severity.py.
COST_CATASTROPHIC = 10_000_000
COST_CRITICAL = 1_000_000
COST_MARGINAL = 100_000

# ---- Table II / A-II: probability levels ------------------------------------------------
PROBABILITY = {
    "A": "Frequent",
    "B": "Probable",
    "C": "Occasional",
    "D": "Remote",
    "E": "Improbable",
}
# Table A-II lower bounds: level applies when p >= bound (checked in order A..E)
PROBABILITY_BOUNDS = [("A", 1e-1), ("B", 1e-2), ("C", 1e-3), ("D", 1e-6), ("E", 0.0)]

# ---- Our tailoring: the exposure unit ---------------------------------------------------
# "Probability of at least one mishap of this severity in 10,000 airport operations."
# 10,000 operations is roughly one month of traffic at the median study airport, and using a
# fixed number of operations (rather than "one airport-month") keeps busy airports from looking
# riskier simply because they are busy.
EXPOSURE_OPS = 10_000

# ---- Table III: risk assessment matrix (rows A..E, columns severity 1..4) ----------------
RISK_MATRIX = {
    "A": {1: "High", 2: "High", 3: "Serious", 4: "Medium"},
    "B": {1: "High", 2: "High", 3: "Serious", 4: "Medium"},
    "C": {1: "High", 2: "Serious", 3: "Medium", 4: "Low"},
    "D": {1: "Serious", 2: "Medium", 3: "Medium", 4: "Low"},
    "E": {1: "Medium", 2: "Medium", 3: "Medium", 4: "Low"},
}
RISK_ORDER = ["Low", "Medium", "Serious", "High"]


def probability_level(p: float) -> str:
    """Table A-II level for a probability of occurrence over one exposure unit."""
    if p is None or (isinstance(p, float) and math.isnan(p)):
        raise ValueError("probability is missing")
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"probability must be in [0, 1], got {p}")
    for level, bound in PROBABILITY_BOUNDS:
        if p >= bound:
            return level
    return "E"


def prob_at_least_one(rate_per_exposure: float) -> float:
    """Poisson: P(N >= 1) when N has mean `rate_per_exposure`."""
    return 1.0 - math.exp(-rate_per_exposure)


def risk_level(prob_level: str, severity: int) -> str:
    return RISK_MATRIX[prob_level][severity]


def rac(prob_level: str, severity: int) -> str:
    """Risk Assessment Code, e.g. '2C' = Critical / Occasional."""
    return f"{severity}{prob_level}"


def worst(levels) -> str:
    """Highest risk level in an iterable of 'Low'/'Medium'/'Serious'/'High'."""
    return max(levels, key=RISK_ORDER.index)
