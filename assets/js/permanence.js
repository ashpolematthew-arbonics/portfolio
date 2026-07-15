// Permanence & bark-beetle risk — real Sentinel-2 detection + Monte-Carlo buffer model.
(function () {
  const { plotLayout, CONFIG, COLORS, fmt, mulberry32 } = PF;
  const D = window.BARK_BEETLE;
  if (!D) { document.getElementById('eostats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  // ---------- Section 1: EO map + stats + time series ----------
  const b = D.bbox; // [W,S,E,N]
  const BOUNDS = [[b[1], b[0]], [b[3], b[2]]];
  const map = L.map('map', { scrollWheelZoom: true }).fitBounds(BOUNDS);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 17 }).addTo(map);
  const overlay = L.imageOverlay('../assets/img/beetle_class.png', BOUNDS, { opacity: 0.85 }).addTo(map);
  L.rectangle(BOUNDS, { color: '#fbbf24', weight: 1.5, fill: false, dashArray: '5 4' }).addTo(map);
  PF.bindRange('op', 'opV', () => overlay.setOpacity(+document.getElementById('op').value / 100), ' %');

  const sp = D.stage_pct;
  document.getElementById('eostats').innerHTML = [
    ['Canopy affected', D.affected_pct + '%', 'of ' + fmt(D.forest_ha) + ' ha spruce'],
    ['Grey / dead', sp[3] + '%', 'already lost'],
    ['Green + yellow', (sp[1] + sp[2]).toFixed(1) + '%', 'active attack'],
    ['Detection', D.detect_year, 'vs ' + D.baseline_year + ' baseline'],
  ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${s}</div></div>`).join('');

  const T = D.timeseries;
  Plotly.newPlot('ts', [
    { x: T.years, y: T.healthy, mode: 'lines+markers', name: 'Healthy spruce',
      line: { color: COLORS.accent, width: 2.5 }, marker: { size: 6 }, hovertemplate: 'CIre %{y}<extra>healthy %{x}</extra>' },
    { x: T.years, y: T.infested, mode: 'lines+markers', name: 'Beetle-killed cohort',
      line: { color: '#f87171', width: 2.5 }, marker: { size: 6 }, hovertemplate: 'CIre %{y}<extra>infested %{x}</extra>' },
  ], plotLayout({
    margin: { l: 55, r: 15, t: 40, b: 55 },
    title: { text: 'Chlorophyll index (CIre) — the reversal seen from orbit', font: { size: 13 }, x: 0.01, y: 0.97, yanchor: 'top' },
    xaxis: { title: 'Year', gridcolor: COLORS.grid, dtick: 1 },
    yaxis: { title: 'CIre (canopy chlorophyll)', gridcolor: COLORS.grid },
    legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
  }), CONFIG);

  // ---------- Section 2: composite risk + Monte-Carlo buffer ----------
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const state = { pct: 28, sf: 0.8, age: 70, vpd: 0.4, wt: false, yrs: 40 };

  function compositeRisk() {
    // faithful to _composite_risk_score in bark_beetle_eo.py
    const eo_cire = clamp(-D.cire_z_mean / 5, 0, 1);
    const eo_pct = clamp(state.pct / 100, 0, 1);
    const eo = 0.6 * eo_cire + 0.4 * eo_pct;
    const age_factor = state.age > 60 ? 1.5 : 1.0;
    const wt = state.wt ? 3.0 : 1.0;
    const stand_risk = state.sf * age_factor * wt * (1 + state.vpd);
    const stand = clamp(stand_risk / 9, 0, 1);
    return { risk: 0.5 * eo + 0.5 * stand, eo, stand };
  }

  function simulate() {
    const { risk } = compositeRisk();
    const p = 0.005 + risk * 0.06;         // annual disturbance hazard 0.5%..~6.5%
    const T = state.yrs, M = 2000, rng = mulberry32(42);
    const meanLoss = new Array(T + 1).fill(0);
    const allYear = Array.from({ length: T + 1 }, () => []);
    const finals = [];
    for (let m = 0; m < M; m++) {
      let remaining = 1;
      for (let t = 1; t <= T; t++) {
        if (rng() < p) remaining *= (1 - (0.3 + 0.6 * rng()));  // lose 30-90%
        const loss = 1 - remaining;
        meanLoss[t] += loss;
        allYear[t].push(loss);
      }
      finals.push(1 - remaining);
    }
    for (let t = 1; t <= T; t++) meanLoss[t] /= M;
    const p95 = new Array(T + 1).fill(0);
    for (let t = 1; t <= T; t++) {
      const s = allYear[t].sort((a, b) => a - b);
      p95[t] = s[Math.floor(s.length * 0.95)];
    }
    finals.sort((a, b) => a - b);
    return {
      risk, p, T,
      meanLoss, p95,
      expected: meanLoss[T],
      buffer: finals[Math.floor(finals.length * 0.95)],
      finals,
    };
  }

  function render() {
    const s = simulate();
    const years = Array.from({ length: s.T + 1 }, (_, i) => i);

    document.getElementById('bufstats').innerHTML = [
      ['Composite risk', fmt(s.risk, 2), '0–1 scale'],
      ['Annual reversal', fmt(s.p * 100, 1) + '%', 'disturbance hazard'],
      ['Expected reversal', fmt(s.expected * 100, 0) + '%', 'mean over ' + s.T + ' yr'],
      ['Buffer pool', fmt(s.buffer * 100, 0) + '%', 'covers 95% of futures'],
    ].map(([k, v, sub], i) => `<div class="stat"><div class="k">${k}</div><div class="v ${i === 3 ? '' : 'small'}">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`).join('');

    Plotly.react('buffer', [
      { x: years, y: s.p95.map(v => v * 100), mode: 'lines', name: '95th percentile',
        line: { color: '#f87171', width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: years, y: s.meanLoss.map(v => v * 100), mode: 'lines', name: 'Expected reversal',
        line: { color: COLORS.accent, width: 3 }, fill: 'tonexty', fillcolor: 'rgba(248,113,113,0.12)',
        hovertemplate: '%{y:.1f}%<extra>yr %{x}</extra>' },
      { x: years, y: s.p95.map(v => v * 100), mode: 'lines', name: '95th percentile (buffer)',
        line: { color: '#f87171', width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.1f}%<extra>P95 yr %{x}</extra>' },
    ], plotLayout({
      margin: { l: 55, r: 15, t: 40, b: 50 },
      title: { text: 'Cumulative reversal risk over the crediting period', font: { size: 13 }, x: 0.01, y: 0.97, yanchor: 'top' },
      xaxis: { title: 'Project year', gridcolor: COLORS.grid },
      yaxis: { title: 'Stock reversed (%)', gridcolor: COLORS.grid, rangemode: 'tozero' },
      legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
    }), CONFIG);

    // distribution of final cumulative loss
    const bins = 20, hmax = Math.max(0.01, s.finals[s.finals.length - 1]);
    const edges = Array.from({ length: bins + 1 }, (_, i) => i / bins * hmax);
    const counts = new Array(bins).fill(0);
    s.finals.forEach(v => { const bi = Math.min(bins - 1, Math.floor(v / hmax * bins)); counts[bi]++; });
    Plotly.react('dist', [{
      x: edges.slice(0, bins).map((e, i) => ((e + edges[i + 1]) / 2 * 100)),
      y: counts, type: 'bar', marker: { color: COLORS.accent2 },
      hovertemplate: '%{y} of 2000 sims<extra>%{x:.0f}% loss</extra>',
    }], plotLayout({
      margin: { l: 55, r: 15, t: 40, b: 48 }, showlegend: false, bargap: 0.02,
      title: { text: 'Distribution of ' + s.T + '-yr reversal across 2,000 simulated projects', font: { size: 12.5 }, x: 0.01, y: 0.98, yanchor: 'top' },
      xaxis: { title: 'Cumulative stock reversed (%)', gridcolor: COLORS.grid },
      yaxis: { title: 'Simulations', gridcolor: COLORS.grid },
      shapes: [{ type: 'line', x0: s.buffer * 100, x1: s.buffer * 100, yref: 'paper', y0: 0, y1: 1,
        line: { color: '#f87171', width: 2, dash: 'dash' } }],
      annotations: [{ x: s.buffer * 100, y: 1, yref: 'paper', text: 'buffer (P95)', showarrow: false,
        font: { size: 10, color: '#f87171' }, xanchor: 'left' }],
    }), CONFIG);
  }

  PF.bindRange('pct', 'pctV', () => { state.pct = +document.getElementById('pct').value; render(); }, ' %');
  PF.bindRange('sf', 'sfV', () => { state.sf = +document.getElementById('sf').value / 100; render(); }, ' %');
  PF.bindRange('age', 'ageV', () => { state.age = +document.getElementById('age').value; render(); }, ' yr');
  PF.bindRange('vpd', 'vpdV', () => {
    state.vpd = +document.getElementById('vpd').value / 100;
    document.getElementById('vpdV').textContent = state.vpd.toFixed(2);
    render();
  });
  PF.bindRange('yrs', 'yrsV', () => { state.yrs = +document.getElementById('yrs').value; render(); }, ' yr');
  document.getElementById('wt').addEventListener('change', e => { state.wt = e.target.checked; render(); });

  render();
})();
