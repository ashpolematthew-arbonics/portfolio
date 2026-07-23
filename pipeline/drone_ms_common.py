#!/usr/bin/env python3
"""
Shared loading / band-registration for the DJI Mavic 3M multispectral frame
(northern Ghana). Registers the G/RE/NIR bands to R by high-pass phase
correlation (the 4 MS lenses have parallax offsets of tens of pixels), registers
the 20 MP RGB frame to the MS grid, crops the vignetted border, and caches the
aligned stack for the analysis stages.
"""
import os, re, glob
import numpy as np
import rasterio
from skimage.registration import phase_cross_correlation
from skimage.transform import resize, warp, SimilarityTransform
from skimage.feature import ORB, match_descriptors
from skimage.measure import ransac
from skimage.exposure import equalize_adapthist
from scipy.ndimage import shift as ndshift, gaussian_filter

CROP = 130          # px border to drop (parallax + vignette)


def _hp(x):
    x = x / max(x.mean(), 1e-6)
    return x - gaussian_filter(x, 12)


def load_aligned(scene_dir, base, force=False):
    cache = os.path.join(os.environ.get("TEMP", "/tmp"), f"msalign_{base}.npz")
    if os.path.exists(cache) and not force:
        d = np.load(cache)
        return {k: d[k] for k in d.files}, dict(gsd_cm=float(d["gsd_cm"]), lat=float(d["lat"]), lon=float(d["lon"]))

    bands = {}
    for b in ["G", "R", "RE", "NIR"]:
        with rasterio.open(os.path.join(scene_dir, f"{base}_MS_{b}.TIF")) as ds:
            bands[b] = ds.read(1).astype(np.float64)
    H, W = bands["R"].shape
    cy, cx = H // 2, W // 2
    sl = (slice(cy - 500, cy + 500), slice(cx - 700, cx + 700))
    hp = {b: _hp(v)[sl] for b, v in bands.items()}
    reg = {"R": bands["R"]}
    for b in ["G", "RE", "NIR"]:
        sh, _, _ = phase_cross_correlation(hp["R"], hp[b], upsample_factor=10, normalization=None)
        reg[b] = ndshift(bands[b], sh, order=1, mode="nearest")

    # register the 20 MP RGB (D) frame to the MS grid. The RGB camera has a wider
    # FOV (~1.19x scale), so a translation isn't enough — estimate a similarity
    # transform from ORB feature matches + RANSAC.
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    rgb = np.asarray(Image.open(os.path.join(scene_dir, f"{base}_D.JPG")).convert("RGB")).astype(np.float64)
    rgb_s = resize(rgb, (H, W, 3), order=1, preserve_range=True, anti_aliasing=True)
    def _prep(x):
        x = (x - x.min()) / (np.ptp(x) + 1e-6)
        return equalize_adapthist(x, clip_limit=0.01).astype(np.float32)
    ref, mov = _prep(reg["G"]), _prep(rgb_s[:, :, 1])
    oa = ORB(n_keypoints=1500, fast_threshold=0.02); oa.detect_and_extract(ref); ka, da = oa.keypoints, oa.descriptors
    ob = ORB(n_keypoints=1500, fast_threshold=0.02); ob.detect_and_extract(mov); kb, db = ob.keypoints, ob.descriptors
    mt = match_descriptors(da, db, cross_check=True, max_ratio=0.8)
    model, inl = ransac((kb[mt[:, 1]][:, ::-1], ka[mt[:, 0]][:, ::-1]),
                        SimilarityTransform, min_samples=3, residual_threshold=3, max_trials=3000, rng=0)
    print(f"  RGB->MS: {len(mt)} matches, {int(inl.sum())} inliers, scale {model.scale:.3f}, rot {np.degrees(model.rotation):.2f} deg")
    rgb_a = np.stack([warp(rgb_s[:, :, k], model.inverse, output_shape=(H, W), preserve_range=True) for k in range(3)], -1)

    # crop border
    c = slice(CROP, -CROP)
    out = {b: reg[b][c, c] for b in reg}
    out["RGB"] = rgb_a[c, c, :]

    # geolocation + GSD (assume ~100 m AGL; M3M MS: 6.4 mm sensor width, 4.34 mm focal)
    raw = open(os.path.join(scene_dir, f"{base}_D.JPG"), "rb").read(200000).decode("latin1")
    def xmp(k, d=None):
        m = re.search(k + r'="?(-?[0-9.]+)', raw); return float(m.group(1)) if m else d
    lat = xmp("GpsLatitude", 10.5823); lon = xmp("GpsLongitude", -0.7639)
    agl = xmp("RelativeAltitude", 100.0)
    gsd_cm = agl * 6.4 / (4.34 * W) * 100

    np.savez_compressed(cache, gsd_cm=gsd_cm, lat=lat, lon=lon, **out)
    return out, dict(gsd_cm=gsd_cm, lat=lat, lon=lon)


def indices(A):
    def nd(a, b): return (a - b) / (a + b + 1e-6)
    return {
        "ndvi": nd(A["NIR"], A["R"]),
        "ndre": nd(A["NIR"], A["RE"]),
        "gndvi": nd(A["NIR"], A["G"]),
    }


if __name__ == "__main__":
    d = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", "drone"))
    A, meta = load_aligned(d, "DJI_20250502123937_0001", force="--force" in os.sys.argv)
    print("aligned stack:", A["R"].shape, "| GSD", round(meta["gsd_cm"], 1), "cm")
