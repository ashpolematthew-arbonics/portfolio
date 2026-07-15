// Shared helpers across demos
window.PF = (function () {
  const COLORS = {
    accent: '#4ade80', accent2: '#38bdf8', warn: '#fbbf24', danger: '#f87171',
    text: '#e8f0ea', muted: '#9bb4a6', grid: '#23382e', panel: '#15241d',
  };

  function plotLayout(extra = {}) {
    return Object.assign({
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter, sans-serif', color: COLORS.text, size: 13 },
      margin: { l: 60, r: 20, t: 30, b: 50 },
      xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid, linecolor: COLORS.grid },
      yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid, linecolor: COLORS.grid },
      legend: { orientation: 'h', y: 1.12, x: 0, font: { size: 12 } },
      hovermode: 'x unified',
      hoverlabel: { bgcolor: 'rgba(9,16,12,0.96)', bordercolor: '#4ade80',
                    font: { family: 'Inter, sans-serif', color: '#f3f8f4', size: 13 } },
    }, extra);
  }
  const CONFIG = { displayModeBar: false, responsive: true };

  const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // Deterministic PRNG so demos are reproducible
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Box-Muller normal
  function randn(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function percentile(sorted, p) {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // wire a range input to a label value display + callback
  function bindRange(id, valId, cb, suffix = '') {
    const el = document.getElementById(id);
    const out = document.getElementById(valId);
    const update = () => { if (out) out.textContent = el.value + suffix; cb && cb(); };
    el.addEventListener('input', update);
    update();
    return el;
  }
  // segmented control: container has buttons with data-val
  function bindSeg(containerId, cb) {
    const c = document.getElementById(containerId);
    c.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        c.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        cb && cb(b.dataset.val);
      });
    });
    const active = c.querySelector('button.active') || c.querySelector('button');
    return active.dataset.val;
  }

  return { COLORS, plotLayout, CONFIG, fmt, mulberry32, randn, percentile, bindRange, bindSeg };
})();
