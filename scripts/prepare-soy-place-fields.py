"""SoyTrace: every 2025 soybean field of a county, for the map's "inspect a place" view (11 Oct 2026).

The Places layer (county / township) answers with four counts (compliant all, compliant in catchments,
non-compliant on ADM's list, non-compliant in catchments). This writes the fields behind those counts, one
file per county, so the map can draw ALL of a county's or township's fields and tell apart the ones inside
a catchment from the ones outside every catchment — not only the supply chain's fields (fields/counties/).

Sources (nothing recomputed from ArcGIS):
  Data Storage/ADM Soy/Data Baru/Soy_National1825.gdb   every 2025 US soybean field (USDA NASS CSB, Albers)
  private-data/tenants/adm-soy/fields/units/*.geojson   the supply chain's compliant fields → catchments (k)
  private-data/tenants/adm-soy/fields/noncomply.geojson ADM's non-compliant list (k = catchments, "" = none)
  Data Storage/ADM Soy/Boundaries/cb_2024_us_cousub_500k.zip  US Census county subdivisions (same placing
                                                        as places.json: the field's interior point)
Output: private-data/tenants/adm-soy/fields/places/<ST>/<county-slug>.geojson — a FeatureCollection of
  compliant fields {id, a, y, c, k, s, n, sub} (k = "" outside every catchment) and the county's listed
  non-compliant fields as in noncomply.geojson plus {sub, nc: 1}. Geometry WGS84, 5 decimals.
  County / subdivision names are the Census ones, as in places.json and layers/cousub/.
Upload: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs --v2 --only=fields/places/
Usage: python scripts/prepare-soy-place-fields.py   (~15 min; system Python: fiona, shapely, pyproj, numpy)
"""
import collections
import glob
import json
import os
import re
import shutil
import time

import fiona
import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import shape

t0 = time.time()
log = lambda m: print(f"[soy-place-fields {time.time() - t0:5.0f}s] {m}", flush=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
NATIONAL = os.path.join(ROOT, "Data Storage", "ADM Soy", "Data Baru", "Soy_National1825.gdb")
COUSUB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Boundaries", "cb_2024_us_cousub_500k.zip")
OUT_DIR = os.path.join(TENANT, "fields", "places")
SOY_CDL = {5, 26, 239, 240, 241, 254}  # soybeans, single or double crop
FLUSH_BYTES = 300 * 1024 * 1024


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "unknown").lower()).strip("-") or "unknown"


def strip_co(full):
    return re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|city|City and Borough)$", "", full)


# --- the supply chain's fields → catchments
inside = {}
for path in sorted(glob.glob(os.path.join(TENANT, "fields", "units", "*.geojson"))):
    if re.search(r"\.part\d+\.geojson$", path):
        continue
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        p = f["properties"]
        fid = str(p["id"])
        ks = {k for k in str(p.get("k") or "").split("|") if k}
        cur = inside.get(fid)
        if cur is None:
            inside[fid] = ks
        else:
            cur |= ks
log(f"supply chain: {len(inside):,} compliant fields in catchments")
nc_fc = json.load(open(os.path.join(TENANT, "fields", "noncomply.geojson"), encoding="utf-8"))["features"]
nc_by_id = {str(f["properties"]["id"]): f for f in nc_fc}
log(f"non-compliant list: {len(nc_by_id):,} fields")

# --- subdivisions
subs, geoms = [], []
with fiona.open(f"zip://{COUSUB}") as src:
    for f in src:
        p = f["properties"]
        subs.append((p["STUSPS"], strip_co(p["NAMELSADCO"]), p["NAMELSAD"]))
        geoms.append(shapely.force_2d(shape(f["geometry"])))
tree = shapely.STRtree(geoms)
log(f"{len(subs):,} county subdivisions")


def place(xs, ys):
    pts = shapely.points(np.column_stack([xs, ys]))
    pi, si = tree.query(pts, predicate="intersects")
    where = np.full(len(pts), -1)
    where[pi] = si
    loose = np.nonzero(where < 0)[0]
    if len(loose):
        where[loose] = tree.nearest(pts[loose])
    return where


# --- pass 1: interior points → place
ids, xs, ys = [], [], []
with fiona.open(NATIONAL, layer="Soy_National1825", ignore_geometry=True) as src:
    natcrs = CRS.from_wkt(src.crs_wkt)
    for f in src:
        p = f["properties"]
        ids.append(str(p["CSBID"]))
        xs.append(p["INSIDE_X"])
        ys.append(p["INSIDE_Y"])
to_wgs = Transformer.from_crs(natcrs, "EPSG:4326", always_xy=True)
lon, lat = to_wgs.transform(np.array(xs, float), np.array(ys, float))
where = place(lon, lat)
log(f"national: {len(ids):,} fields placed")

# --- county buffers, flushed to disk as they grow
shutil.rmtree(OUT_DIR, ignore_errors=True)
buf = collections.defaultdict(list)
started = set()
buffered = 0
counts = collections.Counter()


def flush():
    global buffered
    for key, feats in buf.items():
        st, co = key
        rel = os.path.join(OUT_DIR, st, f"{slug(co)}.geojson")
        if key not in started:
            os.makedirs(os.path.dirname(rel), exist_ok=True)
            with open(rel, "w", encoding="utf-8") as fh:
                fh.write('{"type":"FeatureCollection","features":[' + ",".join(feats))
            started.add(key)
        else:
            with open(rel, "a", encoding="utf-8") as fh:
                fh.write("," + ",".join(feats))
    buf.clear()
    buffered = 0


def add(key, text):
    global buffered
    buf[key].append(text)
    buffered += len(text)
    if buffered > FLUSH_BYTES:
        flush()


def wgs(geom):
    g = shapely.transform(geom, lambda a: np.column_stack(to_wgs.transform(a[:, 0], a[:, 1])))
    g = shapely.transform(g, lambda a: np.round(a, 5))
    if g.geom_type == "MultiPolygon" and len(g.geoms) == 1:
        g = g.geoms[0]
    return g


# --- pass 2: geometry, in the same order
seen_nc = set()
i = 0
with fiona.open(NATIONAL, layer="Soy_National1825") as src:
    for f in src:
        p = f["properties"]
        fid = str(p["CSBID"])
        st, co, sub = subs[where[i]]
        i += 1
        key = (st, co)
        ncf = nc_by_id.get(fid)
        if ncf is not None:
            seen_nc.add(fid)
            props = {**ncf["properties"], "s": st, "n": co, "sub": sub, "nc": 1}
            text = json.dumps({"type": "Feature", "properties": props, "geometry": ncf["geometry"]}, ensure_ascii=False, separators=(",", ":"))
            counts["nc"] += 1
        else:
            cdl = [p[f"CDL{y}"] for y in range(2018, 2026)]
            ks = inside.get(fid)
            props = {
                "id": fid, "a": round(float(p["CSBACRES"] or 0), 1), "y": sum(1 for c in cdl if c in SOY_CDL),
                "c": ",".join("" if c is None else str(c) for c in cdl), "k": "|".join(sorted(ks)) if ks else "",
                "s": st, "n": co, "sub": sub,
            }
            g = wgs(shapely.force_2d(shape(f["geometry"])))
            text = '{"type":"Feature","properties":' + json.dumps(props, ensure_ascii=False, separators=(",", ":")) + ',"geometry":' + shapely.to_geojson(g) + "}"
            counts["in" if ks else "out"] += 1
        add(key, text)
        if i % 250000 == 0:
            log(f"  {i:,} fields — in {counts['in']:,} / out {counts['out']:,} / nc {counts['nc']:,}")
# non-compliant fields that are not in the national file (point-only, or CSB rows missing)
extra_x, extra_y, extra = [], [], []
for fid, ncf in nc_by_id.items():
    if fid in seen_nc:
        continue
    c = shapely.get_coordinates(shapely.point_on_surface(shape(ncf["geometry"])))[0]
    extra_x.append(c[0])
    extra_y.append(c[1])
    extra.append(ncf)
if extra:
    w2 = place(np.array(extra_x), np.array(extra_y))
    for ncf, wi in zip(extra, w2):
        st, co, sub = subs[wi]
        props = {**ncf["properties"], "s": st, "n": co, "sub": sub, "nc": 1}
        add((st, co), json.dumps({"type": "Feature", "properties": props, "geometry": ncf["geometry"]}, ensure_ascii=False, separators=(",", ":")))
        counts["nc"] += 1
flush()
total = 0
biggest = (0, "")
for key in started:
    st, co = key
    rel = os.path.join(OUT_DIR, st, f"{slug(co)}.geojson")
    with open(rel, "a", encoding="utf-8") as fh:
        fh.write("]}")
    size = os.path.getsize(rel)
    total += size
    biggest = max(biggest, (size, f"{st}/{slug(co)}"))
log(f"done: {len(started):,} county files, {total / 1e6:,.0f} MB (largest {biggest[1]} {biggest[0] / 1e6:.1f} MB); "
    f"compliant in catchments {counts['in']:,}, outside {counts['out']:,}, non-compliant {counts['nc']:,} (extra {len(extra)})")
