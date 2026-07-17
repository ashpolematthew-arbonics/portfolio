#!/usr/bin/env python3
"""
Drone site-eligibility assessment from real UAV orthomosaics.

For each of several CC-BY drone scenes on OpenAerialMap, warps the COG to WGS-84,
classifies land cover from visible-band indices + texture (tree/herbaceous/bare/
water), segments cultivated field parcels (Felzenszwalb + region filtering) and
excludes them, then exports a compact per-scene grid the browser reads to
recompute afforestation eligibility live. A scene switcher lets the user compare
the method across an agroforestry-cropland site and an arid rangeland site.

Output:
  <portfolio>/assets/data/drone_eligibility.js   window.DRONE_ELIG = {scenes:{...}}
  (with --preview: also assets/img/drone_class_preview.png for the first scene)
"""
import os, sys, json, math
import numpy as np
import requests
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from scipy import ndimage as ndi
from scipy.ndimage import uniform_filter, distance_transform_edt
from skimage.segmentation import felzenszwalb
from skimage.measure import regionprops
from PIL import Image

SCENES = [
    {"key": "senegal", "id": "68e4ddf928ee177a3c8ca187",
     "label": "Vallée, Senegal", "ctx": "Sudano-Sahelian agroforestry cropland"},
    {"key": "turkana", "id": "64b0212df1006f000147ae86",
     "label": "Kalobeyei, Kenya", "ctx": "Arid degraded rangeland (Turkana)"},
]
PREVIEW = "--preview" in sys.argv
WORK_LONG = 1200      # working raster long-axis (px)
GRID_LONG = 220       # export grid long-axis (cells)

# field segmentation (Felzenszwalb + region filtering)
FELZ_SCALE, FELZ_SIGMA, FELZ_MIN = 120, 0.8, 500
FIELD_MIN_HA, FIELD_STD_MAX, FIELD_EXTENT_MIN, FIELD_TREE_MAX = 0.12, 21.0, 0.38, 0.35

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, "..", "assets", "img"))
DATA = os.path.normpath(os.path.join(HERE, "..", "assets", "data"))
os.makedirs(IMG, exist_ok=True); os.makedirs(DATA, exist_ok=True)
os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif"

NODATA, TREE, HERB, BARE, WATER, FIELD = 0, 1, 2, 3, 4, 5
CLASS_COL = {TREE: (34, 139, 34), HERB: (163, 230, 53), BARE: (214, 178, 120),
             WATER: (56, 120, 200), FIELD: (234, 120, 40)}


def oam_meta(i):
    j = requests.get(f"https://api.openaerialmap.org/meta/{i}", timeout=60).json()["results"]
    return j[0] if isinstance(j, list) else j


def classify(rgb, valid):
    R, G, B = rgb.astype(np.float32)
    bright = (R + G + B) / 3.0
    exg = 2 * G - R - B
    m = uniform_filter(bright, 7); m2 = uniform_filter(bright * bright, 7)
    tex = np.sqrt(np.maximum(m2 - m * m, 0))

    veg = exg > 10
    water = (bright < 55) & ~veg
    tree = np.zeros_like(veg)
    if veg.sum() > 200:            # tree = vegetation both darker and rougher than matrix
        b_thr = np.percentile(bright[veg], 45); t_thr = np.percentile(tex[veg], 62)
        tree = veg & (bright < b_thr) & (tex > t_thr)
    herb = veg & ~tree
    bare = ~veg & ~water

    cls = np.full(R.shape, NODATA, np.uint8)
    cls[bare] = BARE; cls[herb] = HERB; cls[water] = WATER; cls[tree] = TREE
    cls[~valid] = NODATA
    return cls


def segment_fields(rgb, cls, valid, px_m):
    """Detect cultivated parcels: large, internally homogeneous, block-shaped,
    non-tree Felzenszwalb segments over open (herb/bare) cover."""
    seg = felzenszwalb(np.transpose(rgb, (1, 2, 0)) / 255.0,
                       scale=FELZ_SCALE, sigma=FELZ_SIGMA, min_size=FELZ_MIN)
    exg = (2 * rgb[1] - rgb[0] - rgb[2]).astype(np.float32)
    labs = np.arange(seg.max() + 1)
    sizes = ndi.sum(np.ones_like(seg, np.float32), seg, labs)
    exg_std = ndi.standard_deviation(exg, seg, labs)
    tree_frac = ndi.mean((cls == TREE).astype(np.float32), seg, labs)
    herb_frac = ndi.mean((cls == HERB).astype(np.float32), seg, labs)
    valid_frac = ndi.mean(valid.astype(np.float32), seg, labs)
    ext = {r.label: r.extent for r in regionprops(seg + 1)}
    min_px = FIELD_MIN_HA * 1e4 / (px_m * px_m)
    # a cultivated field is a large, homogeneous, block-shaped, VEGETATED parcel
    # (herb-dominated) — this excludes uniform bare desert from being mislabelled crop
    fl = [k for k in labs if sizes[k] >= min_px and valid_frac[k] > 0.6
          and herb_frac[k] >= 0.55 and exg_std[k] <= FIELD_STD_MAX
          and tree_frac[k] <= FIELD_TREE_MAX and ext.get(k + 1, 0) >= FIELD_EXTENT_MIN]
    mask = np.isin(seg, fl) & (cls == HERB)
    return mask, len(fl)


def process_scene(scene):
    x = oam_meta(scene["id"]); url = x["uuid"]; p = x.get("properties", {})
    with rasterio.open("/vsicurl/" + url) as src:
        with WarpedVRT(src, crs="EPSG:4326", resampling=Resampling.average) as vrt:
            if vrt.width >= vrt.height:
                W = WORK_LONG; H = int(W * vrt.height / vrt.width)
            else:
                H = WORK_LONG; W = int(H * vrt.width / vrt.height)
            data = vrt.read(out_shape=(vrt.count, H, W), resampling=Resampling.average)
            b = vrt.bounds
    rgb = data[:3].astype(np.float32)
    valid = (data[3] > 0) if data.shape[0] >= 4 else (rgb.sum(0) > 12)
    px_m = (b[3] - b[1]) * 111320 / H

    cls = classify(rgb, valid)
    fmask, nfields = segment_fields(rgb, cls, valid, px_m)
    cls[fmask] = FIELD
    frac = {k: round(float((cls == k).mean() / max(valid.mean(), 1e-6) * 100), 1)
            for k in (TREE, HERB, BARE, WATER, FIELD)}
    print(f"  {scene['key']}: {W}x{H}, valid {valid.mean()*100:.0f}%, {nfields} fields | "
          f"tree {frac[TREE]} herb {frac[HERB]} bare {frac[BARE]} field {frac[FIELD]} water {frac[WATER]}")

    if PREVIEW and scene is SCENES[0]:
        col = np.zeros((H, W, 3), np.uint8)
        for k, c in CLASS_COL.items():
            col[cls == k] = c
        Image.fromarray(col).save(os.path.join(IMG, "drone_class_preview.png"))
        Image.fromarray(np.transpose(rgb.astype(np.uint8), (1, 2, 0))).save(os.path.join(IMG, "drone_rgb_preview.png"))

    # grid + distance-to-tree
    if W >= H:
        GX = GRID_LONG; GY = int(GRID_LONG * H / W)
    else:
        GY = GRID_LONG; GX = int(GRID_LONG * W / H)
    dist_tree = distance_transform_edt(cls != TREE) * px_m if (cls == TREE).any() else np.full(cls.shape, 999.0)
    grid = np.zeros((GY, GX), np.uint8); dgrid = np.zeros((GY, GX), np.uint8)
    ys = np.linspace(0, H, GY + 1).astype(int); xs = np.linspace(0, W, GX + 1).astype(int)
    for r in range(GY):
        for c in range(GX):
            block = cls[ys[r]:ys[r+1], xs[c]:xs[c+1]]
            vals = block[block != NODATA]
            grid[r, c] = np.bincount(vals, minlength=6).argmax() if vals.size else NODATA
            db = dist_tree[ys[r]:ys[r+1], xs[c]:xs[c+1]]
            dgrid[r, c] = int(min(60, db.mean())) if db.size else 60

    site_w_m = (b[2] - b[0]) * 111320 * math.cos(math.radians((b[1] + b[3]) / 2))
    site_h_m = (b[3] - b[1]) * 111320
    n_valid = int((grid != NODATA).sum())
    site_ha = site_w_m * site_h_m / 1e4 * valid.mean()
    return {
        "key": scene["key"], "label": scene["label"], "ctx": scene["ctx"],
        "provider": x.get("provider"), "license": p.get("license"),
        "acq": (x.get("acquisition_end") or "")[:10],
        "gsd_m": round(p.get("resolution_in_meters") or 0, 3), "tms": p.get("tms"),
        "bbox": [round(v, 6) for v in b],
        "gx": GX, "gy": GY, "cell_ha": round(site_ha / max(n_valid, 1), 4), "site_ha": round(site_ha, 1),
        "class_pct": {"tree": frac[TREE], "herb": frac[HERB], "bare": frac[BARE], "water": frac[WATER], "field": frac[FIELD]},
        "grid": grid.flatten().tolist(), "dist": dgrid.flatten().tolist(),
    }


def main():
    scenes = {}
    for s in SCENES:
        print("processing", s["label"])
        scenes[s["key"]] = process_scene(s)
    out = {"order": [s["key"] for s in SCENES], "default": SCENES[0]["key"], "scenes": scenes}
    with open(os.path.join(DATA, "drone_eligibility.js"), "w", encoding="utf-8") as f:
        f.write("window.DRONE_ELIG = " + json.dumps(out) + ";\n")
    kb = os.path.getsize(os.path.join(DATA, "drone_eligibility.js")) // 1024
    print(f"wrote drone_eligibility.js ({kb} KB) with {len(scenes)} scenes")


if __name__ == "__main__":
    main()
