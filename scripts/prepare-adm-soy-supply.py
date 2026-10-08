"""
Offline admin step for SoyTrace's supply-chain and rail & river views (tenant
`adm-soy`), from the client's ADM_Facilities.gdb (delivered 7 Oct 2026):

  ADM_Crushing_4Sites (+ _Buffer_40NM / _80NM)   4 crushing plants (Quincy,
                                   Decatur West, Lincoln, Des Moines) and their
                                   40 / 80 NM catchments
  ADM_Facilities_Elevators (+ _Buffer_20NM)      50 ADM elevators, 20 NM each
  ThirdParty_Facilities (+ _Buffer_20NM)         98 third-party elevators, 20 NM
  Soy_ADM_Crushing_4Sites_Buffer_40NM/_80NM,
  Soy_ADM_Facilities_Elevators_Buffer_20NM,
  Soy_ThirdParty_Facilities_Buffer_20NM          2025 soybean fields (USDA Crop
                                   Sequence Boundaries 2018–2025) per tier,
                                   single and double crop (CDL 5, 26, 239, 240,
                                   241, 254)
  Non_Compliant_Polygon + Point_Non_Compliant    ADM's non-compliant fields (the
                                   polygons carry no CSBID: joined to the points
                                   by their Longitude/Latitude; crops as names)
  Nola_Terminal                    the export terminal (Port Sulphur, LA)
  Railway (FRA, whole US), River (one connected polygon: the main river system)

The client has not said which plant each elevator or third party delivers to,
so they form one network beside the plants and are not tied to any of them.

Output (private-data/tenants/adm-soy/):
  supply.json                 plants, facilities, catchment statistics,
                              non-compliant summary, rail & river proximity,
                              density grid — bundled, read by the workspace
  fields/units/<id>.geojson   the fields of one catchment, like PalmTrace's
                              plot file per mill: <p>40 (0–40 NM) and <p>80r
                              (the 40–80 NM ring; 0–80 NM = both) per plant
                              (p = q Quincy, dw Decatur West, ln Lincoln, dm Des
                              Moines), adm<n> (one per ADM elevator site),
                              tp<n> (each third party); each field lists every
                              catchment it's in ("k")
  fields/noncomply.geojson    non-compliant fields at their true shape
  fields/tract/<facility>.part<n>.geojson
                              TRACT / TRACES-ready compliant fields per facility
                              (<p>40, <p>80, adm<n>, tp<n>): the original USDA
                              outlines at 6 decimals, CRS84, counter-clockwise
                              rings, ≤ ~40 MB a part; what TRACT rejects is
                              repaired (invalid made valid, holes filled,
                              touching parts merged — user, 8 Oct 2026)
  layers/rail.geojson, layers/rivers.geojson, layers/corridors.geojson
                              (5- and 10-mile bands), layers/grid.json
                              (finer soybean density grids)
fields/ and layers/ go to the soy R2 bucket (under v2/):
  node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs --v2

Definitions (stated in the app too):
  - Catchments are the client's own buffers, in nautical miles: plants 40 and
    80 NM (74.08 / 148.16 km), every elevator 20 NM (37.04 km).
  - A field is in a catchment when its outline touches ADM's buffer polygon
    for that facility, taken from the client's layer for that tier.
  - Compliant = every delivered soybean field that is not on ADM's
    non-compliant list.
  - Distances run from a field's centroid to the nearest active rail line
    (railusage M/O; X is shown but left out) and to the main river system.

Run with the system Python (fiona, shapely 2, pyproj, numpy):
  python scripts/prepare-adm-soy-supply.py
"""
import collections
import json
import math
import os
import re
import time

import fiona
import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely import STRtree
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GDB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Data Baru", "ADM_Facilities.gdb")
OUT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
# Working projection: the fields' own (USGS CONUS Albers, NAD83, latitude of
# origin 23°); everything else is reprojected into it.
WORK = CRS.from_proj4("+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs")
GRID_DEG = 0.2
GRID_LEVELS = [(0.1, 6.5), (0.05, 7.5), (0.025, 8.5)]
M_PER_MI = 1609.344
AC_TO_HA = 0.40468564224
BANDS_MI = [5, 10, 20]
# Field / non-compliant membership bits (mirrored in src/lib/soy-supply.ts):
# any plant 0–40 NM, any plant 0–80 NM, any ADM elevator, any third party,
# (unused: the old 6-state third parties), also on the non-compliant list,
# double crop in 2025.
FLAG_Q40, FLAG_Q80, FLAG_ADM, FLAG_TP, FLAG_CORE, FLAG_DUAL, FLAG_DC = 1, 2, 4, 8, 16, 32, 64
# Plant city in the gdb (Field2) → id, unit key prefix (unit ids: q40, q80r, q80, dw40…).
PLANTS = [("Quincy", "quincy", "q"), ("Decatur (West)", "decatur-west", "dw"), ("Lincoln", "lincoln", "ln"), ("Des Moines", "des-moines", "dm")]
FIPS = {
    "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
    "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
}  # fmt: skip
STATE_NAMES = {
    "Alabama": "AL", "Arkansas": "AR", "Delaware": "DE", "Georgia": "GA", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maryland": "MD", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Nebraska": "NE", "New Jersey": "NJ", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Pennsylvania": "PA", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Virginia": "VA", "West Virginia": "WV", "Wisconsin": "WI", "Ontario": "ON",
}  # fmt: skip
SOY = {5, 26, 239, 240, 241, 254}
CORN = {1, 12, 13, 225, 226, 228, 237}
GRASS = {36, 37, 58, 59, 60, 62, 176, 224}
NON_CROP = {63, 64, 65, 81, 82, 83, 87, 88, 92, 111, 112, 121, 122, 123, 124, 131, 141, 142, 143, 152, 190, 195}
TREED = {63, 141, 142, 143, 190}
NATURAL = TREED | {64, 152, 176, 195, 62}
DEVELOPED = {111, 121, 122, 123, 124, 131}
YEARS = list(range(2018, 2026))
GROUPS = ["soy", "corn", "other", "grass", "fallow", "noncrop"]
# USDA CDL names missing from soy.json's table (the non-compliant layers name crops instead of coding them).
CDL_EXTRA = {
    "Cotton": 2, "Peanuts": 10, "Tobacco": 11, "Canola": 31, "Rape Seed": 34, "Sweet Potatoes": 46, "Pecans": 74,
    "Grass/Pasture": 176, "Broccoli": 214, "Dbl Crop Barley/Corn": 237, "Blueberries": 242,
}  # fmt: skip

to_wgs = Transformer.from_crs(WORK, "EPSG:4326", always_xy=True)


def wgs(geoms, dp=5):
    def fn(xy):
        x, y = to_wgs.transform(xy[:, 0], xy[:, 1])
        return np.round(np.column_stack([x, y]), dp)
    return shapely.transform(geoms, fn)


def extent_of(change, acres):
    """How much of a non-compliant field changed: whole (≥90%), most (≥50%) or part."""
    if change is None or not acres:
        return None
    share = change / acres
    return "whole" if share >= 0.9 else ("most" if share >= 0.5 else "part")


def use_of(code):
    """2025 land use of a field: crop (incl. soybeans), pasture/hay/grass, or not agricultural."""
    if code is None:
        return None
    g = group_of(code)
    return "pasture" if g == "grass" else ("nonag" if g == "noncrop" else "crop")


def group_of(code):
    if code is None:
        return "noncrop"
    if code in SOY:
        return "soy"
    if code in CORN:
        return "corn"
    if code in GRASS:
        return "grass"
    if code == 61:
        return "fallow"
    if code in NON_CROP:
        return "noncrop"
    return "other"


def clean(s):
    return " ".join(str(s).split()) if s is not None and str(s).strip() else None


def state_abbr(s):
    s = clean(s)
    return STATE_NAMES.get(s or "", s)


def owner_props(o):
    """Owner name, mailing address and previous owner of a non-compliant field."""
    if not o:
        return {}
    st = state_abbr(o.get("ST"))
    addr = ", ".join(x for x in (clean(o.get("Address")), clean(o.get("City")),
                                 " ".join(x for x in (st, clean(o.get("Zip"))) if x)) if x)
    out = {"on": clean(o.get("Name")), "oa": addr or None, "pv": clean(o.get("Previous_Owner"))}
    return {k: v for k, v in out.items() if v}


# Typos in delivered place names (Feedback 5, 8 Oct 2026).
COUNTY_FIXES = {"Permiscot": "Pemiscot"}
CITY_FIXES = {"Norforlk": "Norfolk", "Mitchel": "Mitchell"}


def tp_city(code):
    """City from a third party's facility code: "ST-CHS-Morris-East-IL" → "Morris East"."""
    parts = [x.strip() for x in (code or "").split("-")]
    if len(parts) < 4:
        return None
    city = " ".join(parts[2:-1])
    return CITY_FIXES.get(city, city) or None


_COUNTIES = None


def county_at(lon, lat):
    """The county a point is in (US Census cb_2024 layer, made by prepare-soy-boundaries.py)."""
    global _COUNTIES
    if _COUNTIES is None:
        p = os.path.join(OUT, "layers", "counties.geojson")
        feats = json.load(open(p, encoding="utf-8"))["features"] if os.path.exists(p) else []
        _COUNTIES = [(shape(f["geometry"]), f["properties"]) for f in feats]
    pt = shapely.Point(lon, lat)
    for g, pr in _COUNTIES:
        if g.contains(pt):
            return f"{pr['n']} {'Parish' if pr['s'] == 'LA' else 'County'}"
    return None


def county_name(county, st):
    c = clean(county)
    if not c:
        return None
    c = COUNTY_FIXES.get(c, c)
    # Louisiana has parishes; the delivered list names most of them so, not all.
    if st == "LA" and not c.endswith("Parish"):
        c += " Parish"
    return c


# Typos in the delivered names (Feedback 4, 8 Oct 2026); the delivered name stays in "nameAsDelivered".
NAME_FIXES = {"St. Lousi": "St. Louis", "Mt. Aubrun": "Mt. Auburn", "GRAIN CO.": "Grain Co."}


def tidy_name(name):
    """Fixed typos, one casing for "ADM Grain Co.", one spacing around dashes."""
    s = clean(name) or ""
    for bad, good in NAME_FIXES.items():
        s = s.replace(bad, good)
    s = re.sub(r"\s+-\s*|\s*-\s+", " - ", s)  # "Illinois- Morris" → "Illinois - Morris"; "Agris-Industries" stays
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s or None


def city_of(name):
    """"ADM Northern Illinois - Ottawa North (DCX)" → "Ottawa North"."""
    s = clean(name) or ""
    s = re.sub(r"^ADM\s+(Grain\s+(Co\.?|Inc)?\s*|GRAIN CO\.?\s*|Northern Illinois\s*|Agris-Industries ltd\.\s*)?", "", s, flags=re.I)
    s = re.sub(r"^[-\s]+", "", s)
    s = re.sub(r"\s*\((Elevator[^)]*|DCX)\)\s*$", "", s)
    s = re.sub(r"[,\s]+[A-Z]{2}$", "", s)
    return s.strip() or None


def log(msg, t0=[time.time()]):
    print(f"[soy-supply {time.time() - t0[0]:6.0f}s] {msg}", flush=True)


def read(layer, geom=True):
    rows, geoms = [], []
    with fiona.open(GDB, layer=layer) as src:
        tr = None
        if geom and not CRS.from_wkt(src.crs_wkt).equals(WORK, ignore_axis_order=True):
            tr = Transformer.from_crs(CRS.from_wkt(src.crs_wkt), WORK, always_xy=True)
        for f in src:
            rows.append(dict(f["properties"]))
            if geom:
                g = shapely.force_2d(shape(f["geometry"]))
                if tr is not None:
                    g = shapely.transform(g, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))
                geoms.append(g)
    return rows, (np.array(geoms, dtype=object) if geom else None)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    return os.path.getsize(path)


def fc_text(geojson_strings, props):
    feats = [f'{{"type":"Feature","geometry":{g},"properties":{json.dumps(p, separators=(",", ":"), ensure_ascii=False)}}}'
             for g, p in zip(geojson_strings, props)]
    return '{"type":"FeatureCollection","features":[' + ",".join(feats) + "]}"


def write_fc(path, geoms_wgs, props):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(fc_text(shapely.to_geojson(geoms_wgs), props))
    return os.path.getsize(path)


def tiles_of(geom, size):
    """A large polygon cut into size×size pieces, so nearest-distance queries stay fast."""
    x0, y0, x1, y1 = geom.bounds
    boxes = [shapely.box(x, y, x + size, y + size) for x in np.arange(x0, x1, size) for y in np.arange(y0, y1, size)]
    boxes = np.array(boxes, dtype=object)
    boxes = boxes[shapely.intersects(boxes, geom)]
    parts = shapely.intersection(boxes, geom)
    return parts[~shapely.is_empty(parts)]


def main():
    # ---------------------------------------------------------------- network
    log("rail & rivers")
    rail_rows, rail_g = read("Railway")
    usage = np.array([r["railusage"] for r in rail_rows])
    active = np.isin(usage, ["M", "O"])
    rail_active = shapely.simplify(rail_g[active], 25)
    rail_tree = STRtree(rail_active)

    _, riv_g = read("River")
    river = shapely.make_valid(shapely.union_all(riv_g))
    river_km2 = shapely.area(river) / 1e6
    river_pieces = tiles_of(shapely.make_valid(shapely.simplify(river, 25, preserve_topology=True)), 20000)
    river_tree = STRtree(river_pieces)
    log(f"main river system: {river_km2:,.0f} km² ({len(river_pieces)} pieces for distances)")

    def near(points):
        points = np.asarray(points, dtype=object)
        out = []
        for tree in (rail_tree, river_tree):
            (inp, _), dist = tree.query_nearest(points, return_distance=True, all_matches=False)
            d = np.full(len(points), np.nan)
            d[inp] = dist
            out.append(d / M_PER_MI)
        return out[0], out[1]

    # ------------------------------------------------------------- facilities
    log("facilities")
    plant_rows, plant_g = read("ADM_Crushing_4Sites")
    b40_rows, b40_g = read("ADM_Crushing_4Sites_Buffer_40NM")
    b80_rows, b80_g = read("ADM_Crushing_4Sites_Buffer_80NM")
    plant_rd, plant_vd = near(plant_g)
    plant_ll = wgs(plant_g)
    by_city = {clean(r["Field2"]): i for i, r in enumerate(plant_rows)}
    b40_by = {clean(r["Field2"]): g for r, g in zip(b40_rows, b40_g)}
    b80_by = {clean(r["Field2"]): g for r, g in zip(b80_rows, b80_g)}
    plants = []
    for city, pid, key in PLANTS:
        i = by_city[city]
        r = plant_rows[i]
        x, y = shapely.get_coordinates(plant_ll[i])[0]
        r40 = float(next(b["BUFF_DIST"] for b in b40_rows if clean(b["Field2"]) == city))
        r80 = float(next(b["BUFF_DIST"] for b in b80_rows if clean(b["Field2"]) == city))
        plants.append({
            "id": pid, "key": key, "name": f"{clean(r['Buyer'])} {city.replace(' (West)', ' West')}", "company": clean(r["Buyer"]),
            "city": city.replace(" (West)", " West"), "state": state_abbr(r["State"]), "county": county_at(x, y),
            "address": clean(re.sub(r",\s*Estados Unidos$", "", r["Address"] or "")),
            "lat": round(y, 5), "lon": round(x, 5), "f50": clean(r["F50"]), "f100": clean(r["F100"]),
            "railMi": round(float(plant_rd[i]), 2), "riverMi": round(float(plant_vd[i]), 2),
            "rings": [{"id": f"{key}40", "nm": 40, "radiusM": r40}, {"id": f"{key}80", "nm": 80, "radiusM": r80}],
            "_xy": shapely.get_coordinates(plant_g[i])[0], "_b40": b40_by[city], "_b80": b80_by[city],
        })

    adm_rows, adm_g = read("ADM_Facilities_Elevators")
    adm_buf_rows, adm_buf_g = read("ADM_Facilities_Elevators_Buffer_20NM")
    tp_rows, tp_g = read("ThirdParty_Facilities")
    tp_buf_rows, tp_buf_g = read("ThirdParty_Facilities_Buffer_20NM")
    R20 = float(adm_buf_rows[0]["BUFF_DIST"])
    R_TP = float(tp_buf_rows[0]["BUFF_DIST"])
    delivered = {
        "plant40": {"m": plants[0]["rings"][0]["radiusM"], "unit": "NM"},
        "plant80": {"m": plants[0]["rings"][1]["radiusM"], "unit": "NM"},
        "adm": {"m": R20, "unit": "NM"},
        "tp": {"m": R_TP, "unit": "NM"},
    }
    adm_rd, adm_vd = near(adm_g)
    tp_rd, tp_vd = near(tp_g)
    adm_ll = wgs(adm_g)
    tp_ll = wgs(tp_g)

    # Every delivered point is its own facility with its own catchment — also
    # Evansville's three (an elevator and two grain terminals at separate
    # addresses), as the user asked on 8 Oct 2026 (not merged into one site).
    adm = []
    for i, r in enumerate(adm_rows):
        x, y = shapely.get_coordinates(adm_ll[i])[0]
        delivered_name = clean(r["Facility_Name"])
        name = tidy_name(delivered_name) or f"ADM elevator {i + 1}"
        adm.append({
            "id": f"adm{i + 1}", "name": name, **({"nameAsDelivered": delivered_name} if delivered_name != name else {}),
            "code": clean(r["STACT_Naming_Convention"]), "city": city_of(name),
            "county": clean(r["County"]), "state": state_abbr(r["State"]), "address": clean(r["Address"]),
            "type": clean(r["Type_of_facility"]), "lat": round(y, 5), "lon": round(x, 5),
            "radiusM": R20, "site": f"adm{i + 1}",
            "railMi": round(float(adm_rd[i]), 2), "riverMi": round(float(adm_vd[i]), 2),
        })
    # The state a point really lies in (Feedback 5: "LDC · Porter, KY" sits at Burns Harbor, Indiana).
    st_rows, st_g = read("State_Boundary")
    st_tree = STRtree(st_g)

    def state_at(pt):
        hit = st_tree.query(pt, predicate="within")
        return (st_rows[hit[0]]["shapeISO"] or "")[-2:] if len(hit) else None

    tp = []
    for i, r in enumerate(tp_rows):
        x, y = shapely.get_coordinates(tp_ll[i])[0]
        delivered_st = clean(r["State"])
        st = state_at(tp_g[i]) or delivered_st
        e = {
            "id": f"tp{i + 1}", "ref": f"TP-{i + 1:02d}", "tract": clean(r["TRACT_Naming_Convention"]), "company": clean(r["Company_Name"]),
            "city": tp_city(r["TRACT_Naming_Convention"]), "county": county_name(r["County"], st), "state": st,
            "type": clean(r["Type_of_facility"]),
            "lat": round(y, 5), "lon": round(x, 5), "radiusM": R_TP, "core": False,
            "railMi": round(float(tp_rd[i]), 2), "riverMi": round(float(tp_vd[i]), 2),
        }
        if st != delivered_st:
            e["stateAsDelivered"] = delivered_st
            log(f"  {e['id']} {e['company']} {e['city']}: state {delivered_st} as delivered, {st} by its coordinates")
        tp.append(e)
    # Third parties delivered at exactly the same point (12 at 5 places, e.g. CGB / LDC / Cofco at
    # Cahokia): identical catchments and figures, kept as delivered and marked "same location as".
    at = collections.defaultdict(list)
    for e in tp:
        at[(e["lat"], e["lon"])].append(e["id"])
    for e in tp:
        others = [x for x in at[(e["lat"], e["lon"])] if x != e["id"]]
        if others:
            e["sameAs"] = others
    nola_rows, nola_g = read("Nola_Terminal")
    terminals = []
    for r, g in zip(nola_rows, wgs(nola_g)):
        x, y = shapely.get_coordinates(g)[0]
        terminals.append({"name": clean(r["Name"]), "address": clean(r["Snippet"]), "lat": round(y, 5), "lon": round(x, 5)})

    # ------------------------------------------------------- non-compliant ids
    nc_pt_rows, nc_pt_g = read("Point_Non_Compliant")
    nc_ids = {str(r["CSBID"]) for r in nc_pt_rows}

    # ----------------------------------------------------------------- fields
    POOLS = [("Soy_ADM_Crushing_4Sites_Buffer_40NM", 1), ("Soy_ADM_Crushing_4Sites_Buffer_80NM", 2),
             ("Soy_ADM_Facilities_Elevators_Buffer_20NM", 4), ("Soy_ThirdParty_Facilities_Buffer_20NM", 8)]
    idx = {}
    geoms, rows_out = [], []
    on_nc_list = 0
    for layer, bit in POOLS:
        log(f"reading {layer}")
        with fiona.open(GDB, layer=layer) as src:
            for f in src:
                p = f["properties"]
                cid = str(p["CSBID"])
                if cid in nc_ids:
                    on_nc_list += 1
                    continue
                k = idx.get(cid)
                if k is None:
                    idx[cid] = len(rows_out)
                    cdl = [p[f"CDL{y}"] for y in YEARS]
                    rows_out.append({
                        "id": cid, "acres": float(p["CSBACRES"] or 0), "pool": bit, "cdl": cdl,
                        "st": FIPS.get(p["STATEFIPS"], p["STATEFIPS"]), "county": clean(p["CNTY"]),
                    })
                    geoms.append(shapely.force_2d(shape(f["geometry"])))
                else:
                    rows_out[k]["pool"] |= bit
    geoms = np.array(geoms, dtype=object)
    n_all = len(rows_out)
    pool = np.array([r["pool"] for r in rows_out])
    double = np.array([r["cdl"][-1] != 5 for r in rows_out])
    log(f"distinct compliant fields delivered: {n_all:,} ({double.sum():,} double crop; {on_nc_list} rows on the non-compliant list left out)")

    log("catchment membership (ADM's buffer polygons)")
    tree = STRtree(geoms)

    def nearest_buffer(center_xy, bufs):
        cents = shapely.get_coordinates(shapely.centroid(bufs))
        d = np.hypot(*(cents - center_xy).T)
        i = int(np.argmin(d))
        if d[i] > 2000:
            log(f"  no delivered buffer within 2 km of {center_xy} (nearest {d[i]:.0f} m)")
        return bufs[i]

    def touching(area, pool_bits):
        ix = tree.query(area, predicate="intersects")
        return np.sort(ix[(pool[ix] & pool_bits) != 0])

    units = {}
    unit_sets = {}
    direct_units = []
    plant_members = {}
    in_q40 = np.zeros(n_all, bool)
    in_q80 = np.zeros(n_all, bool)
    for pl in plants:
        k = pl["key"]
        ix80 = touching(pl["_b80"], 3)
        ix40 = touching(pl["_b40"], 3)
        units[f"{k}40"] = ix40
        units[f"{k}80r"] = np.setdiff1d(ix80, ix40)
        unit_sets[f"{k}80"] = [f"{k}40", f"{k}80r"]
        direct_units += [f"{k}40", f"{k}80r", f"{k}80"]
        plant_members[pl["id"]] = (ix40, ix80)
        in_q40[ix40] = True
        in_q80[ix80] = True
        log(f"  {pl['name']}: 0–40 NM {len(ix40):,}, 0–80 NM {len(ix80):,}")
    adm_xy = shapely.get_coordinates(adm_g)
    tp_xy = shapely.get_coordinates(tp_g)
    adm_area = {e["id"]: nearest_buffer(adm_xy[i], adm_buf_g) for i, e in enumerate(adm) if e["radiusM"]}
    tp_area = {e["id"]: nearest_buffer(tp_xy[i], tp_buf_g) for i, e in enumerate(tp)}
    adm_members = {sid: touching(a, 4) for sid, a in adm_area.items()}
    tp_members = {sid: touching(a, 8) for sid, a in tp_area.items()}
    units.update(adm_members)
    units.update(tp_members)
    member_of = collections.defaultdict(list)
    for uid, ix in units.items():
        for k in ix:
            member_of[int(k)].append(uid)
    keep = np.array(sorted(member_of))
    log(f"fields in any catchment: {len(keep):,} of {n_all:,}")

    in_adm = np.zeros(n_all, bool)
    for ix in adm_members.values():
        in_adm[ix] = True
    in_tp = np.zeros(n_all, bool)
    for ix in tp_members.values():
        in_tp[ix] = True
    flags = (in_q40 * FLAG_Q40) | (in_q80 * FLAG_Q80) | (in_adm * FLAG_ADM) | (in_tp * FLAG_TP) | (double * FLAG_DC)

    log("distances to rail / rivers")
    cent = shapely.point_on_surface(geoms)
    rail_mi = np.full(n_all, np.nan)
    river_mi = np.full(n_all, np.nan)
    rail_mi[keep], river_mi[keep] = near(cent[keep])

    # ----------------------------------------------------------- non-compliant
    log("non-compliant")
    nc_poly_rows, nc_poly_g = read("Non_Compliant_Polygon")
    poly_by = {(round(r["Longitude"], 6), round(r["Latitude"], 6)): (r, g) for r, g in zip(nc_poly_rows, nc_poly_g)}
    with open(os.path.join(OUT, "soy.json"), encoding="utf-8") as fh:
        code_by_name = {v: int(k) for k, v in json.load(fh)["cdlNames"].items()}
    code_by_name.update(CDL_EXTRA)
    unknown_crops = collections.Counter()

    def code(name):
        n = clean(name)
        if n is None:
            return None
        c = code_by_name.get(n)
        if c is None:
            unknown_crops[n] += 1
        return c

    nc = []
    nc_geoms = []
    for r, g in zip(nc_pt_rows, nc_pt_g):
        hit = poly_by.get((round(r["Longitude"], 6), round(r["Latitude"], 6)))
        nc.append((str(r["CSBID"]), r, hit is None))
        nc_geoms.append(hit[1] if hit else g)
    if unknown_crops:
        log(f"  crop names without a CDL code: {dict(unknown_crops)}")
    nc_geoms = np.array(nc_geoms, dtype=object)
    log(f"  {len(nc)} non-compliant fields, {sum(1 for x in nc if x[2])} without an outline")
    nc_tree = STRtree(nc_geoms)

    def nc_touching(area):
        m = np.zeros(len(nc), bool)
        m[nc_tree.query(area, predicate="intersects")] = True
        return m

    nc_units = {}
    nc_q40 = np.zeros(len(nc), bool)
    nc_q80 = np.zeros(len(nc), bool)
    nc_plant = {}
    for pl in plants:
        k = pl["key"]
        m40, m80 = nc_touching(pl["_b40"]), nc_touching(pl["_b80"])
        nc_units[f"{k}40"] = m40
        nc_units[f"{k}80r"] = m80 & ~m40
        nc_plant[pl["id"]] = (m40, m80)
        nc_q40 |= m40
        nc_q80 |= m80
    for sid, a in adm_area.items():
        nc_units[sid] = nc_touching(a)
    for sid, a in tp_area.items():
        nc_units[sid] = nc_touching(a)
    nc_member = [[u for u, m in nc_units.items() if m[k]] for k in range(len(nc))]
    nc_adm = np.any([nc_units[sid] for sid in adm_area], axis=0)
    nc_tp = np.any([nc_units[sid] for sid in tp_area], axis=0)

    nc_rd, nc_vd = near(shapely.point_on_surface(nc_geoms))
    nc_props = []
    nc_info = []
    for k, (cid, pt, point_only) in enumerate(nc):
        cdl = [code(pt[f"CDL{y}"]) for y in YEARS]
        acres = float(pt["CSBACRES"] or 0)
        st = state_abbr(pt["State"])
        county = clean(pt["County"])
        early = [c for c in cdl[:3] if c is not None]
        before = "treed" if any(c in TREED for c in early) else ("natural" if any(c in NATURAL for c in early) else "crop")
        conv = next((y for y, c in zip(YEARS[3:], cdl[3:]) if c is not None and c not in NATURAL and c not in DEVELOPED), None)
        change = float(pt["Change_Acr"]) if pt.get("Change_Acr") is not None else None
        soy26 = clean(pt.get("Soy_2026"))
        f = (FLAG_Q40 if nc_q40[k] else 0) | (FLAG_Q80 if nc_q80[k] else 0) | (FLAG_ADM if nc_adm[k] else 0) | (FLAG_TP if nc_tp[k] else 0)
        ex = extent_of(change, acres)
        use = use_of(cdl[7])
        info = {"id": cid, "acres": acres, "change": change, "st": st, "county": county, "before": before,
                "conv": conv, "soy26": soy26, "flags": f, "pointOnly": point_only, "cdl": cdl, "extent": ex, "use": use}
        nc_info.append(info)
        nc_props.append({
            "id": cid, "a": round(acres, 1), "ch": None if change is None else round(change, 2), "s": st, "n": county,
            "c": ",".join("" if c is None else str(c) for c in cdl), "b": before, "y": conv, "s26": soy26,
            "c24": clean(pt["CDL2024"]), "c25": clean(pt["CDL2025"]), "f": f, "po": point_only, "k": "|".join(nc_member[k]),
            "sy": sum(1 for c in cdl if c in SOY),
            # Feedback 5 (P0-2): already cropland at field level in 2018–2020 — "to review"; ADM's status is unchanged.
            **({"rf": "cropped_pre_2021"} if before == "crop" else {}),
            "ex": ex, "u": use,
            **owner_props(pt),
            "r": None if math.isnan(nc_rd[k]) else round(float(nc_rd[k]), 1),
            "v": None if math.isnan(nc_vd[k]) else round(float(nc_vd[k]), 1),
        })

    # ----------------------------------------------------------- statistics
    log("statistics")
    acres_arr = np.array([r["acres"] for r in rows_out])
    soy_years = np.array([sum(1 for c in r["cdl"] if c in SOY) for r in rows_out])
    min_mi = np.fmin(rail_mi, river_mi)
    gidx = {g: i for i, g in enumerate(GROUPS)}
    group_arr = np.array([[gidx[group_of(c)] for c in r["cdl"]] for r in rows_out], dtype=np.int8)

    def field_stats(ix):
        ix = np.asarray(ix, dtype=int)
        acres = acres_arr[ix]
        hist = collections.Counter(soy_years[ix].tolist())
        crop = []
        for yi, y in enumerate(YEARS):
            sums = np.bincount(group_arr[ix, yi], weights=acres, minlength=len(GROUPS)) if len(ix) else np.zeros(len(GROUPS))
            crop.append({"year": y, **{g: round(float(sums[i]) * AC_TO_HA, 1) for i, g in enumerate(GROUPS)}})
        counties = collections.Counter()
        cfields = collections.Counter()
        states = collections.Counter()
        for k in ix:
            key = (rows_out[k]["county"] or "—", rows_out[k]["st"])
            counties[key] += rows_out[k]["acres"]
            cfields[key] += 1
            states[rows_out[k]["st"]] += rows_out[k]["acres"]
        corridor = {}
        for band in BANDS_MI:
            corridor[str(band)] = {
                "rail": round(float(acres[rail_mi[ix] <= band].sum()), 1),
                "river": round(float(acres[river_mi[ix] <= band].sum()), 1),
                "either": round(float(acres[min_mi[ix] <= band].sum()), 1),
                "both": round(float(acres[(rail_mi[ix] <= band) & (river_mi[ix] <= band)].sum()), 1),
            }
        dc = ix[double[ix]]
        return {
            "fields": int(len(ix)), "acres": round(float(acres.sum()), 1),
            "doubleCropFields": int(len(dc)), "doubleCropAcres": round(float(acres_arr[dc].sum()), 1),
            "soyYears": [{"years": y, "fields": hist.get(y, 0)} for y in range(1, 9)],
            "cropHistoryHa": crop,
            "topCounties": [{"county": c, "state": s, "fields": cfields[(c, s)], "acres": round(a2, 1)}
                            for (c, s), a2 in counties.most_common(6)],
            "states": [{"state": s, "acres": round(a2, 1)} for s, a2 in states.most_common()],
            # Rail and river now cover every field (national rail, the whole main river system).
            "coverageAcres": round(float(acres.sum()), 1), "coverageFields": int(len(ix)), "corridor": corridor,
        }

    def nc_stats(mask):
        ix = np.where(mask)[0]
        by_year = collections.Counter(nc_info[k]["conv"] for k in ix)
        by_before = collections.Counter(nc_info[k]["before"] for k in ix)
        by_state = collections.Counter(nc_info[k]["st"] for k in ix)
        by_extent = collections.Counter(nc_info[k]["extent"] or "unknown" for k in ix)
        by_use = collections.Counter(nc_info[k]["use"] or "unknown" for k in ix)
        return {
            "fields": int(len(ix)), "acres": round(sum(nc_info[k]["acres"] for k in ix), 1),
            "changeAcres": round(sum(nc_info[k]["change"] or 0 for k in ix), 1),
            "alsoCompliant": 0,
            "pointOnly": int(sum(1 for k in ix if nc_info[k]["pointOnly"])),
            "byYear": [{"year": y, "fields": by_year.get(y, 0)} for y in range(2021, 2026)],
            "unknownYear": int(by_year.get(None, 0)),
            "byBefore": {k2 or "unknown": v for k2, v in by_before.items()},
            "byState": [{"state": s, "fields": v} for s, v in by_state.most_common()],
            "byExtent": dict(by_extent), "byUse": dict(by_use),
        }

    catchments = []

    def add(cid, kind, name, ix, nc_mask, extra=None):
        catchments.append({"id": cid, "kind": kind, "name": name, **(extra or {}),
                           "compliant": field_stats(ix), "nonCompliant": nc_stats(nc_mask)})

    # Combinations (any plant ring, any set of ADM elevator sites and third
    # parties, each on its own): fields grouped by which catchments they are
    # in, so any union can be summed in the browser without counting a field
    # twice. More than 32 bits, so masks are hex strings (BigInt in the
    # browser). "tp" = any third party.
    sites = list(adm_area)
    tps = list(tp_area)
    order = [f"{pl['key']}{r}" for pl in plants for r in ("40", "80")] + sites + ["tp"] + tps
    combo_bits = {cid: i for i, cid in enumerate(order)}
    fmask = np.zeros(n_all, dtype=object)
    fmask[:] = 0
    for pl in plants:
        ix40, ix80 = plant_members[pl["id"]]
        for ix, cid in ((ix40, f"{pl['key']}40"), (ix80, f"{pl['key']}80")):
            for k in ix:
                fmask[k] |= 1 << combo_bits[cid]
    for sid in sites:
        for k in adm_members[sid]:
            fmask[k] |= 1 << combo_bits[sid]
    for k in np.where(in_tp)[0]:
        fmask[k] |= 1 << combo_bits["tp"]
    for tid in tps:
        for k in tp_members[tid]:
            fmask[k] |= 1 << combo_bits[tid]
    soy8 = soy_years == 8
    combo_fields = collections.defaultdict(lambda: [0, 0.0, 0.0, 0])
    for k in keep:
        row = combo_fields[int(fmask[k])]
        row[0] += 1
        row[1] += acres_arr[k]
        if min_mi[k] <= 10:
            row[2] += acres_arr[k]
        row[3] += int(soy8[k])
    nmask = [0] * len(nc)
    for pl in plants:
        m40, m80 = nc_plant[pl["id"]]
        for m, cid in ((m40, f"{pl['key']}40"), (m80, f"{pl['key']}80")):
            for k in np.where(m)[0]:
                nmask[k] |= 1 << combo_bits[cid]
    for sid in sites:
        for k in np.where(nc_units[sid])[0]:
            nmask[k] |= 1 << combo_bits[sid]
    for k in np.where(nc_tp)[0]:
        nmask[k] |= 1 << combo_bits["tp"]
    for tid in tps:
        for k in np.where(nc_units[tid])[0]:
            nmask[k] |= 1 << combo_bits[tid]
    combo_nc = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for k, m in enumerate(nmask):
        if not m:
            continue
        row = combo_nc[m]
        row[0] += 1
        row[1] += nc_info[k]["acres"]
        row[2] += nc_info[k]["change"] or 0
    combos = {
        "bits": combo_bits,
        # [hex mask, fields, acres, acres within 10 mi of rail or river, fields with soybeans all 8 seasons]
        "fields": [[format(m, "x"), v[0], round(v[1], 1), round(v[2], 1), v[3]] for m, v in sorted(combo_fields.items())],
        # [hex mask, fields, field acres, changed acres]
        "nc": [[format(m, "x"), v[0], round(v[1], 1), round(v[2], 1)] for m, v in sorted(combo_nc.items())],
    }
    log(f"combinations: {len(combos['fields'])} field groups, {len(combos['nc'])} non-compliant groups")

    nc_any = nc_q80 | nc_adm | nc_tp
    add("all", "tier", "ADM soybean supply chain", keep, nc_any)
    add("direct", "tier", "Crushing plants (80 NM)", np.where(in_q80)[0], nc_q80)
    add("adm", "tier", "ADM elevators", np.where(in_adm)[0], nc_adm)
    add("tp", "tier", "Third-party elevators", np.where(in_tp)[0], nc_tp)
    for pl in plants:
        k = pl["key"]
        ix40, ix80 = plant_members[pl["id"]]
        m40, m80 = nc_plant[pl["id"]]
        r40, r80 = pl["rings"][0]["radiusM"], pl["rings"][1]["radiusM"]
        extra = {"plant": pl["id"]}
        add(f"{k}40", "plant", f"{pl['name']} 0–40 NM", ix40, m40, {**extra, "radiusM": r40})
        add(f"{k}80r", "plant", f"{pl['name']} 40–80 NM", np.setdiff1d(ix80, ix40), m80 & ~m40, {**extra, "radiusM": r80})
        add(f"{k}80", "plant", f"{pl['name']} 0–80 NM", ix80, m80, {**extra, "radiusM": r80})
    for e in adm:
        if e["radiusM"]:
            add(e["id"], "adm", e["name"], adm_members[e["id"]], nc_units[e["id"]])
    for e in tp:
        add(e["id"], "tp", e["tract"] or e["company"] or e["id"], tp_members[e["id"]], nc_units[e["id"]])
    log(f"{len(catchments)} catchments")

    ll = shapely.get_coordinates(wgs(cent, 4))
    kk = keep
    w = acres_arr[kk]

    def grid_for(deg):
        gx = np.floor(ll[kk, 0] / deg).astype(np.int64)
        gy = np.floor(ll[kk, 1] / deg).astype(np.int64)
        uniq, inv = np.unique((gx + 100000) * 1000000 + (gy + 100000), return_inverse=True)
        ones = np.ones(len(kk), bool)
        sums = [np.bincount(inv, weights=w * m, minlength=len(uniq)) for m in (
            ones, ones, rail_mi[kk] <= 10, river_mi[kk] <= 10, min_mi[kk] <= 10)]
        ux = uniq // 1000000 - 100000
        uy = uniq % 1000000 - 100000
        cell_km2 = (deg * 111.32) ** 2 * np.cos(np.radians((uy + 0.5) * deg))
        share = sums[0] * 0.00404686 / cell_km2 * 100
        return [[int(x), int(y), *[int(round(v[i])) for v in sums], round(float(share[i]), 1)] for i, (x, y) in enumerate(zip(ux, uy))]

    grid_rows = grid_for(GRID_DEG)
    grid_levels = []
    for deg, zoom in GRID_LEVELS:
        rows = grid_for(deg)
        grid_levels.append({"deg": deg, "minZoom": zoom, "rows": rows})
        log(f"  grid {deg}°: {len(rows):,} cells")

    # ------------------------------------------------------------ unit files
    log("writing catchment field files")
    fields_dir = os.path.join(OUT, "fields")
    for old in ("cells", "units"):
        d = os.path.join(fields_dir, old)
        if os.path.isdir(d):
            for f in os.listdir(d):
                os.remove(os.path.join(d, f))
            os.rmdir(d)
    units_dir = os.path.join(fields_dir, "units")
    os.makedirs(units_dir, exist_ok=True)
    simple = shapely.simplify(geoms[keep], 12, preserve_topology=True)
    simple_ll = np.empty(n_all, dtype=object)
    simple_ll[keep] = wgs(simple)
    unit_index = []
    total_bytes = 0
    for uid, ix in units.items():
        props = []
        for k in ix:
            r = rows_out[k]
            props.append({
                "id": r["id"], "a": round(r["acres"], 1), "y": int(soy_years[k]),
                "c": ",".join("" if c is None else str(c) for c in r["cdl"]), "f": int(flags[k]),
                "k": "|".join(member_of[int(k)]),
                "r": None if math.isnan(rail_mi[k]) else round(float(rail_mi[k]), 1),
                "v": None if math.isnan(river_mi[k]) else round(float(river_mi[k]), 1),
                "s": r["st"], "n": r["county"],
            })
        size = write_fc(os.path.join(units_dir, f"{uid}.geojson"), simple_ll[ix], props)
        total_bytes += size
        unit_index.append([uid, int(len(ix)), size])
    big = max(unit_index, key=lambda u: u[2])
    log(f"{len(unit_index)} unit files, {total_bytes / 1e6:,.1f} MB (largest {big[0]}: {big[1]:,} fields, {big[2] / 1e6:.1f} MB)")

    # ------------------------------------------------------------ TRACT files
    # Per facility, for upload to TRACT / TRACES. The user chose to repair what
    # TRACT would reject (8 Oct 2026, option c): invalid outlines made valid,
    # holes filled, touching parts merged; only what still fails is dropped.
    # Area (ha) is the repaired outline's own equal-area size.
    log("TRACT files (original outlines, 6 decimals)")
    tract_dir = os.path.join(fields_dir, "tract")
    if os.path.isdir(tract_dir):
        for f in os.listdir(tract_dir):
            os.remove(os.path.join(tract_dir, f))
    os.makedirs(tract_dir, exist_ok=True)
    with open(os.path.join(OUT, "soy.json"), encoding="utf-8") as fh:
        cdl_names = json.load(fh)["cdlNames"]
    exact = np.empty(n_all, dtype=object)
    exact_ha = np.zeros(n_all)
    ok = np.zeros(n_all, bool)
    reason = collections.Counter()
    from shapely.geometry.polygon import orient

    def polys_of(g):
        return [pp for pp in shapely.get_parts(g) if pp.geom_type == "Polygon" and not pp.is_empty and pp.area > 0] if g is not None else []

    def clean_albers(g):
        """Valid, no holes, touching parts merged (in metres, before rounding)."""
        if not shapely.is_valid(g):
            reason["repaired_invalid"] += 1
            g = shapely.make_valid(g)
        ps = polys_of(g)
        if any(len(pp.interiors) for pp in ps):
            reason["filled_holes"] += 1
        ps = [shapely.Polygon(pp.exterior) for pp in ps]
        if not ps:
            return None
        if len(ps) > 1:
            u = shapely.union_all(ps)
            if len(polys_of(u)) < len(ps):
                reason["merged_parts"] += 1
            ps = [shapely.Polygon(pp.exterior) for pp in polys_of(u)]
        return ps[0] if len(ps) == 1 else shapely.MultiPolygon(ps)

    for k in keep:
        g = clean_albers(geoms[k])
        if g is None:
            reason["dropped"] += 1
            continue
        w = wgs(g, 6)
        if not shapely.is_valid(w):
            # Rounding to 6 decimals can still pinch a ring: repair once more in degrees.
            ps = [shapely.Polygon(pp.exterior) for pp in polys_of(shapely.make_valid(w))]
            w = shapely.set_precision(ps[0] if len(ps) == 1 else shapely.MultiPolygon(ps), 1e-6) if ps else None
            if w is None or w.is_empty or not shapely.is_valid(w) or any(len(pp.interiors) for pp in polys_of(w)):
                reason["dropped"] += 1
                continue
            reason["repaired_after_rounding"] += 1
        parts = polys_of(w)
        exact[k] = orient(parts[0], 1.0) if len(parts) == 1 else shapely.MultiPolygon([orient(pp, 1.0) for pp in parts])
        exact_ha[k] = shapely.area(g) / 1e4
        ok[k] = True
    log(f"  TRACT-ready: {int(ok[keep].sum()):,} of {len(keep):,} fields; {dict(reason)}")
    geo_txt = np.empty(n_all, dtype=object)
    geo_txt[ok] = shapely.to_geojson(exact[ok])

    def base_props(k):
        r = rows_out[k]
        c25 = r["cdl"][-1]
        return {
            "PlotID": f"USA-CSB-{r['id']}", "CSBID": r["id"], "Area": round(float(exact_ha[k]), 4),
            "Acres": round(r["acres"], 2), "ProducerCountry": "US", "State": r["st"], "County": r["county"],
            "Crop2025": cdl_names.get(str(c25), str(c25)), "EUDR_Comply": "YES",
        }

    PART_BYTES = 40_000_000
    tract_index = {}

    def write_tract(fid, label, kind, radius_nm, ix):
        ix = [int(k) for k in ix if ok[k]]
        extra = {"Facility": label, "FacilityType": kind, "Radius_NM": radius_nm}
        head = '{"type":"FeatureCollection","name":' + json.dumps(label) + ',"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},"features":['
        parts, buf, size = [], [], len(head)
        for k in ix:
            feat = '{"type":"Feature","geometry":' + geo_txt[k] + ',"properties":' + json.dumps({**base_props(k), **extra}, separators=(",", ":"), ensure_ascii=False) + "}"
            if buf and size + len(feat) + 3 > PART_BYTES:
                parts.append(buf)
                buf, size = [], len(head)
            buf.append(feat)
            size += len(feat) + 1
        if buf or not parts:
            parts.append(buf)
        out = []
        for n, feats in enumerate(parts, 1):
            path = os.path.join(tract_dir, f"{fid}.part{n}.geojson")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(head + ",".join(feats) + "]}")
            out.append([n, len(feats), os.path.getsize(path)])
        tract_index[fid] = {"label": label, "kind": kind, "radiusNm": radius_nm, "fields": len(ix), "parts": out}

    for pl in plants:
        ix40, ix80 = plant_members[pl["id"]]
        write_tract(f"{pl['key']}40", f"{pl['name']} 0-40 NM", "crushing plant", 40, ix40)
        write_tract(f"{pl['key']}80", f"{pl['name']} 0-80 NM", "crushing plant", 80, ix80)
    for e in adm:
        write_tract(e["id"], e["name"], "ADM elevator", 20, adm_members[e["id"]])
    for e in tp:
        write_tract(e["id"], f"{e['company'] or e['id']} ({e['county']}, {e['state']})", "third-party facility", 20, tp_members[e["id"]])
    tb = sum(pp[2] for v in tract_index.values() for pp in v["parts"])
    log(f"  {sum(len(v['parts']) for v in tract_index.values())} TRACT files, {tb / 1e6:,.0f} MB")

    nc_simple = shapely.simplify(nc_geoms, 5, preserve_topology=True)
    nc_bytes = write_fc(os.path.join(OUT, "fields", "noncomply.geojson"), wgs(nc_simple, 6), nc_props)
    log(f"noncomply.geojson {nc_bytes / 1e6:.1f} MB")

    # ---------------------------------------------------------------- layers
    # Rail is national, and so is the map layer: clipped to 25 km of a catchment, lines ended in mid-air at the
    # edge of that zone (user, 8 Oct 2026). Loaded only when the layer is switched on (~25 MB, ~3 MB gzip).
    log("rail / river / corridor layers")
    region = shapely.buffer(shapely.union_all(np.concatenate([
        np.array([pl["_b80"] for pl in plants], dtype=object), np.array(list(adm_area.values()), dtype=object),
        np.array(list(tp_area.values()), dtype=object)])), 25000)
    in_region = shapely.intersects(rail_g, region)
    rail_rows_r = list(rail_rows)
    rail_rows_zone = [r for r, m in zip(rail_rows, in_region) if m]  # network figures stay those of the catchment zone
    rail_all = wgs(shapely.simplify(rail_g, 60), 4)
    rail_props = [{"u": r["railusage"], "n": clean(r["name"]), "d": clean(r["railsubdiv"])} for r in rail_rows_r]
    rb = write_fc(os.path.join(OUT, "layers", "rail.geojson"), rail_all, rail_props)
    # The river system is one huge polygon (thousands of holes): rounded to the
    # map's precision it turned invalid and MapLibre drew it as giant
    # triangles. Cut it into 50 km pieces, round, and repair each piece.
    riv_pieces = tiles_of(shapely.make_valid(shapely.simplify(river, 30, preserve_topology=True)), 50000)
    riv_ll = shapely.make_valid(shapely.set_precision(wgs(shapely.get_parts(riv_pieces), 6), 1e-5))
    riv_show = shapely.get_parts(riv_ll)
    riv_show = riv_show[(shapely.get_type_id(riv_show) == 3) & (shapely.area(riv_show) > 0)]
    log(f"  rivers: {len(riv_show):,} polygons, all valid: {bool(shapely.is_valid(riv_show).all())}")
    vb = write_fc(os.path.join(OUT, "layers", "rivers.geojson"), riv_show, [{"m": True, "t": 460}] * len(riv_show))
    log(f"rail.geojson {rb / 1e6:.1f} MB ({len(rail_rows_r):,} lines), rivers.geojson {vb / 1e6:.1f} MB")

    rail_region = rail_active[shapely.intersects(rail_active, region)]
    rail_parts = shapely.get_parts(shapely.line_merge(shapely.union_all(shapely.simplify(rail_region, 1000))))
    river_parts = shapely.get_parts(shapely.make_valid(shapely.simplify(river, 1000, preserve_topology=True)))
    bands, band_props = [], []
    for net, parts in (("rail", rail_parts), ("river", river_parts)):
        for miles in (10, 5):
            log(f"  corridor {net} {miles} mi ({len(parts)} pieces)")
            buf = shapely.buffer(parts, miles * M_PER_MI, quad_segs=3)
            poly = shapely.simplify(shapely.union_all(buf), 500)
            bands.append(poly)
            band_props.append({"net": net, "mi": miles})
    cb = write_fc(os.path.join(OUT, "layers", "corridors.geojson"), wgs(np.array(bands, dtype=object), 4), band_props)
    with open(os.path.join(OUT, "layers", "grid.json"), "w", encoding="utf-8") as fh:
        json.dump({"levels": grid_levels}, fh, separators=(",", ":"))
    log(f"grid.json {os.path.getsize(os.path.join(OUT, 'layers', 'grid.json')) / 1e6:.1f} MB, corridors.geojson {cb / 1e6:.1f} MB")

    # ----------------------------------------------------------- supply.json
    rail_km = {u: round(float(sum(r["lengthkm"] or 0 for r in rail_rows_zone if r["railusage"] == u))) for u in ("M", "O", "X")}
    for pl in plants:
        for k in [k for k in pl if k.startswith("_")]:
            del pl[k]
    states = sorted({r["st"] for r in (rows_out[k] for k in keep) if r["st"]})
    supply = {
        "version": 2,
        "source": "ADM_Facilities.gdb (client, 7 Oct 2026): USDA NASS Crop Sequence Boundaries 2018–2025, FRA rail lines, main river system",
        "gridDeg": GRID_DEG, "bandsMi": BANDS_MI, "coverageStates": states,
        "plants": plants, "plant": plants[0], "rings": plants[0]["rings"],
        "admElevators": adm, "thirdParty": tp, "terminals": terminals,
        "delivered": delivered, "directUnits": direct_units, "unitSets": unit_sets,
        "catchments": catchments,
        "nonCompliantAll": nc_stats(np.ones(len(nc), bool)),
        "units": unit_index,
        "grid": grid_rows,
        "network": {"railKm": rail_km, "riverSystemKm2": round(river_km2), "riverSystems": 1, "riverSystemPolygons": len(riv_show)},
        "fieldsTotal": int(len(keep)), "fieldsDelivered": n_all,
        "doubleCropFields": int(double[keep].sum()),
        "tract": {"leftOut": {"dropped": reason.get("dropped", 0)}, "repaired": {k2: v for k2, v in reason.items() if k2 != "dropped"}, "files": tract_index},
        "combos": combos,
    }
    sb = write_json(os.path.join(OUT, "supply.json"), supply)
    log(f"supply.json {sb / 1e3:,.0f} KB — done")


if __name__ == "__main__":
    main()
