#!/usr/bin/env python3
"""
Multispectral drone land-cover, tree-crown & restoration-suitability analysis
across several DJI Mavic 3M scenes in northern Ghana (Bolgatanga area, Great
Green Wall belt). See drone_ms_common.py for band registration.

Per scene: register G/R/RE/NIR + RGB -> NDVI/NDRE -> tree-crown delineation
(local maxima + marker-controlled watershed) -> robust land cover
(tree crown / shrub-woody / open ground) -> a tillage-texture index. Exports the
class grid, a tillage grid and a distance-to-canopy grid so the browser can map
each pixel to a restoration intervention (Agroforestry / Reforestation / ANR).

Literature: Rouse 1974 (NDVI); Gitelson & Merzlyak 1994 (NDRE); Popescu & Wynne
2004 (variable-window maxima); Meyer & Beucher 1990, Ke & Quackenbush 2011
(watershed ITCD); Felzenszwalb & Huttenlocher 2004 (segmentation).

Run: python build_drone_multispectral.py [--preview]
"""
import os, sys, json
import numpy as np
from scipy import ndimage as ndi
from scipy.ndimage import gaussian_filter, uniform_filter, distance_transform_edt
from skimage.feature import peak_local_max
from skimage.segmentation import watershed, felzenszwalb
from skimage.measure import regionprops
from skimage.morphology import binary_closing, remove_small_objects, disk
from skimage.transform import resize
from rasterio import features as rfeatures
from shapely.geometry import shape as shp_shape
import matplotlib; matplotlib.use("Agg"); import matplotlib.cm as cm
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from drone_ms_common import load_aligned, indices

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, "..", "assets", "img"))
DATA = os.path.normpath(os.path.join(HERE, "..", "assets", "data"))
ASSET_DRONE = os.path.normpath(os.path.join(HERE, "..", "assets", "drone"))
PREVIEW = "--preview" in sys.argv
EXPORT_W = 1280
GX = 300

NODATA, TREE, SHRUB, OPEN = 0, 1, 2, 3
COL = {TREE: (26, 102, 46), SHRUB: (120, 190, 90), OPEN: (206, 178, 132)}
# restoration interventions
CANOPY, ANR, AGRO, REFOR = 1, 2, 3, 4
IV_NAME = {CANOPY: "canopy", ANR: "anr", AGRO: "agro", REFOR: "refor"}
POLY_W = 190          # coarse grid for block polygonisation (larger blocks)
MIN_BLOCK_HA = 0.015  # smallest block kept in the export (client filters up)

SCENES = [
    {"key": "mixed", "dir": ASSET_DRONE, "base": "DJI_20250502123937_0001",
     "label": "Mixed parkland", "ctx": "Trees, cleared fields & open ground"},
    {"key": "agroforestry", "dir": r"D:\Gbeog2", "base": "DJI_20250506135619_0010",
     "label": "Farmland parkland", "ctx": "Scattered trees over cropland"},
    {"key": "anr", "dir": r"D:\Gbeog2", "base": "DJI_20250506130349_0024",
     "label": "Dense shrubland", "ctx": "Woody regrowth, few mature trees"},
    {"key": "reforestation", "dir": r"D:\Gbeog2", "base": "DJI_20250506140158_0062",
     "label": "Degraded openland", "ctx": "Sparse vegetation, bare degraded soil"},
]


def analyse(scene):
    A, meta = load_aligned(scene["dir"], scene["base"])
    gsd = meta["gsd_cm"] / 100.0
    idx = indices(A)
    ndvi, ndre = idx["ndvi"], idx["ndre"]
    rgb = A["RGB"]
    bright = rgb.mean(2); bright = (bright - bright.min()) / (np.ptp(bright) + 1e-6)
    H, W = ndvi.shape

    # tree crowns: local maxima + marker-controlled watershed
    sm = gaussian_filter(ndvi, 2)
    woody = ndvi > 0.30
    peaks = peak_local_max(sm, min_distance=max(8, int(1.6 / gsd)), threshold_abs=0.36, labels=woody)
    mark = np.zeros((H, W), int)
    for i, (r, c) in enumerate(peaks, 1):
        mark[r, c] = i
    ws = watershed(-sm, mark, mask=(ndvi > 0.24))
    minA = int(round(0.6 / (gsd * gsd))); majorA = int(round(8.0 / (gsd * gsd))); maxA = int(round(250 / (gsd * gsd)))
    majors, tree_mask = [], np.zeros((H, W), bool)
    for p in regionprops(ws):
        if not (minA <= p.area <= maxA):
            continue
        coords = tuple(np.array(p.coords).T)
        if ndre[coords].mean() < -0.03:
            continue
        if p.area >= majorA and sm[coords].max() > 0.44:
            majors.append(p); tree_mask[coords] = True

    # tillage / disturbance index: gradient-orientation coherence (ploughed fields
    # show long unidirectional furrows -> high coherence)
    gy, gx = np.gradient(gaussian_filter(bright, 1))
    mag = np.hypot(gx, gy); th2 = 2 * np.arctan2(gy, gx)
    win = int(round(1.5 / gsd))
    c2 = uniform_filter(mag * np.cos(th2), win); s2 = uniform_filter(mag * np.sin(th2), win)
    tillage = gaussian_filter(np.hypot(c2, s2) / (uniform_filter(mag, win) + 1e-6), 4)

    cls = np.full((H, W), OPEN, np.uint8)
    cls[woody] = SHRUB
    cls[tree_mask] = TREE
    frac = {k: round(float((cls == k).mean() * 100), 1) for k in (TREE, SHRUB, OPEN)}

    # agricultural-plot detection: Felzenszwalb segments that are large, open
    # (low-veg) and parcel-shaped (definable borders). Agroforestry is only
    # allowed inside these delineated plots.
    seg = felzenszwalb((rgb - rgb.min()) / (np.ptp(rgb) + 1e-6), scale=200, sigma=1.0, min_size=1500)
    labs = np.arange(seg.max() + 1)
    sizes = ndi.sum(np.ones_like(seg, float), seg, labs)
    ndvi_mean = ndi.mean(ndvi, seg, labs)
    ext = {r.label: r.extent for r in regionprops(seg + 1)}
    min_field = 0.05 * 1e4 / (gsd * gsd)   # >= 500 m^2 plots
    field_lbl = [k for k in labs if sizes[k] >= min_field and ndvi_mean[k] < 0.25 and ext.get(k + 1, 0) >= 0.45]
    field_mask = np.isin(seg, field_lbl)

    area_ha = H * W * gsd * gsd / 1e4
    stats = {
        "gsd_cm": round(meta["gsd_cm"], 1), "lat": round(meta["lat"], 5), "lon": round(meta["lon"], 5),
        "area_ha": round(area_ha, 2),
        "class_pct": {"Tree crown": frac[TREE], "Shrub / woody": frac[SHRUB], "Open ground": frac[OPEN]},
        "n_crowns": len(majors), "tree_density_ha": round(len(majors) / area_ha),
        "canopy_cover_pct": round(float(sum(p.area for p in majors)) / (H * W) * 100, 1),
        "mean_crown_diam_m": round(2 * np.sqrt(np.mean([p.area for p in majors]) / np.pi) * gsd, 1) if majors else 0,
        "ndvi_med": round(float(np.median(ndvi)), 2), "ndre_med": round(float(np.median(ndre)), 2),
    }
    return dict(meta=meta, gsd=gsd, ndvi=ndvi, ndre=ndre, rgb=rgb, cls=cls,
                majors=majors, tillage=tillage, tree_mask=tree_mask, field_mask=field_mask, stats=stats)


def _resize_to(arr, W):
    h, w = arr.shape[:2]; Hn = int(W * h / w)
    return resize(arr, (Hn, W) + arr.shape[2:], order=1, preserve_range=True, anti_aliasing=True), Hn


def export_scene(R, scene):
    key = scene["key"]; H0, W0 = R["cls"].shape; Wx = EXPORT_W; Hx = int(Wx * H0 / W0)
    def cmap(x, lo, hi, name):
        im = cm.get_cmap(name)(np.clip((x - lo) / (hi - lo), 0, 1))[:, :, :3]
        r, _ = _resize_to(im, Wx); return (r * 255).astype(np.uint8)

    rgb = np.clip(R["rgb"] / np.percentile(R["rgb"], 99) * 255, 0, 255).astype(np.uint8)
    rgb_r, _ = _resize_to(rgb, Wx)
    P = lambda n: os.path.join(IMG, f"ghana_{key}_{n}")
    Image.fromarray(rgb_r.astype(np.uint8)).save(P("rgb.jpg"), quality=82)
    Image.fromarray(cmap(R["ndvi"], -0.05, 0.7, "RdYlGn")).save(P("ndvi.jpg"), quality=82)
    Image.fromarray(cmap(R["ndre"], -0.1, 0.25, "viridis")).save(P("ndre.jpg"), quality=82)
    Image.fromarray(cmap(R["tillage"], 0.1, 0.7, "magma")).save(P("tillage.jpg"), quality=82)
    col = np.zeros((H0, W0, 4), np.uint8)
    for k, c in COL.items():
        col[R["cls"] == k] = (*c, 235)
    col_r, _ = _resize_to(col, Wx)
    Image.fromarray(col_r.astype(np.uint8)).save(P("class.png"))

    sx = Wx / W0
    crowns = [{"x": round(p.centroid[1] * sx, 1), "y": round(p.centroid[0] * sx, 1),
               "r": round(np.sqrt(p.area / np.pi) * sx, 1)} for p in R["majors"]]

    # --- intervention raster: canopy / ANR / agroforestry / reforestation ---
    interv = np.zeros((H0, W0), np.uint8)
    interv[R["cls"] == OPEN] = REFOR
    interv[(R["cls"] == OPEN) & R["field_mask"]] = AGRO       # agroforestry only in plots
    interv[R["cls"] == SHRUB] = ANR
    interv[R["cls"] == TREE] = CANOPY

    # coarsen to a block grid (majority) so units are larger, then polygonise
    Wc = POLY_W; Hc = int(Wc * H0 / W0)
    ys = np.linspace(0, H0, Hc + 1).astype(int); xs = np.linspace(0, W0, Wc + 1).astype(int)
    coarse = np.zeros((Hc, Wc), np.uint8)
    for r in range(Hc):
        for c in range(Wc):
            coarse[r, c] = np.bincount(interv[ys[r]:ys[r+1], xs[c]:xs[c+1]].ravel(), minlength=5).argmax()
    cell_ha = R["stats"]["area_ha"] / (Wc * Hc)
    min_px = max(3, int(MIN_BLOCK_HA / cell_ha))

    polys, areas = [], {n: 0.0 for n in IV_NAME.values()}
    for t, name in IV_NAME.items():
        m = coarse == t
        m = binary_closing(m, disk(2))
        m = remove_small_objects(m, min_px)
        if not m.any():
            continue
        for geom, _ in rfeatures.shapes(m.astype(np.uint8), mask=m, connectivity=4):
            poly = shp_shape(geom)
            if poly.area < min_px:
                continue
            poly = poly.simplify(1.3)
            xr, yr = poly.exterior.coords.xy
            ring = [[round(x / Wc, 4), round(y / Hc, 4)] for x, y in zip(xr, yr)]
            a = round(poly.area * cell_ha, 4)
            areas[name] += a
            polys.append({"t": name, "a": a, "r": ring})
    stats = dict(R["stats"]); stats["iv_ha"] = {k: round(v, 3) for k, v in areas.items()}
    return {"key": key, "label": scene["label"], "ctx": scene["ctx"], "w": Wx, "h": Hx,
            "stats": stats, "crowns": crowns, "polys": polys}


def main():
    os.makedirs(IMG, exist_ok=True); os.makedirs(DATA, exist_ok=True)
    scenes = {}
    for s in SCENES:
        print("processing", s["label"], f"({s['base']})")
        R = analyse(s)
        print("  ", json.dumps(R["stats"]["class_pct"]), "| crowns", R["stats"]["n_crowns"],
              "| canopy", R["stats"]["canopy_cover_pct"], "%")
        if PREVIEW:
            H, W = R["cls"].shape; colimg = np.zeros((H, W, 3), np.uint8)
            for k, c in COL.items():
                colimg[R["cls"] == k] = c
            Image.fromarray(colimg[::3, ::3]).save(f"/tmp/class_{s['key']}.png")
        else:
            scenes[s["key"]] = export_scene(R, s)
    if not PREVIEW:
        out = {"order": [s["key"] for s in SCENES], "default": SCENES[0]["key"], "scenes": scenes}
        with open(os.path.join(DATA, "drone_ms.js"), "w", encoding="utf-8") as f:
            f.write("window.DRONE_MS = " + json.dumps(out) + ";\n")
        print(f"wrote drone_ms.js ({os.path.getsize(os.path.join(DATA,'drone_ms.js'))//1024} KB), {len(scenes)} scenes")


if __name__ == "__main__":
    main()
