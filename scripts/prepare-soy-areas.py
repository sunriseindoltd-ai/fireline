"""SoyTrace: the supply chain by state and county.

Reads the catchment field files written by prepare-adm-soy-supply.py
(private-data/tenants/adm-soy/fields/units/*.geojson) and the non-compliant
fields (fields/noncomply.geojson) — nothing is recomputed from the source
data — and writes:

  areas.json                              (bundled) per state and county: compliant
                                          fields / acres, non-compliant fields / acres
                                          inside the catchments, bounds, field file
  fields/counties/<ST>/<county>.geojson   the supply chain's compliant fields in one
                                          county, each field once (R2 soy bucket, v2/)

So a state or county can be picked for the whole supply chain without loading
every catchment: figures from areas.json, outlines only for one county.

Usage: python scripts/prepare-soy-areas.py
"""
import glob
import json
import os
import re
import shutil
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
UNITS = os.path.join(TENANT, "fields", "units")
OUT_DIR = os.path.join(TENANT, "fields", "counties")
t0 = time.time()


def log(msg):
    print(f"[soy-areas {time.time() - t0:5.0f}s] {msg}", flush=True)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "unknown").lower()).strip("-") or "unknown"


def bounds(geom, bb):
    def walk(c):
        if isinstance(c[0], (int, float)):
            x, y = c[0], c[1]
            if x < bb[0]:
                bb[0] = x
            if y < bb[1]:
                bb[1] = y
            if x > bb[2]:
                bb[2] = x
            if y > bb[3]:
                bb[3] = y
        else:
            for p in c:
                walk(p)

    walk(geom["coordinates"])


def new_area():
    return {"f": 0, "a": 0.0, "nf": 0, "na": 0.0, "bb": [180.0, 90.0, -180.0, -90.0]}


seen = set()
counties = {}  # (state, county) -> area + features
states = {}
files = sorted(f for f in glob.glob(os.path.join(UNITS, "*.geojson")) if not re.search(r"\.part\d+\.geojson$", f))
log(f"{len(files)} catchment files")
for i, path in enumerate(files):
    fc = json.load(open(path, encoding="utf-8"))
    for f in fc["features"]:
        p = f["properties"]
        fid = str(p["id"])
        if fid in seen:
            continue
        seen.add(fid)
        st, co = p.get("s") or "", p.get("n") or ""
        key = (st, co)
        c = counties.get(key)
        if c is None:
            c = counties[key] = {**new_area(), "feats": []}
        s = states.setdefault(st, new_area())
        a = float(p.get("a") or 0)
        for area in (c, s):
            area["f"] += 1
            area["a"] += a
            bounds(f["geometry"], area["bb"])
        c["feats"].append(json.dumps(f, ensure_ascii=False, separators=(",", ":")))
    if (i + 1) % 25 == 0:
        log(f"  {i + 1}/{len(files)} files, {len(seen):,} fields")
log(f"{len(seen):,} compliant fields in {len(counties):,} counties, {len(states)} states")

# Non-compliant fields inside a catchment (as the Summary counts them).
nc = json.load(open(os.path.join(TENANT, "fields", "noncomply.geojson"), encoding="utf-8"))["features"]
nc_in = 0
for f in nc:
    p = f["properties"]
    if not str(p.get("k") or ""):
        continue
    nc_in += 1
    st, co = p.get("s") or "", p.get("n") or ""
    c = counties.get((st, co))
    if c is None:
        c = counties[(st, co)] = {**new_area(), "feats": []}
        bounds(f["geometry"], c["bb"])
    s = states.setdefault(st, new_area())
    a = float(p.get("a") or 0)
    for area in (c, s):
        area["nf"] += 1
        area["na"] += a
log(f"{nc_in} non-compliant fields inside catchments")

# The county's own outline bounds (US Census layer from prepare-soy-boundaries.py), so the map can show the whole
# county — its supply-chain fields may cover only the part inside a catchment.
cbox = {}
cpath = os.path.join(TENANT, "layers", "counties.geojson")
if os.path.exists(cpath):
    for f in json.load(open(cpath, encoding="utf-8"))["features"]:
        p = f["properties"]
        if f["geometry"]["type"] == "Point":
            continue
        bb = cbox.setdefault((p.get("s") or "", p.get("n") or ""), [180.0, 90.0, -180.0, -90.0])
        bounds(f["geometry"], bb)

# County files (rewritten from scratch so a renamed county leaves nothing behind).
shutil.rmtree(OUT_DIR, ignore_errors=True)
total_bytes = 0
biggest = (0, "")
out_states = {}
for (st, co), c in sorted(counties.items()):
    rel = f"{st or 'XX'}/{slug(co)}"
    size = 0
    if c["feats"]:
        os.makedirs(os.path.join(OUT_DIR, st or "XX"), exist_ok=True)
        body = '{"type":"FeatureCollection","features":[' + ",".join(c["feats"]) + "]}"
        open(os.path.join(OUT_DIR, f"{rel}.geojson"), "w", encoding="utf-8").write(body)
        size = len(body.encode("utf-8"))
        total_bytes += size
        biggest = max(biggest, (size, rel))
    out_states.setdefault(st, []).append({
        "n": co, "file": rel if size else None, "bytes": size,
        "f": c["f"], "a": round(c["a"], 1), "nf": c["nf"], "na": round(c["na"], 1),
        "bbox": [round(v, 4) for v in c["bb"]],
        **({"cbox": [round(v, 4) for v in cbox[(st, co)]]} if (st, co) in cbox else {}),
    })
log(f"{sum(1 for c in counties.values() if c['feats']):,} county files, {total_bytes / 1e6:,.0f} MB (largest {biggest[1]} {biggest[0] / 1e6:.1f} MB)")

out = {
    "version": 1,
    "fields": len(seen),
    "ncFields": nc_in,
    "states": [
        {
            "s": st, "f": s["f"], "a": round(s["a"], 1), "nf": s["nf"], "na": round(s["na"], 1),
            "bbox": [round(v, 4) for v in s["bb"]],
            "counties": sorted(out_states.get(st, []), key=lambda x: x["n"]),
        }
        for st, s in sorted(states.items())
    ],
}
open(os.path.join(TENANT, "areas.json"), "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
log(f"areas.json {os.path.getsize(os.path.join(TENANT, 'areas.json')) / 1e3:.0f} kB — done")
