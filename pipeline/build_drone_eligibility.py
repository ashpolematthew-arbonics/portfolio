#!/usr/bin/env python3
"""
Drone site-eligibility assessment from a real UAV orthomosaic.

Reads a CC-BY drone orthomosaic from OpenAerialMap (a Sudano-Sahelian
agroforestry site in Senegal), warps it to WGS-84, classifies land cover from
visible-band indices + texture (tree/woody, herbaceous, bare soil, water/wet),
derives afforestation eligibility, and exports a compact grid the browser reads
to recompute eligibility live under different rules.

Outputs:
  <portfolio>/assets/img/drone_class_preview.png   (PREVIEW mode: inspect quality)
  <portfolio>/assets/data/drone_eligibility.js     window.DRONE_ELIG = {...}
"""
import os, sys, json, math
import numpy as np
import requests
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from scipy.ndimage import uniform_filter, distance_transform_edt
from PIL import Image

OAM_ID = "68e4ddf928ee177a3c8ca187"      # "vallee", Senegal, UAV, CC-BY 4.0, 2025
PREVIEW = "--preview" in sys.argv
WORK_W = 1200                              # working raster width (px)
GX = 220                                   # export grid width (cells)

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, "..", "assets", "img"))
DATA = os.path.normpath(os.path.join(HERE, "..", "assets", "data"))
os.makedirs(IMG, exist_ok=True); os.makedirs(DATA, exist_ok=True)
os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif"

# class codes
NODATA, TREE, HERB, BARE, WATER = 0, 1, 2, 3, 4
CLASS_COL = {TREE: (34, 139, 34), HERB: (163, 230, 53), BARE: (214, 178, 120), WATER: (56, 120, 200)}


def oam_meta(i):
    j = requests.get(f"https://api.openaerialmap.org/meta/{i}", timeout=60).json()["results"]
    return j[0] if isinstance(j, list) else j


def classify(rgb, valid):
    R, G, B = rgb.astype(np.float32)
    bright = (R + G + B) / 3.0
    exg = 2 * G - R - B                       # excess green (visible-band vegetation)
    # local texture = std of brightness in a 7px window (tree crowns are rough)
    m = uniform_filter(bright, 7); m2 = uniform_filter(bright * bright, 7)
    tex = np.sqrt(np.maximum(m2 - m * m, 0))

    veg = exg > 10
    water = (bright < 55) & ~veg              # dark, non-veg = water/deep shadow
    # tree canopy = vegetation that is BOTH darker and rougher than the crop/grass
    # matrix (data-driven thresholds within the vegetated pixels)
    vb, vt = bright[veg], tex[veg]
    b_thr = np.percentile(vb, 45)             # darker than median-ish
    t_thr = np.percentile(vt, 62)             # rougher than ~upper third
    tree = veg & (bright < b_thr) & (tex > t_thr)
    herb = veg & ~tree                        # smooth, brighter greenness = crop/grass/fallow
    bare = ~veg & ~water                       # exposed soil / track

    cls = np.full(R.shape, NODATA, np.uint8)
    cls[bare] = BARE; cls[herb] = HERB; cls[water] = WATER; cls[tree] = TREE
    cls[~valid] = NODATA
    return cls


def main():
    x = oam_meta(OAM_ID)
    url = x["uuid"]; p = x.get("properties", {})
    print("scene:", x.get("title"), "| license", p.get("license"), "| platform", x.get("platform"))

    with rasterio.open("/vsicurl/" + url) as src:
        with WarpedVRT(src, crs="EPSG:4326", resampling=Resampling.average) as vrt:
            W = WORK_W; H = int(W * vrt.height / vrt.width)
            data = vrt.read(out_shape=(vrt.count, H, W), resampling=Resampling.average)
            b = vrt.bounds  # left, bottom, right, top (lon/lat)
    rgb = data[:3].astype(np.float32)
    valid = (data[3] > 0) if data.shape[0] >= 4 else (rgb.sum(0) > 12)
    print(f"working raster {W}x{H}, bounds {[round(v,5) for v in b]}, valid {valid.mean()*100:.0f}%")

    cls = classify(rgb, valid)
    frac = {k: round(float((cls == k).mean() / max(valid.mean(), 1e-6) * 100), 1) for k in (TREE, HERB, BARE, WATER)}
    print("class % of site:", {"tree": frac[TREE], "herb": frac[HERB], "bare": frac[BARE], "water": frac[WATER]})

    if PREVIEW:
        # colour preview + rgb, side by side inspection
        col = np.zeros((H, W, 3), np.uint8)
        for k, c in CLASS_COL.items():
            col[cls == k] = c
        Image.fromarray(col).save(os.path.join(IMG, "drone_class_preview.png"))
        Image.fromarray(np.transpose(rgb.astype(np.uint8), (1, 2, 0))).save(os.path.join(IMG, "drone_rgb_preview.png"))
        print("wrote previews -> assets/img/drone_class_preview.png, drone_rgb_preview.png")
        return

    # ---- downsample class to export grid (majority vote) + distance-to-tree (m) ----
    GY = int(GX * H / W)
    site_w_m = (b[2] - b[0]) * 111320 * math.cos(math.radians((b[1] + b[3]) / 2))
    site_h_m = (b[3] - b[1]) * 111320
    px_m = site_h_m / H                         # working-res pixel size (m)
    dist_tree = distance_transform_edt(cls != TREE) * px_m   # metres to nearest tree

    grid = np.zeros((GY, GX), np.uint8)
    dgrid = np.zeros((GY, GX), np.uint8)
    ys = np.linspace(0, H, GY + 1).astype(int); xs = np.linspace(0, W, GX + 1).astype(int)
    for r in range(GY):
        for c in range(GX):
            block = cls[ys[r]:ys[r+1], xs[c]:xs[c+1]]
            vals = block[block != NODATA]
            grid[r, c] = np.bincount(vals, minlength=5).argmax() if vals.size else NODATA
            dblock = dist_tree[ys[r]:ys[r+1], xs[c]:xs[c+1]]
            dgrid[r, c] = int(min(60, dblock.mean())) if dblock.size else 0

    n_valid = int((grid != NODATA).sum())
    site_ha = site_w_m * site_h_m / 1e4 * valid.mean()
    cell_ha = site_ha / max(n_valid, 1)

    out = {
        "title": x.get("title"), "provider": x.get("provider"),
        "license": p.get("license"), "acq": (x.get("acquisition_end") or "")[:10],
        "platform": x.get("platform"), "gsd_m": round(p.get("resolution_in_meters") or 0, 3),
        "oam_id": OAM_ID, "tms": p.get("tms"),
        "bbox": [round(b[0], 6), round(b[1], 6), round(b[2], 6), round(b[3], 6)],
        "gx": GX, "gy": GY, "cell_ha": round(cell_ha, 4), "site_ha": round(site_ha, 1),
        "class_pct": {"tree": frac[TREE], "herb": frac[HERB], "bare": frac[BARE], "water": frac[WATER]},
        "grid": grid.flatten().tolist(),
        "dist": dgrid.flatten().tolist(),
    }
    with open(os.path.join(DATA, "drone_eligibility.js"), "w", encoding="utf-8") as f:
        f.write("window.DRONE_ELIG = " + json.dumps(out) + ";\n")
    kb = os.path.getsize(os.path.join(DATA, "drone_eligibility.js")) // 1024
    print(f"wrote drone_eligibility.js ({kb} KB); grid {GX}x{GY}, site {site_ha:.0f} ha")


if __name__ == "__main__":
    main()
