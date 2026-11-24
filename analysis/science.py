"""Run audit, hypothesis tests, topic directions and selected conversations for Study 1.

Reads the same frozen sources as build_data.py plus the raw request/response audit
and the run's final state file. Writes static/data/science.json.

Usage:  python analysis/science.py [--labels names|codes]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sqlite3
import sys

import numpy as np
from scipy import stats as ss
from scipy.spatial.distance import jensenshannon
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, os.path.dirname(__file__))
import stats as S  # noqa: E402
from build_data import ARCHIVE, AUDIT, FROZEN, MAIN_EVENT, PUSH, AGREE, SITE, LIVE, load_decisions  # noqa: E402

STATE = LIVE / "final-results" / MAIN_EVENT / "state.json"
HOPS = LIVE / "final-results" / MAIN_EVENT / "hops.json"
OUT = SITE / "static/data/science.json"
FLOW_OUT = SITE / "static/data/topic-flows.json"
MUSIC = re.compile(r"\b(music|song|melod|rhythm|choreograph|danc|raga|tabla|lyric|tune)", re.I)

# Labels for NMF components are assigned by the first rule whose keyword appears in a
# component's top-8 terms (so they survive component re-ordering). Unmatched -> "Other".
TOPIC_RULES = [
    ("Chess", {"knight", "rook", "pawn", "queen", "bishop"}),
    ("Music & listening", {"music", "song", "melody", "sound"}),
    ("Payments & privacy protocols", {"payment", "transaction", "cancellation", "receipt"}),
    ("Biometrics & proof of personhood", {"biometric", "enrollment", "personhood", "eeg"}),
    ("Agent memory & corrections", {"memory", "fixture", "inference"}),
    ("Fiction & scenes", {"scene", "ending", "character"}),
    ("Openers", {"caught eye", "curious", "interested"}),
    ("Wrap-ups & shared drafts", {"stopping point", "leave", "thanks"}),
    ("Critique & comparison", {"comparison", "response", "example"}),
    ("Advice & decisions", {"decision", "help", "ask"}),
]


def trim(text, words=55):
    w = text.split()
    return " ".join(w[:words]) + (" …" if len(w) > words else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", choices=["names", "codes"], default="names")
    ap.add_argument("--topic-flows-only", action="store_true", help="Refresh the conversation traces without rewriting the full audit export")
    args = ap.parse_args()
    A = json.loads(ARCHIVE.read_text())
    people = A["people"]
    ids = [p["id"] for p in people]
    if args.labels == "codes":
        label = {p["id"]: f"R{i + 1:02d}" for i, p in enumerate(sorted(people, key=lambda p: p["id"]))}
    else:
        label = {p["id"]: p["name"].split()[0].capitalize() for p in people}
    R = next(r for r in A["runs"] if r["number"] == 3)
    t0, t1 = R["started_at"], R["finished_at"]
    H = lambda t: (t - t0) / 3600
    con = sqlite3.connect(f"file:{FROZEN}?mode=ro", uri=True)
    tool_posts = {x for (x,) in con.execute("select message_id from agent_boards where message_id is not null")}
    tool_posts |= {x for (x,) in con.execute("select message_id from workspace_revisions where message_id is not null")}
    allM = sorted((m for m in R["messages"] if m["sender_id"] in label), key=lambda m: m["created_at"])
    M = [m for m in allM if m["id"] not in tool_posts]
    state = json.loads(STATE.read_text())
    out = {"labels_mode": args.labels}

    # =============================== AUDIT ===============================
    req_at, per_member, errors, missing, perr, helper, lat = [], collections.defaultdict(list), [], 0, 0, 0, []
    tok_in = tok_out = 0
    for d in sorted(p for p in AUDIT.iterdir() if p.name.isdigit()):
        rq = json.loads((d / "request.json").read_text())
        sysm = rq["payload"]["messages"][0]["content"]
        if "temporary helper" in (sysm if isinstance(sysm, str) else json.dumps(sysm)).lower():
            helper += 1
            continue
        req_at.append(rq["at"])
        m = rq.get("member_id")
        per_member[m].append(rq["at"])
        rp = d / "response.json"
        if not rp.exists():
            missing += 1
            continue
        j = json.loads(rp.read_text())
        resp = j.get("response") or {}
        lat.append(j["at"] - rq["at"])
        u = resp.get("usage") or {}
        tok_in += u.get("prompt_tokens") or 0
        tok_out += u.get("completion_tokens") or 0
        ch = (resp.get("choices") or [{}])[0]
        if ch.get("finish_reason") == "error":
            errors.append({"agent": label.get(m, "?"), "h": S.r(H(rq["at"]), 2)})
            continue
        try:
            assert isinstance(json.loads(ch["message"]["content"]), dict)
        except Exception:
            perr += 1
    # global stalls: no request from anyone for > 10 min
    ra = sorted(req_at)
    stalls = [[S.r(H(a), 2), S.r(H(b), 2)] for a, b in zip(ra, ra[1:]) if b - a > 600]
    # scheduler starvation: 10-minute bins in which <= 3 distinct agents made every call
    bins10 = collections.defaultdict(set)
    calls10 = collections.Counter()
    for m_, ts_ in per_member.items():
        for t in ts_:
            bins10[int((t - t0) // 600)].add(m_)
            calls10[int((t - t0) // 600)] += 1
    per_bin = collections.defaultdict(collections.Counter)
    for m_, ts_ in per_member.items():
        for t in ts_:
            per_bin[int((t - t0) // 600)][m_] += 1
    # a bin is "starved" when its three busiest agents made >= 90% of all calls in it
    starved = sorted(b for b, c in per_bin.items() if sum(v for _, v in c.most_common(3)) >= 0.9 * sum(c.values()))
    runs_, cur = [], []
    for b in starved:
        if cur and b != cur[-1] + 1:
            runs_.append(cur)
            cur = []
        cur.append(b)
    if cur:
        runs_.append(cur)
    runs_ = [x for x in runs_ if len(x) >= 2]
    starvation = []
    dec_all = [d for d in load_decisions() if not d.get("parse_error")]
    for x in runs_:
        a_, b_ = t0 + x[0] * 600, t0 + (x[-1] + 1) * 600
        holders = {m_ for m_, _ in sum((per_bin[b] for b in x), collections.Counter()).most_common(3)}
        dd = [d for d in dec_all if a_ <= d["at"] < b_]
        starvation.append({"from": S.r(H(a_), 2), "to": S.r(H(b_), 2), "holders": sorted(label[h] for h in holders),
                           "calls": sum(calls10[b] for b in x), "python": sum(d["tools"].count("python_run") for d in dd),
                           "messages": sum(d["messages"] for d in dd), "wait0": sum(d.get("wait") == 0 for d in dd),
                           "decisions": len(dd)})
    stalls = [[s_["from"], s_["to"]] for s_ in starvation]

    # per-agent outages: > 20 min between calls not explained by starvation (> 50% overlap)
    def in_stall(a, b):
        ov = sum(max(0, min(b, t0 + s1 * 3600) - max(a, t0 + s0 * 3600)) for s0, s1 in stalls)
        return ov > 0.5 * (b - a)
    restarts = collections.defaultdict(list)
    for x in state.get("agent_restarts", []):
        restarts[x["member_id"]].append(S.r(H(x["at"]), 2))
    lanes = []
    for i in ids:
        ts = sorted(per_member.get(i, []))
        gaps = [[S.r(H(a), 2), S.r(H(b), 2)] for a, b in zip(ts, ts[1:]) if b - a > 1200 and not in_stall(a, b)]
        starv = [[S.r(H(a), 2), S.r(H(b), 2)] for a, b in zip(ts, ts[1:]) if b - a > 1200 and in_stall(a, b)]
        # the waiting-time cap is 600 s, so a > 20 min silence means the worker was not being scheduled
        lanes.append({"agent": label[i], "calls": len(ts), "outages": gaps, "starved": starv,
                      "outage_h": S.r(sum(b - a for a, b in gaps), 2), "restarts": restarts.get(i, []),
                      "ticks": [S.r(H(t), 3) for t in ts]})
    lanes.sort(key=lambda x: -x["calls"])
    usage = con.execute("select status, count(*), sum(input_tokens), sum(output_tokens), sum(cost_usd) from agent_usage "
                        "where event_id=? group by status", (MAIN_EVENT,)).fetchall()
    tool_fail = con.execute("select name, sum(status!='completed'), count(*) from agent_tool_runs where event_id=? group by name "
                            "order by 3 desc", (MAIN_EVENT,)).fetchall()
    mem = dict(con.execute("select status, count(*) from memory_jobs group by status").fetchall())
    group_from = min(d["at"] for d in load_decisions() if d["group_prompt"])
    music_from = next(a["created_at"] for a in state.get("new_additions", []) if "music" in a["id"])
    out["audit"] = {
        "calls": state["calls"], "completed": state["completed_calls"], "status": state["status"],
        "provider_errors": len(errors), "error_list": errors, "missing_responses": missing, "parse_errors": perr,
        "helper_calls": helper, "latency_median_s": S.r(np.median(lat), 1), "latency_p90_s": S.r(np.percentile(lat, 90), 1),
        "latency_max_s": S.r(max(lat), 1),
        "usage_rows": [{"status": s, "rows": n, "in": a, "out": b, "usd": S.r((c or 0) / 1e6, 2)} for s, n, a, b, c in usage],
        "audit_tokens": {"in": tok_in, "out": tok_out},
        "tool_runs": [{"tool": n, "failed": f, "total": t} for n, f, t in tool_fail],
        "memory_jobs": mem, "messages_total": len(allM), "tool_posts": len(allM) - len(M),
        "stalls": stalls, "starvation": starvation, "lanes": lanes, "hours": S.r(H(t1), 2),
        "interventions": [
            {"h": S.r(H(group_from), 2), "label": "Prompt edit: group rooms allowed"},
            {"h": S.r(H(music_from), 2), "label": "Prompt addition: music & choreography"},
        ],
        "restarts": sum(len(v) for v in restarts.values()),
        "calls_range": [min(x["calls"] for x in lanes), max(x["calls"] for x in lanes)],
    }
    outage_agents = {x["agent"] for x in lanes if x["outage_h"] >= 1}

    # =============================== TESTS ===============================
    tests = []

    def add(tid, claim, test, stat, p, n, effect=None, ci=None, note=None):
        tests.append({"id": tid, "claim": claim, "test": test, "stat": stat, "p": p, "n": n,
                      "effect": effect, "ci": ci, "note": note})

    # T1 partner novelty vs. configuration null
    dy = [frozenset(r["active_participants"]) for r in R["rooms"]
          if r.get("message_count", 0) > 0 and len(r["active_participants"]) == 2]
    obs_repeat = len(dy) - len(set(dy))
    deg = collections.Counter(a for p in dy for a in p)
    stubs = np.array([a for a, k in deg.items() for _ in range(k)])
    sims = []
    codes = {a: k for k, a in enumerate(deg)}
    stub_c = np.array([codes[a] for a in stubs])
    for _ in range(4000):
        # sequential stub matching: each stub pairs with a random remaining stub of a different agent
        pool = S.RNG.permutation(stub_c)
        alive = np.ones(len(pool), bool)
        pairs = []
        for k in range(len(pool)):
            if not alive[k]:
                continue
            alive[k] = False
            opts = np.flatnonzero(alive & (pool != pool[k]))
            if not len(opts):
                break
            j = opts[S.RNG.integers(len(opts))]
            alive[j] = False
            pairs.append((min(pool[k], pool[j]), max(pool[k], pool[j])))
        sims.append(len(pairs) - len(set(pairs)))
    sims = np.array(sims)
    p1 = float((np.sum(sims <= obs_repeat) + 1) / (len(sims) + 1))
    add("N1", "Agents avoid re-meeting a partner", "Degree-preserving random pairing (4,000 draws)",
        f"{obs_repeat} repeat pairs observed vs {sims.mean():.1f} expected (null 95% range {np.percentile(sims, 2.5):.0f}–{np.percentile(sims, 97.5):.0f})",
        p1, len(dy), effect=S.r(obs_repeat / sims.mean()), note="Each agent's number of one-to-one rooms is held fixed; only partner identity is randomised.")
    out["novelty_null"] = {"observed": obs_repeat, "sims": collections.Counter(int(x) for x in sims), "dyads": len(dy)}

    # T2 group rooms when allowed
    D = [d for d in load_decisions() if not d.get("parse_error")]
    gp = [d for d in D if d["group_prompt"]]
    pre = [d for d in D if not d["group_prompt"]]
    gs = sum(d["starts_group"] for d in gp)
    add("N2", "Agents start or join group rooms once allowed", "Exact binomial upper bound on per-decision rate",
        f"{gs} group starts and {sum(d['joins'] for d in gp)} joins in {len(gp):,} decisions; 95% upper bound {S.cp_upper(gs, len(gp)):.2%} per decision",
        None, len(gp), effect=0.0, ci=[0.0, S.cp_upper(gs, len(gp))], note="Not a test against a null: the bound says how rare group starts must be, given none were seen.")
    rr = S.rate_ratio(sum(d["starts_dm"] for d in pre), len(pre), sum(d["starts_dm"] for d in gp), len(gp))
    add("N3", "One-to-one starts per decision changed after the prompt edit", "Exact conditional Poisson rate ratio",
        f"{sum(d['starts_dm'] for d in pre)} starts / {len(pre)} decisions before vs {sum(d['starts_dm'] for d in gp)} / {len(gp)} after; RR {rr['rr']:.2f}",
        rr["p"], len(D), effect=S.r(rr["rr"]), ci=[S.r(x) for x in rr["ci"]],
        note="Confounded with time: the edit coincides with the move from the opening burst to the partner sweep, and the music addition follows 40 minutes later.")

    # T3 music addition
    win = 1.0
    mh = H(music_from)
    before = [bool(MUSIC.search(m["body"])) for m in M if mh - win <= H(m["created_at"]) < mh]
    after = [bool(MUSIC.search(m["body"])) for m in M if mh <= H(m["created_at"]) < mh + win]
    fz = S.fisher(sum(after), len(after) - sum(after), sum(before), len(before) - sum(before))
    add("N4", "The music prompt addition raised music talk", "Fisher exact, 1 h before vs 1 h after",
        f"{np.mean(before):.1%} of messages before vs {np.mean(after):.1%} after (OR {fz['or']:.2f})",
        fz["p"], len(before) + len(after), effect=S.r(fz["or"]), ci=[S.r(x) for x in fz["or_ci"]],
        note="Keyword match (music, song, melody, rhythm, dance, choreography, raga, tabla, lyric, tune).")
    q = []
    for b in range(int(H(t1) * 4) + 1):
        xs = [bool(MUSIC.search(m["body"])) for m in M if int(H(m["created_at"]) * 4) == b]
        if xs:
            q.append({"h": b / 4, "n": len(xs), "share": S.r(np.mean(xs)), "ci": [S.r(v) for v in S.wilson(sum(xs), len(xs))]})
    out["music_series"] = {"bins": q, "at": S.r(mh, 2)}

    # T4 equality of sending; activity vs sending
    sent = collections.Counter(m["sender_id"] for m in M)
    sv = np.array([sent.get(i, 0) for i in ids])
    g = S.gini(sv)
    gci = S.boot(lambda ix: S.gini(sv[ix]), len(sv))
    calls = {x["agent"]: x["calls"] for x in lanes}
    cs = S.spearman_ci([calls[label[i]] for i in ids], sv)
    add("N5", "Message volume is spread evenly across agents", "Gini with agent-level bootstrap",
        f"Gini {g:.3f} (95% CI {gci[0]:.3f}–{gci[1]:.3f})", None, len(ids), effect=S.r(g), ci=[S.r(x) for x in gci])
    add("N6", "Agents who were scheduled more sent more", "Spearman, calls vs messages sent",
        f"ρ = {cs['rho']:.2f} (95% CI {cs['ci'][0]:.2f}–{cs['ci'][1]:.2f})", cs["p"], len(ids), effect=S.r(cs["rho"]),
        ci=[S.r(x) for x in cs["ci"]], note="Decision counts ranged 4×, mostly from provider outages, so raw volume partly measures uptime.")

    # T5 rank stability with CIs and outage sensitivity
    per = {}
    for num in (1, 2, 3):
        RR = next(r for r in A["runs"] if r["number"] == num)
        mm = [m for m in RR["messages"] if m["sender_id"] in label and m["id"] not in tool_posts]
        recv = collections.Counter(rc for m in mm for rc in (m.get("recipients") or []) if rc in label and rc != m["sender_id"])
        per[num] = {"sent": collections.Counter(m["sender_id"] for m in mm), "recv": recv}
    stab = []
    keep = [i for i in ids if label[i] not in outage_agents]
    for metric, key in [("Messages received", "recv"), ("Messages sent", "sent")]:
        for a, b in [(1, 2), (2, 3), (1, 3)]:
            full = S.spearman_ci([per[a][key].get(i, 0) for i in ids], [per[b][key].get(i, 0) for i in ids])
            sub = S.spearman_ci([per[a][key].get(i, 0) for i in keep], [per[b][key].get(i, 0) for i in keep])
            stab.append({"metric": metric, "pair": f"Run {a} vs {b}", "rho": S.r(full["rho"]), "ci": [S.r(x) for x in full["ci"]],
                         "p": full["p"], "rho_no_outage": S.r(sub["rho"]), "ci_no_outage": [S.r(x) for x in sub["ci"]],
                         "n_no_outage": len(keep)})
    out["stability"] = stab
    r13 = next(s for s in stab if s["metric"] == "Messages received" and s["pair"] == "Run 1 vs 3")
    add("N7", "Being sought out is a stable persona trait", "Spearman with bootstrap CI (Run 1 vs 3, messages received)",
        f"ρ = {r13['rho']:.2f} (95% CI {r13['ci'][0]:.2f}–{r13['ci'][1]:.2f}); without the {len(ids) - len(keep)} outage agents ρ = {r13['rho_no_outage']:.2f}",
        r13["p"], len(ids), effect=r13["rho"], ci=r13["ci"])

    # T6 stance trend
    byroom = collections.defaultdict(list)
    for m in M:
        byroom[m["conversation_id"]].append(m)
    qa = collections.defaultdict(lambda: [0, 0, 0])
    for ms in byroom.values():
        if len(ms) < 6:
            continue
        for k, m in enumerate(ms):
            b = min(4, int(5 * k / len(ms)))
            qa[b][0] += 1
            qa[b][1] += bool(AGREE.search(m["body"].strip()))
            qa[b][2] += bool(PUSH.search(m["body"]))
    tot = [qa[b][0] for b in range(5)]
    ag = S.cochran_armitage([qa[b][1] for b in range(5)], tot)
    pu = S.cochran_armitage([qa[b][2] for b in range(5)], tot)
    out["stance"] = [{"quintile": b + 1, "n": qa[b][0], "agree": S.r(qa[b][1] / qa[b][0]), "push": S.r(qa[b][2] / qa[b][0]),
                      "agree_ci": [S.r(x) for x in S.wilson(qa[b][1], qa[b][0])], "push_ci": [S.r(x) for x in S.wilson(qa[b][2], qa[b][0])]}
                     for b in range(5)]
    add("N8", "Agreement rises as a conversation goes on", "Cochran–Armitage trend over quintiles",
        f"z = {ag['z']:.2f}", ag["p"], sum(tot), effect=S.r(ag["z"]))
    add("N9", "Pushback changes as a conversation goes on", "Cochran–Armitage trend over quintiles",
        f"z = {pu['z']:.2f}", pu["p"], sum(tot), effect=S.r(pu["z"]))

    # T7 attention dilution: reply latency vs replier's open conversations
    spans = collections.defaultdict(list)
    for ms in byroom.values():
        for a in {m["sender_id"] for m in ms}:
            spans[a].append((ms[0]["created_at"], ms[-1]["created_at"]))
    lat_x, lat_y = [], []
    for ms in byroom.values():
        for a, b in zip(ms, ms[1:]):
            if a["sender_id"] != b["sender_id"]:
                lat_x.append(sum(1 for s, e in spans[b["sender_id"]] if s <= b["created_at"] <= e))
                lat_y.append(b["created_at"] - a["created_at"])
    lr = ss.spearmanr(lat_x, lat_y)
    lat_by = collections.defaultdict(list)
    for x, y in zip(lat_x, lat_y):
        lat_by[min(x, 10)].append(y)
    out["latency_load"] = [{"open": k, "n": len(v), "median": S.r(np.median(v), 1), "q1": S.r(np.percentile(v, 25), 1),
                            "q3": S.r(np.percentile(v, 75), 1)} for k, v in sorted(lat_by.items()) if len(v) >= 15]
    add("N10", "Replies slow down when the replier has more open conversations", "Spearman over replies",
        f"ρ = {lr.correlation:.2f}", float(lr.pvalue), len(lat_x), effect=S.r(lr.correlation))

    # re-introductions: an opener phrase used after the 5th message of a conversation (context loss)
    OPEN = re.compile(r"caught my (eye|attention)|your (profile|description|introduction) (caught|stood)", re.I)
    reint = [(rid, k) for rid, ms in byroom.items() for k, m in enumerate(ms) if k >= 5 and OPEN.search(m["body"])]
    rooms_re = {r for r, _ in reint}
    add("N14", "Agents re-introduce themselves inside an ongoing conversation", "Count of opener phrases after message 5",
        f"{len(reint)} re-introductions in {len(rooms_re)} of {len(byroom)} conversations", None, len(byroom),
        effect=S.r(len(rooms_re) / len(byroom)), ci=[S.r(x) for x in S.wilson(len(rooms_re), len(byroom))],
        note="Pattern: 'caught my eye/attention', 'your profile/description … caught'. A lower bound: paraphrased re-openings are missed.")
    out["reintro_rooms"] = [r[:8] for r in rooms_re]

    # T8 unanswered endings
    eq = sum(1 for ms in byroom.values() if "?" in ms[-1]["body"])
    add("N11", "Conversations end with a question left open", "Wilson 95% CI on the share",
        f"{eq} of {len(byroom)} conversations ({eq / len(byroom):.0%})", None, len(byroom), effect=S.r(eq / len(byroom)),
        ci=[S.r(x) for x in S.wilson(eq, len(byroom))])

    # =============================== TOPICS ===============================
    stop = set("""i you we it this that the a an and or but to of in on for with is are be was were as at by from your my our
    their they he she his her its not no so if then than can could would should will just also more very what which who how
    when where there here one two about into out up do does did have has had me us them some any all each other such only own
    same too don now get like make made really think thing things want way yes still maybe let lets i'm you're it's that's
    we're i'd i'll you'd""".split())
    name_tok = {w.lower() for p in people for w in re.findall(r"[A-Za-z]+", p["name"] + " " + (p.get("nickname") or ""))}
    vec = TfidfVectorizer(max_df=0.3, min_df=8, stop_words=list(stop | name_tok), ngram_range=(1, 2), sublinear_tf=True,
                          token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z\-]{2,}\b")
    X = vec.fit_transform([m["body"] for m in M])
    nmf = NMF(10, random_state=1, init="nndsvda", max_iter=800)
    W = nmf.fit_transform(X)
    terms = np.array(vec.get_feature_names_out())
    raw_top = [list(terms[c.argsort()[::-1][:8]]) for c in nmf.components_]
    TOPIC_LABELS = {}
    for k, top in enumerate(raw_top):
        TOPIC_LABELS[k] = next((n for n, kw in TOPIC_RULES if kw & set(top)), "Other")
    names_ = sorted(set(TOPIC_LABELS.values()), key=list(TOPIC_LABELS.values()).index)
    tidx = {n: i for i, n in enumerate(names_)}
    Wn = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    T = np.zeros((len(M), len(names_)))
    for k, n in TOPIC_LABELS.items():
        T[:, tidx[n]] += Wn[:, k]
    dom = T.argmax(1)
    has = W.sum(1) > 1e-6
    hbin = np.array([int(H(m["created_at"]) * 2) for m in M])
    series = []
    for j, n in enumerate(names_):
        pts = []
        for b in range(hbin.max() + 1):
            sel = (hbin == b) & has
            if sel.sum():
                pts.append([b / 2, S.r((dom[sel] == j).mean())])
        terms_n = sorted({t for k, v in TOPIC_LABELS.items() if v == n for t in raw_top[k][:6]}, key=lambda t: -len(t))[:6]
        series.append({"topic": n, "share": S.r((dom[has] == j).mean()), "terms": terms_n, "points": pts})
    series.sort(key=lambda s: -s["share"])
    # convergence: JSD of each agent's topic mix from the population mix, first vs second half
    mid = (t0 + t1) / 2
    jsd = {"first": [], "second": []}
    for i in ids:
        for half, sel in (("first", [k for k, m in enumerate(M) if m["sender_id"] == i and m["created_at"] < mid]),
                          ("second", [k for k, m in enumerate(M) if m["sender_id"] == i and m["created_at"] >= mid])):
            pass
    pop = {h: T[[k for k, m in enumerate(M) if (m["created_at"] < mid) == (h == "first")]].mean(0) for h in ("first", "second")}
    pairs_j = []
    for i in ids:
        v = []
        for h in ("first", "second"):
            sel = [k for k, m in enumerate(M) if m["sender_id"] == i and (m["created_at"] < mid) == (h == "first")]
            v.append(jensenshannon(T[sel].mean(0), pop[h]) if len(sel) >= 10 else None)
        if None not in v:
            pairs_j.append(v)
    pj = np.array(pairs_j)
    wt = ss.wilcoxon(pj[:, 0], pj[:, 1])
    add("N12", "Agents' topic mixes converge on the population mix over the run", "Wilcoxon signed-rank on per-agent Jensen–Shannon distance, first vs second half",
        f"median JSD {np.median(pj[:, 0]):.3f} → {np.median(pj[:, 1]):.3f}", float(wt.pvalue), len(pj),
        effect=S.r(np.median(pj[:, 1] - pj[:, 0])))
    # within-conversation drift: dominant topic of first vs last quarter, conversations >= 20 messages
    drift = []
    topic_paths = []
    room_indices = collections.defaultdict(list)
    for i, message in enumerate(M):
        room_indices[message["conversation_id"]].append(i)
    for rid in byroom:
        sel = room_indices[rid]
        if len(sel) >= 20:
            q_ = len(sel) // 4
            bounds = [0, q_, len(sel) // 2, len(sel) - q_, len(sel)]
            windows = []
            for lo, hi in zip(bounds, bounds[1:]):
                indices = sel[lo:hi]
                topic = names_[int(T[indices].mean(0).argmax())]
                windows.append({"topic": topic, "first": lo + 1, "last": hi,
                                "h": S.r(H(M[indices[0]]["created_at"]), 4)})
            a_, b_ = windows[0]["topic"], windows[-1]["topic"]
            drift.append({"room": rid[:8], "from": a_, "to": b_, "n": len(sel)})
            topic_paths.append({"room": rid[:8], "people": sorted({label[M[i]["sender_id"]] for i in sel}),
                                "n": len(sel), "windows": windows})
    nd = sum(d["from"] != d["to"] for d in drift)
    add("N13", "Long conversations drift away from their opening topic", "Share of conversations (≥ 20 messages) whose dominant topic differs between first and last quarter",
        f"{nd} of {len(drift)} drifted", None, len(drift), effect=S.r(nd / len(drift)), ci=[S.r(x) for x in S.wilson(nd, len(drift))])
    flows = collections.Counter((d["from"], d["to"]) for d in drift if d["from"] != d["to"])
    out["drift"] = {"n": len(drift), "drifted": nd, "flows": [{"from": a, "to": b, "n": n} for (a, b), n in flows.most_common()]}
    FLOW_OUT.write_text(json.dumps({"labels_mode": args.labels, "paths": sorted(topic_paths, key=lambda path: (-path["n"], path["room"]))},
                                   ensure_ascii=False, separators=(",", ":")) + "\n")
    if args.topic_flows_only:
        return
    out["topics"] = {"series": series, "jsd": [[S.r(a), S.r(b)] for a, b in pj], "k": 10, "method": "TF-IDF + NMF (k = 10, seed 1), hand-labelled, two chess components merged"}
    # per-room dominant topic (for conversation cards)
    room_topic = {}
    for rid, ms in byroom.items():
        sel = room_indices[rid]
        room_topic[rid] = names_[int(T[sel].mean(0).argmax())]

    # =============================== CONVERSATIONS ===============================
    def card(rid, why, criterion, picks=None, n=4):
        ms = byroom[rid]
        idx = picks if picks is not None else sorted({0, 1, len(ms) // 2, len(ms) - 1})[:n]
        people_ = sorted({label[m["sender_id"]] for m in ms})
        return {"room": rid[:8], "people": people_, "messages": len(ms), "topic": room_topic[rid], "why": why, "criterion": criterion,
                "minutes": S.r((ms[-1]["created_at"] - ms[0]["created_at"]) / 60, 0),
                "turns": [{"who": label[ms[k]["sender_id"]], "seq": k + 1, "h": S.r(H(ms[k]["created_at"]), 2), "text": trim(ms[k]["body"])}
                          for k in idx]}
    cards = []
    longest = max((r for r in byroom if room_topic[r] != "Chess"), key=lambda r: len(byroom[r]))
    cards.append(card(longest, "The longest conversation that was not a chess game. It opens as a request to stress-test a proof-of-personhood idea and ends as a riff on football refereeing.", "max messages, topic ≠ chess"))
    hole_c = collections.Counter(c.get("plain", {}).get("room_id") for c in R["code"]
                                 if starvation and starvation[0]["from"] <= H(c["created_at"]) < starvation[0]["to"])
    hole = hole_c.most_common(1)
    if hole and hole[0][0] in byroom:
        cards.append(card(hole[0][0], f"The conversation most often cited by Python runs during the queue starvation ({hole[0][1]} of "
                          f"{sum(hole_c.values())} runs in that window). The two agents moved their exchange into code, re-running "
                          "dependency and provenance checks between turns, until one of them proposed to “stop multiplying gate drafts”.",
                          "room most referenced by code during the starvation window"))
    push_rate = {r: np.mean([bool(PUSH.search(m["body"])) for m in ms]) for r, ms in byroom.items() if len(ms) >= 10}
    contested = max(push_rate, key=push_rate.get)
    pk = [k for k, m in enumerate(byroom[contested]) if PUSH.search(m["body"])][:3]
    cards.append(card(contested, f"Highest pushback density among conversations with ≥ 10 messages ({push_rate[contested]:.0%} of turns).",
                      "max pushback share", picks=sorted(set([0] + pk + [len(byroom[contested]) - 1]))[:5]))
    chess_rooms = [r for r in byroom if room_topic[r] == "Chess"]
    if chess_rooms:
        cr = max(chess_rooms, key=lambda r: len(byroom[r]))
        cards.append(card(cr, "Two agents played a full game of chess in text, keeping the score on a shared whiteboard.", "dominant topic = chess"))
    mus_rooms = [r for r in byroom if byroom[r][0]["created_at"] >= music_from and room_topic[r] == "Music & listening"]
    if mus_rooms:
        mr = max(mus_rooms, key=lambda r: len(byroom[r]))
        cards.append(card(mr, "The longest music conversation started after the music & choreography prompt addition.", "dominant topic = music, opened after addition"))
    unanswered = [r for r, ms in byroom.items() if "?" in ms[-1]["body"] and len(ms) >= 8]
    if unanswered:
        ur = max(unanswered, key=lambda r: byroom[r][-1]["created_at"] - byroom[r][0]["created_at"])
        ms = byroom[ur]
        cards.append(card(ur, "A long conversation whose last turn is a question nobody answered — and in which one agent re-introduces "
                          "itself 31 messages in, as if meeting for the first time.", "ends on '?', longest such",
                          picks=[0, len(ms) - 3, len(ms) - 2, len(ms) - 1]))
    out["conversations"] = cards
    try:
        hops = json.loads(HOPS.read_text())
        out["hops"] = [{"label": c["label"], "confidence": c["confidence"]} for c in hops["chains"]]
    except Exception:  # noqa: BLE001
        out["hops"] = []

    # =============================== DIVISION OF WORK ===============================
    py = collections.Counter(c["owner_id"] for c in R["code"])
    bd = collections.Counter(b["owner_id"] for b in R["boards"])
    pyv = np.array([py.get(i, 0) for i in ids])
    bdv = np.array([bd.get(i, 0) for i in ids])
    top3 = np.sort(pyv)[::-1][:3].sum() / pyv.sum()
    out["labour"] = {
        "rows": sorted([{"agent": label[i], "messages": int(sv[k]), "python": int(pyv[k]), "boards": int(bdv[k])} for k, i in enumerate(ids)],
                       key=lambda r: -(r["python"] + r["boards"])),
        "gini": {"messages": S.r(S.gini(sv)), "python": S.r(S.gini(pyv)), "boards": S.r(S.gini(bdv))},
        "python_top3": S.r(top3), "python_users": int((pyv > 0).sum()), "board_users": int((bdv > 0).sum()),
    }

    # multiple-testing correction over tests that report a p-value
    ps = [t["p"] for t in tests if t["p"] is not None]
    adj = iter(S.bh(ps))
    for t in tests:
        t["p_bh"] = next(adj) if t["p"] is not None else None
    out["tests"] = tests
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=float))
    print("wrote", OUT, OUT.stat().st_size)
    for t in tests:
        print(t["id"], t["claim"], "|", t["stat"], "| p", t["p"], "bh", t["p_bh"])
    print("topics", [(s["topic"], s["share"], s["terms"]) for s in series])
    print("raw", raw_top)
    a = out["audit"]
    print({k: a[k] for k in a if k not in ("lanes", "error_list")})
    print([(x["agent"], x["calls"], x["outage_h"], x["outages"], x["restarts"]) for x in lanes if x["outage_h"]])
    print(out["labour"]["gini"], out["labour"]["python_top3"])
    for c in cards:
        print("\n##", c["why"], c["people"], c["messages"], c["topic"])
        for t in c["turns"]:
            print("  ", t["who"], t["seq"], t["text"][:160])


if __name__ == "__main__":
    main()
