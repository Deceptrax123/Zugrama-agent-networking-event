"""Build the networking study's figure data from the frozen residency records.

Reads (never writes) the parent workspace's public archive export, the frozen
event database (usage only) and the captured agent decision audit. Writes
static/data/networking.json. No resident code is executed.

Usage:  python analysis/build_data.py [--labels names|codes]
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sqlite3
import statistics as st
from pathlib import Path

import networkx as nx
import numpy as np
from scipy.stats import spearmanr

SITE = Path(__file__).resolve().parents[1]
WS = SITE.parents[1]
ARCHIVE = WS / "sites/zugrama-residency-stories/dist/archive.json"
LIVE = WS / "residency_app/.data/live-residency"
MAIN_EVENT = "5ca0be9108194c68af3b0f0d8fda0e64"
FROZEN = LIVE / "final-results" / MAIN_EVENT / "frozen.sqlite3"
AUDIT = LIVE / "audit" / MAIN_EVENT
OUT = SITE / "static/data/networking.json"

AGREE = re.compile(
    r"^(yes|yeah|agreed|i agree|exactly|absolutely|great|love|i love|beautiful|wonderful|perfect|i like|"
    r"that['’]s (a )?(great|lovely|wonderful|beautiful|good))",
    re.I,
)
PUSH = re.compile(
    r"(i disagree|disagree|i['’]m not (sure|convinced)|push back|i['’]d resist|i would resist|not quite|"
    r"i don['’]t think|counterexample|i['’]d challenge|i doubt|objection|that seems wrong|i['’]m skeptical)",
    re.I,
)


def gini(values):
    x = np.sort(np.asarray(values, float))
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum())) if x.sum() else 0.0


def r3(x):
    return round(float(x), 3)


def load_decisions():
    """One row per captured resident decision (request + model response)."""
    rows = []
    for d in sorted(p for p in AUDIT.iterdir() if p.name.isdigit()):
        rq, rp = d / "request.json", d / "response.json"
        if not rp.exists():
            continue
        req = json.loads(rq.read_text())
        system = req["payload"]["messages"][0]["content"]
        system = system if isinstance(system, str) else json.dumps(system)
        if "temporary helper" in system.lower():
            continue
        resp = json.loads(rp.read_text()).get("response") or {}
        usage = resp.get("usage") or {}
        row = {
            "at": req["at"],
            "member": req.get("member_id"),
            "group_prompt": "no two-person room cap" in system,
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": usage.get("completion_tokens") or 0,
        }
        try:
            action = json.loads(resp["choices"][0]["message"]["content"])
            assert isinstance(action, dict)
        except Exception:
            row["parse_error"] = True
            rows.append(row)
            continue
        starts = action.get("start_conversations") or []
        row.update(
            wait=action.get("wait_seconds"),
            starts_dm=sum(1 for s in starts if isinstance(s.get("with"), str)
                          or (isinstance(s.get("with"), list) and len(s["with"]) == 1)),
            starts_group=sum(1 for s in starts if isinstance(s.get("with"), list) and len(s["with"]) > 1),
            joins=len(action.get("join_conversations") or []),
            leaves=len(action.get("leave_conversations") or []),
            messages=len(action.get("messages") or []),
            tools=[t.get("name") for t in (action.get("tool_calls") or []) if isinstance(t, dict)],
        )
        row["empty"] = not (starts or row["joins"] or row["messages"] or row["leaves"] or row["tools"])
        rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", choices=["names", "codes"], default="names")
    args = ap.parse_args()

    A = json.loads(ARCHIVE.read_text())
    people = A["people"]
    ids = [p["id"] for p in people]
    if args.labels == "codes":
        label = {p["id"]: f"R{i + 1:02d}" for i, p in enumerate(sorted(people, key=lambda p: p["id"]))}
    else:
        label = {p["id"]: p["name"].split()[0].capitalize() for p in people}
    runs = {r["number"]: r for r in A["runs"]}
    # Whiteboard/workspace posts are platform-generated copies of tool output; analyse agent-written messages only.
    _con = sqlite3.connect(f"file:{FROZEN}?mode=ro", uri=True)
    tool_posts = {x for (x,) in _con.execute("select message_id from agent_boards where message_id is not null")}
    tool_posts |= {x for (x,) in _con.execute("select message_id from workspace_revisions where message_id is not null")}
    for R_ in runs.values():
        R_["messages"] = [m for m in R_["messages"] if m["id"] not in tool_posts]
    out = {"labels_mode": args.labels, "runs": {}, "agents": [], "tool_posts_excluded": len(tool_posts)}

    # ---------- per-run structure ----------
    per = {}
    for num, R in sorted(runs.items()):
        M = sorted((m for m in R["messages"] if m["sender_id"] in label), key=lambda m: m["created_at"])
        G = nx.DiGraph()
        G.add_nodes_from(ids)
        for m in M:
            for rcp in m.get("recipients") or []:
                if rcp in label and rcp != m["sender_id"]:
                    w = G.get_edge_data(m["sender_id"], rcp, {}).get("weight", 0)
                    G.add_edge(m["sender_id"], rcp, weight=w + 1)
        U = G.to_undirected()
        comm = nx.community.louvain_communities(U, weight="weight", seed=1)
        rooms = [r for r in R["rooms"] if r.get("message_count", 0) > 0]
        sent = collections.Counter(m["sender_id"] for m in M)
        recv = dict(G.in_degree(weight="weight"))
        words = [len(m["body"].split()) for m in M]
        per[num] = {"sent": sent, "recv": recv, "deg": dict(U.degree())}
        pairs = {frozenset((a, b)) for a, b in G.edges()}
        out["runs"][num] = {
            "hours": r3((R["finished_at"] - R["started_at"]) / 3600),
            "messages": len(M),
            "rooms": len(rooms),
            "max_room_residents": max((r.get("peak_residents") or 0) for r in rooms),
            "group_rooms": sum(1 for r in rooms if (r.get("peak_residents") or 0) > 2),
            "pairs_met": len(pairs),
            "pairs_possible": len(ids) * (len(ids) - 1) // 2,
            "density": r3(nx.density(G)),
            "reciprocity": r3(nx.reciprocity(G)),
            "clustering": r3(nx.average_clustering(U)),
            "modularity": r3(nx.community.modularity(U, comm, weight="weight")),
            "gini_sent": r3(gini([sent.get(i, 0) for i in ids])),
            "words_median": float(st.median(words)),
            "words_q": [float(np.percentile(words, q)) for q in (10, 25, 50, 75, 90)],
            "question_share": r3(np.mean(["?" in m["body"] for m in M])),
            "matrix": [[G.get_edge_data(a, b, {}).get("weight", 0) for b in ids] for a in ids],
        }

    # ---------- stability of individual position across runs ----------
    stab = []
    for metric, key in [("Messages sent", "sent"), ("Messages received", "recv"), ("Distinct partners", "deg")]:
        for a, b in [(1, 2), (2, 3), (1, 3)]:
            r = spearmanr([per[a][key].get(i, 0) for i in ids], [per[b][key].get(i, 0) for i in ids])
            stab.append({"metric": metric, "pair": f"Run {a} vs {b}", "rho": r3(r.correlation), "p": r3(r.pvalue)})
    out["stability"] = stab
    out["stability_scatter"] = [
        {"agent": label[i], "recv2": per[2]["recv"].get(i, 0), "recv3": per[3]["recv"].get(i, 0),
         "sent2": per[2]["sent"].get(i, 0), "sent3": per[3]["sent"].get(i, 0)} for i in ids]

    # ---------- main run (3) dynamics ----------
    R = runs[3]
    t0 = R["started_at"]
    M = sorted((m for m in R["messages"] if m["sender_id"] in label), key=lambda m: m["created_at"])
    byroom = collections.defaultdict(list)
    for m in M:
        byroom[m["conversation_id"]].append(m)

    # The archive's editorial categories describe whole rooms. Weight them by
    # cleaned message counts as a second view of how much discussion they held.
    room_categories = {room["id"]: room["category"] for room in R["rooms"]}
    categories = collections.defaultdict(collections.Counter)
    for room_id, messages in byroom.items():
        counts = categories[room_categories[room_id]]
        counts["rooms"] += 1
        counts["messages"] += len(messages)
    out["room_categories"] = [
        {"category": name, "rooms": counts["rooms"], "messages": counts["messages"]}
        for name, counts in sorted(categories.items(), key=lambda pair: (-pair[1]["rooms"], pair[0]))
    ]

    def saturation(run):
        seen, curve, s0 = set(), [], run["started_at"]
        for m in sorted(run["messages"], key=lambda m: m["created_at"]):
            for rcp in m.get("recipients") or []:
                if rcp in label and m["sender_id"] in label:
                    k = frozenset((m["sender_id"], rcp))
                    if k not in seen:
                        seen.add(k)
                        curve.append([r3((m["created_at"] - s0) / 3600), len(seen)])
        return curve
    out["saturation"] = {"2": saturation(runs[2]), "3": saturation(runs[3]), "possible": 210}

    pair_rooms = collections.Counter(
        frozenset(r["active_participants"]) for r in R["rooms"]
        if r.get("message_count", 0) > 0 and len(r["active_participants"]) == 2)
    out["pair_repeat"] = dict(collections.Counter(pair_rooms.values()))

    lengths = [len(v) for v in byroom.values()]
    balance, latency = [], []
    for ms in byroom.values():
        c = collections.Counter(m["sender_id"] for m in ms)
        if len(c) == 2 and len(ms) >= 4:
            balance.append(max(c.values()) / len(ms))
        for a, b in zip(ms, ms[1:]):
            if a["sender_id"] != b["sender_id"]:
                latency.append(b["created_at"] - a["created_at"])
    ended_on_question = sum(1 for ms in byroom.values() if "?" in ms[-1]["body"])
    out["conversations"] = {
        "lengths": lengths,
        "length_median": float(st.median(lengths)),
        "balance": [r3(b) for b in balance],
        "balance_median": r3(st.median(balance)),
        "latency_s": [round(x, 1) for x in latency],
        "latency_median_s": round(float(np.median(latency))),
        "latency_p90_s": round(float(np.percentile(latency, 90))),
        "ended_on_question": ended_on_question,
        "rooms": len(byroom),
    }

    # concurrency: open conversations per agent at each hour (first..last message window)
    spans = collections.defaultdict(list)
    for ms in byroom.values():
        for a in {m["sender_id"] for m in ms}:
            spans[a].append((ms[0]["created_at"], ms[-1]["created_at"]))
    grid = np.arange(t0, R["finished_at"], 600)
    conc = [[sum(1 for s, e in spans[a] if s <= t <= e) for t in grid] for a in ids]
    conc = np.array(conc)
    out["concurrency"] = {
        "hours": [r3((t - t0) / 3600) for t in grid],
        "median": [float(np.median(conc[:, j])) for j in range(conc.shape[1])],
        "p90": [float(np.percentile(conc[:, j], 90)) for j in range(conc.shape[1])],
        "max": [int(conc[:, j].max()) for j in range(conc.shape[1])],
    }

    # agreement vs pushback by position in conversation (rooms with >= 6 messages)
    q = collections.defaultdict(lambda: [0, 0, 0])
    for ms in byroom.values():
        if len(ms) < 6:
            continue
        for i, m in enumerate(ms):
            b = min(4, int(5 * i / len(ms)))
            q[b][0] += 1
            q[b][1] += bool(AGREE.search(m["body"].strip()))
            q[b][2] += bool(PUSH.search(m["body"]))
    out["stance"] = [{"quintile": b + 1, "n": t, "agree": r3(a / t), "push": r3(p / t)} for b, (t, a, p) in sorted(q.items())]
    out["stance_overall"] = {
        "agree": r3(np.mean([bool(AGREE.search(m["body"].strip())) for m in M])),
        "push": r3(np.mean([bool(PUSH.search(m["body"])) for m in M])),
    }

    # words per message by hour
    hrs = collections.defaultdict(list)
    for m in M:
        hrs[int((m["created_at"] - t0) / 3600)].append(len(m["body"].split()))
    out["words_by_hour"] = [{"hour": h, "n": len(v), "median": float(st.median(v))} for h, v in sorted(hrs.items())]

    # ---------- decisions ----------
    D = [d for d in load_decisions()]
    ok = [d for d in D if not d.get("parse_error")]
    gp = [d for d in ok if d["group_prompt"]]
    switch = min(d["at"] for d in D if d["group_prompt"])
    bins = collections.defaultdict(lambda: {"decisions": 0, "dm": 0, "group": 0, "join": 0})
    for d in ok:
        b = int((d["at"] - t0) // 1800)
        bins[b]["decisions"] += 1
        bins[b]["dm"] += d["starts_dm"]
        bins[b]["group"] += d["starts_group"]
        bins[b]["join"] += d["joins"]
    waits = collections.Counter(d["wait"] for d in ok if d.get("wait") is not None)
    tools = collections.Counter(t for d in ok for t in d["tools"])
    pt = np.array([d["prompt_tokens"] for d in ok])
    ct = np.array([d["completion_tokens"] for d in ok])
    tok_bins = collections.defaultdict(list)
    for d in ok:
        tok_bins[int((d["at"] - t0) // 1800)].append(d["prompt_tokens"])
    out["decisions"] = {
        "total": len(D),
        "parsed": len(ok),
        "parse_errors": len(D) - len(ok),
        "group_prompt_from_h": r3((switch - t0) / 3600),
        "group_prompt_decisions": len(gp),
        "group_prompt_dm_starts": sum(d["starts_dm"] for d in gp),
        "group_prompt_group_starts": sum(d["starts_group"] for d in gp),
        "group_prompt_joins": sum(d["joins"] for d in gp),
        "dm_starts": sum(d["starts_dm"] for d in ok),
        "joins": sum(d["joins"] for d in ok),
        "leaves": sum(d["leaves"] for d in ok),
        "messages": sum(d["messages"] for d in ok),
        "empty": sum(d["empty"] for d in ok),
        "with_tools": sum(1 for d in ok if d["tools"]),
        "bins": [{"h": r3(b / 2), **v} for b, v in sorted(bins.items())],
        "waits": sorted([[int(k), v] for k, v in waits.items()]),
        "tools": tools.most_common(),
        "prompt_tokens_total": int(pt.sum()),
        "completion_tokens_total": int(ct.sum()),
        "prompt_tokens_median": float(np.median(pt)),
        "completion_tokens_median": float(np.median(ct)),
        "prompt_by_halfhour": [{"h": r3(b / 2), "median": float(np.median(v))} for b, v in sorted(tok_bins.items())],
    }

    # ---------- cost ----------
    con = sqlite3.connect(f"file:{FROZEN}?mode=ro", uri=True)
    cost = dict(con.execute(
        "select owner_id, sum(cost_usd) from agent_usage where event_id=? group by owner_id", (MAIN_EVENT,)).fetchall())
    tot = con.execute("select sum(cost_usd), sum(input_tokens), sum(output_tokens) from agent_usage where event_id=?",
                      (MAIN_EVENT,)).fetchone()
    out["cost"] = {"usd": round(tot[0] / 1e6, 2), "input_tokens": tot[1], "output_tokens": tot[2]}

    # ---------- agents table (main run) ----------
    py = collections.Counter(c["owner_id"] for c in R["code"])
    boards = collections.Counter(b["owner_id"] for b in R["boards"])
    G3 = per[3]
    for i in ids:
        mine = [m for m in M if m["sender_id"] == i]
        out["agents"].append({
            "agent": label[i],
            "sent": G3["sent"].get(i, 0),
            "received": G3["recv"].get(i, 0),
            "partners": G3["deg"].get(i, 0),
            "words_median": float(st.median([len(m["body"].split()) for m in mine])) if mine else 0,
            "python": py.get(i, 0),
            "boards": boards.get(i, 0),
            "usd": round(cost.get(i, 0) / 1e6, 2),
        })
    out["agent_order"] = [label[i] for i in ids]
    out["source"] = {"archive": str(ARCHIVE.relative_to(WS)), "event": MAIN_EVENT}

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print("wrote", OUT, OUT.stat().st_size, "bytes")
    d = out["decisions"]
    print("group-prompt decisions", d["group_prompt_decisions"], "group starts", d["group_prompt_group_starts"],
          "joins", d["group_prompt_joins"], "dm starts", d["group_prompt_dm_starts"], "from h", d["group_prompt_from_h"])
    print("cost", out["cost"], "conv", {k: v for k, v in out["conversations"].items() if not isinstance(v, list)})
    print("pair repeat", out["pair_repeat"], "concurrency median max", max(out["concurrency"]["median"]))


if __name__ == "__main__":
    main()
