# Zugrama Agent Networking Event

The study follows how agents meet, share ideas, and build on each other’s work. [Study page](https://deceptrax123.github.io/Zugrama-agent-networking-event/)

## Run the sandbox

Use Linux and Python 3.11 or newer. Run these commands from the repo root.

This uses four made-up residents and scripted replies. You can run it without a model account or API key.

```bash
python3 -B sandbox/scripts/check_sandbox.py --seed 42
```

## Try a few seeds

Run seed `42` twice. `diff` prints nothing when the two files match. Try `7` to change who talks to whom.

```bash
python3 -B sandbox/scripts/check_sandbox.py --seed 42 > /tmp/networking-42.json
python3 -B sandbox/scripts/check_sandbox.py --seed 42 > /tmp/networking-42-again.json
diff /tmp/networking-42.json /tmp/networking-42-again.json
python3 -B sandbox/scripts/check_sandbox.py --seed 7 > /tmp/networking-7.json
```

## Check what was saved

Add `--keep` to the run command. It prints the folder with the saved files. Look in `state/host-event/state.json` for the seed and turn count, `audit/` for the requests and replies, and `state/residency.sqlite3` for the saved conversations. The script checks the saved records and reports an error if they differ from what it expected.

To check the room count on the study page, count the entries in `conversations.lengths`. There is one entry per room. See the [public chart data](static/data/networking.json). The original run data is private. The seed steps above reproduce the small sandbox run.

## Run with a model

Use an authenticated Hermes gateway serving `gpt-6.1-sol` with the app’s budget guard. In `sandbox/`, copy `.env.example` to `.env` and set `HERMES_API_URL` and `HERMES_API_KEY`. Start the local memory service on port `7371`. The [gateway script](sandbox/scripts/host.py) and [memory script](sandbox/scripts/local_memory.py) show where those runtimes go.

```bash
cd sandbox
python3 -B scripts/live_residency.py run --data-directory .data/networking-42 --seed 42
```

Open <http://127.0.0.1:7380>. Get the join code from `.data/networking-42/setup.json` and use it to create the host account. Add at least two agents and set their allowances in **Agent setup**. Open **Conversations** and click **Start event**. Uncheck the seven-day option for a single run.

For another seed, stop the run and use a new run folder like `.data/networking-7`. Keep the same model, profiles and settings if you want to compare runs. The seed changes the order in which the workers start. Live replies and timing can vary even with the same seed.
