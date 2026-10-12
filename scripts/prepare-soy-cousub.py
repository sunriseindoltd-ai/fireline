"""
Township / city / town boundaries for SoyTrace's map ("Places" layer, 11 Oct 2026):
one file per state (lower 48 + DC), every Census county subdivision with the supply-chain figures of
places.json (scripts/prepare-soy-places.py) embedded, so a click on the map reads its
statistics without loading any fields.

Source: Data Storage/ADM Soy/Boundaries/cb_2024_us_cousub_500k.zip (US Census 2024,
1:500,000) — the same file places.json was built from, so names match exactly.
Output: private-data/tenants/adm-soy/layers/cousub/<ST>.geojson — outlines
(simplified, 5 decimals) and one label point per subdivision (`label: true`).
Properties: s (state), co (county, as places.json `n`), n (NAMELSAD), t (type),
cf/ca/cif/cia/nf/na/nif/nia (places.json figures; 0 where no field is placed).
Upload: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs --v2 --only=layers/cousub/
System Python (fiona, shapely). Usage: python scripts/prepare-soy-cousub.py
"""
import json
import os
import re
import time

import fiona
import shapely
from shapely.geometry import mapping, shape

t0 = time.time()
log = lambda m: print(f"[soy-cousub {time.time() - t0:5.0f}s] {m}", flush=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
COUSUB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Boundaries", "cb_2024_us_cousub_500k.zip")
OUT_DIR = os.path.join(TENANT, "layers", "cousub")
TOLERANCE = 0.0003  # degrees (~30 m): the 1:500k file is already generalised
SKIP = {"AK", "HI", "PR", "VI", "GU", "MP", "AS"}  # the lower 48 + DC, like the state/county layers
FIELDS = ("cf", "ca", "cif", "cia", "nf", "na", "nif", "nia")
LSAD = {"20": "barrio", "21": "borough", "22": "census county division", "23": "census subarea", "24": "subdistrict",
        "25": "city", "26": "county", "27": "district", "28": "district", "29": "precinct", "30": "precinct", "31": "gore",
        "32": "grant", "36": "location", "37": "municipality", "39": "plantation", "41": "barrio-pueblo", "42": "purchase",
        "43": "town", "44": "township", "45": "township", "46": "unorganized territory", "47": "village",
        "49": "charter township", "86": "reservation"}


def strip_co(full):
    return re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|city|City and Borough)$", "", full)


def rounded(geom):
    return json.loads(json.dumps(mapping(geom)), parse_float=lambda x: round(float(x), 5))


def main():
    places = json.load(open(os.path.join(TENANT, "places.json"), encoding="utf-8"))
    stats = {}
    for st in places["states"]:
        for co in st["counties"]:
            for sub in co["subs"]:
                stats[(st["s"], co["n"], sub["n"])] = {k: sub[k] for k in FIELDS}
    states = {st["s"] for st in places["states"]}
    log(f"places.json: {len(stats):,} subdivisions with fields in {len(states)} states")

    per_state = {}
    with fiona.open(f"zip://{COUSUB}") as src:
        for f in src:
            p = f["properties"]
            st = p["STUSPS"]
            if st in SKIP:
                continue
            name, lsad = p["NAME"], p["NAMELSAD"]
            kind = LSAD.get(p["LSAD"]) or (lsad[len(name):].strip() if lsad.startswith(name) else "")
            co = strip_co(p["NAMELSADCO"])
            g = shapely.force_2d(shape(f["geometry"]))
            g = shapely.simplify(g, TOLERANCE, preserve_topology=True)
            props = {"s": st, "co": co, "n": lsad, "t": kind, **stats.get((st, co, lsad), dict.fromkeys(FIELDS, 0))}
            feats = per_state.setdefault(st, [])
            feats.append({"type": "Feature", "properties": props, "geometry": rounded(g)})
            pt = g.representative_point()
            feats.append({"type": "Feature", "properties": {"s": st, "co": co, "n": lsad, "label": True}, "geometry": {"type": "Point", "coordinates": [round(pt.x, 4), round(pt.y, 4)]}})
    os.makedirs(OUT_DIR, exist_ok=True)
    for old in os.listdir(OUT_DIR):
        os.remove(os.path.join(OUT_DIR, old))
    total = 0
    matched = 0
    for st, feats in sorted(per_state.items()):
        out = os.path.join(OUT_DIR, f"{st}.geojson")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
        n = len(feats) // 2
        total += n
        matched += sum(1 for f in feats if not f["properties"].get("label") and f["properties"]["cf"] + f["properties"]["nf"] > 0)
        log(f"{st}: {n:,} subdivisions, {os.path.getsize(out) / 1048576:.1f} MB")
    missing = [k for k in stats if k[0] in per_state and not any(f["properties"]["n"] == k[2] and f["properties"]["co"] == k[1] for f in per_state[k[0]] if not f["properties"].get("label"))]
    log(f"done: {total:,} subdivisions in {len(per_state)} files, {matched:,} with fields; places.json rows without an outline: {len(missing)} {missing[:5]}")


if __name__ == "__main__":
    main()
