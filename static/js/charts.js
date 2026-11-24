/* Small D3 chart kit shared by both study pages.
   Every chart reads colours from CSS tokens so light/dark both work,
   draws hairline axes, and exposes a hover tooltip on each mark. */
(function () {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = d3.format(",");
  const tip = d3.select("body").append("div").attr("class", "tooltip").attr("role", "status");

  function showTip(event, html) {
    tip.html(html).style("opacity", 1);
    const pad = 14, w = tip.node().offsetWidth, h = tip.node().offsetHeight;
    let x = event.clientX + pad, y = event.clientY + pad;
    if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
    tip.style("left", x + "px").style("top", y + "px");
  }
  const hideTip = () => tip.style("opacity", 0);

  function frame(el, { height = 260, margin = {}, minWidth = 260 } = {}) {
    const root = d3.select(el);
    root.selectAll("*").remove();
    const width = Math.max(minWidth, el.clientWidth || 600);
    const m = Object.assign({ top: 24, right: 16, bottom: 34, left: 44 }, margin);
    const svg = root.append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    return { svg, g, w: width - m.left - m.right, h: height - m.top - m.bottom, m, width, height };
  }

  function axes(f, x, y, { xTicks = 6, yTicks = 5, xFormat, yFormat, xLabel, yLabel, gridY = true, gridX = false, xTickValues } = {}) {
    if (gridY) f.g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(yTicks).tickSize(-f.w).tickFormat(""));
    if (gridX) f.g.append("g").attr("class", "grid").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(xTicks).tickSize(-f.h).tickFormat(""));
    const xa = f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`)
      .call((x.bandwidth ? d3.axisBottom(x) : xTickValues ? d3.axisBottom(x).tickValues(xTickValues) : d3.axisBottom(x).ticks(xTicks)).tickSizeOuter(0).tickFormat(xFormat || null));
    const ya = f.g.append("g").attr("class", "axis")
      .call((y.bandwidth ? d3.axisLeft(y) : d3.axisLeft(y).ticks(yTicks)).tickSizeOuter(0).tickFormat(yFormat || null));
    ya.select(".domain").remove();
    if (!y.bandwidth) ya.selectAll(".tick line").remove();
    if (xLabel) f.g.append("text").attr("x", f.w).attr("y", f.h + 30).attr("text-anchor", "end").text(xLabel);
    if (yLabel) f.g.append("text").attr("x", -f.m.left + 2).attr("y", -12).attr("text-anchor", "start").text(yLabel);
    return { xa, ya };
  }

  /* Rounded-end bar path (4px radius on the data end only). */
  function barPathV(x, y, w, h, r = 4) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barPathH(x, y, w, h, r = 4) {
    if (w <= 0) return "";
    r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  /* ---------- line chart ---------- */
  function line(el, { series, xLabel, yLabel, yMax, xMax, xMin = 0, xTickValues, yFormat, xFormat, height = 260, markers = [], areas = [], directLabels = true }) {
    const f = frame(el, { height, margin: { right: directLabels ? 70 : 16 } });
    const all = series.flatMap((s) => s.values);
    const x = d3.scaleLinear().domain([xMin, xMax ?? d3.max(all, (d) => d[0])]).range([0, f.w]);
    const y = d3.scaleLinear().domain([0, yMax ?? d3.max(all, (d) => d[1]) * 1.08]).nice().range([f.h, 0]);
    areas.forEach((a) => {
      f.g.append("rect").attr("x", x(a.from)).attr("y", 0).attr("width", x(a.to) - x(a.from)).attr("height", f.h)
        .attr("fill", css(a.color || "--surface-2")).attr("fill-opacity", a.color ? 0.16 : 1);
      f.g.append("text").attr("class", "annot").attr("x", x(a.from) + 6).attr("y", 12 + (a.row || 0) * 13).text(a.label);
    });
    axes(f, x, y, { xLabel, yLabel, yFormat, xFormat, xTickValues });
    markers.forEach((mk) => {
      f.g.append("line").attr("x1", x(mk.x)).attr("x2", x(mk.x)).attr("y1", 0).attr("y2", f.h)
        .attr("stroke", css("--ink-2")).attr("stroke-width", 1);
      f.g.append("text").attr("class", "annot").attr("x", x(mk.x) + 5).attr("y", 12 + (mk.row || 0) * 13).text(mk.label);
    });
    const ln = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(series[0].step ? d3.curveStepAfter : d3.curveMonotoneX);
    series.forEach((s) => {
      f.g.append("path").attr("d", ln(s.values)).attr("fill", "none").attr("stroke", css(s.color))
        .attr("stroke-width", 2).attr("stroke-linejoin", "round");
      if (directLabels) {
        const last = s.values[s.values.length - 1];
        f.g.append("text").attr("x", x(last[0]) + 6).attr("y", y(last[1])).attr("dy", "0.35em")
          .attr("class", "label-strong").text(s.name);
      }
    });
    // crosshair
    const cross = f.g.append("line").attr("y1", 0).attr("y2", f.h).attr("stroke", css("--axis")).style("opacity", 0);
    const dots = series.map((s) => f.g.append("circle").attr("r", 4).attr("fill", css(s.color))
      .attr("stroke", css("--surface")).attr("stroke-width", 2).style("opacity", 0));
    f.g.append("rect").attr("width", f.w).attr("height", f.h).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const xv = x.invert(d3.pointer(ev)[0]);
        cross.attr("x1", x(xv)).attr("x2", x(xv)).style("opacity", 1);
        const rows = series.map((s, i) => {
          const idx = Math.max(0, d3.bisector((d) => d[0]).right(s.values, xv) - 1);
          const d = s.values[idx];
          dots[i].attr("cx", x(d[0])).attr("cy", y(d[1])).style("opacity", 1);
          return `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${css(s.color)};margin-right:6px"></i>${s.name}: <b>${(yFormat || fmt)(d[1])}</b></div>`;
        });
        showTip(ev, `<div class="muted">${(xFormat || d3.format(".2f"))(xv)} ${xLabel ? xLabel.replace(/ →$/, "") : ""}</div>${rows.join("")}`);
      })
      .on("mouseleave", () => { hideTip(); cross.style("opacity", 0); dots.forEach((d) => d.style("opacity", 0)); });
  }

  /* ---------- vertical bars (single, grouped or stacked) ---------- */
  function bars(el, { data, x: xKey, keys, colors, names, stacked = false, height = 240, xLabel, yLabel, yFormat, tipFmt, xTickFormat, shade, yMax, tickEvery }) {
    const f = frame(el, { height });
    const x = d3.scaleBand().domain(data.map((d) => d[xKey])).range([0, f.w]).padding(0.25);
    const top = stacked ? d3.max(data, (d) => d3.sum(keys, (k) => d[k])) : d3.max(data, (d) => d3.max(keys, (k) => d[k]));
    const y = d3.scaleLinear().domain([0, yMax ?? Math.max(1, top * 1.08)]).nice().range([f.h, 0]);
    (Array.isArray(shade) ? shade : shade ? [shade] : []).forEach((sh) => {
      const xs = data.filter(sh.when).map((d) => x(d[xKey]));
      if (xs.length) {
        f.g.append("rect").attr("x", d3.min(xs) - x.step() * x.padding() / 2).attr("y", 0)
          .attr("width", d3.max(xs) - d3.min(xs) + x.step()).attr("height", f.h).attr("fill", css(sh.color || "--surface-2"))
          .attr("fill-opacity", sh.color ? 0.16 : 1);
        f.g.append("text").attr("class", "annot").attr("x", d3.min(xs) + 2).attr("y", 12 + (sh.row || 0) * 13).text(sh.label);
      }
    });
    const every = tickEvery || Math.ceil(data.length / Math.max(4, Math.floor(f.w / 46)));
    axes(f, x, y, { xLabel, yLabel, yFormat, xFormat: (v, i) => (i % every ? "" : (xTickFormat ? xTickFormat(v) : v)) });
    const sub = stacked ? null : d3.scaleBand().domain(keys).range([0, x.bandwidth()]).padding(0.12);
    data.forEach((d) => {
      let acc = 0;
      keys.forEach((k, i) => {
        const v = d[k] || 0;
        let bx, bw, by, bh;
        if (stacked) { bx = x(d[xKey]); bw = x.bandwidth(); by = y(acc + v); bh = y(acc) - y(acc + v); acc += v; }
        else { bx = x(d[xKey]) + sub(k); bw = sub.bandwidth(); by = y(v); bh = f.h - y(v); }
        const isTop = !stacked || i === keys.length - 1 || keys.slice(i + 1).every((kk) => !d[kk]);
        const gap = stacked && i > 0 ? 1 : 0;
        f.g.append("path")
          .attr("d", isTop ? barPathV(bx, by, bw, Math.max(0, bh - gap)) : `M${bx},${by}h${bw}v${Math.max(0, bh - gap)}h${-bw}Z`)
          .attr("fill", css(colors[i]))
          .on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(d, k) : `<b>${d[xKey]}</b><br>${names ? names[i] : k}: ${fmt(v)}`))
          .on("mouseleave", hideTip);
      });
    });
    // hit targets for whole column
  }

  /* ---------- horizontal bars (single or stacked) ---------- */
  function hbars(el, { data, label, keys, colors, names, stacked = true, xLabel, valueFmt, tipFmt, rowH = 22, labelW = 110, valueLabels = false, valueW = 56, xMax, height }) {
    const f = frame(el, { height: height || data.length * rowH + 44, margin: { left: labelW, right: valueLabels ? valueW : 16 } });
    const y = d3.scaleBand().domain(data.map((d) => d[label])).range([0, f.h]).padding(0.28);
    const top = d3.max(data, (d) => (stacked ? d3.sum(keys, (k) => d[k]) : d3.max(keys, (k) => d[k])));
    const x = d3.scaleLinear().domain([0, xMax ?? top * 1.04]).nice().range([0, f.w]);
    f.g.append("g").attr("class", "grid").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(5).tickSize(-f.h).tickFormat(""));
    f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(5).tickSizeOuter(0).tickFormat(valueFmt || null));
    const ya = f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(8));
    ya.select(".domain").attr("stroke", css("--axis"));
    if (xLabel) f.g.append("text").attr("x", f.w).attr("y", f.h + 30).attr("text-anchor", "end").text(xLabel);
    data.forEach((d) => {
      let acc = 0;
      keys.forEach((k, i) => {
        const v = d[k] || 0;
        const bx = x(acc), bw = x(acc + v) - x(acc);
        const isEnd = i === keys.length - 1 || keys.slice(i + 1).every((kk) => !d[kk]);
        const gap = i > 0 && v ? 1 : 0;
        f.g.append("path")
          .attr("d", isEnd ? barPathH(bx + gap, y(d[label]), Math.max(0, bw - gap), y.bandwidth()) : `M${bx + gap},${y(d[label])}h${Math.max(0, bw - gap)}v${y.bandwidth()}h${-Math.max(0, bw - gap)}Z`)
          .attr("fill", css(typeof colors === "function" ? colors(d, k) : colors[i]))
          .on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(d, k) : `<b>${d[label]}</b><br>${names ? names[i] : k}: ${fmt(v)}`))
          .on("mouseleave", hideTip);
        if (stacked) acc += v;
      });
      if (valueLabels) {
        const tot = stacked ? d3.sum(keys, (k) => d[k]) : d[keys[0]];
        f.g.append("text").attr("x", x(tot) + 6).attr("y", y(d[label]) + y.bandwidth() / 2).attr("dy", "0.35em")
          .attr("class", "label-strong").text(typeof valueLabels === "function" ? valueLabels(d) : (valueFmt || fmt)(tot));
      }
    });
  }

  /* ---------- histogram ---------- */
  function histogram(el, { values, thresholds, domain, xLabel, yLabel = "count", color = "--s1", height = 200, log = false, xFormat, unit = "" }) {
    const f = frame(el, { height });
    const tx = log ? (v) => Math.log10(Math.max(v, 1e-9)) : (v) => v;
    const dom = domain || d3.extent(values, tx);
    const x = d3.scaleLinear().domain(dom).range([0, f.w]);
    const bins = d3.bin().domain(dom).thresholds(thresholds || 24)(values.map(tx));
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length) * 1.08]).nice().range([f.h, 0]);
    axes(f, x, y, { xLabel, yLabel, xFormat: xFormat || (log ? (v) => d3.format("~s")(Math.round(10 ** v)) : null), xTicks: 6,
      xTickValues: log ? d3.range(Math.ceil(dom[0]), Math.floor(dom[1]) + 1) : undefined });
    bins.forEach((b) => {
      const bx = x(b.x0) + 1, bw = Math.max(0, x(b.x1) - x(b.x0) - 2);
      f.g.append("path").attr("d", barPathV(bx, y(b.length), bw, f.h - y(b.length), 3)).attr("fill", css(color))
        .on("mousemove", (ev) => {
          const lo = log ? 10 ** b.x0 : b.x0, hi = log ? 10 ** b.x1 : b.x1;
          showTip(ev, `<b>${fmt(b.length)}</b> in ${d3.format(".3~g")(lo)}–${d3.format(".3~g")(hi)}${unit}`);
        })
        .on("mouseleave", hideTip);
    });
  }

  /* ---------- scatter ---------- */
  function scatter(el, { points, x: xk, y: yk, label, colorOf, sizeOf, xLabel, yLabel, height = 300, labelIf, tipFmt, diagonal = false }) {
    const f = frame(el, { height, margin: { left: 48, right: 20 } });
    const x = d3.scaleLinear().domain([0, d3.max(points, (d) => d[xk]) * 1.08]).nice().range([0, f.w]);
    const y = d3.scaleLinear().domain([0, d3.max(points, (d) => d[yk]) * 1.08]).nice().range([f.h, 0]);
    axes(f, x, y, { xLabel, yLabel, gridX: true });
    if (diagonal) {
      const m = Math.min(x.domain()[1], y.domain()[1]);
      f.g.append("line").attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(m)).attr("y2", y(m)).attr("stroke", css("--axis"));
    }
    points.forEach((d) => {
      f.g.append("circle").attr("cx", x(d[xk])).attr("cy", y(d[yk])).attr("r", sizeOf ? sizeOf(d) : 5)
        .attr("fill", css(colorOf ? colorOf(d) : "--s1")).attr("fill-opacity", 0.85)
        .attr("stroke", css("--surface")).attr("stroke-width", 2)
        .on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(d) : `<b>${d[label]}</b><br>${xLabel}: ${fmt(d[xk])}<br>${yLabel}: ${fmt(d[yk])}`))
        .on("mouseleave", hideTip);
      if (labelIf && labelIf(d)) f.g.append("text").attr("x", x(d[xk]) + 8).attr("y", y(d[yk])).attr("dy", "0.35em").text(d[label]);
    });
  }

  /* ---------- heatmap (adjacency matrix) ---------- */
  function matrix(el, { m, labels, title, max, height }) {
    const n = labels.length;
    const size = Math.min(el.clientWidth || 300, 420);
    const f = frame(el, { height: height || size, margin: { top: 4, right: 4, bottom: 4, left: 4 } });
    const cell = Math.min(f.w, f.h) / n;
    const steps = ["--seq-0", "--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"].map(css);
    const col = d3.scaleQuantize().domain([1, max]).range(steps.slice(1));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = m[i][j];
      f.g.append("rect").attr("x", j * cell).attr("y", i * cell).attr("width", cell - 1).attr("height", cell - 1)
        .attr("rx", 1.5).attr("fill", i === j ? "transparent" : v ? col(v) : steps[0])
        .on("mousemove", (ev) => i !== j && showTip(ev, `<b>${labels[i]} → ${labels[j]}</b><br>${fmt(v)} message${v === 1 ? "" : "s"}${title ? `<div class="muted">${title}</div>` : ""}`))
        .on("mouseleave", hideTip);
    }
  }

  /* ---------- dot plot (categories × series) ---------- */
  function dots(el, { rows, series, colors, value, xDomain = [-1, 1], xLabel, labelW = 140, tipFmt }) {
    const f = frame(el, { height: rows.length * 40 + 46, margin: { left: labelW, right: 20 } });
    const y = d3.scaleBand().domain(rows).range([0, f.h]).padding(0.3);
    const x = d3.scaleLinear().domain(xDomain).range([0, f.w]);
    f.g.append("g").attr("class", "grid").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(5).tickSize(-f.h).tickFormat(""));
    f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
    f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).select(".domain").remove();
    f.g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", f.h).attr("stroke", css("--ink-2"));
    if (xLabel) f.g.append("text").attr("x", f.w).attr("y", f.h + 30).attr("text-anchor", "end").text(xLabel);
    rows.forEach((r) => {
      const vals = series.map((s) => value(r, s)).filter((v) => v != null);
      f.g.append("line").attr("x1", x(d3.min(vals))).attr("x2", x(d3.max(vals))).attr("y1", y(r) + y.bandwidth() / 2)
        .attr("y2", y(r) + y.bandwidth() / 2).attr("stroke", css("--axis")).attr("stroke-width", 2);
      series.forEach((s, i) => {
        const v = value(r, s);
        f.g.append("circle").attr("cx", x(v)).attr("cy", y(r) + y.bandwidth() / 2).attr("r", 6)
          .attr("fill", css(colors[i])).attr("stroke", css("--surface")).attr("stroke-width", 2)
          .on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(r, s) : `<b>${r}</b><br>${s}: ${v}`)).on("mouseleave", hideTip);
      });
    });
  }

  /* ---------- range strip (quantiles) ---------- */
  function ranges(el, { rows, labelW = 70, xLabel, color = "--s1", tipFmt }) {
    const f = frame(el, { height: rows.length * 38 + 46, margin: { left: labelW, right: 40 } });
    const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([0, f.h]).padding(0.35);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.q[4]) * 1.05]).nice().range([0, f.w]);
    f.g.append("g").attr("class", "grid").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(6).tickSize(-f.h).tickFormat(""));
    f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
    f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).select(".domain").remove();
    if (xLabel) f.g.append("text").attr("x", f.w).attr("y", f.h + 30).attr("text-anchor", "end").text(xLabel);
    rows.forEach((r) => {
      const cy = y(r.label) + y.bandwidth() / 2, g = f.g.append("g")
        .on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(r) : `<b>${r.label}</b><br>median ${r.q[2]}`)).on("mouseleave", hideTip);
      g.append("rect").attr("x", x(r.q[0])).attr("y", cy - 1).attr("width", x(r.q[4]) - x(r.q[0])).attr("height", 2).attr("fill", css("--axis"));
      g.append("rect").attr("x", x(r.q[1])).attr("y", cy - 7).attr("width", x(r.q[3]) - x(r.q[1])).attr("height", 14).attr("rx", 4).attr("fill", css(color)).attr("fill-opacity", 0.35);
      g.append("circle").attr("cx", x(r.q[2])).attr("cy", cy).attr("r", 6).attr("fill", css(color)).attr("stroke", css("--surface")).attr("stroke-width", 2);
      g.append("text").attr("x", x(r.q[4]) + 6).attr("y", cy).attr("dy", "0.35em").attr("class", "label-strong").text(r.q[2]);
    });
  }

  /* ---------- force network ---------- */
  function network(el, { nodes, edges, colorOf, radius, tipFmt, height = 440, labelIf }) {
    const f = frame(el, { height, margin: { top: 8, right: 8, bottom: 8, left: 8 } });
    const N = nodes.map((d) => Object.assign({}, d)), E = edges.map((d) => Object.assign({}, d));
    const wmax = d3.max(E, (e) => e.weight);
    const sim = d3.forceSimulation(N)
      .force("link", d3.forceLink(E).id((d) => d.id).distance((e) => 110 - 70 * Math.sqrt(e.weight / wmax)).strength((e) => 0.15 + 0.6 * Math.sqrt(e.weight / wmax)))
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(f.w / 2, f.h / 2))
      .force("collide", d3.forceCollide().radius((d) => radius(d) + 4))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();
    const xe = d3.extent(N, (d) => d.x), ye = d3.extent(N, (d) => d.y);
    const sx = d3.scaleLinear().domain(xe).range([24, f.w - 80]), sy = d3.scaleLinear().domain(ye).range([20, f.h - 20]);
    N.forEach((d) => { d.x = sx(d.x); d.y = sy(d.y); });
    const el2 = f.g.append("g");
    const link = el2.selectAll("line").data(E).join("line")
      .attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y)
      .attr("stroke", css("--axis")).attr("stroke-width", (d) => 0.5 + 3 * Math.sqrt(d.weight / wmax)).attr("stroke-opacity", 0.8);
    const node = el2.selectAll("g.n").data(N).join("g").attr("class", "n").attr("transform", (d) => `translate(${d.x},${d.y})`);
    node.append("circle").attr("r", radius).attr("fill", (d) => css(colorOf(d))).attr("stroke", css("--surface")).attr("stroke-width", 2);
    node.filter((d) => !labelIf || labelIf(d)).append("text").attr("x", (d) => radius(d) + 4).attr("dy", "0.35em").attr("class", "label-strong").style("font-size", "11px").text((d) => d.id);
    node.on("mousemove", (ev, d) => {
      link.attr("stroke", (e) => (e.source === d || e.target === d ? css("--ink-2") : css("--axis")))
        .attr("stroke-opacity", (e) => (e.source === d || e.target === d ? 1 : 0.25));
      showTip(ev, tipFmt(d));
    }).on("mouseleave", () => { link.attr("stroke", css("--axis")).attr("stroke-opacity", 0.8); hideTip(); });
  }

  /* ---------- sortable table ---------- */
  function table(el, { rows, columns }) {
    const root = d3.select(el); root.selectAll("*").remove();
    const t = root.append("div").attr("class", "table-wrap").append("table");
    const head = t.append("thead").append("tr");
    const body = t.append("tbody");
    let sortKey = columns[1].key, dir = -1;
    function render() {
      const sorted = rows.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
      body.selectAll("tr").data(sorted).join("tr").selectAll("td").data((r) => columns.map((c) => (c.fmt ? c.fmt(r[c.key]) : r[c.key])))
        .join("td").text((d) => d);
      head.selectAll("th").attr("aria-sort", (c) => (c.key === sortKey ? (dir > 0 ? "ascending" : "descending") : null));
    }
    head.selectAll("th").data(columns).join("th").text((c) => c.label).attr("scope", "col")
      .on("click", (ev, c) => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = -1; } render(); });
    render();
  }

  /* ---------- forest plot: point estimate + 95% CI per row ---------- */
  function forest(el, { rows, xDomain, ref, xLabel, labelW = 200, tipFmt, xFormat, colorOf, log = false, rowH = 34 }) {
    const f = frame(el, { height: rows.length * rowH + 50, margin: { left: labelW, right: 24, top: 10 } });
    const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([0, f.h]).padding(0.3);
    const x = (log ? d3.scaleLog() : d3.scaleLinear()).domain(xDomain).range([0, f.w]).clamp(true);
    const ticks = log ? x.ticks(5).filter((t) => [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].includes(+t.toPrecision(1))) : x.ticks(5);
    f.g.append("g").attr("class", "grid").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).tickValues(ticks).tickSize(-f.h).tickFormat(""));
    f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).tickValues(ticks).tickSizeOuter(0).tickFormat(xFormat || (log ? d3.format("~g") : null)));
    f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).select(".domain").remove();
    if (ref != null) f.g.append("line").attr("x1", x(ref)).attr("x2", x(ref)).attr("y1", 0).attr("y2", f.h).attr("stroke", css("--ink-2")).attr("stroke-dasharray", "3 3");
    if (xLabel) f.g.append("text").attr("x", f.w).attr("y", f.h + 32).attr("text-anchor", "end").text(xLabel);
    rows.forEach((r) => {
      const cy = y(r.label) + y.bandwidth() / 2, col = css(colorOf ? colorOf(r) : "--s1");
      const g = f.g.append("g").on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(r) : `<b>${r.label}</b>`)).on("mouseleave", hideTip);
      g.append("rect").attr("x", 0).attr("y", y(r.label)).attr("width", f.w).attr("height", y.bandwidth()).attr("fill", "transparent");
      if (r.ci) g.append("line").attr("x1", x(r.ci[0])).attr("x2", x(r.ci[1])).attr("y1", cy).attr("y2", cy).attr("stroke", col).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
      g.append("circle").attr("cx", x(r.est)).attr("cy", cy).attr("r", 6).attr("fill", col).attr("stroke", css("--surface")).attr("stroke-width", 2);
    });
  }

  /* ---------- swimlanes: one row per agent over time ---------- */
  function swimlanes(el, { lanes, xMax, interventions = [], stalls = [], xLabel = "hours →", labelW = 78, rowH = 15, legend = true }) {
    const f = frame(el, { height: lanes.length * rowH + 64, margin: { left: labelW, right: 14, top: 30 } });
    const x = d3.scaleLinear().domain([0, xMax]).range([0, f.w]);
    const y = d3.scaleBand().domain(lanes.map((l) => l.agent)).range([0, f.h]).padding(0.18);
    stalls.forEach(([a, b]) => f.g.append("rect").attr("x", x(a)).attr("width", x(b) - x(a)).attr("y", 0).attr("height", f.h).attr("fill", css("--surface-2")));
    f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(8).tickSizeOuter(0));
    f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(6)).select(".domain").remove();
    f.g.selectAll(".axis text").style("font-size", "11px");
    f.g.append("text").attr("x", f.w).attr("y", f.h + 30).attr("text-anchor", "end").text(xLabel);
    lanes.forEach((l) => {
      const y0 = y(l.agent), bh = y.bandwidth();
      const g = f.g.append("g").on("mousemove", (ev) => showTip(ev, `<b>${l.agent}</b><br>${fmt(l.calls)} model calls` +
        (l.outages && l.outages.length ? `<br>not scheduled: ${l.outages.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} h`).join(", ")}` : "") +
        (l.starved && l.starved.length ? `<br>queue starved: ${l.starved.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} h`).join(", ")}` : "") +
        (l.restarts && l.restarts.length ? `<br>worker restarted at ${l.restarts.map((r) => r.toFixed(2) + " h").join(", ")}` : ""))).on("mouseleave", hideTip);
      g.append("rect").attr("x", 0).attr("y", y0).attr("width", f.w).attr("height", bh).attr("fill", "transparent");
      (l.outages || []).forEach(([a, b]) => g.append("rect").attr("x", x(a)).attr("y", y0).attr("width", Math.max(1, x(b) - x(a))).attr("height", bh).attr("rx", 2).attr("fill", css("--s2")).attr("fill-opacity", 0.85));
      (l.starved || []).forEach(([a, b]) => g.append("rect").attr("x", x(a)).attr("y", y0 + bh * 0.25).attr("width", Math.max(1, x(b) - x(a))).attr("height", bh * 0.5).attr("rx", 2).attr("fill", css("--s3")).attr("fill-opacity", 0.9));
      g.append("path").attr("d", l.ticks.map((t) => `M${x(t).toFixed(1)},${y0 + 1}V${y0 + bh - 1}`).join("")).attr("stroke", css("--s1")).attr("stroke-width", 1).attr("stroke-opacity", 0.55);
      (l.restarts || []).forEach((r) => g.append("path").attr("d", d3.symbol(d3.symbolTriangle, 34)()).attr("transform", `translate(${x(r)},${y0 + bh / 2}) rotate(90)`).attr("fill", css("--ink")));
    });
    interventions.forEach((iv, i) => {
      f.g.append("line").attr("x1", x(iv.h)).attr("x2", x(iv.h)).attr("y1", -6).attr("y2", f.h).attr("stroke", css("--ink-2")).attr("stroke-dasharray", "4 3");
      f.g.append("text").attr("class", "annot").attr("x", x(iv.h) + 4).attr("y", -10 - (i % 2) * 0).attr("text-anchor", i % 2 ? "start" : "end").attr("dx", i % 2 ? 0 : -8).text(iv.short || iv.label);
    });
  }

  /* ---------- small multiples of share-over-time ---------- */
  function multiples(el, { series, xMax, yMax, markers = [], color = "--s1", minW = 200, height = 110, xLabel = "h", yFormat = d3.format(".0%") }) {
    const root = d3.select(el); root.selectAll("*").remove();
    const cols = Math.max(1, Math.floor((el.clientWidth || 600) / minW));
    const grid = root.append("div").attr("class", "multiples").style("grid-template-columns", `repeat(${cols}, 1fr)`);
    const ym = yMax ?? d3.max(series, (s) => d3.max(s.points, (p) => p[1]));
    series.forEach((s) => {
      const cell = grid.append("div").attr("class", "mult");
      cell.append("p").attr("class", "mult-title").html(`${s.topic} <span>${yFormat(s.share)}</span>`);
      if (s.terms) cell.append("p").attr("class", "mult-terms").text(s.terms.join(" · "));
      const box = cell.append("div").node();
      const f = frame(box, { height, minWidth: 120, margin: { top: 6, right: 6, bottom: 20, left: 30 } });
      const x = d3.scaleLinear().domain([0, xMax]).range([0, f.w]);
      const y = d3.scaleLinear().domain([0, ym]).nice().range([f.h, 0]);
      f.g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(2).tickSize(-f.w).tickFormat(""));
      f.g.append("g").attr("class", "axis").attr("transform", `translate(0,${f.h})`).call(d3.axisBottom(x).ticks(4).tickSizeOuter(0).tickFormat((v) => v + xLabel));
      f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(2).tickFormat(yFormat)).select(".domain").remove();
      markers.forEach((m) => f.g.append("line").attr("x1", x(m)).attr("x2", x(m)).attr("y1", 0).attr("y2", f.h).attr("stroke", css("--ink-2")).attr("stroke-dasharray", "3 3"));
      const area = d3.area().x((d) => x(d[0])).y0(f.h).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
      f.g.append("path").attr("d", area(s.points)).attr("fill", css(color)).attr("fill-opacity", 0.22);
      f.g.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX)(s.points)).attr("fill", "none").attr("stroke", css(color)).attr("stroke-width", 1.8);
      f.g.append("rect").attr("width", f.w).attr("height", f.h).attr("fill", "transparent").on("mousemove", (ev) => {
        const xv = x.invert(d3.pointer(ev)[0]);
        const d = s.points.reduce((a, b) => (Math.abs(b[0] - xv) < Math.abs(a[0] - xv) ? b : a));
        showTip(ev, `<b>${s.topic}</b><br>${d[0]} ${xLabel}: ${yFormat(d[1])} of messages`);
      }).on("mouseleave", hideTip);
    });
  }

  /* ---------- heat table: rows × columns, single-hue intensity ---------- */
  function heat(el, { rows, cols, value, label = (r) => r.label, max = 1, labelW = 96, cellH = 20, color = "--s1", tipFmt, valueFmt = d3.format(".0%"), groupOf }) {
    const f = frame(el, { height: rows.length * cellH + 40, margin: { left: labelW, right: 8, top: 34, bottom: 6 } });
    const x = d3.scaleBand().domain(cols).range([0, f.w]).padding(0.06);
    const y = d3.scaleBand().domain(rows.map(label)).range([0, f.h]).padding(0.08);
    f.g.append("g").attr("class", "axis").call(d3.axisTop(x).tickSize(0).tickPadding(6)).select(".domain").remove();
    f.g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickPadding(6)).select(".domain").remove();
    f.g.selectAll(".axis text").style("font-size", "11px");
    rows.forEach((r) => cols.forEach((c, j) => {
      const v = value(r, j);
      const g = f.g.append("g").on("mousemove", (ev) => showTip(ev, tipFmt ? tipFmt(r, j) : `<b>${label(r)}</b><br>${c}: ${valueFmt(v)}`)).on("mouseleave", hideTip);
      g.append("rect").attr("x", x(c)).attr("y", y(label(r))).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 3)
        .attr("fill", css(color)).attr("fill-opacity", v > 0 ? 0.08 + 0.92 * Math.min(1, v / max) : 0.03);
      if (x.bandwidth() > 34 && v > 0) g.append("text").attr("x", x(c) + x.bandwidth() / 2).attr("y", y(label(r)) + y.bandwidth() / 2).attr("dy", "0.35em")
        .attr("text-anchor", "middle").style("font-size", "10px").attr("fill", v / max > 0.55 ? css("--surface") : css("--ink-2")).text(valueFmt(v));
    }));
    if (groupOf) {
      let prev = null;
      rows.forEach((r) => { const gname = groupOf(r); if (prev !== null && gname !== prev) f.g.append("line").attr("x1", -labelW + 4).attr("x2", f.w).attr("y1", y(label(r)) - 1).attr("y2", y(label(r)) - 1).attr("stroke", css("--ink-2")); prev = gname; });
    }
  }

  window.Charts = { line, bars, hbars, histogram, scatter, matrix, dots, ranges, network, table, forest, swimlanes, multiples, heat, css, fmt };

  /* ---------- page plumbing: theme toggle, re-render on resize/theme ---------- */
  const renderers = [];
  window.Charts.register = (fn) => { renderers.push(fn); fn(); };
  const rerender = () => renderers.forEach((fn) => fn());
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(rerender, 150); });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener && mq.addEventListener("change", rerender);
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.querySelector(".theme-btn");
    if (!btn) return;
    let saved = null;
    try { saved = localStorage.getItem("theme"); } catch (e) { /* storage unavailable */ }
    if (saved) document.documentElement.dataset.theme = saved;
    const label = () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : mq.matches;
      btn.textContent = dark ? "Light mode" : "Dark mode";
    };
    label();
    btn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : mq.matches;
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("theme", document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
      label(); rerender();
    });
    document.querySelectorAll(".copy-btn").forEach((b) => b.addEventListener("click", () => {
      const pre = b.closest("pre"); const text = pre.querySelector("code").textContent;
      navigator.clipboard && navigator.clipboard.writeText(text).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
    }));
  });
})();
