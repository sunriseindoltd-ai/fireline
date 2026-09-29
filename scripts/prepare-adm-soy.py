"""
Offline admin step for the ADM Soy workspace (tenant `adm-soy`): turns ADM's
soybean delivery into what the app reads.

  Input  (ADM Soybean delivery folder, see --src):
    Buffer_Crushing_Plant.shp  five ADM crushing plants, 40-mile buffer each
    SOY_Crushingplant.shp      USDA NASS Crop Sequence Boundaries 2018-2025
                               fields planted with soybeans in 2025 that fall
                               within those buffers (CDL crop code per year)
  Output (private-data/tenants/adm-soy/):
    soy.json                   plants, buffer polygons, per-plant and overall
                               statistics (bundled into the app — small)
    fields/<plant>.geojson     that plant's fields (+ .partN when large);
                               never bundled — uploaded to the soy R2 bucket
                               by scripts/upload-soy-fields-to-r2.mjs

Every plant keeps its own sourcing area — Decatur (West) and Decatur (East)
are ~1 km apart and their buffers nearly coincide, so most Decatur fields
belong to both and appear under each (user decision, 2026-09-29). The
"all plants" totals count each field once.

A field belongs to a plant when its centroid is inside the buffer or, near
the edge, when its polygon touches it (the delivery selected fields that
way — 662 have their centroid just outside every buffer).

Statistics only — no EUDR analysis (scope for now). The crop-history figures
describe the 2025 soybean fields' own past crops, not total soybean area in
earlier years, since the delivery only holds fields that grew soy in 2025.

Run with ArcGIS Pro's Python:
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" scripts/prepare-adm-soy.py
"""
import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

DEFAULT_SRC = r"D:\000 Work\000 Databases\002 Request\999 Request Lainnya\ADM Soybean"
SCRATCH = r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini\_ArcpyScratch"
os.environ["TEMP"] = os.environ["TMP"] = SCRATCH
import arcpy  # noqa: E402  (TEMP/TMP must be set first)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
YEARS = list(range(2018, 2026))
AC_TO_HA = 0.40468564224
BUFFER_MILES = 40
BUFFER_KM = BUFFER_MILES * 1.609344
PART_BYTES = 12 * 1024 * 1024  # same order as the palm plot files' parts
COORD_DP = 5  # ~1 m

CDL_NAMES = {
    1: "Corn", 2: "Cotton", 3: "Rice", 4: "Sorghum", 5: "Soybeans", 6: "Sunflower", 10: "Peanuts",
    11: "Tobacco", 12: "Sweet Corn", 13: "Pop or Orn Corn", 14: "Mint", 21: "Barley", 22: "Durum Wheat",
    23: "Spring Wheat", 24: "Winter Wheat", 25: "Other Small Grains", 26: "Dbl Crop WinWht/Soybeans",
    27: "Rye", 28: "Oats", 29: "Millet", 30: "Speltz", 31: "Canola", 32: "Flaxseed", 33: "Safflower",
    34: "Rape Seed", 35: "Mustard", 36: "Alfalfa", 37: "Other Hay/Non Alfalfa", 38: "Camelina",
    39: "Buckwheat", 41: "Sugarbeets", 42: "Dry Beans", 43: "Potatoes", 44: "Other Crops",
    45: "Sugarcane", 46: "Sweet Potatoes", 47: "Misc Vegs & Fruits", 48: "Watermelons", 49: "Onions",
    50: "Cucumbers", 51: "Chick Peas", 52: "Lentils", 53: "Peas", 54: "Tomatoes", 55: "Caneberries",
    56: "Hops", 57: "Herbs", 58: "Clover/Wildflowers", 59: "Sod/Grass Seed", 60: "Switchgrass",
    61: "Fallow/Idle Cropland", 62: "Pasture/Grass", 63: "Forest", 64: "Shrubland", 65: "Barren",
    66: "Cherries", 67: "Peaches", 68: "Apples", 69: "Grapes", 70: "Christmas Trees",
    71: "Other Tree Crops", 72: "Citrus", 74: "Pecans", 75: "Almonds", 76: "Walnuts", 77: "Pears",
    81: "Clouds/No Data", 82: "Developed", 83: "Water", 87: "Wetlands", 88: "Nonag/Undefined",
    92: "Aquaculture", 111: "Open Water", 112: "Perennial Ice/Snow", 121: "Developed/Open Space",
    122: "Developed/Low Intensity", 123: "Developed/Med Intensity", 124: "Developed/High Intensity",
    131: "Barren", 141: "Deciduous Forest", 142: "Evergreen Forest", 143: "Mixed Forest",
    152: "Shrubland", 176: "Grassland/Pasture", 190: "Woody Wetlands", 195: "Herbaceous Wetlands",
    204: "Pistachios", 205: "Triticale", 206: "Carrots", 207: "Asparagus", 208: "Garlic",
    209: "Cantaloupes", 210: "Prunes", 211: "Olives", 212: "Oranges", 213: "Honeydew Melons",
    214: "Broccoli", 215: "Avocados", 216: "Peppers", 217: "Pomegranates", 218: "Nectarines",
    219: "Greens", 220: "Plums", 221: "Strawberries", 222: "Squash", 223: "Apricots", 224: "Vetch",
    225: "Dbl Crop WinWht/Corn", 226: "Dbl Crop Oats/Corn", 227: "Lettuce",
    228: "Dbl Crop Triticale/Corn", 229: "Pumpkins", 236: "Dbl Crop WinWht/Sorghum",
    237: "Dbl Crop Barley/Corn", 238: "Dbl Crop WinWht/Cotton", 239: "Dbl Crop Soybeans/Cotton",
    240: "Dbl Crop Soybeans/Oats", 241: "Dbl Crop Corn/Soybeans", 242: "Blueberries", 243: "Cabbage",
    244: "Cauliflower", 245: "Celery", 246: "Radishes", 247: "Turnips", 248: "Eggplants",
    249: "Gourds", 250: "Cranberries", 254: "Dbl Crop Barley/Soybeans",
}
# Crop-history groups (ids are what the app keys its labels and colours on).
SOY = {5, 26, 239, 240, 241, 254}
CORN = {1, 12, 13, 225, 226, 228, 237}
GRASS = {36, 37, 58, 59, 60, 62, 176, 224}
FALLOW = {61}
NON_CROP = {63, 64, 65, 81, 82, 83, 87, 88, 92, 111, 112, 121, 122, 123, 124, 131, 141, 142, 143, 152, 190, 195}
GROUPS = ["soy", "corn", "other", "grass", "fallow", "noncrop"]
SIZE_BINS_HA = [2, 5, 10, 20, 50, 100]  # upper bounds; last bin is >= 100
STATE_ABBR = {"17": "IL", "19": "IA", "29": "MO", "31": "NE", "18": "IN", "20": "KS", "55": "WI", "27": "MN"}
STATE_NAME = {"IL": "Illinois", "IA": "Iowa", "MO": "Missouri", "NE": "Nebraska", "IN": "Indiana",
              "KS": "Kansas", "WI": "Wisconsin", "MN": "Minnesota"}


def group_of(code):
    if code is None:
        return "noncrop"
    if code in SOY:
        return "soy"
    if code in CORN:
        return "corn"
    if code in GRASS:
        return "grass"
    if code in FALLOW:
        return "fallow"
    if code in NON_CROP:
        return "noncrop"
    return "other"


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def haversine_km(lat1, lon1, lat2, lon2):
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def round_geom(gi):
    """GeoJSON geometry dict (from __geo_interface__) rounded to COORD_DP,
    consecutive duplicate vertices dropped, degenerate rings removed."""
    def ring(pts):
        out = []
        for x, y in pts:
            p = (round(x, COORD_DP), round(y, COORD_DP))
            if not out or out[-1] != p:
                out.append(p)
        if out and out[0] != out[-1]:
            out.append(out[0])
        return [list(p) for p in out] if len(out) >= 4 else None

    def poly(rings):
        rs = [ring(r) for r in rings]
        rs = [r for r in rs if r]
        return rs if rs else None

    if gi["type"] == "Polygon":
        p = poly(gi["coordinates"])
        return {"type": "Polygon", "coordinates": p} if p else None
    polys = [p for p in (poly(c) for c in gi["coordinates"]) if p]
    if not polys:
        return None
    return {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}


def quantile(sorted_vals, q):
    if not sorted_vals:
        return None
    return sorted_vals[int(q * (len(sorted_vals) - 1))]


class Stats:
    def __init__(self):
        self.fields = 0
        self.acres = 0.0
        self.sizes_ha = []
        self.year = {y: Counter() for y in YEARS}
        self.soy_years = Counter()
        self.state = defaultdict(lambda: [0, 0.0])
        self.county = defaultdict(lambda: [0, 0.0])

    def add(self, f):
        ac = f["acres"]
        self.fields += 1
        self.acres += ac
        self.sizes_ha.append(ac * AC_TO_HA)
        for y, code in zip(YEARS, f["cdl"]):
            self.year[y][group_of(code)] += ac
        self.soy_years[sum(1 for c in f["cdl"] if c in SOY)] += 1
        s = self.state[f["st"]]
        s[0] += 1
        s[1] += ac
        c = self.county[(f["county"], f["st"])]
        c[0] += 1
        c[1] += ac

    def to_json(self):
        z = sorted(self.sizes_ha)
        bins = [0] * (len(SIZE_BINS_HA) + 1)
        for v in z:
            i = next((k for k, ub in enumerate(SIZE_BINS_HA) if v < ub), len(SIZE_BINS_HA))
            bins[i] += 1
        ha = lambda ac: round(ac * AC_TO_HA)  # noqa: E731
        return {
            "fields": self.fields,
            "ha": ha(self.acres),
            "acres": round(self.acres),
            "fieldHa": {k: (round(quantile(z, q), 1) if z else None) for k, q in (("p10", 0.1), ("median", 0.5), ("p90", 0.9), ("max", 1))},
            "sizeBinsHa": {"bounds": SIZE_BINS_HA, "fields": bins},
            "cropHistoryHa": [{"year": y, **{g: ha(self.year[y][g]) for g in GROUPS}} for y in YEARS],
            "soyYears": [{"years": n, "fields": self.soy_years.get(n, 0)} for n in range(1, len(YEARS) + 1)],
            "states": sorted(({"state": st, "name": STATE_NAME.get(st, st), "fields": v[0], "ha": ha(v[1])} for st, v in self.state.items()), key=lambda r: -r["ha"]),
            "topCounties": [{"county": k[0], "state": k[1], "fields": v[0], "ha": ha(v[1])} for k, v in sorted(self.county.items(), key=lambda kv: -kv[1][1])[:10]],
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    args = ap.parse_args()
    wgs = arcpy.SpatialReference(4326)

    # Plants + their buffer polygons (already WGS84 in the delivery).
    plants = []
    with arcpy.da.SearchCursor(os.path.join(args.src, "Buffer_Crushing_Plant.shp"),
                               ["Field2", "Address", "State", "BUFF_DIST", "SHAPE@", "SHAPE@TRUECENTROID"],
                               spatial_reference=wgs) as cur:
        for name, address, state, dist, geom, (cx, cy) in cur:
            if abs((dist or 0) - BUFFER_MILES) > 1e-6:
                sys.exit(f"unexpected buffer distance {dist} for {name}")
            plants.append({"id": slug(name), "name": name, "address": (address or "").replace(", Estados Unidos", ", United States"),
                           "state": state, "lat": round(cy, 6), "lon": round(cx, 6), "geom": geom})
    print(f"[prepare-adm-soy] {len(plants)} plants: {', '.join(p['name'] for p in plants)}")

    per_plant = {p["id"]: [] for p in plants}
    per_stats = {p["id"]: Stats() for p in plants}
    overall = Stats()
    codes_seen = set()
    edge_checks = 0
    orphans = 0
    fields_path = os.path.join(args.src, "SOY_Crushingplant.shp")
    flds = ["CSBID", "CSBACRES", "CNTY", "STATEFIPS"] + [f"CDL{y}" for y in YEARS]
    with arcpy.da.SearchCursor(fields_path, flds + ["SHAPE@"], spatial_reference=wgs) as cur:
        for row in cur:
            geom = row[-1]
            if geom is None:
                continue
            c = geom.trueCentroid
            cdl = [int(v) if v is not None else None for v in row[4:4 + len(YEARS)]]
            codes_seen.update(v for v in cdl if v is not None)
            members = []
            for p in plants:
                d = haversine_km(c.Y, c.X, p["lat"], p["lon"])
                if d <= BUFFER_KM - 2:
                    members.append(p["id"])
                elif d <= BUFFER_KM + 5:
                    edge_checks += 1
                    if not geom.disjoint(p["geom"]):
                        members.append(p["id"])
            if not members:
                orphans += 1
                continue
            gi = round_geom(geom.__geo_interface__)
            if gi is None:
                continue
            st = STATE_ABBR.get(row[3], row[3])
            f = {"id": row[0], "acres": row[1] or 0.0, "county": row[2], "st": st, "cdl": cdl}
            feature = {"type": "Feature", "geometry": gi, "properties": {
                "id": f["id"], "ha": round(f["acres"] * AC_TO_HA, 2), "county": f["county"], "st": st,
                "cdl": ",".join("" if v is None else str(v) for v in cdl),
                "soyYears": sum(1 for v in cdl if v in SOY),
            }}
            for pid in members:
                per_plant[pid].append(feature)
                per_stats[pid].add(f)
            overall.add(f)
    print(f"[prepare-adm-soy] {overall.fields} fields; {edge_checks} edge polygon checks; {orphans} outside every buffer (skipped)")

    os.makedirs(os.path.join(OUT_DIR, "fields"), exist_ok=True)
    for name in os.listdir(os.path.join(OUT_DIR, "fields")):
        if name.endswith(".geojson"):
            os.remove(os.path.join(OUT_DIR, "fields", name))
    for p in plants:
        feats = per_plant[p["id"]]
        parts, cur_part, size = [], [], 0
        for ft in feats:
            s = len(json.dumps(ft, separators=(",", ":")))
            if cur_part and size + s > PART_BYTES:
                parts.append(cur_part)
                cur_part, size = [], 0
            cur_part.append(ft)
            size += s
        if cur_part:
            parts.append(cur_part)
        for i, chunk in enumerate(parts):
            fname = f"{p['id']}.geojson" if i == 0 else f"{p['id']}.part{i + 1}.geojson"
            with open(os.path.join(OUT_DIR, "fields", fname), "w", encoding="utf-8") as fh:
                json.dump({"type": "FeatureCollection", "features": chunk}, fh, separators=(",", ":"))
        print(f"[prepare-adm-soy] {p['name']}: {len(feats)} fields in {len(parts)} file(s)")

    buffers = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"plant": p["id"]}, "geometry": round_geom(p["geom"].__geo_interface__)} for p in plants
    ]}
    out = {
        "source": "USDA NASS Crop Sequence Boundaries 2018-2025 (fields planted with soybeans in 2025), delivered by ADM",
        "bufferMiles": BUFFER_MILES,
        "years": YEARS,
        "plants": [{k: v for k, v in p.items() if k != "geom"} | {"stats": per_stats[p["id"]].to_json()} for p in plants],
        "overall": overall.to_json(),
        "buffers": buffers,
        "cdlNames": {str(c): CDL_NAMES.get(c, f"CDL code {c}") for c in sorted(codes_seen)},
    }
    with open(os.path.join(OUT_DIR, "soy.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    unknown = sorted(c for c in codes_seen if c not in CDL_NAMES)
    print(f"[prepare-adm-soy] soy.json written ({os.path.getsize(os.path.join(OUT_DIR, 'soy.json')) // 1024} KB); unnamed CDL codes: {unknown}")


if __name__ == "__main__":
    main()
