// Drone site eligibility — per-pixel raster classification within one project boundary,
// with a toggleable vectorised (dissolved) eligibility layer.
(function () {
  const { fmt } = PF;

  const CENTER = [58.62, 25.45];
  const map = L.map('map', { scrollWheelZoom: true }).setView(CENTER, 12);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 18 });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19 });
  sat.addTo(map);

  // --- Project boundary (irregular polygon) ---
  const BND = [
    [58.585, 25.385], [58.600, 25.360], [58.628, 25.372], [58.650, 25.405],
    [58.655, 25.455], [58.640, 25.500], [58.610, 25.512], [58.585, 25.495],
    [58.572, 25.450], [58.575, 25.410],
  ];
  L.polygon(BND, { color: '#fbbf24', weight: 2.5, fill: false, dashArray: '6 5' }).addTo(map);

  // bbox
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  BND.forEach(([la, ln]) => { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln); });

  const NX = 46, NY = 38;
  const dLat = (maxLat - minLat) / NY, dLng = (maxLng - minLng) / NX;

  function pointInPoly(la, ln, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > la) !== (yj > la)) && (ln < (xj - xi) * (la - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // smooth pseudo-random spatial field in ~[0,1] from sums of sines (seeded constants)
  function field(u, v, a, b, c) {
    const s = Math.sin(u * a + c) * Math.cos(v * b - c)
            + 0.5 * Math.sin(u * b * 1.7 + v * a * 1.3 + c)
            + 0.5 * Math.cos(u * 3.1 * a - v * 2.3 + c * 2);
    return (s / 2.5 + 1) / 2;
  }

  // pixel ground area (ha) — approx at center latitude
  const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos(CENTER[0] * Math.PI / 180);
  const pxAreaHa = (dLat * mPerDegLat) * (dLng * mPerDegLng) / 1e4;

  // --- build pixels with spatially-coherent attributes ---
  const PIX = [];
  const grid = Array.from({ length: NY }, () => Array(NX).fill(null));
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      const la = minLat + (r + 0.5) * dLat, ln = minLng + (c + 0.5) * dLng;
      if (!pointInPoly(la, ln, BND)) continue;
      const u = c / NX, v = r / NY;
      const slope = 4 + 40 * field(u, v, 6.0, 5.0, 1.3);
      const yrs = Math.round(24 * field(u, v, 9.0, 7.0, 4.7));
      const peat = field(u, v, 5.0, 6.0, 9.1) > 0.74;
      const protd = field(u, v, 8.0, 8.0, 2.2) > 0.80;
      const lu = field(u, v, 4.0, 4.5, 6.6);
      const landuse = lu < 0.40 ? 'grazing' : lu < 0.62 ? 'cropland' : lu < 0.80 ? 'shrub' : 'wetland-edge';
      const a = { r, c, la, ln, slope: Math.round(slope), yrs, peat, protd, landuse };
      const px = { a, bounds: [[la - dLat / 2, ln - dLng / 2], [la + dLat / 2, ln + dLng / 2]], eligible: true };
      PIX.push(px);
      grid[r][c] = px;
    }
  }
  document.getElementById('sTotalP').textContent = PIX.length;

  function fails(a, on) {
    const f = [];
    if (on.c_forest && a.yrs < 10) f.push('forested within last 10 yrs');
    if (on.c_slope && a.slope > 30) f.push('slope ' + a.slope + '° > 30°');
    if (on.c_peat && a.peat) f.push('on peat / wetland');
    if (on.c_protected && a.protd) f.push('inside protected area');
    if (on.c_landuse && !(a.landuse === 'grazing' || a.landuse === 'cropland')) f.push('prior use: ' + a.landuse);
    if (on.c_minarea && pxAreaHa < 0.5) f.push('below min size');
    return f;
  }
  const toggles = () => ({
    c_forest: g('c_forest'), c_slope: g('c_slope'), c_peat: g('c_peat'),
    c_protected: g('c_protected'), c_landuse: g('c_landuse'), c_minarea: g('c_minarea'),
  });
  function g(id) { return document.getElementById(id).checked; }

  const rasterGroup = L.layerGroup();
  const vectorGroup = L.layerGroup();
  const reasonEl = document.getElementById('reason');
  let viewMode = 'raster';

  function classify() {
    const on = toggles();
    let eligPx = 0;
    PIX.forEach(px => { px.eligible = fails(px.a, on).length === 0; if (px.eligible) eligPx++; });
    return eligPx;
  }

  function drawRaster() {
    rasterGroup.clearLayers();
    PIX.forEach(px => {
      const rect = L.rectangle(px.bounds, {
        stroke: false, fillColor: px.eligible ? '#4ade80' : '#f87171', fillOpacity: 0.55,
      });
      rect.on('click', () => {
        const f = fails(px.a, toggles());
        reasonEl.innerHTML = f.length === 0
          ? `✅ <strong>Pixel [${px.a.r},${px.a.c}]</strong> (${fmt(pxAreaHa, 2)} ha) — eligible. Slope ${px.a.slope}°, ${px.a.landuse}, non-forest ${px.a.yrs} yr.`
          : `❌ <strong>Pixel [${px.a.r},${px.a.c}]</strong> — excluded: ${f.join('; ')}.`;
      });
      rasterGroup.addLayer(rect);
    });
  }

  // dissolve eligible pixels: soft fill + trace boundary edges (edges not shared with another eligible pixel)
  function drawVector() {
    vectorGroup.clearLayers();
    PIX.forEach(px => {
      if (px.eligible) vectorGroup.addLayer(L.rectangle(px.bounds, { stroke: false, fillColor: '#4ade80', fillOpacity: 0.35 }));
    });
    const segs = [];
    const isElig = (r, c) => r >= 0 && r < NY && c >= 0 && c < NX && grid[r][c] && grid[r][c].eligible;
    PIX.forEach(px => {
      if (!px.eligible) return;
      const { r, c } = px.a;
      const top = px.bounds[1][0], bot = px.bounds[0][0], left = px.bounds[0][1], right = px.bounds[1][1];
      if (!isElig(r + 1, c)) segs.push([[top, left], [top, right]]);
      if (!isElig(r - 1, c)) segs.push([[bot, left], [bot, right]]);
      if (!isElig(r, c - 1)) segs.push([[bot, left], [top, left]]);
      if (!isElig(r, c + 1)) segs.push([[bot, right], [top, right]]);
    });
    if (segs.length) vectorGroup.addLayer(L.polyline(segs, { color: '#16a34a', weight: 2 }));
  }

  function refresh() {
    const eligPx = classify();
    const eligArea = eligPx * pxAreaHa;
    if (viewMode === 'raster') drawRaster(); else drawVector();
    document.getElementById('sElig').textContent = fmt(eligArea);
    document.getElementById('sCount').textContent = eligPx;
    document.getElementById('sRate').textContent = fmt((eligPx / PIX.length) * 100, 0) + '%';
    document.getElementById('sCred').textContent = fmt(eligArea * 8);
  }

  ['c_forest', 'c_slope', 'c_peat', 'c_protected', 'c_landuse', 'c_minarea'].forEach(id =>
    document.getElementById(id).addEventListener('change', refresh));

  PF.bindSeg('view', v => {
    viewMode = v;
    if (v === 'raster') { map.removeLayer(vectorGroup); rasterGroup.addTo(map); }
    else { map.removeLayer(rasterGroup); vectorGroup.addTo(map); }
    refresh();
  });
  PF.bindSeg('basemap', v => {
    if (v === 'sat') { map.removeLayer(osm); sat.addTo(map); }
    else { map.removeLayer(sat); osm.addTo(map); }
  });

  rasterGroup.addTo(map);
  refresh();
  map.fitBounds(L.polygon(BND).getBounds().pad(0.04));
})();
