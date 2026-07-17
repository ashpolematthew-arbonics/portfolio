// Drone site eligibility — real UAV orthomosaics (OpenAerialMap), multi-scene.
(function () {
  const { fmt } = PF;
  const ALL = window.DRONE_ELIG;
  if (!ALL || !ALL.scenes) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const NODATA = 0, TREE = 1, HERB = 2, BARE = 3, WATER = 4, FIELD = 5;
  const CLASS_COL = { [TREE]: [34, 139, 34], [HERB]: [163, 230, 53], [BARE]: [214, 178, 120], [WATER]: [56, 120, 200], [FIELD]: [234, 120, 40] };
  const SCENE_LABEL = { senegal: 'Senegal', turkana: 'Turkana' };

  const state = { key: ALL.default, mode: 'elig', op: 0.75, set: 10, min: 0.3, bare: true, fields: true };
  let S, grid, dist, N, GX, GY, BOUNDS;

  const map = L.map('map', { scrollWheelZoom: true });
  let droneLayer = null, boundaryRect = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = L.imageOverlay('', [[0, 0], [1, 1]], { opacity: state.op, className: 'px-crisp', interactive: false }).addTo(map);

  function setScene(key) {
    state.key = key;
    S = ALL.scenes[key];
    grid = S.grid; dist = S.dist; GX = S.gx; GY = S.gy; N = GX * GY;
    const b = S.bbox;                       // [W,S,E,N]
    BOUNDS = [[b[1], b[0]], [b[3], b[2]]];
    canvas.width = GX; canvas.height = GY;

    if (droneLayer) map.removeLayer(droneLayer);
    droneLayer = L.tileLayer(S.tms, { attribution: 'Imagery © OpenAerialMap / ' + (S.provider || '') + ' (CC-BY)', maxNativeZoom: 20, maxZoom: 22 }).addTo(map);
    droneLayer.bringToBack();
    if (boundaryRect) map.removeLayer(boundaryRect);
    boundaryRect = L.rectangle(BOUNDS, { color: '#fbbf24', weight: 2, fill: false, dashArray: '6 5' }).addTo(map);
    overlay.setBounds(BOUNDS);
    map.fitBounds(BOUNDS);

    document.getElementById('scenectx').textContent = S.ctx + ' · ' + S.gsd_m + ' m GSD · flown ' + S.acq;
    document.getElementById('scene').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.val === key));
    fillMethod();
    render();
  }

  function computeEligible() {
    const elig = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const g = grid[i];
      let ok = (g === HERB) || (state.bare && g === BARE) || (!state.fields && g === FIELD);
      if (ok && state.set > 0 && dist[i] < state.set) ok = false;   // canopy setback
      elig[i] = ok ? 1 : 0;
    }
    if (state.min > 0) {                                             // min-block filter
      const minCells = state.min / S.cell_ha, seen = new Uint8Array(N), stack = [];
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

  function render() {
    const elig = state.mode === 'elig' ? computeEligible() : null;
    const img = ctx.createImageData(GX, GY);
    let eligCells = 0;
    for (let i = 0; i < N; i++) {
      const g = grid[i]; let col = [0, 0, 0], a = 0;
      if (g === NODATA) { a = 0; }
      else if (state.mode === 'class') { col = CLASS_COL[g]; a = 255; }
      else {
        if (elig[i] === 1) { col = [74, 222, 128]; a = 235; eligCells++; }
        else if (g === TREE) { col = [22, 101, 52]; a = 235; }
        else if (g === FIELD) { col = [234, 120, 40]; a = 225; }        // cultivated, excluded
        else if (g === WATER) { col = [43, 108, 176]; a = 235; }
        else { col = [248, 113, 113]; a = 200; }                        // other excluded open
      }
      const j = i * 4;
      img.data[j] = col[0]; img.data[j + 1] = col[1]; img.data[j + 2] = col[2]; img.data[j + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    overlay.setUrl(canvas.toDataURL());
    overlay.setOpacity(state.mode === 'drone' ? 0 : state.op);

    const eligHa = eligCells * S.cell_ha, seq = eligHa * 3.5 * 20;
    document.getElementById('stats').innerHTML = [
      ['Site area', fmt(S.site_ha) + ' ha', SCENE_LABEL[S.key] || S.label],
      ['Existing canopy', S.class_pct.tree + '%', 'excluded (forest test)'],
      ['Cultivated cropland', S.class_pct.field + '%', 'segmented & excluded'],
      ['Eligible to plant', fmt(eligHa) + ' ha', fmt(eligHa / S.site_ha * 100, 0) + '% of site'],
      ['Ex-ante potential', fmt(seq / 1000, 1) + 'k', 'tCO₂e over 20 yr'],
    ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${s}</div></div>`).join('');
    renderLegend();
  }

  function renderLegend() {
    const el = document.getElementById('legend');
    if (state.mode === 'class') {
      el.innerHTML = [['#228b22', 'Tree canopy'], ['#a3e635', 'Herbaceous / grass'], ['#ea7828', 'Cropland field'], ['#d6b278', 'Bare soil'], ['#3878c8', 'Water']]
        .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    } else if (state.mode === 'elig') {
      el.innerHTML = [['#4ade80', 'Eligible to plant'], ['#166534', 'Existing canopy'], ['#ea7828', 'Cultivated (excluded)'], ['#f87171', 'Other excluded']]
        .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    } else el.innerHTML = '<span class="muted">Raw drone orthomosaic</span>';
  }

  function fillMethod() {
    document.getElementById('scene').dataset.ready = '1';
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('scene-name', S.label + ' (' + (S.provider || '') + ')');
    set('lic', S.license || 'CC-BY'); set('acq', S.acq || '');
    set('treepct', S.class_pct.tree + '%'); set('fieldpct', S.class_pct.field + '%');
    set('siteha', fmt(S.site_ha) + ' ha');
  }

  // build scene switcher
  const seg = document.getElementById('scene');
  seg.innerHTML = ALL.order.map((k, i) =>
    `<button data-val="${k}" class="${k === state.key ? 'active' : ''}">${ALL.scenes[k].label}</button>`).join('');
  seg.querySelectorAll('button').forEach(bn => bn.addEventListener('click', () => setScene(bn.dataset.val)));

  // controls
  PF.bindSeg('mode', v => { state.mode = v; render(); });
  PF.bindRange('op', 'opV', () => { state.op = +document.getElementById('op').value / 100; render(); }, ' %');
  PF.bindRange('set', 'setV', () => { state.set = +document.getElementById('set').value; render(); }, ' m');
  PF.bindRange('min', 'minV', () => {
    state.min = +document.getElementById('min').value / 10;
    document.getElementById('minV').textContent = state.min.toFixed(1) + ' ha';
    render();
  });
  document.getElementById('bare').addEventListener('change', e => { state.bare = e.target.checked; render(); });
  document.getElementById('fields').addEventListener('change', e => { state.fields = e.target.checked; render(); });

  setScene(state.key);
})();
