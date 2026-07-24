// Multispectral drone restoration planning — DJI Mavic 3M, N. Ghana. Multi-scene,
// interventions delineated as contiguous vector polygons.
(function () {
  const { fmt } = PF;
  const ALL = window.DRONE_MS;
  if (!ALL || !ALL.scenes) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const IMG = '../assets/img/';
  // intervention: [colour, label, tCO2e/ha/yr]
  const IV = {
    canopy: ['#14532d', 'Existing canopy', 0],
    anr: ['#22d3ee', 'Assisted regeneration', 4],
    agro: ['#f59e0b', 'Agroforestry', 3],
    refor: ['#4ade80', 'Reforestation', 5],
  };
  const state = { key: ALL.default, layer: 'rgb', op: 0.85, crowns: false, min: 0.05,
                  show: { agro: true, refor: true, anr: true, canopy: false } };
  let S, W, H;

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
  let base = null, boundsCur = null;
  const topImg = L.imageOverlay('', [[0, 0], [1, 1]], { className: 'px-crisp', opacity: state.op });
  const ivLayer = L.layerGroup();
  const crCanvas = document.createElement('canvas'); const crCtx = crCanvas.getContext('2d');
  const crOverlay = L.imageOverlay('', [[0, 0], [1, 1]]);

  // normalized poly coord -> CRS.Simple latlng (image top-left origin, y flipped)
  const toLL = (nx, ny) => [H * (1 - ny), W * nx];

  function setScene(key) {
    state.key = key; S = ALL.scenes[key]; W = S.w; H = S.h;
    boundsCur = [[0, 0], [H, W]];
    crCanvas.width = W; crCanvas.height = H;
    if (base) map.removeLayer(base);
    base = L.imageOverlay(IMG + `ghana_${key}_rgb.jpg`, boundsCur).addTo(map); base.bringToBack();
    topImg.setBounds(boundsCur); crOverlay.setBounds(boundsCur);
    map.fitBounds(boundsCur); map.setMaxBounds(boundsCur);

    crCtx.clearRect(0, 0, W, H); crCtx.strokeStyle = 'rgba(255,240,60,0.95)'; crCtx.lineWidth = 2;
    S.crowns.forEach(c => { crCtx.beginPath(); crCtx.arc(c.x, c.y, Math.max(3, c.r), 0, 2 * Math.PI); crCtx.stroke(); });
    crOverlay.setUrl(crCanvas.toDataURL());

    document.getElementById('scenectx').textContent = S.ctx + ' · ' + S.stats.gsd_cm + ' cm GSD · ' + fmt(S.stats.area_ha, 2) + ' ha';
    document.getElementById('scene').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.val === key));
    apply();
  }

  function visiblePolys() {
    return S.polys.filter(p => p.a >= state.min && state.show[p.t]);
  }

  function renderIV() {
    ivLayer.clearLayers();
    visiblePolys().forEach(p => {
      const latlngs = p.r.map(([nx, ny]) => toLL(nx, ny));
      L.polygon(latlngs, { color: IV[p.t][0], weight: 2, fillColor: IV[p.t][0], fillOpacity: 0.45 * state.op })
        .bindTooltip(`${IV[p.t][1]} · ${fmt(p.a, 2)} ha`, { sticky: true })
        .addTo(ivLayer);
    });
  }

  function apply() {
    const L_ = state.layer;
    if (L_ === 'rgb' || L_ === 'interv') { if (map.hasLayer(topImg)) map.removeLayer(topImg); }
    else {
      const ext = L_ === 'class' ? 'png' : 'jpg';
      topImg.setUrl(IMG + `ghana_${state.key}_${L_}.${ext}`); topImg.setOpacity(state.op);
      if (!map.hasLayer(topImg)) topImg.addTo(map);
    }
    if (L_ === 'interv') { renderIV(); if (!map.hasLayer(ivLayer)) ivLayer.addTo(map); }
    else if (map.hasLayer(ivLayer)) map.removeLayer(ivLayer);
    if (state.crowns) { if (!map.hasLayer(crOverlay)) crOverlay.addTo(map); crOverlay.bringToFront(); }
    else if (map.hasLayer(crOverlay)) map.removeLayer(crOverlay);
    renderStats(); renderLegend();
  }

  function shownAreas() {
    const ha = { agro: 0, refor: 0, anr: 0, canopy: 0 };
    visiblePolys().forEach(p => ha[p.t] += p.a);
    return ha;
  }

  function renderStats() {
    const s = S.stats, ha = shownAreas();
    const restorable = ha.agro + ha.refor + ha.anr;
    const seq = (ha.agro * IV.agro[2] + ha.refor * IV.refor[2] + ha.anr * IV.anr[2]) * 20;
    document.getElementById('stats').innerHTML = [
      ['Area imaged', fmt(s.area_ha, 2) + ' ha', s.gsd_cm + ' cm GSD'],
      ['Canopy cover', s.canopy_cover_pct + '%', fmt(s.n_crowns) + ' crowns · ' + fmt(s.tree_density_ha) + '/ha'],
      ['Median NDVI', s.ndvi_med, 'NDRE ' + s.ndre_med],
      ['Restoration blocks', fmt(restorable, 2) + ' ha', fmt(restorable / s.area_ha * 100, 0) + '% of frame'],
      ['Ex-ante potential', fmt(seq), 'tCO₂e over 20 yr'],
    ].map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`).join('');
  }

  function renderLegend() {
    const el = document.getElementById('legend'), bd = document.getElementById('breakdown');
    if (state.layer === 'interv') {
      const ha = shownAreas();
      el.innerHTML = ['agro', 'refor', 'anr', 'canopy'].filter(t => state.show[t]).map(t => `<span><i style="background:${IV[t][0]}"></i>${IV[t][1]}</span>`).join('');
      bd.innerHTML = '<strong>Delineated blocks</strong>' + ['agro', 'refor', 'anr'].map(t =>
        `<div style="display:flex;justify-content:space-between;padding:2px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${IV[t][0]};margin-right:7px"></i>${IV[t][1]}</span><span class="mono">${fmt(ha[t], 2)} ha</span></div>`).join('');
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
  PF.bindRange('min', 'minV', () => {
    state.min = +document.getElementById('min').value / 100;
    document.getElementById('minV').textContent = state.min.toFixed(2) + ' ha'; apply();
  });
  document.getElementById('crowns').addEventListener('change', e => { state.crowns = e.target.checked; apply(); });
  [['t_agro', 'agro'], ['t_refor', 'refor'], ['t_anr', 'anr'], ['t_canopy', 'canopy']].forEach(([id, t]) =>
    document.getElementById(id).addEventListener('change', e => { state.show[t] = e.target.checked; apply(); }));

  setScene(state.key);
})();
