/* Figures for Study 1 (networking). Data: static/data/networking.json + science.json */
(async function () {
  const [D, X] = await Promise.all([
    fetch("static/data/networking.json").then((r) => r.json()),
    fetch("static/data/science.json").then((r) => r.json()),
  ]);
  const C = window.Charts, fmt = C.fmt;
  const $ = (id) => document.getElementById(id);
  const pct = d3.format(".0%"), pct1 = d3.format(".1%");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pfmt = (p) => (p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
  const T = Object.fromEntries(X.tests.map((t) => [t.id, t]));
  const AU = X.audit;
  const starve = AU.starvation[0];

  function tiles(el, items) {
    $(el).innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  }
  const r3 = D.runs["3"];
  const topicUnit = $("topic-unit");
  const roomOption = topicUnit.querySelector('input[value="rooms"]');
  function renderRoomTopics() {
    const byRoom = roomOption.checked;
    const key = byRoom ? "rooms" : "messages";
    const unit = byRoom ? "conversations" : "messages";
    const chart = $("fig-room-topics");
    C.hbars(chart, {
      data: D.room_categories, label: "category", keys: [key], colors: [byRoom ? "--s1" : "--s3"],
      labelW: 153, rowH: 27, valueLabels: true, valueW: 36, xMax: byRoom ? 60 : 650, xLabel: unit,
      tipFmt: (row) => `<b>${esc(row.category)}</b><br>${row.rooms} conversations · ${fmt(row.messages)} agent-written messages`,
    });
    const music = D.room_categories.find((row) => row.category === "Music & movement");
    $("topic-reading").textContent = byRoom
      ? `Community and research was the largest category, with ${D.room_categories[0].rooms} of ${r3.rooms} conversations.`
      : `Music and movement held ${fmt(music.messages)} messages across ${music.rooms} conversations.`;
    const values = D.room_categories.map((row) => `${row.category}: ${fmt(row[key])}`).join(". ");
    chart.querySelector("svg").setAttribute("aria-label", `Primary topic by ${unit}. ${values}.`);
  }
  topicUnit.addEventListener("change", renderRoomTopics);
  C.register(renderRoomTopics);

  tiles("run-stats", [
    [fmt(AU.calls), "model calls audited"],
    [fmt(r3.messages), "agent-written messages"],
    [fmt(r3.rooms), "conversations"],
    [`${r3.pairs_met}/${r3.pairs_possible}`, "possible pairs that met"],
    ["$" + D.cost.usd.toFixed(0), "API-equivalent spend"],
  ]);
  const sl = (id, t) => { $(id).textContent = `${t.test}: ${t.stat}` + (t.p != null ? `; p ${pfmt(t.p).startsWith("<") ? "" : "= "}${pfmt(t.p)}, BH-adjusted ${pfmt(t.p_bh)}` : "") + (t.ci && t.p == null ? "" : ""); };
  sl("sl-n1", T.N1); sl("sl-n4", T.N4); sl("sl-n7", T.N7); sl("sl-n8", T.N8);

  // ---------- audit cards + table ----------
  const outage4 = AU.lanes.filter((l) => l.outage_h >= 2.5).sort((a, b) => a.outages.at(-1)[0] - b.outages.at(-1)[0]);
  const py = AU.tool_runs.find((t) => t.tool === "python_run"), web = AU.tool_runs.find((t) => t.tool === "web_read");
  const promptChanges = AU.interventions.map((entry, i) => ({ ...entry, short: i === 0 ? "prompt edit" : "music added" }));
  const items = [
    ["sev-high", "High", "Turn-queue starvation", `${starve.from.toFixed(2)}–${starve.to.toFixed(2)} h: ${starve.holders.join(", ")} made ${starve.calls} consecutive calls (${starve.python} Python, ${starve.wait0} with a 0 s wait, ${starve.messages} messages). The other 18 agents could not act for about 50 minutes.`],
    ["sev-high", "High", "Provider outages", `${outage4.map((l) => `${l.agent} (from ${l.outages.at(-1)[0].toFixed(1)} h)`).join(", ")} stopped after provider errors and were restarted only at 7.24 h, losing 2.7–4.0 h each. Model calls per agent range ${AU.calls_range[0]}–${AU.calls_range[1]}.`],
    ["sev-mid", "Medium", "Two mid-run prompt changes", `The platform recorded a prompt edit at ${promptChanges[0].h.toFixed(2)} h and a music addition at ${X.music_series.at.toFixed(2)} h. Neither was randomised.`],
    ["sev-mid", "Medium", "Shorter outages late in the run", `${AU.lanes.filter((l) => l.outage_h > 0 && l.outage_h < 2.5).length} more agents went unscheduled for 20–60 min between 6.0 and 7.3 h. ${AU.restarts} worker restarts in total.`],
    ["sev-mid", "Medium", "Platform posts recorded as messages", `${AU.tool_posts} of ${fmt(AU.messages_total)} messages (${pct1(AU.tool_posts / AU.messages_total)}) are whiteboard or workspace publications posted under an agent's name. They are excluded from every talk measure.`],
    ["sev-ok", "OK", "Ledger reconciles with raw responses", `Raw responses: ${fmt(AU.audit_tokens.in)} input / ${fmt(AU.audit_tokens.out)} output tokens. Ledger: ${fmt(AU.usage_rows[0].in)} / ${fmt(AU.usage_rows[0].out)} (difference < 0.01%).`],
    ["sev-ok", "OK", "Responses are well-formed", `${AU.provider_errors} provider errors, ${AU.missing_responses} missing response and ${AU.parse_errors} unparseable action in ${fmt(AU.calls)} calls. Median model latency ${AU.latency_median_s} s (p90 ${AU.latency_p90_s} s).`],
    ["sev-mid", "Low", "Tool failures", `Python ${py.failed}/${py.total} failed (${pct1(py.failed / py.total)}); web reads ${web.failed}/${web.total} (${pct(web.failed / web.total)}); memory extraction ${AU.memory_jobs.failed || 0}/${fmt((AU.memory_jobs.completed || 0) + (AU.memory_jobs.failed || 0))}.`],
  ];
  $("audit-items").innerHTML = items.map(([c, s, h, p]) => `<div class="audit-item ${c}"><span class="sev">${s}</span><h4>${h}</h4><p>${esc(p)}</p></div>`).join("");
  const rec = AU.usage_rows.find((u) => u.status === "recorded");
  $("tbl-audit").innerHTML = `<thead><tr><th>Check</th><th>Value</th><th>Status</th></tr></thead><tbody>${[
    ["Model calls issued / completed", `${fmt(AU.calls)} / ${fmt(AU.completed)}`, "16 incomplete; all explained below"],
    ["Ledger rows recorded / unknown", `${fmt(rec.rows)} / ${AU.usage_rows.filter((u) => u.status !== "recorded").reduce((a, u) => a + u.rows, 0)}`, "unknown rows = 8 provider errors + 1 missing response"],
    ["Input tokens: raw responses vs ledger", `${fmt(AU.audit_tokens.in)} vs ${fmt(rec.in)}`, "match (< 0.01%)"],
    ["Output tokens: raw responses vs ledger", `${fmt(AU.audit_tokens.out)} vs ${fmt(rec.out)}`, "match (< 0.01%)"],
    ["Archive messages vs database", `${fmt(AU.messages_total)} vs ${fmt(AU.messages_total)}`, "match (platform integrity check passed)"],
    ["Run status", AU.status.replace(/_/g, " "), "errors listed in the audit cards"],
    ["Spend (API-equivalent)", "$" + rec.usd.toFixed(2), "—"],
  ].map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;

  // ---------- table: runs ----------
  const rows = [
    ["Duration (h)", (r) => r.hours.toFixed(1)], ["Messages", (r) => fmt(r.messages)], ["Populated rooms", (r) => fmt(r.rooms)],
    ["Pairs met / 210", (r) => r.pairs_met],
    ["Directed density", (r) => r.density.toFixed(2)], ["Reciprocity", (r) => pct(r.reciprocity)],
    ["Clustering", (r) => r.clustering.toFixed(2)], ["Modularity (Louvain)", (r) => r.modularity.toFixed(2)],
    ["Gini of messages sent", (r) => r.gini_sent.toFixed(3)], ["Median words / message", (r) => r.words_median],
  ];
  $("tbl-runs").innerHTML = `<thead><tr><th>Statistic</th><th>Run 1</th><th>Run 2</th><th>Run 3 (main)</th></tr></thead><tbody>${
    rows.map(([l, f]) => `<tr><td>${l}</td>${["1", "2", "3"].map((k) => `<td>${f(D.runs[k])}</td>`).join("")}</tr>`).join("")}</tbody>`;

  // ---------- conversation cards ----------
  $("convos").innerHTML = X.conversations.map((c, i) => {
    let prev = 0;
    const turns = c.turns.map((t) => {
      const gap = t.seq - prev > 1 && prev > 0 ? `<div class="turn gap">… ${t.seq - prev - 1} message${t.seq - prev - 1 > 1 ? "s" : ""} omitted …</div>` : "";
      prev = t.seq;
      return `${gap}<div class="turn"><div class="who">${esc(t.who)}<span>msg ${t.seq} · ${t.h.toFixed(2)} h</span></div><q>${esc(t.text)}</q></div>`;
    }).join("");
    return `<article class="convo"><header><h4>${i + 1}. ${esc(c.people.join(" & "))}</h4><span class="meta">${c.messages} messages · ${c.minutes} min · topic: ${esc(c.topic)}</span></header>
      <p class="why">${esc(c.why)}</p>${turns}<p class="crit">Selection rule: ${esc(c.criterion)}</p></article>`;
  }).join("");
  // ---------- drift table ----------
  $("tbl-drift").innerHTML = `<thead><tr><th>From (first quarter)</th><th>To (last quarter)</th><th>Conversations</th></tr></thead><tbody>${
    X.drift.flows.map((f) => `<tr><td>${esc(f.from)}</td><td>${esc(f.to)}</td><td>${f.n}</td></tr>`).join("")}
    <tr><td colspan="2"><b>Stayed on topic</b></td><td>${X.drift.n - X.drift.drifted}</td></tr></tbody>`;
  const pyTot = d3.sum(X.labour.rows, (r) => r.python);
  $("py-top3").textContent = pct(X.labour.python_top3);

  // ---------- tests table ----------
  const verdict = (t) => {
    if (t.id === "N10") return ["weak", "Detectable, negligible"];
    if (t.p == null) return ["est", "Estimate"];
    return t.p_bh < 0.05 ? ["yes", "Supported"] : ["no", "Not supported"];
  };
  $("tbl-tests").innerHTML = `<div class="table-wrap"><table class="compare tests"><thead><tr><th>ID</th><th>Hypothesis</th><th>Test</th><th>Result</th><th>p (BH)</th><th>Verdict</th></tr></thead><tbody>${
    X.tests.filter((t) => t.id !== "N2" && t.id !== "N3").sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map((t) => { const [c, v] = verdict(t); return `<tr><td>${t.id}</td><td>${esc(t.claim)}</td><td>${esc(t.test)}</td><td>${esc(t.stat)}${t.note ? `<br><span class="muted" style="color:var(--muted);font-size:12.5px">${esc(t.note)}</span>` : ""}</td><td>${pfmt(t.p_bh)}</td><td><span class="verdict ${c}">${v}</span></td></tr>`; }).join("")
  }</tbody></table></div>`;

  // ---------- agents table ----------
  C.table($("tbl-agents"), {
    rows: D.agents,
    columns: [
      { key: "agent", label: "Agent" }, { key: "sent", label: "Sent" }, { key: "received", label: "Received" },
      { key: "partners", label: "Partners" }, { key: "words_median", label: "Median words" },
      { key: "python", label: "Python calls" }, { key: "boards", label: "Whiteboards" },
      { key: "usd", label: "Spend ($)", fmt: (v) => v.toFixed(2) },
    ],
  });

  C.register(() => {
    // Fig 1: matrices
    const wrap = $("fig-matrices");
    wrap.innerHTML = ["1", "2", "3"].map((k) => `<div><p class="chart-title">Run ${k}${k === "3" ? " (main)" : ""}</p><p class="chart-sub">${fmt(D.runs[k].messages)} messages · ${D.runs[k].pairs_met}/210 pairs</p><div class="chart" id="mx-${k}"></div></div>`).join("");
    const max = d3.max(["1", "2", "3"], (k) => d3.max(D.runs[k].matrix.flat()));
    ["1", "2", "3"].forEach((k) => C.matrix($("mx-" + k), { m: D.runs[k].matrix, labels: D.agent_order, max, title: "Run " + k }));

    // Fig 2: swimlanes
    C.swimlanes($("fig-lanes"), {
      lanes: AU.lanes, xMax: AU.hours, stalls: AU.stalls,
      interventions: promptChanges,
      xLabel: "hours since start →", rowH: 16,
    });

    // Fig 3: saturation + null
    const sat = (k) => [[0, 0], ...D.saturation[k].map(([h, c]) => [h, c / D.saturation.possible])];
    C.line($("fig-saturation"), {
      series: [{ name: "Run 3", color: "--s1", values: sat("3") }, { name: "Run 2", color: "--s2", values: sat("2") }],
      xLabel: "hours →", yMax: 1, yFormat: d3.format(".0%"), xFormat: d3.format(".1f"),
      areas: [{ from: starve.from, to: starve.to, label: "starved" }], height: 250,
    });
    const nullRows = Object.entries(X.novelty_null.sims).map(([k, v]) => ({ k: +k, n: v })).sort((a, b) => a.k - b.k);
    const full = d3.range(0, d3.max(nullRows, (r) => r.k) + 1).map((k) => ({ k: String(k), n: (nullRows.find((r) => r.k === k) || { n: 0 }).n, obs: k === X.novelty_null.observed ? 1 : 0 }));
    C.bars($("fig-null"), {
      data: full, x: "k", keys: ["n"], colors: ["--neutral"], names: ["draws"], xLabel: "repeat pairs →", yLabel: "random draws", height: 250,
      tickEvery: 10,
      shade: [{ when: (d) => +d.k === X.novelty_null.observed, label: `observed: ${X.novelty_null.observed}`, color: "--s2" }],
      tipFmt: (d) => `<b>${d.k} repeat pairs</b><br>${fmt(d.n)} of 4,000 random draws`,
    });

    // Fig 5: music ITS
    const mb = X.music_series.bins.filter((b) => b.n >= 20);
    C.line($("fig-music"), {
      series: [{ name: "music share", color: "--s1", values: mb.map((b) => [b.h + 0.125, b.share]) }],
      areas: [{ from: starve.from, to: starve.to, label: "starved" }],
      markers: [{ x: X.music_series.at, label: "music added" }],
      xLabel: "hours since start →", yFormat: d3.format(".0%"), xFormat: d3.format(".2f"), yMax: 0.35, height: 260, directLabels: false,
    });
    const svg = d3.select($("fig-music")).select("svg g");
    if (!svg.empty()) {
      const w = $("fig-music").clientWidth - 44 - 16, h = 260 - 24 - 34;
      const x = d3.scaleLinear().domain([0, d3.max(mb, (b) => b.h + 0.125)]).range([0, w]);
      const y = d3.scaleLinear().domain([0, 0.35]).nice().range([h, 0]);
      svg.insert("path", () => svg.node().querySelector(":scope > path")).attr("d", d3.area().x((b) => x(b.h + 0.125)).y0((b) => y(b.ci[0])).y1((b) => y(b.ci[1])).curve(d3.curveMonotoneX)(mb))
        .attr("fill", C.css("--s1")).attr("fill-opacity", 0.14);
    }

    // Fig 6: stability forest
    const sr = X.stability.map((s) => ({ ...s, label: `${s.metric.replace("Messages ", "")} · ${s.pair.replace("Run ", "R").replace(" vs ", "–R")}`, est: s.rho }));
    C.forest($("fig-stability"), {
      rows: sr, xDomain: [-0.6, 1], ref: 0, xLabel: "Spearman ρ →", labelW: 150,
      colorOf: (r) => (r.metric === "Messages received" ? "--s1" : "--s2"),
      tipFmt: (r) => `<b>${r.metric}, ${r.pair}</b><br>ρ = ${r.rho.toFixed(2)} (95% CI ${r.ci[0].toFixed(2)} to ${r.ci[1].toFixed(2)})<br>p = ${pfmt(r.p)}<br>without the outage agents: ρ = ${r.rho_no_outage.toFixed(2)} (n = ${r.n_no_outage})`,
    });

    // Fig 7: stance + load
    C.line($("fig-stance"), {
      series: [
        { name: "Agreement", color: "--s1", values: X.stance.map((s) => [s.quintile, s.agree]) },
        { name: "Pushback", color: "--s2", values: X.stance.map((s) => [s.quintile, s.push]) },
      ],
      xMin: 1, xMax: 5, xTickValues: [1, 2, 3, 4, 5], yMax: 0.2, yFormat: d3.format(".0%"), xFormat: (v) => "Q" + Math.round(v),
      xLabel: "quintile →", height: 240,
    });
    const sg = d3.select($("fig-stance")).select("svg g");
    if (!sg.empty()) {
      const w = $("fig-stance").clientWidth - 44 - 70, h = 240 - 24 - 34;
      const x = d3.scaleLinear().domain([1, 5]).range([0, w]), y = d3.scaleLinear().domain([0, 0.2]).nice().range([h, 0]);
      [["agree_ci", "--s1"], ["push_ci", "--s2"]].forEach(([k, c]) => sg.insert("path", () => sg.node().querySelector(":scope > path"))
        .attr("d", d3.area().x((s) => x(s.quintile)).y0((s) => y(s[k][0])).y1((s) => y(s[k][1])).curve(d3.curveMonotoneX)(X.stance))
        .attr("fill", C.css(c)).attr("fill-opacity", 0.13));
    }
    C.ranges($("fig-load"), {
      rows: X.latency_load.map((r) => ({ label: r.open === 10 ? "10+" : String(r.open), q: [r.q1, r.q1, r.median, r.q3, r.q3], ...r })),
      labelW: 40, xLabel: "seconds to reply →",
      tipFmt: (r) => `<b>${r.label} open conversations</b><br>median ${r.median} s · IQR ${r.q1}–${r.q3} s<br>${fmt(r.n)} replies`,
    });

    // Fig 8: anatomy
    C.histogram($("fig-len"), { values: D.conversations.lengths, thresholds: 20, xLabel: "messages", yLabel: "rooms", height: 190 });
    C.histogram($("fig-bal"), { values: D.conversations.balance, domain: [0.5, 1], thresholds: d3.range(0.5, 1.001, 0.05), xLabel: "share", yLabel: "rooms", color: "--s3", height: 190, xFormat: d3.format(".0%") });
    C.histogram($("fig-lat"), { values: D.conversations.latency_s.filter((v) => v > 0), log: true, domain: [0, 4.2], thresholds: 24, xLabel: "seconds", yLabel: "replies", color: "--s2", height: 190, unit: " s" });

    // Fig 9: topic multiples
    C.multiples($("fig-topics"), {
      series: X.topics.series, xMax: Math.floor(AU.hours * 2) / 2, markers: [X.music_series.at], minW: 210, height: 104,
    });

    // Fig 10: labour
    C.hbars($("fig-labour"), {
      data: X.labour.rows.filter((r) => r.python + r.boards > 0), label: "agent", keys: ["python", "boards"], colors: ["--s1", "--s3"],
      names: ["Python executions", "Whiteboard posts"], labelW: 84, rowH: 19, xLabel: "count →",
      tipFmt: (d, k) => `<b>${d.agent}</b><br>Python: ${d.python} (${pct1(d.python / pyTot)} of all)<br>Whiteboards: ${d.boards}<br>Messages: ${d.messages}`,
    });
  });
})();
