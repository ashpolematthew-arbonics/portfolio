// Biomass-map disagreement audit — real Spawn 2010 vs GEDI L4B AGB over N. Ghana.
(function () {
  const { plotLayout, CONFIG, COLORS, fmt } = PF;

  // ROI bounds [S,W],[N,E] must match pipeline BBOX [-1.2, 9.0, 0.8, 11.2]
  const BOUNDS = [[9.0, -1.2], [11.2, 0.8]];
  const LC_COLOR = { 10: '#16a34a', 20: '#ca8a04', 30: '#a3e635', 40: '#f59e0b', 50: '#ef4444', 60: '#a8a29e', 80: '#38bdf8', 90: '#22d3ee' };
  const LC_LABEL = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up', 60: 'Bare/sparse', 80: 'Water', 90: 'Wetland' };

  const map = L.map('map', { scrollWheelZoom: true, minZoom: 7 }).fitBounds(BOUNDS);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 16 }).addTo(map);

  let opacity = 0.9;
  const spawn = L.imageOverlay('../assets/img/agb_spawn.png', BOUNDS, { opacity, interactive: false });
  const gedi = L.imageOverlay('../assets/img/agb_gedi.png', BOUNDS, { opacity, interactive: false });
  const diff = L.imageOverlay('../assets/img/agb_diff.png', BOUNDS, { opacity, interactive: false });
  L.rectangle(BOUNDS, { color: '#fbbf24', weight: 2, fill: false, dashArray: '6 5' }).addTo(map);

  // ---- custom swipe divider ----
  const container = map.getContainer();
  let frac = 0.5;      // divider position as fraction of map width
  let mode = 'compare';

  const divider = document.createElement('div');
  divider.className = 'swipe-divider';
  divider.innerHTML = '<div class="line"></div><div class="grip">⇆</div>';
  const tagL = document.createElement('div'); tagL.className = 'swipe-tag'; tagL.style.left = '10px'; tagL.textContent = 'Spawn 2010';
  const tagR = document.createElement('div'); tagR.className = 'swipe-tag'; tagR.style.right = '10px'; tagR.textContent = 'GEDI L4B';
  container.appendChild(divider); container.appendChild(tagL); container.appendChild(tagR);

  function updateSwipe() {
    if (mode !== 'compare') return;
    const w = container.clientWidth;
    const x = frac * w;
    divider.style.left = x + 'px';
    // clip the GEDI overlay (on top) so it only shows to the RIGHT of the divider,
    // revealing Spawn (underneath) on the left. clip-path is relative to the img box.
    const gImg = gedi.getElement();
    if (gImg) {
      const cRect = container.getBoundingClientRect();
      const gRect = gImg.getBoundingClientRect();
      let f = (cRect.left + x - gRect.left) / gRect.width;
      f = Math.max(0, Math.min(1, f));
      gImg.style.clipPath = `inset(0 0 0 ${f * 100}%)`;
      gImg.style.webkitClipPath = `inset(0 0 0 ${f * 100}%)`;
    }
  }

  // dragging
  let dragging = false;
  function setFracFromEvent(e) {
    const cRect = container.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    frac = Math.max(0, Math.min(1, (cx - cRect.left) / cRect.width));
    updateSwipe();
  }
  divider.querySelector('.grip').addEventListener('pointerdown', e => {
    e.preventDefault(); dragging = true; map.dragging.disable();
  });
  window.addEventListener('pointermove', e => { if (dragging) setFracFromEvent(e); });
  window.addEventListener('pointerup', () => { if (dragging) { dragging = false; map.dragging.enable(); } });
  map.on('move zoom zoomend moveend resize load', updateSwipe);
  gedi.on('load', updateSwipe);

  function setCompare() {
    mode = 'compare';
    map.removeLayer(diff);
    spawn.addTo(map); gedi.addTo(map);
    divider.style.display = ''; tagL.style.display = ''; tagR.style.display = '';
    document.getElementById('legend-agb').style.display = '';
    document.getElementById('legend-diff').style.display = 'none';
    setTimeout(updateSwipe, 30);
  }
  function setDiff() {
    mode = 'diff';
    map.removeLayer(spawn); map.removeLayer(gedi);
    diff.addTo(map);
    divider.style.display = 'none'; tagL.style.display = 'none'; tagR.style.display = 'none';
    document.getElementById('legend-agb').style.display = 'none';
    document.getElementById('legend-diff').style.display = '';
  }

  PF.bindSeg('view', v => { v === 'compare' ? setCompare() : setDiff(); });
  PF.bindRange('op', 'opV', () => {
    opacity = +document.getElementById('op').value / 100;
    [spawn, gedi, diff].forEach(l => l.setOpacity(opacity));
  }, ' %');

  setCompare();

  // ---- load stats + samples (embedded as a JS global so it works under file:// too) ----
  function renderData(d) {
    const a = d.agreement, cr = d.crediting, p = d.products;

    const stats = [
      ['Regional means', `${p.spawn.mean_agb} / ${p.gedi.mean_agb}`, 'Mg/ha · agree to ' + cr.regional_gap_pct + '%'],
      ['Local disagreement', a.rel_disagree_pct + '%', 'pixel-scale MAE'],
      ['Correlation R²', a.r2, 'Spawn vs GEDI, per pixel'],
      ['Local carbon error', '±' + cr.local_err_tco2_ha, 'tCO₂e / ha'],
      ['10,000 ha project', '±' + fmt(cr.local_err_proj_ktco2e) + 'k', 'tCO₂e of ambiguity'],
    ];
    document.getElementById('stats').innerHTML = stats.map(([k, v, s]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${s}</div></div>`).join('');

    // scatter Spawn vs GEDI coloured by land cover
    const classes = [...new Set(d.samples.map(s => s.c))].sort((x, y) => y - x);
    const traces = classes.map(c => {
      const pts = d.samples.filter(s => s.c === c);
      return {
        x: pts.map(s => s.s), y: pts.map(s => s.g), mode: 'markers', type: 'scatter',
        name: LC_LABEL[c] || c, marker: { color: LC_COLOR[c] || '#94a3b8', size: 5, opacity: 0.65 },
        hovertemplate: 'Spawn %{x} · GEDI %{y} Mg/ha<extra>' + (LC_LABEL[c] || c) + '</extra>',
      };
    });
    const mx = Math.max(...d.samples.map(s => Math.max(s.s, s.g))) * 1.05;
    traces.push({ x: [0, mx], y: [0, mx], mode: 'lines', name: '1:1', line: { color: '#e8f0ea', width: 1.5, dash: 'dash' }, hoverinfo: 'skip' });
    Plotly.newPlot('scatter', traces, plotLayout({
      margin: { l: 55, r: 15, t: 34, b: 46 },
      title: { text: `Per-pixel agreement — R² = ${a.r2} (points scatter far off the 1:1 line)`, font: { size: 13 }, x: 0.01 },
      xaxis: { title: 'Spawn 2010 AGB (Mg/ha)', gridcolor: COLORS.grid, range: [0, mx] },
      yaxis: { title: 'GEDI L4B AGB (Mg/ha)', gridcolor: COLORS.grid, range: [0, mx] },
      legend: { orientation: 'h', y: -0.2, font: { size: 11 } },
    }), CONFIG);

    // grouped bars: mean AGB by product per land-cover class
    const bc = d.by_class.filter(c => c.n >= 15);
    Plotly.newPlot('bars', [
      { x: bc.map(c => c.label), y: bc.map(c => c.spawn_mean), type: 'bar', name: 'Spawn 2010', marker: { color: '#41ab5d' } },
      { x: bc.map(c => c.label), y: bc.map(c => c.gedi_mean), type: 'bar', name: 'GEDI L4B', marker: { color: '#38bdf8' } },
    ], plotLayout({
      margin: { l: 55, r: 15, t: 34, b: 60 }, barmode: 'group',
      title: { text: 'Mean AGB by land cover — divergence grows with tree cover', font: { size: 13 }, x: 0.01 },
      yaxis: { title: 'Mean AGB (Mg/ha)', gridcolor: COLORS.grid },
      xaxis: { gridcolor: COLORS.grid },
      legend: { orientation: 'h', y: 1.15, font: { size: 12 } },
    }), CONFIG);
  }

  if (window.BIOMASS_AUDIT) {
    try { renderData(window.BIOMASS_AUDIT); }
    catch (err) { console.error(err); }
  } else {
    document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">unavailable</div><div class="muted" style="font-size:11px">biomass_audit.js not loaded</div></div>';
  }
})();
