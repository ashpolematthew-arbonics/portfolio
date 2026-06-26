// Ex-ante carbon calculation — Chapman-Richards growth + Monte-Carlo uncertainty
(function () {
  const { plotLayout, CONFIG, COLORS, fmt, mulberry32, randn, percentile } = PF;

  // Synthetic but realistic species base params (tCO2e/ha asymptote, rate k, shape p)
  const SPECIES = {
    pine:   { name: 'Pine',   Bmax: 360, k: 0.045, p: 1.9 },
    spruce: { name: 'Spruce', Bmax: 430, k: 0.050, p: 2.1 },
    birch:  { name: 'Birch',  Bmax: 300, k: 0.060, p: 1.6 },
  };
  // Region multipliers: [Bmax scale, k scale]
  const REGION = {
    north:     { name: 'N boreal',  bm: 0.78, kf: 0.85 },
    south:     { name: 'S boreal',  bm: 1.00, kf: 1.00 },
    temperate: { name: 'Temperate', bm: 1.22, kf: 1.18 },
  };

  const state = { species: 'pine', region: 'south', area: 500, years: 30, stock: 0.85, buf: 0.18, mc: true };

  const cr = (t, Bmax, k, p) => Bmax * Math.pow(1 - Math.exp(-k * t), p);

  function curve(Bmax, k, p, years) {
    const out = [];
    for (let t = 0; t <= years; t++) out.push(cr(t, Bmax, k, p));
    return out;
  }

  function compute() {
    const sp = SPECIES[state.species], rg = REGION[state.region];
    const Bmax = sp.Bmax * rg.bm * state.stock;
    const k = sp.k * rg.kf, p = sp.p;
    const years = state.years, area = state.area, net = 1 - state.buf;

    const perHa = curve(Bmax, k, p, years);                 // cumulative tCO2e/ha
    const cumTotal = perHa.map(v => v * area);              // cumulative project total (gross)
    const cumNet = cumTotal.map(v => v * net);              // after buffer
    const annual = cumNet.map((v, i) => i === 0 ? 0 : v - cumNet[i - 1]);

    // Monte-Carlo envelope on cumulative net
    let band = null;
    if (state.mc) {
      const N = 250, rng = mulberry32(1337);
      const runs = [];
      for (let r = 0; r < N; r++) {
        const kk = Math.max(0.01, k * (1 + 0.18 * randn(rng)));
        const pp = Math.max(0.5, p * (1 + 0.10 * randn(rng)));
        const bb = Math.max(10, Bmax * (1 + 0.12 * randn(rng)));
        runs.push(curve(bb, kk, pp, years).map(v => v * area * net));
      }
      const lo = [], hi = [];
      for (let t = 0; t <= years; t++) {
        const col = runs.map(r => r[t]).sort((a, b) => a - b);
        lo.push(percentile(col, 0.05));
        hi.push(percentile(col, 0.95));
      }
      band = { lo, hi };
    }

    const peakIdx = annual.indexOf(Math.max(...annual));
    return { perHa, cumNet, annual, band, years, Bmax, k, p, peakIdx,
             total: cumNet[years], meanAnnual: cumNet[years] / years, grossHa: perHa[years] };
  }

  function render() {
    const d = compute();
    const x = Array.from({ length: d.years + 1 }, (_, i) => i);

    const traces = [];
    if (d.band) {
      traces.push({ x, y: d.band.hi, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      traces.push({ x, y: d.band.lo, mode: 'lines', line: { width: 0 }, fill: 'tonexty',
        fillcolor: 'rgba(74,222,128,0.15)', name: 'P5–P95', hoverinfo: 'skip' });
    }
    traces.push({ x, y: d.cumNet, mode: 'lines', name: 'Cumulative net tCO₂e',
      line: { color: COLORS.accent, width: 3 }, hovertemplate: '%{y:,.0f} tCO₂e<extra>yr %{x}</extra>' });

    Plotly.react('plot', traces, plotLayout({
      xaxis: { title: 'Project year', gridcolor: COLORS.grid },
      yaxis: { title: 'Cumulative tCO₂e (net of buffer)', gridcolor: COLORS.grid },
    }), CONFIG);

    Plotly.react('plot2', [{
      x: x.slice(1), y: d.annual.slice(1), type: 'bar', name: 'Annual issuance',
      marker: { color: COLORS.accent2 }, hovertemplate: '%{y:,.0f} tCO₂e<extra>yr %{x}</extra>',
    }], plotLayout({
      margin: { l: 60, r: 20, t: 10, b: 45 },
      xaxis: { title: 'Project year', gridcolor: COLORS.grid },
      yaxis: { title: 'Annual tCO₂e', gridcolor: COLORS.grid },
      showlegend: false,
    }), CONFIG);

    document.getElementById('sTotal').textContent = fmt(d.total);
    document.getElementById('sAnnual').textContent = fmt(d.meanAnnual);
    document.getElementById('sPeak').textContent = 'yr ' + d.peakIdx;
    document.getElementById('sHa').textContent = fmt(d.grossHa);
  }

  // wire controls
  const area = document.getElementById('area'), years = document.getElementById('years'),
        stock = document.getElementById('stock'), buf = document.getElementById('buf');

  PF.bindSeg('species', v => { state.species = v; render(); });
  PF.bindSeg('region', v => { state.region = v; render(); });
  PF.bindRange('area', 'areaV', () => { state.area = +area.value; render(); }, ' ha');
  PF.bindRange('years', 'yearsV', () => { state.years = +years.value; render(); }, ' yr');
  PF.bindRange('stock', 'stockV', () => { state.stock = +stock.value / 100; render(); }, ' %');
  PF.bindRange('buf', 'bufV', () => { state.buf = +buf.value / 100; render(); }, ' %');
  document.getElementById('mc').addEventListener('change', e => { state.mc = e.target.checked; render(); });

  render();
})();
