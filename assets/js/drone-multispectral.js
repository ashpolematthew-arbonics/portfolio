// Multispectral drone restoration planning — DJI Mavic 3M, N. Ghana. Multi-scene.
(function () {
  const { fmt } = PF;
  const ALL = window.DRONE_MS;
  if (!ALL || !ALL.scenes) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const TREE = 1, SHRUB = 2, OPEN = 3;
  const CANOPY = 1, ANR = 2, AGRO = 3, REFOR = 4, REFOR_X = 5;
  const IMG = '../assets/img/';
  // intervention: [colour, label, tCO2e/ha/yr]
  const IV = {
    [CANOPY]: ['#14532d', 'Existing canopy', 0],
    [ANR]: ['#22d3ee', 'Assisted regeneration', 4],
    [AGRO]: ['#f59e0b', 'Agroforestry', 3],
    [REFOR]: ['#4ade80', 'Reforestation', 5],
    [REFOR_X]: ['#9ca3af', 'Too fragmented', 0],
  };

  const state = { key: ALL.default, layer: 'rgb', op: 0.85, crowns: false, till: 20, min: 0.03 };
  let S, grid, till, dist, N, GX, GY;

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
  let base = null, boundsCur = null;
  const topImg = L.imageOverlay('', [[0, 0], [1, 1]], { className: 'px-crisp', opacity: state.op });
  const ivCanvas = document.createElement('canvas'); const ivCtx = ivCanvas.getContext('2d');
  const ivOverlay = L.imageOverlay('', [[0, 0], [1, 1]], { className: 'px-crisp', opacity: state.op });
  const crCanvas = document.createElement('canvas'); const crCtx = crCanvas.getContext('2d');
  const crOverlay = L.imageOverlay('', [[0, 0], [1, 1]]);

  function setScene(key) {
    state.key = key; S = ALL.scenes[key];
    grid = S.grid; till = S.till; dist = S.dist; GX = S.gx; GY = S.gy; N = GX * GY;
    boundsCur = [[0, 0], [S.h, S.w]];
    ivCanvas.width = GX; ivCanvas.height = GY; crCanvas.width = S.w; crCanvas.height = S.h;

    if (base) map.removeLayer(base);
    base = L.imageOverlay(IMG + `ghana_${key}_rgb.jpg`, boundsCur).addTo(map);
    base.bringToBack();
    topImg.setBounds(boundsCur); ivOverlay.setBounds(boundsCur); crOverlay.setBounds(boundsCur);
    map.fitBounds(boundsCur); map.setMaxBounds(boundsCur);

    // crowns for this scene
    crCtx.clearRect(0, 0, S.w, S.h); crCtx.strokeStyle = 'rgba(255,240,60,0.95)'; crCtx.lineWidth = 2;
    S.crowns.forEach(c => { crCtx.beginPath(); crCtx.arc(c.x, c.y, Math.max(3, c.r), 0, 2 * Math.PI); crCtx.stroke(); });
    crOverlay.setUrl(crCanvas.toDataURL());

    document.getElementById('scenectx').textContent = S.ctx + ' · ' + S.stats.gsd_cm + ' cm GSD · ' + fmt(S.stats.area_ha, 2) + ' ha';
    document.getElementById('scene').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.val === key));
    apply();
  }

  // map every cell to an intervention
  function interventions() {
    const iv = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const g = grid[i];
      if (g === TREE) iv[i] = CANOPY;
      else if (g === SHRUB) iv[i] = ANR;
      else if (g === OPEN) iv[i] = (till[i] >= state.till) ? AGRO : REFOR;
    }
    // min-block filter on reforestation (contiguous)
    if (state.min > 0) {
      const minCells = state.min / S.cell_ha, seen = new Uint8Array(N), stack = [];
      for (let i = 0; i < N; i++) {
        if (iv[i] !== REFOR || seen[i]) continue;
        stack.length = 0; stack.push(i); seen[i] = 1; const comp = [i];
        while (stack.length) {
          const p = stack.pop(), r = (p / GX) | 0, c = p % GX, nb = [];
          if (c > 0) nb.push(p - 1); if (c < GX - 1) nb.push(p + 1);
          if (r > 0) nb.push(p - GX); if (r < GY - 1) nb.push(p + GX);
          for (const q of nb) if (iv[q] === REFOR && !seen[q]) { seen[q] = 1; stack.push(q); comp.push(q); }
        }
        if (comp.length < minCells) for (const q of comp) iv[q] = REFOR_X;
      }
    }
    return iv;
  }

  function areasOf(iv) {
    const ha = {}; Object.keys(IV).forEach(k => ha[k] = 0);
    for (let i = 0; i < N; i++) if (iv[i]) ha[iv[i]] += S.cell_ha;
    return ha;
  }
  function drawIV(iv) {
    const im = ivCtx.createImageData(GX, GY);
    for (let i = 0; i < N; i++) {
      const k = iv[i]; if (!k) continue;
      const hex = IV[k][0], j = i * 4;
      im.data[j] = parseInt(hex.slice(1, 3), 16); im.data[j + 1] = parseInt(hex.slice(3, 5), 16);
      im.data[j + 2] = parseInt(hex.slice(5, 7), 16); im.data[j + 3] = 225;
    }
    ivCtx.putImageData(im, 0, 0); ivOverlay.setUrl(ivCanvas.toDataURL());
  }

  function apply() {
    const L_ = state.layer;
    const iv = interventions(); const ha = areasOf(iv);
    if (L_ === 'rgb' || L_ === 'interv') { if (map.hasLayer(topImg)) map.removeLayer(topImg); }
    else {
      const ext = L_ === 'class' ? 'png' : 'jpg';
      topImg.setUrl(IMG + `ghana_${state.key}_${L_}.${ext}`); topImg.setOpacity(state.op);
      if (!map.hasLayer(topImg)) topImg.addTo(map);
    }
    if (L_ === 'interv') { drawIV(iv); ivOverlay.setOpacity(state.op); if (!map.hasLayer(ivOverlay)) ivOverlay.addTo(map); }
    else if (map.hasLayer(ivOverlay)) map.removeLayer(ivOverlay);
    if (state.crowns) { if (!map.hasLayer(crOverlay)) crOverlay.addTo(map); crOverlay.bringToFront(); }
    else if (map.hasLayer(crOverlay)) map.removeLayer(crOverlay);
    renderStats(ha); renderLegend(ha);
  }

  function renderStats(ha) {
    const s = S.stats;
    const restorable = (ha[AGRO] || 0) + (ha[REFOR] || 0) + (ha[ANR] || 0);
    const seq = (ha[AGRO] || 0) * IV[AGRO][2] + (ha[REFOR] || 0) * IV[REFOR][2] + (ha[ANR] || 0) * IV[ANR][2];
    document.getElementById('stats').innerHTML = [
      ['Area imaged', fmt(s.area_ha, 2) + ' ha', s.gsd_cm + ' cm GSD'],
      ['Canopy cover', s.canopy_cover_pct + '%', fmt(s.n_crowns) + ' crowns · ' + fmt(s.tree_density_ha) + '/ha'],
      ['Median NDVI', s.ndvi_med, 'NDRE ' + s.ndre_med],
      ['Restorable', fmt(restorable, 2) + ' ha', fmt(restorable / s.area_ha * 100, 0) + '% of frame'],
      ['Ex-ante potential', fmt(seq * 20), 'tCO₂e over 20 yr'],
    ].map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`).join('');
  }

  function renderLegend(ha) {
    const el = document.getElementById('legend'); const bd = document.getElementById('breakdown');
    if (state.layer === 'interv') {
      el.innerHTML = [CANOPY, AGRO, REFOR, ANR].map(k => `<span><i style="background:${IV[k][0]}"></i>${IV[k][1]}</span>`).join('');
      bd.innerHTML = '<strong>Area by intervention</strong>' + [AGRO, REFOR, ANR].map(k =>
        `<div style="display:flex;justify-content:space-between;padding:2px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${IV[k][0]};margin-right:7px"></i>${IV[k][1]}</span><span class="mono">${fmt(ha[k] || 0, 2)} ha</span></div>`).join('') +
        `<div class="muted" style="font-size:11px;margin-top:4px">Existing canopy conserved: ${fmt(ha[CANOPY] || 0, 2)} ha</div>`;
    } else {
      bd.innerHTML = '';
      if (state.layer === 'class') el.innerHTML = [['#1a662e', 'Tree crown'], ['#78be5a', 'Shrub / woody'], ['#ceb284', 'Open ground']].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
      else if (state.layer === 'ndvi') el.innerHTML = '<span>NDVI: <i style="background:#a50026"></i>low → <i style="background:#006837"></i>high</span>';
      else if (state.layer === 'ndre') el.innerHTML = '<span>NDRE: <i style="background:#440154"></i>low → <i style="background:#fde725"></i>high</span>';
      else if (state.layer === 'tillage') el.innerHTML = '<span>Tillage: <i style="background:#000004"></i>random → <i style="background:#fcfdbf"></i>furrows</span>';
      else el.innerHTML = '<span class="muted">True-colour RGB orthophoto</span>';
    }
  }

  // scene switcher
  const seg = document.getElementById('scene');
  seg.innerHTML = ALL.order.map(k => `<button data-val="${k}" class="${k === state.key ? 'active' : ''}">${ALL.scenes[k].label}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setScene(b.dataset.val)));

  PF.bindSeg('layer', v => { state.layer = v; apply(); });
  PF.bindRange('op', 'opV', () => { state.op = +document.getElementById('op').value / 100; apply(); }, ' %');
  PF.bindRange('till', 'tillV', () => { state.till = +document.getElementById('till').value; apply(); });
  PF.bindRange('min', 'minV', () => {
    state.min = +document.getElementById('min').value / 100;
    document.getElementById('minV').textContent = state.min.toFixed(2) + ' ha'; apply();
  });
  document.getElementById('crowns').addEventListener('change', e => { state.crowns = e.target.checked; apply(); });

  setScene(state.key);
})();
