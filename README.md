# Carbon MRV & Geospatial Portfolio

A zero-build static portfolio site with five live, browser-only interactive demos of forest-carbon data-science workflows:

| Demo | What it shows | Tech |
|------|---------------|------|
| **Biomass-map disagreement audit** ⭐ *real data* | Spawn 2010 vs GEDI L4B AGB over N. Ghana — agree on regional total, disagree ~48% pixel-wise; crediting implications | Earth Engine + Leaflet + Plotly |
| **Tree age from LiDAR → growth DB** ⭐ *real data* | Real Estonian ALS crowns (1 tile of 1.2M); crown-area-correction toggle collapses a false "mature" tail; reliability envelope | Leaflet + Plotly |
| **Permanence & bark-beetle risk** ⭐ *real data* | Real Sentinel-2 detection of the Harz outbreak (own EO pipeline) → Monte-Carlo buffer-pool sizing | Earth Engine + Leaflet + Plotly |
| **Ex-ante carbon calculation** | Chapman–Richards growth → annual & cumulative tCO₂e with Monte-Carlo uncertainty | Plotly |
| **Drone site eligibility** | Screening parcels against AND-ed afforestation eligibility rules | Leaflet |
| **Tree age from LiDAR** | Synthetic CHM, local-maxima crown detection, height–age inversion | Plotly |
| **Drone participatory mapping** | Draw/measure land parcels over imagery, export GeoJSON | Leaflet.draw |
| **Stratification & plot sampling** | VCS plot-count sizing with Neyman allocation & uncertainty deduction | Plotly |

Most demos use **synthetic / illustrative** data (no client or proprietary information); the methods, formulas and structure mirror real production workflows. The **biomass-map disagreement audit uses real published satellite data** (NASA GEDI L4B, Spawn & Gibbs, ESA WorldCover), pre-computed in Google Earth Engine.

## Real-data pipeline

`pipeline/build_biomass_audit.py` reproduces the biomass audit: it pulls the three products from Earth Engine over a northern-Ghana window, computes agreement metrics stratified by land cover, translates the disagreement into carbon-crediting terms, and exports the static assets the demo reads (`assets/data/biomass_audit.json`, `assets/img/agb_*.png`). Requires an authenticated Earth Engine project:

```bash
pip install earthengine-api numpy requests pillow
python pipeline/build_biomass_audit.py   # set EE_PROJECT env var to your GEE project
```

## Stack

Plain HTML/CSS/vanilla JS. No build step, no framework, no dependencies to install — libraries (Plotly, Leaflet) load from CDN. That's what makes it free to host on GitHub Pages.

```
index.html              landing page
demos/*.html            one page per demo
assets/css/style.css    design system
assets/js/*.js          one module per demo + common.js helpers
.github/workflows/      GitHub Pages deploy
```

## Run locally

Just open `index.html`, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Deploy (GitHub Pages)

1. Create a new public repo on GitHub (e.g. `portfolio`).
2. Push this folder to it (see commands below).
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The included workflow publishes on every push to `main`. Your site goes live at
   `https://<username>.github.io/<repo>/`.

```bash
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```
