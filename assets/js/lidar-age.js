// Tree age from LiDAR — synthetic CHM, local-maxima crown detection, height-age inversion
(function () {
  const { plotLayout, CONFIG, COLORS, fmt, mulberry32, randn, percentile } = PF;

  const SPECIES = {
    pine:   { k: 0.030, p: 1.4 },
    spruce: { k: 0.035, p: 1.5 },
    birch:  { k: 0.050, p: 1.3 },
  };
  const BASE = 50;             // base age for site index
  const N = 64;                // grid size
  const state = { species: 'pine', si: 24, thr: 5, showCrowns: true };

  // --- Build synthetic CHM once (heights are "measured", independent of SI) ---
  const rng = mulberry32(7);
  const trees = [];
  const nTrees = 95;
  for (let i = 0; i < nTrees; i++) {
    const h = Math.max(2.5, 19 + 4.2 * randn(rng));   // mean ~19 m, even-aged stand
    trees.push({ x: rng() * (N - 6) + 3, y: rng() * (N - 6) + 3, h, r: 1.4 + h * 0.07 });
  }
  // rasterise: each cell = max over tree Gaussian bumps + ground noise
  const CHM = [];
  for (let yy = 0; yy < N; yy++) {
    const row = [];
    for (let xx = 0; xx < N; xx++) {
      let v = 0.4 * Math.abs(randn(rng));   // understorey / noise
      for (const t of trees) {
        const d2 = (xx - t.x) ** 2 + (yy - t.y) ** 2;
        const bump = t.h * Math.exp(-d2 / (2 * t.r * t.r));
        if (bump > v) v = bump;
      }
      row.push(v);
    }
    CHM.push(row);
  }

  // --- Crown detection: local maxima above threshold ---
  function detectCrowns(thr) {
    const crowns = [];
    for (let yy = 1; yy < N - 1; yy++) {
      for (let xx = 1; xx < N - 1; xx++) {
        const v = CHM[yy][xx];
        if (v < thr) continue;
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (CHM[yy + dy][xx + dx] > v) { isMax = false; break; }
          }
        if (isMax) crowns.push({ x: xx, y: yy, h: v });
      }
    }
    return crowns;
  }

  // --- Height-age inversion ---
  function ageFromHeight(h, sp, si) {
    const { k, p } = SPECIES[sp];
    const Hmax = si / Math.pow(1 - Math.exp(-k * BASE), p);   // anchor: H(BASE)=si
    const ratio = Math.min(0.999, h / Hmax);
    const age = -Math.log(1 - Math.pow(ratio, 1 / p)) / k;
    return { age: Math.max(0, age), Hmax };
  }

  function render() {
    const crowns = detectCrowns(state.thr);
    const heights = crowns.map(c => c.h).sort((a, b) => a - b);
    const topH = heights.length ? percentile(heights, 0.95) : 0;
    const { age: standAge, Hmax } = ageFromHeight(topH, state.species, state.si);

    // CHM heatmap
    const data = [{
      z: CHM, type: 'heatmap', colorscale: [
        [0, '#0c1410'], [0.25, '#15402b'], [0.5, '#1f7a45'], [0.75, '#4ade80'], [1, '#eaffd0'],
      ], colorbar: { title: 'm', thickness: 12, len: 0.8 }, hovertemplate: 'h=%{z:.1f} m<extra></extra>',
    }];
    if (state.showCrowns) {
      data.push({
        x: crowns.map(c => c.x), y: crowns.map(c => c.y), mode: 'markers', type: 'scatter',
        marker: { symbol: 'circle-open', color: '#fff', size: 7, line: { width: 1.4 } },
        name: 'crown', hovertemplate: 'crown %{customdata:.1f} m<extra></extra>',
        customdata: crowns.map(c => c.h),
      });
    }
    Plotly.react('chm', data, plotLayout({
      margin: { l: 30, r: 10, t: 28, b: 30 }, showlegend: false,
      title: { text: 'Canopy Height Model (1 ha)', font: { size: 14 }, x: 0.01 },
      xaxis: { visible: false, scaleanchor: 'y' }, yaxis: { visible: false },
    }), CONFIG);

    // Height-age curve + detected crowns plotted at their inferred age
    const { k, p } = SPECIES[state.species];
    const ages = Array.from({ length: 81 }, (_, i) => i);
    const curveH = ages.map(a => Hmax * Math.pow(1 - Math.exp(-k * a), p));
    const ptAges = crowns.map(c => ageFromHeight(c.h, state.species, state.si).age);

    Plotly.react('curve', [
      { x: ages, y: curveH, mode: 'lines', name: 'site-index curve', line: { color: COLORS.accent2, width: 2.5 } },
      { x: ptAges, y: crowns.map(c => c.h), mode: 'markers', name: 'detected crowns',
        marker: { color: COLORS.accent, size: 6, opacity: 0.7 }, hovertemplate: '%{y:.1f} m @ ~%{x:.0f} yr<extra></extra>' },
      { x: [standAge], y: [topH], mode: 'markers', name: 'stand (top height)',
        marker: { color: COLORS.warn, size: 13, symbol: 'star' } },
    ], plotLayout({
      margin: { l: 55, r: 15, t: 10, b: 45 },
      xaxis: { title: 'Age (yr)', range: [0, 80], gridcolor: COLORS.grid },
      yaxis: { title: 'Height (m)', gridcolor: COLORS.grid },
    }), CONFIG);

    document.getElementById('sN').textContent = crowns.length;
    document.getElementById('sTop').textContent = fmt(topH, 1) + ' m';
    document.getElementById('sAge').textContent = '~' + fmt(standAge, 0) + ' yr';
    document.getElementById('sDens').textContent = fmt(crowns.length);   // 1 ha grid
  }

  PF.bindSeg('species', v => { state.species = v; render(); });
  PF.bindRange('si', 'siV', () => { state.si = +document.getElementById('si').value; render(); }, ' m');
  PF.bindRange('thr', 'thrV', () => { state.thr = +document.getElementById('thr').value; render(); }, ' m');
  document.getElementById('showCrowns').addEventListener('change', e => { state.showCrowns = e.target.checked; render(); });
  render();
})();
