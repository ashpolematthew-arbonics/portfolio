# Carbon MRV & Geospatial Portfolio

A zero-build static portfolio site with five live, browser-only interactive demos of forest-carbon data-science workflows:

| Demo | What it shows | Tech |
|------|---------------|------|
| **Ex-ante carbon calculation** | Chapman–Richards growth → annual & cumulative tCO₂e with Monte-Carlo uncertainty | Plotly |
| **Drone site eligibility** | Screening parcels against AND-ed afforestation eligibility rules | Leaflet |
| **Tree age from LiDAR** | Synthetic CHM, local-maxima crown detection, height–age inversion | Plotly |
| **Drone participatory mapping** | Draw/measure land parcels over imagery, export GeoJSON | Leaflet.draw |
| **Stratification & plot sampling** | VCS plot-count sizing with Neyman allocation & uncertainty deduction | Plotly |

All data is **synthetic / illustrative** — no client or proprietary information. The methods, formulas and structure mirror real production workflows.

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
