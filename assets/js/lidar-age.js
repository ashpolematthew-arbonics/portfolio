// ALS tree age -> growth database — real Estonian ALS crowns, 1 km tile.
(function () {
  const { plotLayout, CONFIG, COLORS, fmt } = PF;
  const D = window.ALS_INVENTORY;
  if (!D) { document.getElementById('stats').innerHTML = '<div class="stat"><div class="k">Data</div><div class="v small">not loaded</div></div>'; return; }

  const SP_COLOR = { pine: '#4ade80', spruce: '#38bdf8', birch: '#fbbf24', broadleaf: '#fb923c', conifer: '#a3e635', other: '#94a3b8' };
  const SP_LABEL = { pine: 'Pine', spruce: 'Spruce', birch: 'Birch', broadleaf: 'Broadleaf', conifer: 'Conifer', other: 'Other' };
  // age colour ramp (young -> old)
  function ageColor(a) {
    const t = Math.max(0, Math.min(1, a / 100));
    const stops = [[74, 222, 128], [163, 230, 53], [251, 191, 36], [248, 113, 113], [153, 27, 27]];
    const x = t * (stops.length - 1), i = Math.floor(x), f = x - i;
    const c0 = stops[i], c1 = stops[Math.min(i + 1, stops.length - 1)];
    return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(',')})`;
  }

  const state = { corr: 'on', colour: 'species' };
  const ageOf = c => (state.corr === 'on' ? c.ao : (c.ap != null ? c.ap : c.ao));

  // ---- map ----
  const b = D.bbox; // [minx,miny,maxx,maxy]
  const BOUNDS = [[b[1], b[0]], [b[3], b[2]]];
  const map = L.map('map', { preferCanvas: true, scrollWheelZoom: true }).fitBounds(BOUNDS);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 19 }).addTo(map);
  L.rectangle(BOUNDS, { color: '#fbbf24', weight: 1.5, fill: false, dashArray: '5 4' }).addTo(map);

  const pickEl = document.getElementById('pick');
  const markers = D.crowns.map(c => {
    const m = L.circleMarker([c.lat, c.lng], { radius: 3, stroke: false, fillOpacity: 0.85 });
    m.on('click', () => {
      pickEl.innerHTML = `<strong>${SP_LABEL[c.sp] || c.sp}</strong> · height ${c.h} m · ` +
        `age (corrected) ${c.ao} yr <span class="muted">[${c.lo}–${c.hi} 95% CI]</span> · ` +
        `raw ${c.ap != null ? c.ap + ' yr' : '—'} · NDVI ${c.nd != null ? c.nd : '—'}`;
    });
    m.__c = c;
    return m.addTo(map);
  });

  function restyleMarkers() {
    markers.forEach(m => {
      const c = m.__c;
      m.setStyle({ fillColor: state.colour === 'species' ? (SP_COLOR[c.sp] || SP_COLOR.other) : ageColor(ageOf(c)) });
    });
  }
  function renderLegend() {
    const el = document.getElementById('map-legend');
    if (state.colour === 'species') {
      const present = [...new Set(D.crowns.map(c => c.sp))];
      el.innerHTML = present.map(s => `<span><i style="background:${SP_COLOR[s]}"></i>${SP_LABEL[s] || s}</span>`).join('');
    } else {
      el.innerHTML = `<span><i style="background:${ageColor(10)}"></i>young</span>
        <span><i style="background:${ageColor(50)}"></i>~50 yr</span>
        <span><i style="background:${ageColor(95)}"></i>old</span>`;
    }
  }

  // ---- stat cards (respond to correction toggle) ----
  const H = D.hist;
  function sumBins(arr, i0, i1) { let s = 0; for (let i = i0; i <= i1; i++) s += arr[i]; return s; }
  function stats() {
    const arr = state.corr === 'on' ? H.post : H.pre;
    const total = arr.reduce((a, x) => a + x, 0);
    const s = state.corr === 'on' ? D.stats.post : D.stats.pre;
    const reliable = sumBins(arr, 0, 5) / total * 100;    // <60 yr
    const censored = sumBins(arr, 8, 10) / total * 100;   // >=80 yr
    return { median: s.median, reliable, censored };
  }
  function renderStats() {
    const s = stats();
    const cards = [
      ['Crowns in tile', fmt(D.n_full), 'detected & aged'],
      ['Median age', s.median + ' yr', state.corr === 'on' ? 'crown-area corrected' : 'raw watershed'],
      ['Reliable (<60 yr)', fmt(s.reliable, 0) + '%', 'within envelope'],
      ['Censored ≥80 yr', fmt(s.censored, 0) + '%', 'right-censored floor'],
    ];
    document.getElementById('stats').innerHTML = cards.map(([k, v, sub]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v small">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`).join('');
  }

  // ---- histogram: active distribution solid, the other as ghost outline ----
  function renderHist() {
    const on = state.corr === 'on';
    const activeName = on ? 'Corrected ×0.43' : 'Raw watershed';
    const active = on ? H.post : H.pre;
    const ghost = on ? H.pre : H.post;
    const activeColor = on ? COLORS.accent : '#f87171';
    Plotly.react('hist', [
      { x: H.labels, y: ghost, type: 'bar', name: on ? 'Raw (uncorrected)' : 'Corrected',
        marker: { color: 'rgba(255,255,255,0.06)', line: { color: 'rgba(255,255,255,0.35)', width: 1 } },
        hovertemplate: '%{y} crowns<extra>%{x} yr</extra>' },
      { x: H.labels, y: active, type: 'bar', name: activeName,
        marker: { color: activeColor }, hovertemplate: '%{y} crowns<extra>%{x} yr</extra>' },
    ], plotLayout({
      barmode: 'overlay', margin: { l: 55, r: 15, t: 38, b: 70 },
      title: { text: 'Age distribution — the correction drains the artefactual ≥80 yr tail', font: { size: 13 }, x: 0.01, y: 0.97, yanchor: 'top' },
      xaxis: { title: 'Predicted age (yr)', gridcolor: COLORS.grid },
      yaxis: { title: 'Crowns', gridcolor: COLORS.grid },
      legend: { orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center', font: { size: 12 } },
      shapes: [{ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, visible: false }],
    }), CONFIG);
  }

  // ---- height vs age saturation + reliability bands ----
  function renderSat() {
    const bandColors = { reliable: 'rgba(74,222,128,0.07)', medium: 'rgba(251,191,36,0.09)', censored_mature: 'rgba(248,113,113,0.11)' };
    const shapes = D.envelope.map(e => ({
      type: 'rect', xref: 'x', yref: 'paper', x0: e.lo, x1: Math.min(e.hi, 110), y0: 0, y1: 1,
      fillcolor: bandColors[e.tag], line: { width: 0 }, layer: 'below',
    }));
    const traces = [...new Set(D.hs.map(p => p.sp))].map(sp => {
      const pts = D.hs.filter(p => p.sp === sp);
      return { x: pts.map(p => p.a), y: pts.map(p => p.h), mode: 'markers', type: 'scatter',
        name: SP_LABEL[sp] || sp, marker: { color: SP_COLOR[sp] || SP_COLOR.other, size: 5, opacity: 0.6 },
        hovertemplate: 'age %{x} yr · %{y} m<extra></extra>' };
    });
    Plotly.react('sat', traces, plotLayout({
      margin: { l: 55, r: 15, t: 38, b: 62 }, shapes,
      title: { text: 'Height saturates with age → old ages are uncertain (bands = reliability envelope)', font: { size: 12.5 }, x: 0.01, y: 0.98, yanchor: 'top' },
      xaxis: { title: 'Predicted age (yr)', gridcolor: COLORS.grid, range: [0, 110] },
      yaxis: { title: 'ALS height (m)', gridcolor: COLORS.grid },
      legend: { orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center', font: { size: 11 } },
      annotations: [
        { x: 30, y: 1.0, yref: 'paper', text: 'reliable', showarrow: false, font: { size: 10, color: '#4ade80' } },
        { x: 70, y: 1.0, yref: 'paper', text: 'medium', showarrow: false, font: { size: 10, color: '#fbbf24' } },
        { x: 95, y: 1.0, yref: 'paper', text: 'censored', showarrow: false, font: { size: 10, color: '#f87171' } },
      ],
    }), CONFIG);
  }

  // ---- pipeline stage list ----
  document.getElementById('stages').innerHTML = [
    ['CHM', '0.5 m raster; heights >45 m dropped'],
    ['Treetops', 'variable-window local maxima, ≥2 m'],
    ['Crowns', 'marker-controlled watershed'],
    ['NDVI filter', 'drop dead/non-veg (~10.6%)'],
    ['Crown-area', '×0.43 median-anchored to TLS'],
    ['Species', 'CLIP zero-shot on RGB ortho'],
    ['Age', 'GBM on FORage + reliability envelope'],
    ['SI₅₀ / DBH', 'anamorphic SI → inverse Näslund DBH'],
    ['Growth', 'folds into Chapman–Richards curves'],
  ].map(([k, v], i) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid var(--border)">
      <span class="mono" style="color:var(--accent);min-width:16px">${i + 1}</span>
      <span><strong style="color:var(--text)">${k}</strong> — ${v}</span></div>`).join('');
  document.getElementById('tileid').textContent = D.tile;

  function renderAll() { renderStats(); renderHist(); restyleMarkers(); renderLegend(); }

  PF.bindSeg('corr', v => { state.corr = v; renderAll(); });
  PF.bindSeg('colour', v => { state.colour = v; restyleMarkers(); renderLegend(); });

  renderSat();
  renderAll();
})();
