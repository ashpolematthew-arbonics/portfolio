// Drone site eligibility — real UAV orthomosaic (OpenAerialMap) classified & screened.
(function () {
  const { fmt } = PF;
  const D = window.DRONE_ELIG;
  if (!D) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const NODATA = 0, TREE = 1, HERB = 2, BARE = 3, WATER = 4;
  const GX = D.gx, GY = D.gy, grid = D.grid, dist = D.dist, N = GX * GY;
  const b = D.bbox;                       // [W,S,E,N]
  const BOUNDS = [[b[1], b[0]], [b[3], b[2]]];
  const CLASS_COL = { [TREE]: [34, 139, 34], [HERB]: [163, 230, 53], [BARE]: [214, 178, 120], [WATER]: [56, 120, 200] };

  const state = { mode: 'elig', op: 0.75, set: 10, min: 0.3, bare: true };

  // ---- map: OAM drone imagery basemap + Esri fallback ----
  const map = L.map('map', { scrollWheelZoom: true }).fitBounds(BOUNDS);
  L.tileLayer(D.tms, { attribution: 'Imagery © OpenAerialMap / ' + (D.provider || '') + ' (CC-BY)', maxNativeZoom: 20, maxZoom: 22 }).addTo(map);
  L.rectangle(BOUNDS, { color: '#fbbf24', weight: 2, fill: false, dashArray: '6 5' }).addTo(map);
  const SCENE = 'Vallée agroforestry site, Senegal';

  // canvas overlay
  const canvas = document.createElement('canvas'); canvas.width = GX; canvas.height = GY;
  const ctx = canvas.getContext('2d');
  const overlay = L.imageOverlay(canvas.toDataURL(), BOUNDS, { opacity: state.op, className: 'px-crisp', interactive: false }).addTo(map);

  // ---- eligibility computation ----
  function computeEligible() {
    // base plantable = open cover
    const elig = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const g = grid[i];
      let ok = (g === HERB) || (state.bare && g === BARE);
      if (ok && state.set > 0 && dist[i] < state.set) ok = false;   // canopy setback
      elig[i] = ok ? 1 : 0;
    }
    // minimum-block connected-components filter (4-connectivity)
    if (state.min > 0) {
      const minCells = state.min / D.cell_ha;
      const seen = new Uint8Array(N), stack = [];
      for (let i = 0; i < N; i++) {
        if (!elig[i] || seen[i]) continue;
        stack.length = 0; stack.push(i); seen[i] = 1;
        const comp = [i];
        while (stack.length) {
          const p = stack.pop(), r = (p / GX) | 0, c = p % GX;
          const nb = [];
          if (c > 0) nb.push(p - 1); if (c < GX - 1) nb.push(p + 1);
          if (r > 0) nb.push(p - GX); if (r < GY - 1) nb.push(p + GX);
          for (const q of nb) if (elig[q] && !seen[q]) { seen[q] = 1; stack.push(q); comp.push(q); }
        }
        if (comp.length < minCells) for (const q of comp) elig[q] = 2;  // mark too-small
      }
    }
    return elig;   // 1 = eligible, 2 = excluded-small, 0 = not plantable
  }

  function render() {
    const elig = state.mode === 'elig' ? computeEligible() : null;
    const img = ctx.createImageData(GX, GY);
    let eligCells = 0;
    for (let i = 0; i < N; i++) {
      const g = grid[i]; let col = null, a = 0;
      if (g === NODATA) { col = [0, 0, 0]; a = 0; }
      else if (state.mode === 'class') { col = CLASS_COL[g]; a = 255; }
      else { // eligibility
        if (elig[i] === 1) { col = [74, 222, 128]; a = 235; eligCells++; }
        else if (g === TREE) { col = [22, 101, 52]; a = 235; }        // existing canopy
        else if (g === WATER) { col = [43, 108, 176]; a = 235; }
        else { col = [248, 113, 113]; a = 200; }                       // excluded open land
      }
      const j = i * 4;
      img.data[j] = col[0]; img.data[j + 1] = col[1]; img.data[j + 2] = col[2]; img.data[j + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    overlay.setUrl(canvas.toDataURL());
    overlay.setOpacity(state.mode === 'drone' ? 0 : state.op);

    // stats
    const eligHa = eligCells * D.cell_ha;
    const seq = eligHa * 3.5 * 20;   // ~3.5 tCO2e/ha/yr over 20 yr (dryland agroforestry)
    document.getElementById('stats').innerHTML = [
      ['Site area', fmt(D.site_ha) + ' ha', D.gsd_m + ' m GSD drone'],
      ['Existing canopy', D.class_pct.tree + '%', 'excluded (forest test)'],
      ['Eligible to plant', fmt(eligHa) + ' ha', fmt(eligHa / D.site_ha * 100, 0) + '% of site'],
      ['Ex-ante potential', fmt(seq / 1000, 1) + 'k', 'tCO₂e over 20 yr'],
    ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${s}</div></div>`).join('');

    renderLegend();
  }

  function renderLegend() {
    const el = document.getElementById('legend');
    if (state.mode === 'class') {
      el.innerHTML = [['#228b22', 'Tree canopy'], ['#a3e635', 'Herbaceous / crop'], ['#d6b278', 'Bare soil'], ['#3878c8', 'Water']]
        .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    } else if (state.mode === 'elig') {
      el.innerHTML = [['#4ade80', 'Eligible to plant'], ['#166534', 'Existing canopy'], ['#f87171', 'Excluded'], ['#2b6cb0', 'Water']]
        .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    } else { el.innerHTML = '<span class="muted">Raw drone orthomosaic</span>'; }
  }

  // ---- controls ----
  PF.bindSeg('mode', v => { state.mode = v; render(); });
  PF.bindRange('op', 'opV', () => { state.op = +document.getElementById('op').value / 100; render(); }, ' %');
  PF.bindRange('set', 'setV', () => { state.set = +document.getElementById('set').value; render(); }, ' m');
  PF.bindRange('min', 'minV', () => {
    state.min = +document.getElementById('min').value / 10;
    document.getElementById('minV').textContent = state.min.toFixed(1) + ' ha';
    render();
  });
  document.getElementById('bare').addEventListener('change', e => { state.bare = e.target.checked; render(); });

  // method-panel attribution fill-ins
  document.getElementById('scene').textContent = SCENE + ' (' + (D.provider || '') + ')';
  document.getElementById('lic').textContent = D.license || 'CC-BY';
  document.getElementById('acq').textContent = D.acq || '';
  document.getElementById('treepct').textContent = D.class_pct.tree + '%';
  document.getElementById('siteha').textContent = fmt(D.site_ha) + ' ha';

  render();
})();
