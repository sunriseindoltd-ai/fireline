"""SoyTrace: the supply chain per State, County and City/Town/Township, as places.json for the platform
(10 Oct 2026; the same placing as export-soy-area-stats.py, which writes the Excel for ADM).
Sources (nothing recomputed from ArcGIS):
  Data Storage/ADM Soy/Data Baru/Soy_National1825.gdb   every 2025 US soybean field (USDA NASS CSB, ADM delivery)
  private-data/tenants/adm-soy/fields/units/*.geojson   the supply chain's compliant fields + catchments (k)
  private-data/tenants/adm-soy/fields/noncomply.geojson ADM's non-compliant list (k = catchments, "" = none)
  Data Storage/ADM Soy/Boundaries/cb_2024_us_cousub_500k.zip  US Census county subdivisions
Each field is placed by its interior point in a Census county subdivision, so subdivision, county and state
rows add up. Output: private-data/tenants/adm-soy/places.json —
  { version, asOf, states: [{ s, n, cf, ca, cif, cia, nf, na, nif, nia, bbox,
      counties: [{ n, full, cf…, bbox, subs: [{ n, t, cf…, bbox }] }] }] }
  cf/ca = compliant fields/acres (all US), cif/cia = inside the supply chain's catchments,
  nf/na = on ADM's non-compliant list, nif/nia = listed and inside a catchment. bbox = [W, S, E, N].
Usage: python scripts/prepare-soy-places.py   (~3 min)
"""
import collections
import glob
import json
import os
import re
import time
import fiona
import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import shape

t0 = time.time()
log = lambda m: print(f"[soy-places {time.time() - t0:5.0f}s] {m}", flush=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
NATIONAL = os.path.join(ROOT, "Data Storage", "ADM Soy", "Data Baru", "Soy_National1825.gdb")
COUSUB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Boundaries", "cb_2024_us_cousub_500k.zip")
OUT = os.path.join(TENANT, "places.json")

nc_fc = json.load(open(os.path.join(TENANT, "fields", "noncomply.geojson"), encoding="utf-8"))["features"]
nc_ids = {str(f["properties"]["id"]) for f in nc_fc}
inside = {}
for path in sorted(glob.glob(os.path.join(TENANT, "fields", "units", "*.geojson"))):
    if re.search(r"\.part\d+\.geojson$", path):
        continue
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        p = f["properties"]
        fid = str(p["id"])
        ks = {k for k in str(p.get("k") or "").split("|") if k}
        hit = inside.get(fid)
        if hit is None:
            inside[fid] = [float(p.get("a") or 0), ks, f["geometry"]]
        else:
            hit[1] |= ks
log(f"supply chain: {len(inside):,} compliant fields in catchments")

ids, acres, xs, ys = [], [], [], []
with fiona.open(NATIONAL, layer="Soy_National1825", ignore_geometry=True) as src:
    natcrs = CRS.from_wkt(src.crs_wkt)
    for f in src:
        p = f["properties"]
        ids.append(str(p["CSBID"]))
        acres.append(float(p["CSBACRES"] or 0))
        xs.append(p["INSIDE_X"])
        ys.append(p["INSIDE_Y"])
lon, lat = Transformer.from_crs(natcrs, "EPSG:4269", always_xy=True).transform(np.array(xs, float), np.array(ys, float))
nat_index = {fid: i for i, fid in enumerate(ids)}
log(f"national: {len(ids):,} fields")

rec_id, rec_ac, rec_nc, rec_x, rec_y = [], [], [], [], []
for i, fid in enumerate(ids):
    rec_id.append(fid)
    rec_ac.append(acres[i])
    rec_nc.append(fid in nc_ids)
    rec_x.append(lon[i])
    rec_y.append(lat[i])
for fid in [fid for fid in inside if fid not in nat_index]:
    c = shapely.get_coordinates(shapely.point_on_surface(shape(inside[fid][2])))[0]
    rec_id.append(fid)
    rec_ac.append(inside[fid][0])
    rec_nc.append(fid in nc_ids)
    rec_x.append(c[0])
    rec_y.append(c[1])
for f in nc_fc:
    fid = str(f["properties"]["id"])
    if fid not in nat_index and fid not in inside:
        c = shapely.get_coordinates(shapely.point_on_surface(shape(f["geometry"])))[0]
        rec_id.append(fid)
        rec_ac.append(float(f["properties"].get("a") or 0))
        rec_nc.append(True)
        rec_x.append(c[0])
        rec_y.append(c[1])

LSAD = {"20": "barrio", "21": "borough", "22": "census county division", "23": "census subarea", "24": "subdistrict",
        "25": "city", "26": "county", "27": "district", "28": "district", "29": "precinct", "30": "precinct", "31": "gore",
        "32": "grant", "36": "location", "37": "municipality", "39": "plantation", "41": "barrio-pueblo", "42": "purchase",
        "43": "town", "44": "township", "45": "township", "46": "unorganized territory", "47": "village",
        "49": "charter township", "86": "reservation"}
subs, geoms = [], []
with fiona.open(f"zip://{COUSUB}") as src:
    for f in src:
        p = f["properties"]
        name, lsad = p["NAME"], p["NAMELSAD"]
        kind = LSAD.get(p["LSAD"]) or (lsad[len(name):].strip() if lsad.startswith(name) else "")
        subs.append((p["STUSPS"], p["STATE_NAME"], p["NAMELSADCO"], lsad, kind))
        geoms.append(shapely.force_2d(shape(f["geometry"])))
tree = shapely.STRtree(geoms)
pts = shapely.points(np.column_stack([rec_x, rec_y]))
pi, si = tree.query(pts, predicate="intersects")
where = np.full(len(pts), -1)
where[pi] = si
loose = np.nonzero(where < 0)[0]
if len(loose):
    where[loose] = tree.nearest(pts[loose])
log(f"placed {len(pts):,} fields ({len(loose):,} by nearest subdivision)")

FIELDS = ("cf", "ca", "cif", "cia", "nf", "na", "nif", "nia")
def blank():
    return dict.fromkeys(FIELDS, 0)
lev = {"state": collections.defaultdict(blank), "county": collections.defaultdict(blank), "sub": collections.defaultdict(blank)}
bounds = {"county": {}, "sub": {}}
nc_props = {str(f["properties"]["id"]): f["properties"] for f in nc_fc}
seen = set()
for r in range(len(rec_id)):
    fid = rec_id[r]
    if fid in seen:
        continue
    seen.add(fid)
    st, stname, co, sub, kind = subs[where[r]]
    keys = {"state": (st, stname), "county": (st, stname, co), "sub": (st, stname, co, sub, kind)}
    if rec_nc[r]:
        np_ = nc_props.get(fid, {})
        a = float(np_.get("a") or rec_ac[r])
        ks = {k for k in str(np_.get("k") or "").split("|") if k}
        for lv, key in keys.items():
            row = lev[lv][key]
            row["nf"] += 1
            row["na"] += a
            if ks:
                row["nif"] += 1
                row["nia"] += a
    else:
        sc = inside.get(fid)
        a = rec_ac[r]
        for lv, key in keys.items():
            row = lev[lv][key]
            row["cf"] += 1
            row["ca"] += a
            if sc:
                row["cif"] += 1
                row["cia"] += a
    # The subdivision's own outline bounds (the fields' point bounds would be smaller).
    bounds["sub"].setdefault(keys["sub"], where[r])

# Outline bounds per subdivision and county (union of its subdivisions' bounds).
sub_bbox = {}
for key, gi in bounds["sub"].items():
    b = shapely.bounds(geoms[gi])
    sub_bbox[key] = [round(float(v), 4) for v in b]
co_bbox = {}
for key, b in sub_bbox.items():
    ck = key[:3]
    cur = co_bbox.get(ck)
    co_bbox[ck] = b[:] if cur is None else [min(cur[0], b[0]), min(cur[1], b[1]), max(cur[2], b[2]), max(cur[3], b[3])]

def strip_co(full):
    return re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|city|City and Borough)$", "", full)

def num(row):
    return {k: (round(v, 1) if isinstance(v, float) else v) for k, v in row.items()}

states = []
for (st, stname), srow in sorted(lev["state"].items(), key=lambda kv: -kv[1]["ca"]):
    counties = []
    for (st2, _, co), crow in sorted(((k, v) for k, v in lev["county"].items() if k[0] == st), key=lambda kv: -kv[1]["ca"]):
        subrows = []
        for (st3, _, co3, sub, kind), xrow in sorted(((k, v) for k, v in lev["sub"].items() if k[0] == st and k[2] == co), key=lambda kv: -kv[1]["ca"]):
            subrows.append({"n": sub, "t": kind, **num(xrow), "bbox": sub_bbox[(st3, _, co3, sub, kind)]})
        counties.append({"n": strip_co(co), "full": co, **num(crow), "bbox": co_bbox[(st2, _, co)], "subs": subrows})
    sb = None
    for c in counties:
        b = c["bbox"]
        sb = b[:] if sb is None else [min(sb[0], b[0]), min(sb[1], b[1]), max(sb[2], b[2]), max(sb[3], b[3])]
    states.append({"s": st, "n": stname, **num(srow), "bbox": sb, "counties": counties})
tot = {f: round(sum(v[f] for v in lev["state"].values()), 1) for f in FIELDS}
out = {"version": 1, "asOf": "2026-10-07", "totals": tot, "states": states}
json.dump(out, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
log(f"written {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB): {len(states)} states, "
    f"{sum(len(s['counties']) for s in states):,} counties, {sum(len(c['subs']) for s in states for c in s['counties']):,} subdivisions; totals {tot}")
