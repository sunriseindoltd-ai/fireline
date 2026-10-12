"""
State and county boundary layers for SoyTrace's map (layers "States" and
"Counties"). Source: US Census Bureau cartographic boundary files, 1:5,000,000,
2024 edition — states and counties from the same release, so their edges
match. The lower 48 states plus DC only.

Output (served from the soy bucket like the rail/river layers):
  private-data/tenants/adm-soy/layers/states.geojson
  private-data/tenants/adm-soy/layers/counties.geojson
Each holds the outlines (Polygon/MultiPolygon, simplified, 5 decimals) and one
label point per unit (Point, `label: true`) — properties `n` (name) and `s`
(state abbreviation).
Upload: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs --keep-stale

System Python (fiona, shapely). Usage: python scripts/prepare-soy-boundaries.py
"""
import io
import json
import os
import urllib.request
import zipfile

import fiona
import shapely
from shapely.geometry import mapping, shape

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC_DIR = os.path.join(ROOT, "Data Storage", "ADM Soy", "Boundaries")
OUT_DIR = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "layers")
BASE = "https://www2.census.gov/geo/tiger/GENZ2024/shp"
SKIP = {"AK", "HI", "PR", "VI", "GU", "MP", "AS"}
TOLERANCE = {"state": 0.002, "county": 0.001}  # degrees (~200 m / ~100 m)


def fetch(name):
    os.makedirs(SRC_DIR, exist_ok=True)
    path = os.path.join(SRC_DIR, f"{name}.zip")
    if not os.path.exists(path):
        print(f"downloading {name} …")
        urllib.request.urlretrieve(f"{BASE}/{name}.zip", path)
    return path


def rounded(geom):
    return json.loads(json.dumps(mapping(geom)), parse_float=lambda x: round(float(x), 5))


def place_stats():
    """places.json (scripts/prepare-soy-places.py): the supply-chain figures per state and county,
    embedded in the outlines so a click on the map reads them (11 Oct 2026)."""
    path = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "places.json")
    if not os.path.exists(path):
        return {}, {}
    places = json.load(open(path, encoding="utf-8"))
    st = {s["s"]: {k: s[k] for k in FIELDS} for s in places["states"]}
    co = {(s["s"], c["n"]): {k: c[k] for k in FIELDS} for s in places["states"] for c in s["counties"]}
    return st, co


FIELDS = ("cf", "ca", "cif", "cia", "nf", "na", "nif", "nia")


def build(kind, name, label_of, state_of):
    zp = fetch(name)
    st_stats, co_stats = place_stats()
    feats = []
    with fiona.open(f"zip://{zp}") as src:
        for f in src:
            p = f["properties"]
            st = state_of(p)
            if st in SKIP:
                continue
            g = shape(f["geometry"])
            g = shapely.simplify(g, TOLERANCE[kind], preserve_topology=True)
            props = {"n": label_of(p), "s": st}
            stats = st_stats.get(st) if kind == "state" else co_stats.get((st, props["n"]))
            feats.append({"type": "Feature", "properties": {**props, **(stats or dict.fromkeys(FIELDS, 0))}, "geometry": rounded(g)})
            pt = g.representative_point()
            feats.append({"type": "Feature", "properties": {**props, "label": True}, "geometry": {"type": "Point", "coordinates": [round(pt.x, 4), round(pt.y, 4)]}})
    out = os.path.join(OUT_DIR, {"state": "states.geojson", "county": "counties.geojson"}[kind])
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
    print(f"{os.path.basename(out)}: {len(feats) // 2} units, {os.path.getsize(out) / 1048576:.1f} MB")


def main():
    build("state", "cb_2024_us_state_5m", lambda p: p["NAME"], lambda p: p["STUSPS"])
    build("county", "cb_2024_us_county_5m", lambda p: p["NAME"], lambda p: p["STUSPS"])


if __name__ == "__main__":
    main()
