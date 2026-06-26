// Drone site eligibility — procedurally generated parcels screened against AND-ed rules
(function () {
  const { fmt, mulberry32 } = PF;
  const rng = mulberry32(20240626);

  // Center on a generic Baltic/boreal rural landscape
  const CENTER = [58.62, 25.45];
  const map = L.map('map', { scrollWheelZoom: true }).setView(CENTER, 13);

  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 18 });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19 });
  sat.addTo(map);

  // Build a grid of irregular parcels
  const PARCELS = [];
  const rows = 9, cols = 9, cell = 0.011;
  const lat0 = CENTER[0] - (rows * cell) / 2, lng0 = CENTER[1] - (cols * cell) / 2.0;
  const LANDUSE = ['grazing', 'cropland', 'shrub', 'wetland-edge'];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // jitter corners for organic look
      const j = () => (rng() - 0.5) * cell * 0.35;
      const la = lat0 + r * cell, ln = lng0 + c * cell;
      const poly = [
        [la + j(), ln + j()],
        [la + j(), ln + cell + j()],
        [la + cell + j(), ln + cell + j()],
        [la + cell + j(), ln + j()],
      ];
      // synthetic attributes
      const area = 25 + rng() * 95; // hectares (cell ~ big enough to be interesting)
      const attr = {
        id: id++,
        area: area,
        yearsNonForest: Math.floor(rng() * 25),          // 0..24
        slope: Math.round(rng() * 45),                   // degrees
        peat: rng() < 0.18,
        protected: rng() < 0.12,
        landuse: LANDUSE[Math.floor(rng() * LANDUSE.length)],
      };
      PARCELS.push({ poly, attr, layer: null });
    }
  }
  document.getElementById('sTotalP').textContent = PARCELS.length;

  function rulesFor(a, on) {
    const fails = [];
    if (on.c_forest && a.yearsNonForest < 10) fails.push('forested within last 10 yrs');
    if (on.c_slope && a.slope > 30) fails.push('slope ' + a.slope + '° > 30°');
    if (on.c_peat && a.peat) fails.push('on peat / wetland');
    if (on.c_protected && a.protected) fails.push('inside protected area');
    if (on.c_landuse && !(a.landuse === 'grazing' || a.landuse === 'cropland')) fails.push('prior use: ' + a.landuse);
    if (on.c_minarea && a.area < 0.5) fails.push('below min size');
    return fails;
  }

  const reasonEl = document.getElementById('reason');

  function readToggles() {
    return {
      c_forest: f('c_forest'), c_slope: f('c_slope'), c_peat: f('c_peat'),
      c_protected: f('c_protected'), c_landuse: f('c_landuse'), c_minarea: f('c_minarea'),
    };
    function f(id) { return document.getElementById(id).checked; }
  }

  function render() {
    const on = readToggles();
    let eligArea = 0, eligCount = 0, totalArea = 0;

    PARCELS.forEach(p => {
      const fails = rulesFor(p.attr, on);
      const eligible = fails.length === 0;
      totalArea += p.attr.area;
      if (eligible) { eligArea += p.attr.area; eligCount++; }

      const style = {
        color: eligible ? '#16a34a' : '#b91c1c',
        weight: 1.2,
        fillColor: eligible ? '#4ade80' : '#f87171',
        fillOpacity: 0.45,
      };
      if (!p.layer) {
        p.layer = L.polygon(p.poly, style).addTo(map);
        p.layer.on('click', () => {
          const f = rulesFor(p.attr, readToggles());
          reasonEl.innerHTML = f.length === 0
            ? `✅ <strong>Parcel #${p.attr.id}</strong> (${fmt(p.attr.area, 1)} ha) — eligible. Slope ${p.attr.slope}°, ${p.attr.landuse}, non-forest ${p.attr.yearsNonForest} yr.`
            : `❌ <strong>Parcel #${p.attr.id}</strong> (${fmt(p.attr.area, 1)} ha) — excluded: ${f.join('; ')}.`;
        });
        p.layer.on('mouseover', () => p.layer.setStyle({ fillOpacity: 0.7 }));
        p.layer.on('mouseout', () => p.layer.setStyle({ fillOpacity: 0.45 }));
      } else {
        p.layer.setStyle(style);
      }
    });

    document.getElementById('sElig').textContent = fmt(eligArea);
    document.getElementById('sCount').textContent = eligCount;
    document.getElementById('sRate').textContent = fmt((eligArea / totalArea) * 100, 0) + '%';
    document.getElementById('sCred').textContent = fmt(eligArea * 8);
  }

  ['c_forest', 'c_slope', 'c_peat', 'c_protected', 'c_landuse', 'c_minarea'].forEach(id =>
    document.getElementById(id).addEventListener('change', render));

  PF.bindSeg('basemap', v => {
    if (v === 'sat') { map.removeLayer(osm); sat.addTo(map); }
    else { map.removeLayer(sat); osm.addTo(map); }
  });

  render();
  map.fitBounds(L.polygon(PARCELS.flatMap(p => p.poly)).getBounds().pad(0.05));
})();
