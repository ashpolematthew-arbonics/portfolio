// Unsupervised stratification — k-means + X-Means (BIC) on a synthetic 2-band feature space.
(function () {
  const { plotLayout, CONFIG, COLORS, fmt, mulberry32, randn } = PF;
  const PALETTE = ['#4ade80', '#38bdf8', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#34d399', '#fb923c'];

  // --- synthetic Sentinel-2-like pixels: mixture of 4 true land types ---
  const rng = mulberry32(99);
  const TRUE = [
    { mx: -1.6, my: 1.2, bio: 60 },   // sparse shrub
    { mx: 1.4, my: 1.6, bio: 130 },   // young plantation
    { mx: 1.9, my: -1.3, bio: 240 },  // mature conifer
    { mx: -1.2, my: -1.5, bio: 95 },  // mixed broadleaf
  ];
  const M = 340, pts = [];
  for (let i = 0; i < M; i++) {
    const t = TRUE[Math.floor(rng() * TRUE.length)];
    const x = t.mx + 0.62 * randn(rng);
    const y = t.my + 0.62 * randn(rng);
    // biomass correlated with spectral position + noise
    const bio = Math.max(5, t.bio + 22 * (x * 0.3 - y * 0.5) + 14 * randn(rng));
    pts.push({ x, y, bio, k: 0 });
  }

  // standardise features
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y));
  const sx = Math.sqrt(mean(pts.map(p => (p.x - mx) ** 2))), sy = Math.sqrt(mean(pts.map(p => (p.y - my) ** 2)));
  pts.forEach(p => { p.fx = (p.x - mx) / sx; p.fy = (p.y - my) / sy; });

  const bioMean = mean(pts.map(p => p.bio));
  const bioVar = mean(pts.map(p => (p.bio - bioMean) ** 2));

  function kmeans(K, seed) {
    const r = mulberry32(seed);
    // k-means++ init
    const cents = [pts[Math.floor(r() * M)]].map(p => ({ x: p.fx, y: p.fy }));
    while (cents.length < K) {
      const d2 = pts.map(p => Math.min(...cents.map(c => (p.fx - c.x) ** 2 + (p.fy - c.y) ** 2)));
      const sum = d2.reduce((a, b) => a + b, 0);
      let thr = r() * sum, idx = 0;
      for (let i = 0; i < M; i++) { thr -= d2[i]; if (thr <= 0) { idx = i; break; } }
      cents.push({ x: pts[idx].fx, y: pts[idx].fy });
    }
    let assign = new Array(M).fill(0);
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < M; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < K; c++) {
          const dd = (pts[i].fx - cents[c].x) ** 2 + (pts[i].fy - cents[c].y) ** 2;
          if (dd < bd) { bd = dd; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      for (let c = 0; c < K; c++) {
        const mem = pts.filter((_, i) => assign[i] === c);
        if (mem.length) { cents[c].x = mean(mem.map(p => p.fx)); cents[c].y = mean(mem.map(p => p.fy)); }
      }
      if (!moved) break;
    }
    // inertia (feature space)
    let inertia = 0;
    for (let i = 0; i < M; i++) inertia += (pts[i].fx - cents[assign[i]].x) ** 2 + (pts[i].fy - cents[assign[i]].y) ** 2;
    return { assign, cents, inertia };
  }

  // Pelleg-Moore BIC for k-means (maximise). d = 2 features.
  function bic(K, res) {
    const d = 2;
    const sizes = Array(K).fill(0);
    res.assign.forEach(a => sizes[a]++);
    const sigma2 = res.inertia / (d * Math.max(1, M - K));
    if (sigma2 <= 0) return -Infinity;
    let L = 0;
    for (let c = 0; c < K; c++) {
      const n = sizes[c]; if (!n) continue;
      L += -n * d / 2 * Math.log(2 * Math.PI * sigma2) - (n - K) / 2 + n * Math.log(n) - n * Math.log(M);
    }
    const p = K * (d + 1);
    return L - p / 2 * Math.log(M);
  }

  // precompute BIC across k for X-Means
  const KBIC = [];
  for (let K = 1; K <= 8; K++) KBIC.push({ K, bic: bic(K, kmeans(K, 7)) });
  const autoK = KBIC.reduce((a, b) => (b.bic > a.bic ? b : a)).K;

  const state = { k: 4, showCent: true };

  function metrics(res, K) {
    const sizes = Array(K).fill(0), sums = Array(K).fill(0);
    res.assign.forEach((a, i) => { sizes[a]++; sums[a] += pts[i].bio; });
    const cMean = sums.map((s, c) => sizes[c] ? s / sizes[c] : 0);
    let within = 0;
    res.assign.forEach((a, i) => { within += (pts[i].bio - cMean[a]) ** 2; });
    within /= M;                                   // pooled within-stratum variance
    const r2 = 1 - within / bioVar;
    const globalCV = Math.sqrt(bioVar) / bioMean;
    const withinCV = Math.sqrt(within) / bioMean;
    const plotsRatio = (withinCV / globalCV) ** 2;  // plots ∝ CV²
    return { r2, globalCV, withinCV, plotsRatio };
  }

  function render() {
    const K = state.k;
    const res = kmeans(K, 7);
    const m = metrics(res, K);

    // scatter coloured by cluster
    const traces = [];
    for (let c = 0; c < K; c++) {
      const mem = pts.filter((_, i) => res.assign[i] === c);
      traces.push({
        x: mem.map(p => p.x), y: mem.map(p => p.y), mode: 'markers', type: 'scatter',
        name: 'stratum ' + (c + 1), marker: { color: PALETTE[c % PALETTE.length], size: 7, opacity: 0.8 },
        hovertemplate: 'biomass %{customdata:.0f} t/ha<extra>stratum ' + (c + 1) + '</extra>',
        customdata: mem.map(p => p.bio),
      });
    }
    if (state.showCent) {
      traces.push({
        x: res.cents.map(c => c.x * sx + mx), y: res.cents.map(c => c.y * sy + my),
        mode: 'markers', type: 'scatter', name: 'centroids',
        marker: { color: '#fff', size: 13, symbol: 'x', line: { width: 2 } },
      });
    }
    Plotly.react('scatter', traces, plotLayout({
      margin: { l: 55, r: 15, t: 30, b: 45 },
      title: { text: 'Pixels in spectral feature space (k = ' + K + ')', font: { size: 14 }, x: 0.01 },
      xaxis: { title: 'Band index 1', gridcolor: COLORS.grid },
      yaxis: { title: 'Band index 2', gridcolor: COLORS.grid },
      legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
    }), CONFIG);

    Plotly.react('bic', [
      { x: KBIC.map(d => d.K), y: KBIC.map(d => d.bic), mode: 'lines+markers', name: 'BIC',
        line: { color: COLORS.accent2, width: 2.5 }, marker: { size: 7 } },
      { x: [autoK], y: [KBIC[autoK - 1].bic], mode: 'markers', name: 'X-Means pick',
        marker: { color: COLORS.warn, size: 14, symbol: 'star' } },
      { x: [K], y: [KBIC[K - 1].bic], mode: 'markers', name: 'current k',
        marker: { color: COLORS.accent, size: 11, symbol: 'circle-open', line: { width: 2 } } },
    ], plotLayout({
      margin: { l: 60, r: 15, t: 30, b: 42 },
      title: { text: 'X-Means model selection — BIC vs k (peak = best)', font: { size: 13 }, x: 0.01 },
      xaxis: { title: 'k (number of strata)', gridcolor: COLORS.grid, dtick: 1 },
      yaxis: { title: 'BIC', gridcolor: COLORS.grid },
      legend: { orientation: 'h', y: -0.25, font: { size: 11 } },
    }), CONFIG);

    document.getElementById('cR2').textContent = fmt(Math.max(0, m.r2) * 100, 0) + '%';
    document.getElementById('cGlobal').textContent = fmt(m.globalCV * 100, 1) + '%';
    document.getElementById('cWithin').textContent = fmt(m.withinCV * 100, 1) + '%';
    const fewer = (1 - m.plotsRatio) * 100;
    document.getElementById('cPlots').textContent = (fewer >= 0 ? '−' : '+') + fmt(Math.abs(fewer), 0) + '%';
  }

  PF.bindRange('k', 'kV', () => { state.k = +document.getElementById('k').value; render(); });
  document.getElementById('showCent').addEventListener('change', e => { state.showCent = e.target.checked; render(); });
  document.getElementById('autok').addEventListener('click', () => {
    document.getElementById('k').value = autoK;
    document.getElementById('kV').textContent = autoK;
    state.k = autoK; render();
  });
  render();
})();
