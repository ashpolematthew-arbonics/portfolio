#!/usr/bin/env python3
"""
Biomass-map disagreement audit — northern Ghana (Great Green Wall belt).

Compares two independent, published aboveground-biomass (AGB) products over a real
dryland-savanna window and quantifies their disagreement, stratified by land cover,
then translates that into carbon-crediting terms.

Products (same units: Mg/ha aboveground biomass):
  - Spawn & Gibbs (2010) harmonized AGB   NASA/ORNL/biomass_carbon_density/v1  band 'agb'
  - GEDI L4B (2019-2023) AGBD             LARSE/GEDI/GEDI04_B_002              band 'MU'
Land cover for stratification:
  - ESA WorldCover 2021                   ESA/WorldCover/v200/2021            band 'Map'

Outputs (written into ../assets):
  assets/data/biomass_audit.json   stats + downsampled sample points
  assets/img/agb_spawn.png         AGB map (shared colour scale)
  assets/img/agb_gedi.png          AGB map (shared colour scale)
  assets/img/agb_diff.png          Spawn - GEDI difference (diverging)

Reproducible: run with an authenticated Earth Engine project.
    python build_biomass_audit.py
"""
import json, os, io, sys
import numpy as np
import requests
import ee

PROJECT = os.environ.get("EE_PROJECT", "arbonics-488410")
HERE = os.path.dirname(os.path.abspath(__file__))
ASSET_DIR = os.path.normpath(os.path.join(HERE, "..", "assets"))
IMG_DIR = os.path.join(ASSET_DIR, "img")
DATA_DIR = os.path.join(ASSET_DIR, "data")
os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Study window: northern Ghana — Bongo / Bolgatanga / Yendi (Tree Aid GGW belt)
BBOX = [-1.2, 9.0, 0.8, 11.2]   # [W, S, E, N]
SCALE = 1000                    # metres — matches GEDI L4B 1 km grid

# WorldCover class map -> label (only the classes that matter here)
WC_LABELS = {
    10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland",
    50: "Built-up", 60: "Bare/sparse", 80: "Water", 90: "Wetland",
}

AGB_VIS_MAX = 40.0    # Mg/ha, shared scale for the two AGB maps (region P95 ~ 35)
DIFF_VIS = 15.0       # Mg/ha, +/- for difference map (~2x regional MAE)


def main():
    ee.Initialize(project=PROJECT)
    roi = ee.Geometry.Rectangle(BBOX)

    spawn = ee.ImageCollection("NASA/ORNL/biomass_carbon_density/v1").first().select("agb").rename("spawn")
    gedi = ee.Image("LARSE/GEDI/GEDI04_B_002").select("MU").rename("gedi")
    wc = ee.Image("ESA/WorldCover/v200/2021").select("Map").rename("lc")

    stack = spawn.addBands(gedi).addBands(wc)

    # ---- region means per product ----
    print("Computing region statistics ...")
    means = stack.select(["spawn", "gedi"]).reduceRegion(
        reducer=ee.Reducer.mean(), geometry=roi, scale=SCALE, maxPixels=1e10, bestEffort=True
    ).getInfo()

    # ---- sample points for scatter + per-class stats ----
    print("Sampling points ...")
    samp = stack.sample(region=roi, scale=SCALE, numPixels=3000, seed=7, geometries=False, dropNulls=True)
    feats = samp.getInfo()["features"]
    rows = [(f["properties"].get("spawn"), f["properties"].get("gedi"), f["properties"].get("lc")) for f in feats]
    arr = np.array([(s, g, c) for (s, g, c) in rows if s is not None and g is not None and c is not None], dtype=float)
    sp, gd, lc = arr[:, 0], arr[:, 1], arr[:, 2].astype(int)
    print(f"  usable samples: {len(sp)}")

    # ---- agreement metrics ----
    bias = float(np.mean(sp - gd))                       # Spawn - GEDI
    mae = float(np.mean(np.abs(sp - gd)))
    rmse = float(np.sqrt(np.mean((sp - gd) ** 2)))
    both_mean = float(np.mean((sp + gd) / 2))
    rel_disagree = float(mae / both_mean * 100)          # % of mean stock
    r = float(np.corrcoef(sp, gd)[0, 1])
    r2 = r * r

    # ---- per-land-cover-class breakdown ----
    by_class = []
    for code in sorted(set(lc)):
        m = lc == code
        if m.sum() < 15:
            continue
        s_m, g_m = sp[m], gd[m]
        pair_mean = float(np.mean((s_m + g_m) / 2))
        by_class.append({
            "code": int(code),
            "label": WC_LABELS.get(int(code), str(code)),
            "n": int(m.sum()),
            "spawn_mean": round(float(np.mean(s_m)), 1),
            "gedi_mean": round(float(np.mean(g_m)), 1),
            "mae": round(float(np.mean(np.abs(s_m - g_m))), 1),
            "rel_disagree": round(float(np.mean(np.abs(s_m - g_m)) / pair_mean * 100), 1) if pair_mean > 0 else None,
        })
    by_class.sort(key=lambda d: -d["n"])

    # ---- crediting translation ----
    # AGB (Mg/ha) -> aboveground carbon -> CO2e ; carbon fraction 0.47, CO2:C 44/12
    C_FRAC, CO2 = 0.47, 44.0 / 12.0
    co2_per_ha = lambda agb: agb * C_FRAC * CO2
    mean_stock_ha = co2_per_ha(both_mean)          # tCO2e/ha, mean of the two maps
    local_err_ha = co2_per_ha(mae)                 # tCO2e/ha, typical local (pixel-scale) discrepancy
    # illustrative project footprint at which siting/stratification happens
    proj_ha = 10_000
    spawn_proj = co2_per_ha(means["spawn"]) * proj_ha / 1e3   # ktCO2e
    gedi_proj = co2_per_ha(means["gedi"]) * proj_ha / 1e3
    local_err_proj = local_err_ha * proj_ha / 1e3             # ktCO2e typical local error

    stats = {
        "region": "Northern Ghana (Bongo–Bolgatanga–Yendi), Great Green Wall belt",
        "bbox": BBOX,
        "scale_m": SCALE,
        "n_samples": int(len(sp)),
        "products": {
            "spawn": {"name": "Spawn & Gibbs 2010 (harmonized)", "epoch": "~2010", "mean_agb": round(means["spawn"], 1)},
            "gedi": {"name": "GEDI L4B", "epoch": "2019–2023", "mean_agb": round(means["gedi"], 1)},
        },
        "agreement": {
            "mean_bias_spawn_minus_gedi": round(bias, 1),
            "mae": round(mae, 1),
            "rmse": round(rmse, 1),
            "rel_disagree_pct": round(rel_disagree, 1),
            "r2": round(r2, 3),
        },
        "by_class": by_class,
        "crediting": {
            "carbon_fraction": C_FRAC,
            "mean_stock_tco2_ha": round(mean_stock_ha, 1),
            "local_err_tco2_ha": round(local_err_ha, 1),
            "local_disagree_pct": round(rel_disagree, 1),
            "regional_gap_pct": round(abs(bias) / both_mean * 100, 1),
            "proj_ha": proj_ha,
            "spawn_proj_ktco2e": round(spawn_proj, 0),
            "gedi_proj_ktco2e": round(gedi_proj, 0),
            "local_err_proj_ktco2e": round(local_err_proj, 0),
        },
        # downsample scatter to keep the JSON light
        "samples": [
            {"s": round(float(s), 1), "g": round(float(g), 1), "c": int(c)}
            for s, g, c in list(zip(sp, gd, lc))[:1200]
        ],
        "wc_labels": WC_LABELS,
        "vis": {"agb_max": AGB_VIS_MAX, "diff": DIFF_VIS},
    }

    with open(os.path.join(DATA_DIR, "biomass_audit.json"), "w") as f:
        json.dump(stats, f, indent=1)
    # also emit a JS-global version so the demo works when opened directly (file://),
    # where fetch() of a local file is blocked by the browser.
    with open(os.path.join(DATA_DIR, "biomass_audit.js"), "w") as f:
        f.write("window.BIOMASS_AUDIT = " + json.dumps(stats) + ";\n")
    print("Wrote biomass_audit.json + biomass_audit.js")
    print(json.dumps(stats["agreement"], indent=1))
    print(json.dumps(stats["crediting"], indent=1))

    # ---- map thumbnails ----
    agb_palette = ["#f7fcb9", "#addd8e", "#41ab5d", "#238443", "#005a32"]
    diff_palette = ["#8c510a", "#d8b365", "#f6e8c3", "#f5f5f5", "#c7eae5", "#5ab4ac", "#01665e"]

    # fixed pixel grid so all overlays align exactly on the web map.
    # ROI is 2.0deg wide x 2.2deg tall -> 800 x 880.
    def download(img, vis, name):
        url = img.clip(roi).getThumbURL({
            "region": roi, "dimensions": "800x880", "crs": "EPSG:4326", "format": "png", **vis})
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        with open(os.path.join(IMG_DIR, name), "wb") as fh:
            fh.write(r.content)
        print("Wrote", name, f"({len(r.content)//1024} KB)")

    download(spawn, {"min": 0, "max": AGB_VIS_MAX, "palette": agb_palette}, "agb_spawn.png")
    download(gedi, {"min": 0, "max": AGB_VIS_MAX, "palette": agb_palette}, "agb_gedi.png")
    download(spawn.subtract(gedi), {"min": -DIFF_VIS, "max": DIFF_VIS, "palette": diff_palette}, "agb_diff.png")

    print("Done.")


if __name__ == "__main__":
    main()
