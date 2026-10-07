"""
Land-cover tiles for SoyTrace: USGS Annual NLCD (30 m, CONUS) cut to the
supply chain's catchments and rendered as 256 px PNG map tiles, so the
workspace can show land cover around the fields without leaning on MRLC's
WMS (2–14 s per tile, sometimes no answer — tested 6 Oct 2026).

Input: Data Storage/ADM Soy/NLCD/Annual_NLCD_LndCov_<year>_CU_C1V*.zip
  (downloaded from https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/;
  the GeoTIFF inside is extracted next to the zip on first run).
Output: private-data/tenants/adm-soy/layers/nlcd/<year>/<z>/<x>/<y>.png
  — paletted PNG, official NLCD colours, transparent outside the catchments
  (crushing plants 0–80 NM, ADM and third-party elevators 20 NM, from
  supply.json) and where NLCD has no data. Zoom 5–12 (z12 ≈ 30 m pixels; the
  map overzooms past it). Tiles with nothing to show are not written; the
  server answers those with an empty tile.
Upload: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs

System Python (rasterio, rio-tiler, mercantile, numpy, Pillow).
Usage: python scripts/prepare-soy-nlcd.py 2025 2020 [--workers 8]
"""
import argparse
import glob
import json
import math
import os
import zipfile
from multiprocessing import Pool

import mercantile
import numpy as np
from PIL import Image
from rio_tiler.io import Reader

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC_DIR = os.path.join(ROOT, "Data Storage", "ADM Soy", "NLCD")
SUPPLY = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "supply.json")
OUT_DIR = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "layers", "nlcd")
ZOOMS = range(5, 13)
EARTH_R = 6371008.8

# Official NLCD legend colours (class code -> hex). Kept in step with
# NLCD_CLASSES in src/lib/soy-nlcd.ts.
COLORS = {
    11: "#466b9f", 12: "#d1def8",
    21: "#dec5c5", 22: "#d99282", 23: "#eb0000", 24: "#ab0000",
    31: "#b3ac9f",
    41: "#68ab5f", 42: "#1c5f2c", 43: "#b5c58f",
    52: "#ccb879", 71: "#dfdfc2",
    81: "#dcd939", 82: "#ab6c28",
    90: "#b8d9eb", 95: "#6c9fb8",
}
PALETTE = [0] * 768
for code, hx in COLORS.items():
    PALETTE[code * 3: code * 3 + 3] = [int(hx[i:i + 2], 16) for i in (1, 3, 5)]


def catchments():
    d = json.load(open(SUPPLY, encoding="utf-8"))
    # Every crushing plant's 0–80 NM circle (supply.json "plants" since 7 Oct 2026; "plant" before).
    plants = d.get("plants") or [{**d["plant"], "rings": d["rings"]}]
    out = [(p["lon"], p["lat"], max(r["radiusM"] for r in p["rings"])) for p in plants]
    out += [(e["lon"], e["lat"], e["radiusM"]) for e in d["admElevators"] if e.get("radiusM")]
    out += [(e["lon"], e["lat"], e["radiusM"]) for e in d["thirdParty"]]
    return out


def hav(lon1, lat1, lon2, lat2):
    r = np.pi / 180
    a = np.sin((lat2 - lat1) * r / 2) ** 2 + np.cos(lat1 * r) * np.cos(lat2 * r) * np.sin((lon2 - lon1) * r / 2) ** 2
    return 2 * EARTH_R * np.arcsin(np.sqrt(a))


def tile_hits(tile, circles):
    """Circles that reach into the tile (nearest point of the tile box within the radius)."""
    b = mercantile.bounds(tile)
    hits = []
    for lon, lat, r in circles:
        nx = min(max(lon, b.west), b.east)
        ny = min(max(lat, b.south), b.north)
        if hav(lon, lat, nx, ny) <= r:
            hits.append((lon, lat, r))
    return hits


def tile_list(circles):
    tiles = {}
    for z in ZOOMS:
        for lon, lat, r in circles:
            dlat = r / 111320
            dlon = r / (111320 * math.cos(math.radians(lat)))
            for t in mercantile.tiles(lon - dlon, lat - dlat, lon + dlon, lat + dlat, z):
                if t not in tiles:
                    hits = tile_hits(t, circles)
                    if hits:
                        tiles[t] = hits
    return tiles


_reader = None


def _init(tif):
    global _reader
    _reader = Reader(tif)


def render(job):
    (x, y, z), hits, out = job
    img = _reader.tile(x, y, z, tilesize=256, resampling_method="nearest")
    data = img.data[0].astype(np.uint8)
    valid = (img.mask > 0) & (data != 0) & (data != 250)
    # Pixel centres in lon/lat, then keep only those inside a catchment.
    b = mercantile.xy_bounds(x, y, z)
    xs = b.left + (np.arange(256) + 0.5) * (b.right - b.left) / 256
    ys = b.top - (np.arange(256) + 0.5) * (b.top - b.bottom) / 256
    lon = xs * 180 / (math.pi * 6378137)
    lat = np.degrees(2 * np.arctan(np.exp(ys / 6378137)) - math.pi / 2)
    LON, LAT = np.meshgrid(lon, lat)
    inside = np.zeros((256, 256), bool)
    for clon, clat, r in hits:
        inside |= hav(clon, clat, LON, LAT) <= r
    valid &= inside
    if not valid.any():
        return 0
    im = Image.fromarray(np.where(valid, data, 0).astype(np.uint8), "P")
    im.putpalette(PALETTE)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, optimize=True, transparency=0)
    return os.path.getsize(out)


def tif_for(year):
    zips = sorted(glob.glob(os.path.join(SRC_DIR, f"Annual_NLCD_LndCov_{year}_CU_C1V*.zip")))
    if not zips:
        raise SystemExit(f"no NLCD zip for {year} in {SRC_DIR}")
    zp = zips[-1]
    with zipfile.ZipFile(zp) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        tif = os.path.join(SRC_DIR, name)
        if not os.path.exists(tif):
            print(f"extracting {name} …")
            z.extract(name, SRC_DIR)
    return tif


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("years", nargs="+")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    circles = catchments()
    tiles = tile_list(circles)
    print(f"{len(circles)} catchments, {len(tiles)} tiles (z{ZOOMS.start}–{ZOOMS.stop - 1}) per year")
    for year in a.years:
        tif = tif_for(year)
        jobs = [((t.x, t.y, t.z), hits, os.path.join(OUT_DIR, year, str(t.z), str(t.x), f"{t.y}.png")) for t, hits in tiles.items()]
        written = size = 0
        with Pool(a.workers, initializer=_init, initargs=(tif,)) as pool:
            for i, n in enumerate(pool.imap_unordered(render, jobs, chunksize=16), 1):
                if n:
                    written += 1
                    size += n
                if i % 2000 == 0:
                    print(f"  {year}: {i}/{len(jobs)}")
        print(f"{year}: {written} tiles written, {size / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
