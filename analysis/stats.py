"""Small, dependency-light statistics helpers shared by both studies.

Every function returns plain floats so results serialise straight to JSON.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as ss

RNG = np.random.default_rng(20261124)


def wilson(k, n, z=1.959964):
    """Wilson score interval for a binomial proportion."""
    if n == 0:
        return [0.0, 1.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [max(0.0, c - h), min(1.0, c + h)]


def cp_upper(k, n, a=0.05):
    """One-sided Clopper-Pearson upper bound (exact)."""
    return 1.0 if k >= n else float(ss.beta.ppf(1 - a, k + 1, n - k))


def fisher(a, b, c, d):
    """2x2 [[a,b],[c,d]] Fisher exact test with a Woolf (Haldane-corrected) 95% CI on the odds ratio."""
    res = ss.fisher_exact([[a, b], [c, d]])
    aa, bb, cc, dd = (x + 0.5 for x in (a, b, c, d))
    lor = math.log(aa * dd / (bb * cc))
    se = math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd)
    return {"or": float(res.statistic) if np.isfinite(res.statistic) else float(math.exp(lor)), "p": float(res.pvalue),
            "or_ci": [math.exp(lor - 1.96 * se), math.exp(lor + 1.96 * se)]}


def boot(fn, n_items, b=5000):
    """Percentile bootstrap over item indices; fn(idx) -> float."""
    vals = []
    for _ in range(b):
        idx = RNG.integers(0, n_items, n_items)
        v = fn(idx)
        if v is not None and np.isfinite(v):
            vals.append(v)
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def spearman_ci(x, y, b=5000):
    x, y = np.asarray(x, float), np.asarray(y, float)
    r = ss.spearmanr(x, y)

    def f(i):
        if np.ptp(x[i]) == 0 or np.ptp(y[i]) == 0:
            return None
        return ss.spearmanr(x[i], y[i]).correlation
    return {"rho": float(r.correlation), "p": float(r.pvalue), "ci": boot(f, len(x), b), "n": len(x)}


def gini(values):
    x = np.sort(np.asarray(values, float))
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum())) if x.sum() else 0.0


def cochran_armitage(successes, totals, scores=None):
    """Two-sided Cochran-Armitage test for a linear trend in proportions."""
    s = np.asarray(successes, float)
    n = np.asarray(totals, float)
    t = np.arange(len(s), dtype=float) if scores is None else np.asarray(scores, float)
    N, S = n.sum(), s.sum()
    p = S / N
    T = (t * (s - n * p)).sum()
    var = p * (1 - p) * ((n * t * t).sum() - (n * t).sum() ** 2 / N)
    z = T / math.sqrt(var)
    return {"z": float(z), "p": float(2 * ss.norm.sf(abs(z)))}


def rate_ratio(k1, n1, k2, n2):
    """Exact conditional test of two Poisson rates (events k over exposure n); returns RR and 95% CI."""
    rr = (k2 / n2) / (k1 / n1) if k1 and n2 else float("nan")
    # conditional binomial: k2 | k1+k2 ~ Bin(k1+k2, n2/(n1+n2))
    tot = k1 + k2
    pi = n2 / (n1 + n2)
    p = float(ss.binomtest(k2, tot, pi).pvalue)
    lo, hi = ss.binomtest(k2, tot).proportion_ci(0.95, method="exact")
    f = lambda q: (q / (1 - q)) * (n1 / n2) if 0 < q < 1 else (0.0 if q <= 0 else float("inf"))
    return {"rr": float(rr), "ci": [f(lo), f(hi)], "p": p}


def bh(pvals):
    """Benjamini-Hochberg adjusted p-values."""
    p = np.asarray(pvals, float)
    n = len(p)
    o = np.argsort(p)
    adj = np.empty(n)
    prev = 1.0
    for rank, i in reversed(list(enumerate(o, 1))):
        prev = min(prev, p[i] * n / rank)
        adj[i] = prev
    return [float(x) for x in adj]


def r(x, k=3):
    return None if x is None else round(float(x), k)
