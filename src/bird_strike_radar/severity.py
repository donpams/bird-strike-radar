"""Map FAA strike outcomes onto MIL-STD-882E Table I severity categories.

Rules for a single damaging strike, first match wins:
  1. Any fatality                              -> 1 Catastrophic
  2. Total cost known (repairs + other, inflation-adjusted) -> Table I dollar bands
  3. 3+ injuries                               -> 2 Critical   (proxy for "hospitalization of >= 3")
  4. 1-2 injuries                              -> 3 Marginal   (proxy for "lost work day")
  5. Otherwise severity is UNKNOWN (cost missing in ~80% of damaging reports).

Rule 5 is where judgment comes in. Rather than guessing one category per report, we estimate
P(severity | FAA damage level) from reports that DO have a cost, and apply that distribution to
reports that don't. The result is a national severity mix for damaging strikes.

Known limitation: cost is more likely to be recorded for expensive events, so the mix may lean
severe. The Week 2 report quantifies the share of costs that are known per damage level.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .mil882 import COST_CATASTROPHIC, COST_CRITICAL, COST_MARGINAL, SEVERITY


def severity_from_cost(cost: float) -> int:
    if cost >= COST_CATASTROPHIC:
        return 1
    if cost >= COST_CRITICAL:
        return 2
    if cost >= COST_MARGINAL:
        return 3
    return 4


def classify(strikes: pd.DataFrame) -> pd.Series:
    """Severity 1-4 per damaging strike where determinable, else <NA>."""
    cost = strikes["cost_repairs_usd_adj"].fillna(0) + strikes["cost_other_usd_adj"].fillna(0)
    has_cost = strikes["cost_repairs_usd_adj"].notna() | strikes["cost_other_usd_adj"].notna()

    # Start from the dollar band where cost is known; 5 = "not determined yet"
    sev = pd.Series(5, index=strikes.index, dtype="int64")
    sev[has_cost] = cost[has_cost].map(severity_from_cost)
    # Injury and fatality criteria can only make it worse (lower number), never better
    sev = sev.where(~(strikes["injuries"] >= 1), np.minimum(sev, 3))
    sev = sev.where(~(strikes["injuries"] >= 3), np.minimum(sev, 2))
    sev = sev.where(~(strikes["fatalities"] > 0), 1)
    return sev.astype("Int64").mask(sev == 5)


def severity_mix(damaging: pd.DataFrame, prior_weight: float = 0.5) -> tuple[pd.DataFrame, pd.DataFrame]:
    """National P(severity) for damaging strikes, filling unknown-cost reports by damage level.

    Returns one row per severity with the estimated share and the evidence behind it.
    A Jeffreys-style Dirichlet prior (`prior_weight` = 0.5 pseudo-counts per category) keeps
    a category from being exactly zero just because no report in the sample reached it.
    """
    d = damaging.copy()
    d["severity"] = classify(d)
    # Destroyed (D) is too rare to estimate alone; pool it with Substantial
    d["level_group"] = d["damage_level"].astype(str).replace({"D": "S"})

    known = d.dropna(subset=["severity"])
    cond = (
        pd.crosstab(known["level_group"], known["severity"])
        .reindex(columns=[1, 2, 3, 4], fill_value=0)
        .add(prior_weight)
    )
    cond = cond.div(cond.sum(axis=1), axis=0)  # P(severity | damage level group)

    # Known-severity reports count as themselves; unknown ones are spread by their level's distribution
    total = pd.Series(0.0, index=[1, 2, 3, 4])
    total += known["severity"].value_counts().reindex(total.index, fill_value=0)
    unknown_by_level = d[d["severity"].isna()]["level_group"].value_counts()
    for level, n in unknown_by_level.items():
        total += cond.loc[level] * n

    out = pd.DataFrame(
        {
            "severity": total.index,
            "category": [SEVERITY[k] for k in total.index],
            "share": (total / total.sum()).values,
            "reports_with_known_severity": known["severity"].value_counts().reindex(total.index, fill_value=0).values,
        }
    )
    return out, cond
