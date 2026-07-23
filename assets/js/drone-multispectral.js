// Multispectral drone analysis — DJI Mavic 3M, northern Ghana. Image-space viewer.
(function () {
  const { fmt } = PF;
  const D = window.DRONE_MS;
  if (!D) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const TREE = 1, SHRUB = 2, OPEN = 3;
  const W = D.w, H = D.h, GX = D.gx, GY = D.gy, grid = D.grid, dist = D.dist, N = GX * GY;
  const IMG = '../assets/img/';
  const LAYER_IMG = { rgb: 'ghana_rgb.jpg', ndvi: 'ghana_ndvi.jpg', ndre: 'ghana_ndre.jpg', class: 'ghana_class.png', tillage: 'ghana_tillage.jpg' };

  const state = { layer: 'rgb', op: 0.85, crowns: false, set: 4, min: 0.02 };

  // ---- CRS.Simple image map ----
  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
  const bounds = [[0, 0], [H, W]];
  const rgbBase = L.imageOverlay(IMG + 'ghana_rgb.jpg', bounds).addTo(map);
  const topImg = L.imageOverlay('', bounds, { className: 'px-crisp', opacity: state.op });
  const suitCanvas = document.createElement('canvas'); suitCanvas.width = GX; suitCanvas.height = GY;
  const suitCtx = suitCanvas.getContext('2d');
  const suitOverlay = L.imageOverlay('', bounds, { className: 'px-crisp', opacity: state.op });
  const crownCanvas = document.createElement('canvas'); crownCanvas.width = W; crownCanvas.height = H;
  const crownCtx = crownCanvas.getContext('2d');
  const crownOverlay = L.imageOverlay('', bounds);
  map.fitBounds(bounds); map.setMaxBounds(bounds);

  // draw crowns once
  crownCtx.clearRect(0, 0, W, H);
  crownCtx.strokeStyle = 'rgba(255,240,60,0.95)'; crownCtx.lineWidth = 2;
  D.crowns.forEach(c => { crownCtx.beginPath(); crownCtx.arc(c.x, c.y, Math.max(3, c.r), 0, 2 * Math.PI); crownCtx.stroke(); });
  crownOverlay.setUrl(crownCanvas.toDataURL());

  function computeEligible() {
    const elig = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      let ok = grid[i] === OPEN;
      if (ok && state.set > 0 && dist[i] < state.set) ok = false;
      elig[i] = ok ? 1 : 0;
    }
    if (state.min > 0) {
      const minCells = state.min / D.cell_ha, seen = new Uint8Array(N), stack = [];
      for (let i = 0; i < N; i++) {
        if (!elig[i] || seen[i]) continue;
        stack.length = 0; stack.push(i); seen[i] = 1; const comp = [i];
        while (stack.length) {
          const p = stack.pop(), r = (p / GX) | 0, c = p % GX, nb = [];
          if (c > 0) nb.push(p - 1); if (c < GX - 1) nb.push(p + 1);
          if (r > 0) nb.push(p - GX); if (r < GY - 1) nb.push(p + GX);
          for (const q of nb) if (elig[q] && !seen[q]) { seen[q] = 1; stack.push(q); comp.push(q); }
        }
        if (comp.length < minCells) for (const q of comp) elig[q] = 0;
      }
    }
    return elig;
  }

  function renderSuit() {
    const elig = computeEligible();
    const im = suitCtx.createImageData(GX, GY);
    let n = 0;
    for (let i = 0; i < N; i++) {
      let col = [0, 0, 0], a = 0;
      if (elig[i]) { col = [74, 222, 128]; a = 235; n++; }
      else if (grid[i] === TREE) { col = [26, 102, 46]; a = 220; }
      else if (grid[i] === SHRUB) { col = [120, 190, 90]; a = 210; }
      else { col = [248, 113, 113]; a = 180; }   // open but excluded (setback/min-block)
      const j = i * 4; im.data[j] = col[0]; im.data[j + 1] = col[1]; im.data[j + 2] = col[2]; im.data[j + 3] = a;
    }
    suitCtx.putImageData(im, 0, 0); suitOverlay.setUrl(suitCanvas.toDataURL());
    return n * D.cell_ha;
  }

  function apply() {
    // base layers
    if (state.layer === 'rgb' || state.layer === 'suit') {
      if (map.hasLayer(topImg)) map.removeLayer(topImg);
    } else {
      topImg.setUrl(IMG + LAYER_IMG[state.layer]); topImg.setOpacity(state.op);
      if (!map.hasLayer(topImg)) topImg.addTo(map);
    }
    let eligHa = null;
    if (state.layer === 'suit') { eligHa = renderSuit(); suitOverlay.setOpacity(state.op); if (!map.hasLayer(suitOverlay)) suitOverlay.addTo(map); }
    else if (map.hasLayer(suitOverlay)) map.removeLayer(suitOverlay);
    // crowns on top
    if (state.crowns) { if (!map.hasLayer(crownOverlay)) crownOverlay.addTo(map); crownOverlay.bringToFront(); }
    else if (map.hasLayer(crownOverlay)) map.removeLayer(crownOverlay);
    renderStats(eligHa); renderLegend();
  }

  function renderStats(eligHa) {
    if (eligHa == null) { const e = computeEligible(); let n = 0; for (let i = 0; i < N; i++) n += e[i]; eligHa = n * D.cell_ha; }
    const s = D.stats;
    const seq = eligHa * 4.5 * 20; // ~4.5 tCO2e/ha/yr agroforestry, 20 yr
    document.getElementById('stats').innerHTML = [
      ['Area imaged', fmt(s.area_ha, 2) + ' ha', s.gsd_cm + ' cm GSD'],
      ['Canopy cover', s.canopy_cover_pct + '%', 'woody, NDVI-derived'],
      ['Tree crowns', fmt(s.n_crowns), fmt(s.tree_density_ha) + ' / ha'],
      ['Eligible to plant', fmt(eligHa, 2) + ' ha', fmt(eligHa / s.area_ha * 100, 0) + '% of frame'],
      ['Ex-ante potential', fmt(seq) + '', 'tCO₂e over 20 yr'],
    ].map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`).join('');
  }

  function renderLegend() {
    const el = document.getElementById('legend');
    if (state.layer === 'class') el.innerHTML = [['#1a662e', 'Tree crown'], ['#78be5a', 'Shrub / woody'], ['#ceb284', 'Open ground']].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    else if (state.layer === 'suit') el.innerHTML = [['#4ade80', 'Eligible to plant'], ['#1a662e', 'Tree'], ['#78be5a', 'Shrub'], ['#f87171', 'Excluded']].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    else if (state.layer === 'ndvi') el.innerHTML = '<span>NDVI: <i style="background:#a50026"></i>low → <i style="background:#006837"></i>high vegetation</span>';
    else if (state.layer === 'ndre') el.innerHTML = '<span>NDRE (red-edge): <i style="background:#440154"></i>low → <i style="background:#fde725"></i>high canopy</span>';
    else if (state.layer === 'tillage') el.innerHTML = '<span>Tillage index: <i style="background:#000004"></i>random → <i style="background:#fcfdbf"></i>furrow-like</span>';
    else el.innerHTML = '<span class="muted">True-colour RGB orthophoto</span>';
  }

  PF.bindSeg('layer', v => { state.layer = v; apply(); });
  PF.bindRange('op', 'opV', () => { state.op = +document.getElementById('op').value / 100; apply(); }, ' %');
  PF.bindRange('set', 'setV', () => { state.set = +document.getElementById('set').value; apply(); }, ' m');
  PF.bindRange('min', 'minV', () => {
    state.min = +document.getElementById('min').value / 100;
    document.getElementById('minV').textContent = state.min.toFixed(2) + ' ha';
    apply();
  });
  document.getElementById('crowns').addEventListener('change', e => { state.crowns = e.target.checked; apply(); });

  document.getElementById('ncr').textContent = D.stats.n_crowns;
  document.getElementById('cd').textContent = D.stats.mean_crown_diam_m;
  apply();
})();
