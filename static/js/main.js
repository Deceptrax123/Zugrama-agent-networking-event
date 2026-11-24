/* Figures for Study 1 (networking). Data: static/data/networking.json */
(async function () {
  const D = await (await fetch("static/data/networking.json")).json();
  const C = window.Charts, fmt = C.fmt;
  const $ = (id) => document.getElementById(id);
  const pct = d3.format(".0%");

  function tiles(el, items) {
    $(el).innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  }
  const r3 = D.runs["3"];
  tiles("run-stats", [
    [fmt(r3.messages), "messages (main run)"],
    [fmt(r3.rooms), "conversations"],
    [`${r3.pairs_met}/${r3.pairs_possible}`, "possible pairs that met"],
    [fmt(D.decisions.total), "captured agent decisions"],
    ["$" + D.cost.usd.toFixed(0), "API-equivalent spend"],
  ]);
  tiles("group-stats", [
    [fmt(D.decisions.group_prompt_decisions), "decisions with groups explicitly allowed"],
    [D.decisions.group_prompt_group_starts, "group rooms started"],
    [D.decisions.group_prompt_joins, "joins of an existing room"],
    [fmt(D.decisions.group_prompt_dm_starts), "new one-to-one chats started instead"],
    [D.decisions.leaves, "explicit 'leave' actions (whole run)"],
  ]);
  const ratio = D.decisions.prompt_tokens_total / D.decisions.completion_tokens_total;
  tiles("token-stats", [
    [d3.format(".1f")(D.decisions.prompt_tokens_total / 1e6) + "M", "prompt tokens read"],
    [d3.format(".2f")(D.decisions.completion_tokens_total / 1e6) + "M", "completion tokens written"],
    [Math.round(ratio) + " : 1", "read-to-write token ratio"],
    [fmt(D.decisions.prompt_tokens_median), "median prompt tokens per decision"],
  ]);

  // Table 1: runs
  const rows = [
    ["Duration (h)", (r) => r.hours.toFixed(1)],
    ["Messages", (r) => fmt(r.messages)],
    ["Populated rooms", (r) => fmt(r.rooms)],
    ["Largest room (residents)", (r) => r.max_room_residents],
    ["Pairs met / 210", (r) => r.pairs_met],
    ["Directed density", (r) => r.density.toFixed(2)],
    ["Reciprocity", (r) => pct(r.reciprocity)],
    ["Clustering", (r) => r.clustering.toFixed(2)],
    ["Modularity (Louvain)", (r) => r.modularity.toFixed(2)],
    ["Gini of messages sent", (r) => r.gini_sent.toFixed(3)],
    ["Median words / message", (r) => r.words_median],
  ];
  $("tbl-runs").innerHTML = `<thead><tr><th>Statistic</th><th>Run 1</th><th>Run 2</th><th>Run 3 (main)</th></tr></thead><tbody>${
    rows.map(([l, f]) => `<tr><td>${l}</td>${["1", "2", "3"].map((k) => `<td>${f(D.runs[k])}</td>`).join("")}</tr>`).join("")}</tbody>`;

  C.register(() => {
    // Fig 1: matrices
    const wrap = $("fig-matrices");
    wrap.innerHTML = ["1", "2", "3"].map((k) => `<div><p class="chart-title">Run ${k}${k === "3" ? " (main)" : ""}</p><p class="chart-sub">${fmt(D.runs[k].messages)} messages · ${D.runs[k].pairs_met}/210 pairs</p><div class="chart" id="mx-${k}"></div></div>`).join("");
    const max = d3.max(["1", "2", "3"], (k) => d3.max(D.runs[k].matrix.flat()));
    ["1", "2", "3"].forEach((k) => C.matrix($("mx-" + k), { m: D.runs[k].matrix, labels: D.agent_order, max, title: "Run " + k }));

    // Fig 2: saturation
    const sat = (k) => [[0, 0], ...D.saturation[k].map(([h, c]) => [h, c / D.saturation.possible])];
    C.line($("fig-saturation"), {
      series: [{ name: "Run 3", color: "--s1", values: sat("3") }, { name: "Run 2", color: "--s2", values: sat("2") }],
      xLabel: "hours since start →", yMax: 1, yFormat: d3.format(".0%"), xFormat: d3.format(".1f"),
      areas: [{ from: D.decisions.group_prompt_from_h, to: D.runs["3"].hours, label: "group rooms allowed (Run 3)" }],
      height: 280,
    });

    // Fig 3: starts per half hour
    C.bars($("fig-starts"), {
      data: D.decisions.bins.map((b) => ({ ...b, label: b.h.toFixed(1) })), x: "label", keys: ["dm", "group"],
      colors: ["--s1", "--s2"], names: ["One-to-one starts", "Group starts"], xLabel: "hour →", yLabel: "starts",
      shade: { when: (d) => d.h + 0.5 > D.decisions.group_prompt_from_h, label: "group rooms allowed" },
      tipFmt: (d) => `<b>${d.h.toFixed(1)}–${(d.h + 0.5).toFixed(1)} h</b><br>${fmt(d.decisions)} decisions<br>one-to-one starts: ${d.dm}<br>group starts: ${d.group}<br>joins: ${d.join}`,
      height: 240,
    });

    // Fig 4: concurrency
    const ch = D.concurrency.hours;
    C.line($("fig-concurrency"), {
      series: [
        { name: "Median", color: "--s1", values: ch.map((h, i) => [h, D.concurrency.median[i]]) },
        { name: "90th pct", color: "--s2", values: ch.map((h, i) => [h, D.concurrency.p90[i]]) },
      ],
      xLabel: "hours since start →", yLabel: "open conversations", xFormat: d3.format(".1f"), yFormat: d3.format(".0f"), height: 240,
    });

    // Fig 5: anatomy
    C.histogram($("fig-len"), { values: D.conversations.lengths, thresholds: 20, xLabel: "messages", yLabel: "rooms", height: 190 });
    C.histogram($("fig-bal"), { values: D.conversations.balance, domain: [0.5, 1], thresholds: d3.range(0.5, 1.001, 0.05), xLabel: "share", yLabel: "rooms", color: "--s3", height: 190, xFormat: d3.format(".0%") });
    C.histogram($("fig-lat"), { values: D.conversations.latency_s.filter((v) => v > 0), log: true, domain: [0, 4.2], thresholds: 24, xLabel: "seconds", yLabel: "replies", color: "--s2", height: 190, unit: " s" });

    // Fig 6: words per message by run
    C.ranges($("fig-words"), {
      rows: ["1", "2", "3"].map((k) => ({ label: "Run " + k, q: D.runs[k].words_q })),
      xLabel: "words per message →",
      tipFmt: (r) => `<b>${r.label}</b><br>median ${r.q[2]} words<br>IQR ${r.q[1]}–${r.q[3]}<br>10–90%: ${r.q[0]}–${r.q[4]}`,
    });

    // Fig 7: stability dots
    const metrics = ["Messages received", "Messages sent", "Distinct partners"];
    const pairs = ["Run 1 vs 2", "Run 2 vs 3", "Run 1 vs 3"];
    const find = (m, p) => D.stability.find((s) => s.metric === m && s.pair === p);
    C.dots($("fig-stability"), {
      rows: metrics, series: pairs, colors: ["--s1", "--s2", "--s3"], value: (m, p) => find(m, p).rho,
      xDomain: [-0.5, 1], xLabel: "Spearman ρ →", labelW: 140,
      tipFmt: (m, p) => { const s = find(m, p); return `<b>${m}</b><br>${p}: ρ = ${s.rho.toFixed(2)}<br>p = ${s.p.toFixed(3)}`; },
    });

    // Fig 8: stance
    C.line($("fig-stance"), {
      series: [
        { name: "Agreement", color: "--s1", values: D.stance.map((s) => [s.quintile, s.agree]) },
        { name: "Pushback", color: "--s2", values: D.stance.map((s) => [s.quintile, s.push]) },
      ],
      xMin: 1, xMax: 5, xTickValues: [1, 2, 3, 4, 5], yMax: 0.2, yFormat: d3.format(".0%"), xFormat: (v) => "Q" + Math.round(v),
      xLabel: "position in conversation (quintile) →", height: 240,
    });

    // Fig 9: waits & tools
    const waits = D.decisions.waits.filter(([, n]) => n >= 20).map(([w, n]) => ({ w: w >= 60 ? (w / 60) + " min" : w + " s", n }));
    C.bars($("fig-wait"), { data: waits, x: "w", keys: ["n"], colors: ["--s1"], names: ["decisions"], yLabel: "decisions", height: 220,
      tipFmt: (d) => `<b>wait ${d.w}</b><br>${fmt(d.n)} decisions` });
    const nice = { conversation_recall: "Memory recall", python_run: "Python", board_add: "Whiteboard post", web_search: "Web search", web_read: "Web read", workspace_read: "Workspace read", board_read: "Whiteboard read", workspace_update: "Workspace update", workspace_create: "Workspace create", delegate: "Delegate" };
    C.hbars($("fig-tools"), { data: D.decisions.tools.map(([k, n]) => ({ tool: nice[k] || k, n })), label: "tool", keys: ["n"], colors: ["--s1"], names: ["calls"], valueLabels: true, labelW: 120, rowH: 20 });
  });

  C.table($("tbl-agents"), {
    rows: D.agents,
    columns: [
      { key: "agent", label: "Agent" }, { key: "sent", label: "Sent" }, { key: "received", label: "Received" },
      { key: "partners", label: "Partners" }, { key: "words_median", label: "Median words" },
      { key: "python", label: "Python calls" }, { key: "boards", label: "Whiteboards" },
      { key: "usd", label: "Spend ($)", fmt: (v) => v.toFixed(2) },
    ],
  });
})();
