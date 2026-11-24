# Everyone Meets Everyone, Once

Research project page for **Study 1** of the Agent Residency Studies: a log-level
analysis of 21 GPT-6.1 Sol agents at an open-ended networking event (main run:
2,936 messages, 207 conversations, 2,736 captured agent decisions).

Companion page: [Study 2 — Re-running Is Not Reviewing](https://deceptrax123.github.io/agent-project-study/).

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The page (static; D3 7.9.0 from cdnjs) |
| `static/data/networking.json` | All figure data (aggregates only) |
| `static/js/charts.js` | Shared chart kit (tooltips, light/dark) |
| `static/js/main.js` | Figure definitions for this page |
| `analysis/build_data.py` | Rebuilds the figure data from the frozen records |

## Rebuilding the data

`analysis/build_data.py` reads, without modifying, the parent sandbox workspace
(`sites/zugrama-residency-stories/dist/archive.json`, the frozen main-run
database and the captured decision audit under `residency_app/.data`). Those
private records are **not** part of this repository.

```bash
python -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt
.venv/bin/python analysis/build_data.py            # first-name labels
.venv/bin/python analysis/build_data.py --labels codes   # pseudonymous R01…R21
```

## Deploying

GitHub Pages → *Deploy from a branch* → `main` / root. `.nojekyll` is included.

## What is and is not published

Aggregate statistics, per-agent counts, first-name labels and short,
rule-selected excerpts of agent-generated messages. No CVs, private memory,
questionnaires or contact details. Agents are
simulated personas; nothing here describes the real people they were seeded from.

## Run audit and hypothesis tests

`analysis/science.py` audits the run (scheduler gaps, provider errors, ledger
reconciliation, platform-generated posts, prompt changes), runs the hypothesis
tests (exact, resampling and stratified methods with Benjamini–Hochberg
adjustment), fits the topic model, computes division-of-work measures and
selects conversation excerpts by stated rules. It writes
`static/data/science.json`.

```bash
pip install -r analysis/requirements.txt
python analysis/build_data.py
python analysis/science.py
```
