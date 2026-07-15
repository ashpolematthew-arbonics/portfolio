#!/usr/bin/env python3
"""
ALS individual-tree inventory export for the "ALS -> age -> growth database" demo.

Reads the real Estonian ALS crown inventory produced by the forest_age_model
pipeline (see ex_ante_europe/ALS_GROWTH_DB_METHODOLOGY.md), for a single 1 km tile,
joining the pre- and post- crown-area-correction ages per crown, and exports a
compact JS global the browser demo reads directly.

Source (in the ex_ante_europe repo):
  results/ee_age_inventory.csv            pre crown-area correction (age_mean)
  results/ee_age_inventory_careacorr.gpkg post correction + crown-centroid geometry

Output:
  <portfolio>/assets/data/als_inventory.js   window.ALS_INVENTORY = {...}
"""
import os, json
import numpy as np
import pandas as pd
import geopandas as gpd

TILE = "530580"                       # pine-dominated Estonian tile with spruce/birch mix
REPO = r"c:\Users\ashpo\ex_ante_europe"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "data", "als_inventory.js"))
MAX_CROWNS = 3500                     # downsample for the browser (histograms use the full tile)

SPECIES_SHORT = {
    "Pinus_sylvestris": "pine", "Picea_abies": "spruce", "Betula_pendula": "birch",
    "broadleaf": "broadleaf", "conifer": "conifer",
}
# validation-derived reliability envelope, banded by PREDICTED age (methodology §6.2)
ENVELOPE = [
    {"band": "0–20", "lo": 0, "hi": 20, "rmse": 6.6, "mae": 4.2, "tag": "reliable"},
    {"band": "20–40", "lo": 20, "hi": 40, "rmse": 13.5, "mae": 11.0, "tag": "reliable"},
    {"band": "40–60", "lo": 40, "hi": 60, "rmse": 22.3, "mae": 15.5, "tag": "reliable"},
    {"band": "60–80", "lo": 60, "hi": 80, "rmse": 33.7, "mae": 20.4, "tag": "medium"},
    {"band": "≥80", "lo": 80, "hi": 999, "rmse": 80.2, "mae": 59.2, "tag": "censored_mature"},
]


def hist(a, edges):
    c, _ = np.histogram(a, bins=edges)
    return [int(x) for x in c]


def dist_stats(a):
    return {"median": round(float(np.median(a)), 1), "mean": round(float(np.mean(a)), 1),
            "pct_ge80": round(float((a >= 80).mean() * 100), 1)}


def main():
    print("Loading post-correction gpkg (geometry) ...")
    g = gpd.read_file(os.path.join(REPO, "results", "ee_age_inventory_careacorr.gpkg"))
    g = g[g["tile"].astype(str) == TILE].copy()
    print(f"  tile {TILE}: {len(g)} crowns")

    print("Loading pre-correction ages ...")
    pre = pd.read_csv(os.path.join(REPO, "results", "ee_age_inventory.csv"),
                      usecols=["tree_id", "age_mean"]).rename(columns={"age_mean": "age_pre"})
    g = g.merge(pre, on="tree_id", how="left")

    # crown polygons -> centroids (in projected source CRS) -> WGS84 points
    g["crown_m2"] = g.geometry.area.round(1)          # projected 3301 => m^2
    cent = g.geometry.centroid                        # planar centroid, no geographic warning
    g = g.set_geometry(cent).to_crs(4326)
    g["lng"] = g.geometry.x.round(6)
    g["lat"] = g.geometry.y.round(6)
    g["sp"] = g["species"].map(SPECIES_SHORT).fillna("other")

    full_pre = g["age_pre"].to_numpy(float)
    full_post = g["age_mean"].to_numpy(float)

    # histograms on the FULL tile (0..100 in 10-yr bins, last bin = 100+)
    edges = list(range(0, 101, 10)) + [1000]
    labels = [f"{edges[i]}–{edges[i+1]}" for i in range(len(edges) - 2)] + ["100+"]

    # species composition
    comp = g["sp"].value_counts().to_dict()

    # height vs age sample (post) for the saturation panel
    hs = g[["height_chm", "age_mean", "sp"]].dropna()
    hs = hs.sample(min(1500, len(hs)), random_state=1)

    # downsample crowns for the map
    crowns_df = g.sample(min(MAX_CROWNS, len(g)), random_state=7)

    data = {
        "tile": TILE,
        "region": "Estonia (Maa-amet national ALS), 1 km tile " + TILE,
        "crs_source": "EPSG:3301", "n_full": int(len(g)),
        "carea_scale": 0.43,
        "composition": comp,
        "hist": {
            "labels": labels,
            "pre": hist(full_pre, edges),
            "post": hist(full_post, edges),
        },
        "stats": {"pre": dist_stats(full_pre), "post": dist_stats(full_post)},
        "national": {  # from ALS_GROWTH_DB_METHODOLOGY.md §4/§6.2
            "pre_pct_ge80": 42.3, "post_pct_ge80": 8.1,
            "pre_median": 51.8, "post_median": 36.9,
            "reliable_frac": 85.6, "medium_frac": 6.4, "censored_frac": 8.1,
            "watershed_area_ratio": 2.30, "nonveg_dropped_pct": 10.6,
        },
        "envelope": ENVELOPE,
        "hs": [{"h": round(float(r.height_chm), 1), "a": round(float(r.age_mean), 1), "sp": r.sp}
               for r in hs.itertuples()],
        "crowns": [
            {"lat": float(r.lat), "lng": float(r.lng), "sp": r.sp,
             "h": round(float(r.height_chm), 1),
             "ap": round(float(r.age_pre), 1) if pd.notna(r.age_pre) else None,
             "ao": round(float(r.age_mean), 1),
             "lo": round(float(r.age_lower95), 1), "hi": round(float(r.age_upper95), 1),
             "nd": round(float(r.ndvi), 2) if pd.notna(r.ndvi) else None}
            for r in crowns_df.itertuples()
        ],
    }
    # tile bbox for map framing
    b = g.total_bounds  # minx,miny,maxx,maxy in 4326
    data["bbox"] = [round(float(b[0]), 5), round(float(b[1]), 5), round(float(b[2]), 5), round(float(b[3]), 5)]

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.ALS_INVENTORY = " + json.dumps(data) + ";\n")
    kb = os.path.getsize(OUT) // 1024
    print(f"Wrote {OUT} ({kb} KB); crowns={len(data['crowns'])}")
    print("tile stats pre :", data["stats"]["pre"])
    print("tile stats post:", data["stats"]["post"])
    print("composition:", comp)


if __name__ == "__main__":
    main()
