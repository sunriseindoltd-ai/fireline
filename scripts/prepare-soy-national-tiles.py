"""
Vector tiles of every US soybean field (USDA NASS Crop Sequence Boundaries,
fields in soybeans in 2025: Soy_National1825.gdb, 2.4 million fields) for
SoyTrace's "All US soybean fields" layer, packed as one PMTiles archive the
map reads by HTTP range requests.

  zoom 10–12   layer "fields": the field outlines (clipped per tile,
               simplified to the tile's grid), properties
               i = CSB field ID, a = acres, y = seasons in soybeans 2018–2025,
               n = county, s = state; at zoom 12 also h = CDL codes 2018–2025
               ("5,1,5,…") for the field card.
  below 10     a density grid instead (national-grid.geojson, 0.1° cells:
               soybean acres per cell), drawn by the map from zoom 4 to 10.

No tippecanoe on this machine: tiles are cut with shapely and encoded with
mapbox-vector-tile, in two passes so the 2.4 million geometries never sit in
memory at once:
  A. read the layer once, project to Web Mercator, drop each field into the
     zoom-8 tile(s) its bounds touch (pickled buckets under a scratch folder);
  B. per bucket, in parallel: an STRtree, then every zoom 10–12 child tile.

Output: private-data/tenants/adm-soy/layers/national/soy.pmtiles
        private-data/tenants/adm-soy/layers/national-grid.geojson
Upload: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs --keep-stale

System Python (fiona, shapely, pyproj, mercantile, mapbox-vector-tile, pmtiles).
Usage: python scripts/prepare-soy-national-tiles.py [--workers 12] [--only Z8X,Z8Y …] [--keep-buckets]
"""
import argparse
import collections
import gzip
import json
import math
import os
import pickle
import shutil
import time
from multiprocessing import Pool

import fiona
import mapbox_vector_tile
import mercantile
import numpy as np
import shapely
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from pyproj import Transformer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = r"D:\000 Work\000 Databases\002 Request\999 Request Lainnya\ADM Soybean\Soy_National1825\Soy_National1825.gdb"
LAYER = "Soy_National1825"
OUT_DIR = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "layers")
PMTILES = os.path.join(OUT_DIR, "national", "soy.pmtiles")
GRID = os.path.join(OUT_DIR, "national-grid.geojson")
SCRATCH = os.path.join(ROOT, "Data Storage", "ADM Soy", "National tiles scratch")
BUCKET_Z = 8
ZOOMS = (10, 11, 12)
EXTENT = 4096
GRID_DEG = 0.1
YEARS = list(range(2018, 2026))
SOY = {5, 26, 239, 240, 241, 254}
FIPS = {
    "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
    "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
}
R = 6378137.0
HALF = math.pi * R


def merc_tile_bounds(z, x, y):
    size = 2 * HALF / 2 ** z
    return (-HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size)


def tiles_for_bounds(z, minx, miny, maxx, maxy):
    size = 2 * HALF / 2 ** z
    x0 = int((minx + HALF) // size)
    x1 = int((maxx + HALF) // size)
    y0 = int((HALF - maxy) // size)
    y1 = int((HALF - miny) // size)
    n = 2 ** z - 1
    for x in range(max(0, x0), min(n, x1) + 1):
        for y in range(max(0, y0), min(n, y1) + 1):
            yield x, y


# ------------------------------------------------------------------ pass A
def pass_a(only):
    os.makedirs(SCRATCH, exist_ok=True)
    to_merc = Transformer.from_crs("EPSG:5070", "EPSG:3857", always_xy=True)
    to_ll = Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True)
    buckets = collections.defaultdict(list)
    grid = collections.defaultdict(float)
    flushed = collections.Counter()
    t = time.time()

    def flush(force=False):
        for key in list(buckets):
            items = buckets[key]
            if force or len(items) >= 4000:
                with open(os.path.join(SCRATCH, f"{key[0]}_{key[1]}.pkl"), "ab") as fh:
                    pickle.dump(items, fh, protocol=pickle.HIGHEST_PROTOCOL)
                flushed[key] += len(items)
                del buckets[key]

    batch_geoms, batch_props = [], []

    def run_batch():
        geoms = shapely.from_wkb([g for g in batch_geoms])
        geoms = shapely.transform(geoms, lambda c: np.column_stack(to_merc.transform(c[:, 0], c[:, 1])))
        geoms = shapely.make_valid(geoms)
        bounds = shapely.bounds(geoms)
        for g, b, p in zip(geoms, bounds, batch_props):
            if g is None or shapely.is_empty(g):
                continue
            keys = list(tiles_for_bounds(BUCKET_Z, *b))
            if only:
                keys = [k for k in keys if k in only]
            if not keys:
                continue
            wkb = shapely.to_wkb(g)
            for k in keys:
                buckets[k].append((wkb, p))
        batch_geoms.clear()
        batch_props.clear()
        flush()

    n = 0
    with fiona.open(SRC, layer=LAYER) as src:
        rows = src
        if only:
            # A test run reads only the fields around the chosen zoom-8 tiles.
            to_5070 = Transformer.from_crs("EPSG:3857", "EPSG:5070", always_xy=True)
            xs, ys = [], []
            for bx, by in only:
                minx, miny, maxx, maxy = merc_tile_bounds(BUCKET_Z, bx, by)
                for mx, my in ((minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)):
                    ax, ay = to_5070.transform(mx, my)
                    xs.append(ax)
                    ys.append(ay)
            rows = src.filter(bbox=(min(xs), min(ys), max(xs), max(ys)))
        for f in rows:
            n += 1
            pr = f["properties"]
            codes = [pr[f"CDL{y}"] for y in YEARS]
            acres = float(pr["CSBACRES"] or 0)
            st = FIPS.get(pr["STATEFIPS"], pr["STATEFIPS"])
            lon, lat = to_ll.transform(pr["INSIDE_X"], pr["INSIDE_Y"])
            grid[(math.floor(lon / GRID_DEG), math.floor(lat / GRID_DEG))] += acres
            props = {
                "i": pr["CSBID"],
                "a": round(acres, 1),
                "y": sum(1 for c in codes if c in SOY),
                "n": pr["CNTY"] or "",
                "s": st,
                "h": ",".join(str(c or 0) for c in codes),
            }
            batch_geoms.append(shapely.to_wkb(shapely.geometry.shape(f["geometry"])))
            batch_props.append(props)
            if len(batch_geoms) >= 20000:
                run_batch()
            if n % 250000 == 0:
                print(f"  A: {n:,} fields, {time.time() - t:.0f} s")
    if batch_geoms:
        run_batch()
    flush(force=True)
    print(f"A: {n:,} fields into {len(flushed)} zoom-{BUCKET_Z} buckets, {time.time() - t:.0f} s")
    return grid


def write_grid(grid):
    feats = []
    d = GRID_DEG
    for (gx, gy), acres in grid.items():
        if acres < 1:
            continue
        x0, y0 = round(gx * d, 4), round(gy * d, 4)
        x1, y1 = round(x0 + d, 4), round(y0 + d, 4)
        feats.append({"type": "Feature", "properties": {"a": round(acres)}, "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}})
    with open(GRID, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "cellDeg": d, "features": feats}, fh, separators=(",", ":"))
    print(f"grid: {len(feats):,} cells of {d}°, {os.path.getsize(GRID) / 1048576:.1f} MB")


# ------------------------------------------------------------------ pass B
def tile_bucket(path):
    items = []
    with open(path, "rb") as fh:
        while True:
            try:
                items.extend(pickle.load(fh))
            except EOFError:
                break
    if not items:
        return []
    geoms = shapely.from_wkb([w for w, _ in items])
    props = [p for _, p in items]
    tree = shapely.STRtree(geoms)
    bx, by = (int(v) for v in os.path.basename(path)[:-4].split("_"))
    out = []
    for z in ZOOMS:
        f = 2 ** (z - BUCKET_Z)
        for x in range(bx * f, (bx + 1) * f):
            for y in range(by * f, (by + 1) * f):
                minx, miny, maxx, maxy = merc_tile_bounds(z, x, y)
                pad = (maxx - minx) / 64
                box = shapely.box(minx - pad, miny - pad, maxx + pad, maxy + pad)
                idx = tree.query(box, predicate="intersects")
                if len(idx) == 0:
                    continue
                unit = (maxx - minx) / EXTENT
                feats = []
                for i in idx:
                    g = shapely.clip_by_rect(geoms[i], minx - pad, miny - pad, maxx + pad, maxy + pad)
                    if g.is_empty:
                        continue
                    g = shapely.simplify(g, unit * 0.75, preserve_topology=True)
                    if g.is_empty or g.area < unit * unit:
                        continue
                    p = props[i] if z == ZOOMS[-1] else {k: v for k, v in props[i].items() if k != "h"}
                    feats.append({"geometry": g, "properties": p})
                if not feats:
                    continue
                data = mapbox_vector_tile.encode(
                    [{"name": "fields", "features": feats}],
                    default_options={"quantize_bounds": (minx, miny, maxx, maxy), "extents": EXTENT, "y_coord_down": False},
                )
                out.append((zxy_to_tileid(z, x, y), gzip.compress(data, 6)))
    return out


def pass_b(workers):
    paths = sorted(os.path.join(SCRATCH, p) for p in os.listdir(SCRATCH) if p.endswith(".pkl"))
    os.makedirs(os.path.dirname(PMTILES), exist_ok=True)
    t = time.time()
    tiles = 0
    size = 0
    per_zoom = collections.Counter()
    tmp = PMTILES + ".tmp"
    with open(tmp, "wb") as fh:
        writer = Writer(fh)
        with Pool(workers) as pool:
            for i, result in enumerate(pool.imap_unordered(tile_bucket, paths), 1):
                for tid, data in result:
                    writer.write_tile(tid, data)
                    tiles += 1
                    size += len(data)
                if i % 20 == 0:
                    print(f"  B: {i}/{len(paths)} buckets, {tiles:,} tiles, {size / 1048576:.0f} MB, {time.time() - t:.0f} s")
        # Bounds of the soybean area (lower 48).
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": ZOOMS[0],
                "max_zoom": ZOOMS[-1],
                "min_lon_e7": int(-125 * 1e7), "min_lat_e7": int(24 * 1e7),
                "max_lon_e7": int(-66 * 1e7), "max_lat_e7": int(50 * 1e7),
                "center_zoom": 10, "center_lon_e7": int(-91.4 * 1e7), "center_lat_e7": int(39.9 * 1e7),
            },
            {
                "name": "US soybean fields 2025",
                "attribution": "USDA NASS Crop Sequence Boundaries",
                "vector_layers": [{"id": "fields", "fields": {"i": "String", "a": "Number", "y": "Number", "n": "String", "s": "String", "h": "String"}}],
            },
        )
    os.replace(tmp, PMTILES)
    print(f"B: {tiles:,} tiles, {os.path.getsize(PMTILES) / 1048576:.0f} MB, {time.time() - t:.0f} s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--only", nargs="*", default=None, help="zoom-8 tiles 'x,y' to build (a test run)")
    ap.add_argument("--keep-buckets", action="store_true")
    a = ap.parse_args()
    only = {tuple(int(v) for v in s.split(",")) for s in a.only} if a.only else None
    if os.path.isdir(SCRATCH):
        shutil.rmtree(SCRATCH)
    grid = pass_a(only)
    if not only:
        write_grid(grid)
    pass_b(a.workers)
    if not a.keep_buckets:
        shutil.rmtree(SCRATCH, ignore_errors=True)


if __name__ == "__main__":
    main()
