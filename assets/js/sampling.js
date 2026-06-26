// Stratification & plot sampling — stratified Neyman sizing + VCS uncertainty deduction
(function () {
  const { plotLayout, CONFIG, COLORS, fmt } = PF;

  // editable strata
  const STRATA = [
    { name: 'Young plantation', area: 420, cv: 35 },
    { name: 'Mature conifer',   area: 760, cv: 22 },
    { name: 'Mixed broadleaf',  area: 310, cv: 48 },
  ];
  const Z = { '90': 1.645, '95': 1.960 };
  const state = { conf: '90', err: 10, ps: 0.04 };
  const PS_VALUES = [0, .01, .02, .03, .04, .05, .06, .07, .08, .09, .10];

  // build strata inputs
  const wrap = document.getElementById('strata');
  STRATA.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'ctl';
    row.innerHTML = `
      <label>${s.name}</label>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <span class="muted" style="font-size:11px">Area (ha)</span>
          <input type="number" id="area${i}" value="${s.area}" min="1" step="10" />
        </div>
        <div style="flex:1">
          <span class="muted" style="font-size:11px">CV (%)</span>
          <input type="number" id="cv${i}" value="${s.cv}" min="1" max="120" step="1" />
        </div>
      </div>`;
    wrap.appendChild(row);
    row.querySelector(`#area${i}`).addEventListener('input', render);
    row.querySelector(`#cv${i}`).addEventListener('input', render);
  });

  function readStrata() {
    return STRATA.map((s, i) => ({
      name: s.name,
      area: Math.max(1, +document.getElementById('area' + i).value || 1),
      cv: Math.max(0.1, +document.getElementById('cv' + i).value || 1) / 100,
    }));
  }

  const REF_PLOT = 0.04; // ha: plot size at which entered CV holds

  function compute() {
    const strata = readStrata();
    const t = Z[state.conf], E = state.err / 100;
    const totalArea = strata.reduce((a, s) => a + s.area, 0);
    const W = strata.map(s => s.area / totalArea);

    // larger plots aggregate more trees → lower CV (variance of a mean ∝ 1/area)
    const cvScale = Math.sqrt(REF_PLOT / state.ps);
    const cv = strata.map(s => s.cv * cvScale);

    const sumWcv = strata.reduce((a, s, i) => a + W[i] * cv[i], 0);          // Σ Wh CVh
    const sumWcv2 = strata.reduce((a, s, i) => a + W[i] * cv[i] * cv[i], 0); // Σ Wh CVh²

    const nStrat = Math.ceil((t / E) ** 2 * sumWcv ** 2);
    const cvPooled = Math.sqrt(sumWcv2);
    const nSRS = Math.ceil((t / E) ** 2 * cvPooled ** 2);

    // Neyman allocation
    const alloc = strata.map((s, i) => Math.max(1, Math.round(nStrat * (W[i] * cv[i]) / sumWcv)));
    const nAlloc = alloc.reduce((a, b) => a + b, 0);

    // Achieved uncertainty at nAlloc plots, expressed at 90% CI
    const t90 = Z['90'];
    const uncAt = n => t90 * sumWcv / Math.sqrt(n) * 100; // %
    const unc = uncAt(nAlloc);
    const deduction = Math.max(0, unc - 10); // VCS: excess over 10% half-width

    const areaSampled = nAlloc * state.ps;
    return { strata, alloc, nStrat, nSRS, nAlloc, unc, deduction, sumWcv, t90, uncAt, areaSampled };
  }

  function render() {
    const d = compute();

    Plotly.react('alloc', [{
      x: d.strata.map(s => s.name), y: d.alloc, type: 'bar',
      marker: { color: [COLORS.accent, COLORS.accent2, COLORS.warn] },
      text: d.alloc.map(v => v + ' plots'), textposition: 'auto',
      hovertemplate: '%{y} plots<extra>%{x}</extra>',
    }], plotLayout({
      margin: { l: 50, r: 15, t: 30, b: 50 }, showlegend: false,
      title: { text: 'Plot allocation across strata (Neyman optimal)', font: { size: 14 }, x: 0.01 },
      yaxis: { title: 'Plots', gridcolor: COLORS.grid },
    }), CONFIG);

    // uncertainty vs n curve
    const nmax = Math.max(d.nAlloc * 2, 60);
    const xs = [], ys = [];
    for (let n = 5; n <= nmax; n++) { xs.push(n); ys.push(d.uncAt(n)); }
    Plotly.react('curve', [
      { x: xs, y: ys, mode: 'lines', name: 'uncertainty', line: { color: COLORS.accent, width: 2.5 },
        hovertemplate: '%{y:.1f}% @ n=%{x}<extra></extra>' },
      { x: [d.nAlloc], y: [d.unc], mode: 'markers', name: 'your design',
        marker: { color: COLORS.warn, size: 12, symbol: 'star' } },
      { x: [5, nmax], y: [10, 10], mode: 'lines', name: 'VCS 10% threshold',
        line: { color: COLORS.danger, width: 1.5, dash: 'dash' } },
    ], plotLayout({
      margin: { l: 55, r: 15, t: 30, b: 45 },
      title: { text: '90% CI uncertainty vs sample size', font: { size: 14 }, x: 0.01 },
      xaxis: { title: 'Number of plots', gridcolor: COLORS.grid },
      yaxis: { title: 'Uncertainty (%)', gridcolor: COLORS.grid, rangemode: 'tozero' },
    }), CONFIG);

    document.getElementById('sN').textContent = d.nAlloc;
    const saved = d.nSRS - d.nAlloc;
    document.getElementById('sSRS').textContent = (saved >= 0 ? '−' : '+') + Math.abs(saved);
    document.getElementById('sSamp').textContent = fmt(d.areaSampled, 1) + ' ha';
    document.getElementById('sUnc').textContent = fmt(d.unc, 1) + '%';
    document.getElementById('sDed').textContent = d.deduction <= 0 ? 'none' : '−' + fmt(d.deduction, 1) + '%';
    document.getElementById('sDed').style.color = d.deduction <= 0 ? COLORS.accent : COLORS.warn;
  }

  PF.bindSeg('conf', v => { state.conf = v; render(); });
  PF.bindRange('err', 'errV', () => { state.err = +document.getElementById('err').value; render(); }, ' %');
  PF.bindRange('ps', 'psV', () => {
    state.ps = PS_VALUES[+document.getElementById('ps').value];
    document.getElementById('psV').textContent = state.ps.toFixed(2) + ' ha';
    render();
  });
  render();
})();
