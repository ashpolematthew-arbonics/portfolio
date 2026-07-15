#!/usr/bin/env python3
"""
Bark-beetle EO export for the "Permanence & disturbance risk" demo.

Runs the project's own Sentinel-2 bark-beetle detection code
(utils/bark_beetle_eo.py: CIre/NBR z-scores vs a seasonal baseline, Barta et al.
infestation staging) over the Harz mountains (Germany) — site of a severe
Ips typographus (spruce bark beetle) outbreak — and exports static assets:

  <portfolio>/assets/img/beetle_class.png     forest-masked infestation stages
  <portfolio>/assets/data/bark_beetle.js      window.BARK_BEETLE = {...}

Reproducible with an authenticated Earth Engine project.
"""
import os, json, sys
import requests

REPO = r"c:\Users\ashpo\ex_ante_europe"
sys.path.insert(0, REPO)
import ee
from utils import bark_beetle_eo as bb

PROJECT = os.environ.get("EE_PROJECT", "arbonics-488410")
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, "..", "assets", "img"))
DATA = os.path.normpath(os.path.join(HERE, "..", "assets", "data"))
os.makedirs(IMG, exist_ok=True); os.makedirs(DATA, exist_ok=True)

BBOX = [10.55, 51.74, 10.82, 51.92]     # Harz die-off window [W,S,E,N]
BASELINE_YR = 2018
DETECT_YR = 2022                         # outbreak peak
STAGE_PALETTE = ["#facc15", "#fb923c", "#7f1d1d"]   # green / yellow / grey-dead


def main():
    ee.Initialize(project=PROJECT)
    aoi = ee.Geometry.Rectangle(BBOX)

    bm, bs = bb._build_baseline(aoi, BASELINE_YR, BASELINE_YR)
    forest = bm.select("NDVI").gt(0.6)                      # baseline canopy mask

    det = bb._build_detection_composite(aoi, DETECT_YR, 6, 9)
    z = bb._compute_anomaly(det, bm, bs)
    cls = bb._classify_infestation(z).updateMask(forest)    # 0 healthy .. 3 grey/dead

    # ---- stage areas ----
    px_area = ee.Image.pixelArea()
    hist = cls.reduceRegion(ee.Reducer.frequencyHistogram(), aoi, scale=20, maxPixels=1e10).getInfo().get("infestation_class", {})
    counts = {int(float(k)): v for k, v in hist.items()}
    tot = sum(counts.values()) or 1
    forest_ha = forest.multiply(px_area).reduceRegion(ee.Reducer.sum(), aoi, 20, maxPixels=1e10).getInfo()["NDVI"] / 1e4
    pct = {s: round(counts.get(s, 0) / tot * 100, 1) for s in (0, 1, 2, 3)}
    affected_pct = round(pct[1] + pct[2] + pct[3], 1)
    print("stage %:", pct, "affected", affected_pct, "forest_ha", round(forest_ha))

    # ---- real index time series: infested cohort vs healthy cohort ----
    grey = cls.eq(3)          # trees dead by the 2022 peak
    healthy = cls.eq(0)
    years = list(range(2018, 2025))
    ts_infested, ts_healthy = [], []
    for yr in years:
        comp = bb._build_detection_composite(aoi, yr, 6, 9).select("CIre")
        combined = (comp.updateMask(grey).rename("inf")
                    .addBands(comp.updateMask(healthy).rename("hea")))
        r = combined.reduceRegion(ee.Reducer.mean(), aoi, 20, maxPixels=1e10).getInfo()
        ts_infested.append(round(r["inf"], 3) if r.get("inf") is not None else None)
        ts_healthy.append(round(r["hea"], 3) if r.get("hea") is not None else None)
        print(f"  {yr}: infested CIre={ts_infested[-1]}  healthy={ts_healthy[-1]}")

    # ---- mean CIre z of affected forest (feeds the buffer model default) ----
    cire_z_mean = z.select("CIre_z").updateMask(forest).reduceRegion(
        ee.Reducer.mean(), aoi, 40, maxPixels=1e10).getInfo().get("CIre_z")

    data = {
        "region": "Harz mountains, Germany — Ips typographus outbreak",
        "bbox": BBOX, "baseline_year": BASELINE_YR, "detect_year": DETECT_YR,
        "forest_ha": round(forest_ha),
        "stage_pct": pct, "affected_pct": affected_pct,
        "cire_z_mean": round(cire_z_mean, 2) if cire_z_mean is not None else -1.2,
        "timeseries": {"years": years, "infested": ts_infested, "healthy": ts_healthy, "index": "CIre"},
        "thresholds": bb.INFESTATION_THRESHOLDS,
    }
    with open(os.path.join(DATA, "bark_beetle.js"), "w", encoding="utf-8") as f:
        f.write("window.BARK_BEETLE = " + json.dumps(data) + ";\n")
    print("Wrote bark_beetle.js")

    # ---- classification thumbnail (affected stages only, over imagery) ----
    vis = cls.updateMask(cls.gt(0))
    url = vis.getThumbURL({"region": aoi, "dimensions": "760x520", "crs": "EPSG:4326",
                           "format": "png", "min": 1, "max": 3, "palette": STAGE_PALETTE})
    r = requests.get(url, timeout=180); r.raise_for_status()
    with open(os.path.join(IMG, "beetle_class.png"), "wb") as fh:
        fh.write(r.content)
    print(f"Wrote beetle_class.png ({len(r.content)//1024} KB)")


if __name__ == "__main__":
    main()
