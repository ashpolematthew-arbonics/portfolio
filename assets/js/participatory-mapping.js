// Drone participatory mapping — Leaflet.draw with area/perimeter + GeoJSON export
(function () {
  const { fmt } = PF;
  const CENTER = [9.412, -0.965]; // generic agroforestry landscape (N Ghana style)
  const COLORS = {
    agroforestry: '#4ade80', grazing: '#fbbf24', cropland: '#fb923c',
    forest: '#16a34a', settlement: '#f87171',
  };
  let currentClass = 'agroforestry';

  const map = L.map('map', { scrollWheelZoom: true }).setView(CENTER, 16);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 19 }).addTo(map);

  const drawn = new L.FeatureGroup().addTo(map);
  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawn, remove: true },
    draw: {
      polygon: { allowIntersection: false, showArea: false, shapeOptions: { color: COLORS[currentClass], weight: 2 } },
      rectangle: { shapeOptions: { color: COLORS[currentClass], weight: 2 } },
      polyline: false, circle: false, circlemarker: false, marker: false,
    },
  });
  map.addControl(drawControl);

  const parcels = []; // {layer, cls}

  // Spherical polygon area (m^2) — same approach as Leaflet.GeometryUtil / Turf
  function ringAreaM2(latlngs) {
    const R = 6378137;
    let area = 0;
    const n = latlngs.length;
    for (let i = 0; i < n; i++) {
      const p1 = latlngs[i], p2 = latlngs[(i + 1) % n];
      area += (toRad(p2.lng) - toRad(p1.lng)) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
    }
    return Math.abs(area * R * R / 2);
  }
  function perimeterM(latlngs) {
    let d = 0;
    for (let i = 0; i < latlngs.length; i++) {
      d += map.distance(latlngs[i], latlngs[(i + 1) % latlngs.length]);
    }
    return d;
  }
  const toRad = d => d * Math.PI / 180;

  function refresh() {
    let totalArea = 0, totalPerim = 0;
    const byClass = {};
    parcels.forEach(p => {
      const ll = p.layer.getLatLngs()[0];
      const a = ringAreaM2(ll) / 1e4;        // ha
      totalArea += a;
      totalPerim += perimeterM(ll) / 1000;   // km
      byClass[p.cls] = (byClass[p.cls] || 0) + a;
    });
    document.getElementById('sN').textContent = parcels.length;
    document.getElementById('sArea').textContent = fmt(totalArea, 1) + ' ha';
    document.getElementById('sPerim').textContent = fmt(totalPerim, 2) + ' km';
    document.getElementById('sCls').textContent = Object.keys(byClass).length;

    const sum = document.getElementById('summary');
    if (!parcels.length) { sum.textContent = 'No parcels yet — start drawing.'; return; }
    sum.innerHTML = Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div style="display:flex;justify-content:space-between;padding:3px 0">
        <span><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${COLORS[k]};margin-right:7px"></i>${k}</span>
        <span class="mono">${fmt(v, 1)} ha</span></div>`).join('');
  }

  map.on(L.Draw.Event.CREATED, e => {
    const layer = e.layer;
    layer.setStyle && layer.setStyle({ color: COLORS[currentClass], fillColor: COLORS[currentClass], fillOpacity: 0.35, weight: 2 });
    drawn.addLayer(layer);
    const rec = { layer, cls: currentClass };
    parcels.push(rec);
    const ll = layer.getLatLngs()[0];
    layer.bindPopup(`<b>${currentClass}</b><br>${fmt(ringAreaM2(ll) / 1e4, 2)} ha`).openPopup();
    refresh();
  });

  map.on(L.Draw.Event.DELETED, e => {
    e.layers.eachLayer(l => {
      const idx = parcels.findIndex(p => p.layer === l);
      if (idx >= 0) parcels.splice(idx, 1);
    });
    refresh();
  });
  map.on(L.Draw.Event.EDITED, refresh);

  PF.bindSeg('lcclass', v => {
    currentClass = v;
    // update draw tool default colors
    drawControl.setDrawingOptions({
      polygon: { shapeOptions: { color: COLORS[v], weight: 2 } },
      rectangle: { shapeOptions: { color: COLORS[v], weight: 2 } },
    });
  });

  document.getElementById('clear').addEventListener('click', () => {
    drawn.clearLayers(); parcels.length = 0; refresh();
  });

  document.getElementById('export').addEventListener('click', () => {
    const fc = {
      type: 'FeatureCollection',
      features: parcels.map((p, i) => {
        const ll = p.layer.getLatLngs()[0];
        const coords = ll.map(c => [c.lng, c.lat]);
        coords.push(coords[0]);
        return {
          type: 'Feature',
          properties: { id: i, landcover: p.cls, area_ha: +(ringAreaM2(ll) / 1e4).toFixed(3) },
          geometry: { type: 'Polygon', coordinates: [coords] },
        };
      }),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'participatory_map.geojson';
    a.click();
  });

  refresh();
})();
