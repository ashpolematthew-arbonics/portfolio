#!/usr/bin/env python3
"""
Multispectral drone land-cover + tree-crown analysis for afforestation
suitability — DJI Mavic 3M frame, northern Ghana (near Bolgatanga, Tree Aid GGW
belt). Uses the registered G/R/RE/NIR + RGB stack from drone_ms_common.

Method (with literature):
  * Vegetation indices: NDVI (Rouse 1974), NDRE (red-edge, Gitelson & Merzlyak
    1994) — red-edge separates woody/high-chlorophyll canopy from dry herbaceous.
  * Individual-tree-crown detection: smoothed-NDVI local maxima (variable window,
    Popescu & Wynne 2004) + marker-controlled watershed (Meyer & Beucher 1990;
    Ke & Quackenbush 2011).
  * Cropland parcels: Felzenszwalb segmentation (Felzenszwalb & Huttenlocher 2004)
    of large, homogeneous, low-vegetation blocks.
  * Paths/tracks: Sato tubular-ridge filter (Sato et al. 1998) on brightness.
  * Afforestation suitability from the class map + canopy/path setbacks.

Run: python build_drone_multispectral.py [--preview]
"""
import os, sys
import numpy as np
from scipy.ndimage import gaussian_filter, uniform_filter, distance_transform_edt
from skimage.feature import peak_local_max
from skimage.segmentation import watershed, felzenszwalb, find_boundaries
from skimage.measure import regionprops, label
from skimage.filters import sato
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from drone_ms_common import load_aligned, indices

PREVIEW = "--preview" in sys.argv
NODATA, TREE, SHRUB, OPEN = 0, 1, 2, 3
COL = {TREE: (26, 102, 46), SHRUB: (120, 190, 90), OPEN: (206, 178, 132)}
LABEL = {TREE: "Tree crown", SHRUB: "Shrub / woody", OPEN: "Open ground"}


def analyse():
    A, meta = load_aligned()
    gsd = meta["gsd_cm"] / 100.0
    idx = indices(A)
    ndvi, ndre = idx["ndvi"], idx["ndre"]
    rgb = A["RGB"]
    bright = rgb.mean(2); bright = (bright - bright.min()) / (np.ptp(bright) + 1e-6)
    H, W = ndvi.shape

    # --- tree crowns: local maxima + marker-controlled watershed ---
    sm = gaussian_filter(ndvi, 2)
    woody = ndvi > 0.30
    peaks = peak_local_max(sm, min_distance=max(8, int(1.6 / gsd)), threshold_abs=0.36, labels=woody)
    mark = np.zeros((H, W), int)
    for i, (r, c) in enumerate(peaks, 1):
        mark[r, c] = i
    ws = watershed(-sm, mark, mask=(ndvi > 0.24))
    minA = int(round(0.6 / (gsd * gsd)))
    majorA = int(round(8.0 / (gsd * gsd)))      # "major" tree >= ~3.2 m diameter
    maxA = int(round(250 / (gsd * gsd)))
    crowns, majors = [], []
    tree_mask = np.zeros((H, W), bool)
    for p in regionprops(ws):
        if not (minA <= p.area <= maxA):
            continue
        coords = tuple(np.array(p.coords).T)
        if ndre[coords].mean() < -0.03:
            continue
        crowns.append(p)
        if p.area >= majorA and sm[coords].max() > 0.44:   # prominent, green
            majors.append(p)
            tree_mask[coords] = True

    # --- tillage/disturbance index: gradient-orientation coherence (ploughed
    # fields show long unidirectional furrows). Kept as a continuous layer rather
    # than a hard "cropland" class, because in a single dry-season frame tilled
    # fields and degraded bare soil are spectrally inseparable (both bare). ---
    gy, gx = np.gradient(gaussian_filter(bright, 1))
    mag = np.hypot(gx, gy); th2 = 2 * np.arctan2(gy, gx)
    win = int(round(1.5 / gsd))
    c2 = uniform_filter(mag * np.cos(th2), win); s2 = uniform_filter(mag * np.sin(th2), win)
    tillage = gaussian_filter(np.hypot(c2, s2) / (uniform_filter(mag, win) + 1e-6), 4)

    # --- assemble robust class map: open ground / shrub-woody / tree crown ---
    cls = np.full((H, W), OPEN, np.uint8)
    cls[woody] = SHRUB
    cls[tree_mask] = TREE

    frac = {k: round(float((cls == k).mean() * 100), 1) for k in (TREE, SHRUB, OPEN)}
    canopy_all = round(float(sum(p.area for p in crowns)) / (H * W) * 100, 1)
    stats = {
        "gsd_cm": round(meta["gsd_cm"], 1), "lat": round(meta["lat"], 5), "lon": round(meta["lon"], 5),
        "area_ha": round(H * W * gsd * gsd / 1e4, 2),
        "class_pct": {LABEL[k]: frac[k] for k in frac},
        "n_crowns": len(majors), "canopy_cover_pct": canopy_all,
        "tree_density_ha": round(len(majors) / (H * W * gsd * gsd / 1e4)),
        "mean_crown_diam_m": round(2 * np.sqrt(np.mean([p.area for p in majors]) / np.pi) * gsd, 1) if majors else None,
        "ndvi_med": round(float(np.median(ndvi)), 2), "ndre_med": round(float(np.median(ndre)), 2),
    }
    return dict(A=A, meta=meta, gsd=gsd, ndvi=ndvi, ndre=ndre, rgb=rgb, cls=cls,
                crowns=crowns, majors=majors, tillage=tillage, tree_mask=tree_mask, stats=stats)


import os, json
import matplotlib; matplotlib.use("Agg"); import matplotlib.cm as cm
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, "..", "assets", "img"))
DATA = os.path.normpath(os.path.join(HERE, "..", "assets", "data"))
EXPORT_W = 1600


def _resize_to(arr, W):
    from skimage.transform import resize
    h, w = arr.shape[:2]; H = int(W * h / w)
    return resize(arr, (H, W) + arr.shape[2:], order=1, preserve_range=True, anti_aliasing=True), H


def export(R):
    os.makedirs(IMG, exist_ok=True); os.makedirs(DATA, exist_ok=True)
    H0, W0 = R["cls"].shape
    Wx = EXPORT_W; Hx = int(Wx * H0 / W0)
    def cmap(x, lo, hi, name):
        img = cm.get_cmap(name)(np.clip((x - lo) / (hi - lo), 0, 1))[:, :, :3]
        r, _ = _resize_to(img, Wx); return (r * 255).astype(np.uint8)

    # base RGB + index layers (JPG — full-frame, no transparency needed)
    rgb = np.clip(R["rgb"] / np.percentile(R["rgb"], 99) * 255, 0, 255).astype(np.uint8)
    rgb_r, _ = _resize_to(rgb, Wx)
    Image.fromarray(rgb_r.astype(np.uint8)).save(os.path.join(IMG, "ghana_rgb.jpg"), quality=88)
    Image.fromarray(cmap(R["ndvi"], -0.05, 0.7, "RdYlGn")).save(os.path.join(IMG, "ghana_ndvi.jpg"), quality=88)
    Image.fromarray(cmap(R["ndre"], -0.1, 0.25, "viridis")).save(os.path.join(IMG, "ghana_ndre.jpg"), quality=88)
    Image.fromarray(cmap(R["tillage"], 0.1, 0.7, "magma")).save(os.path.join(IMG, "ghana_tillage.jpg"), quality=88)

    # land-cover class overlay (PNG, crisp categorical)
    col = np.zeros((H0, W0, 4), np.uint8)
    for k, c in COL.items():
        col[R["cls"] == k] = (*c, 235)
    col_r, _ = _resize_to(col, Wx)
    Image.fromarray(col_r.astype(np.uint8)).save(os.path.join(IMG, "ghana_class.png"))

    # crowns (major) as vector, normalised to export pixel coords
    sx = Wx / W0
    crowns = [{"x": round(p.centroid[1] * sx, 1), "y": round(p.centroid[0] * sx, 1),
               "r": round(np.sqrt(p.area / np.pi) * sx, 1),
               "d": round(2 * np.sqrt(p.area / np.pi) * R["gsd"], 1)} for p in R["majors"]]

    # suitability grid for client-side recompute: class + distance-to-canopy (m)
    woody = np.isin(R["cls"], [TREE, SHRUB])
    distc = distance_transform_edt(~woody) * R["gsd"]
    GX = 360; GY = int(GX * H0 / W0)
    ys = np.linspace(0, H0, GY + 1).astype(int); xs = np.linspace(0, W0, GX + 1).astype(int)
    grid = np.zeros((GY, GX), np.uint8); dgrid = np.zeros((GY, GX), np.uint8)
    for r in range(GY):
        for c in range(GX):
            blk = R["cls"][ys[r]:ys[r+1], xs[c]:xs[c+1]]
            grid[r, c] = np.bincount(blk.ravel(), minlength=4).argmax()
            dgrid[r, c] = int(min(40, distc[ys[r]:ys[r+1], xs[c]:xs[c+1]].mean()))
    cell_ha = (W0 * H0 * R["gsd"]**2 / 1e4) / (GX * GY)

    out = dict(w=Wx, h=Hx, gsd_cm=R["stats"]["gsd_cm"], lat=R["stats"]["lat"], lon=R["stats"]["lon"],
               area_ha=R["stats"]["area_ha"], stats=R["stats"], crowns=crowns,
               gx=GX, gy=GY, cell_ha=round(cell_ha, 5),
               grid=grid.flatten().tolist(), dist=dgrid.flatten().tolist())
    with open(os.path.join(DATA, "drone_ms.js"), "w", encoding="utf-8") as f:
        f.write("window.DRONE_MS = " + json.dumps(out) + ";\n")
    print(f"exported assets: {len(crowns)} crowns, grid {GX}x{GY}, "
          f"drone_ms.js {os.path.getsize(os.path.join(DATA,'drone_ms.js'))//1024} KB")


def main():
    R = analyse()
    print(json.dumps(R["stats"], indent=1))
    if PREVIEW:
        H, W = R["cls"].shape
        col = np.zeros((H, W, 3), np.uint8)
        for k, c in COL.items():
            col[R["cls"] == k] = c
        Image.fromarray(col[::2, ::2]).save("/tmp/class_preview.png")
    else:
        export(R)


if __name__ == "__main__":
    main()
