"""
Offline admin step for SoyTrace's Quincy supply-chain and rail & river views
(tenant `adm-soy`), from the client's ADM_SOY.gdb (delivered 30 Sep 2026):

  Crushing_Plant_Quincy            ADM Quincy (IL) crushing plant
  Buffer_Quincy_40NM / _80NM       its two catchments (nautical miles)
  Point_Elevator_ADM (+ Buffer_…)  ADM elevators, 20 NM catchments
  Point_ThirdParty_Polygons        98 third-party elevators, 20-mile catchments
  Point_ThirdParty_Elevator_3_Estate   the 56 of them in IL/IA/MO/KY/MN/IN
  CP_Compliant_Polygons_40NM/_80NM, Compliant_Elevator_ADM_Polygons,
  ThirdParty_Compliant_Polygons    compliant 2025 soybean fields per tier
                                   (USDA Crop Sequence Boundaries 2018–2025)
  Non_Compliant_Polygons + Point_Non_Compliant   non-compliant fields
  (+ Data Storage/ADM Soy/Non_Compliant_Polygon_Tambahan: outlines for points
     that came without one, 1 Oct 2026)
  RailWay (FRA 07/2025), River (NHD areas)       7 states: IL IN IA KY MN MO WI

Output (private-data/tenants/adm-soy/):
  supply.json                 facilities, catchment statistics, non-compliant
                              summary, rail & river proximity, density grid —
                              bundled, read by the workspace
  fields/units/<id>.geojson   the fields of one catchment, like PalmTrace's
                              plot file per mill: q40 (0–40 mi), q80r (the
                              40–80 mi ring; 0–80 mi = q40 + q80r), adm<n> (one per ADM
                              elevator site), tp<n> (each third party); each
                              field lists every catchment it's in ("k")
  fields/noncomply.geojson    non-compliant fields at their true shape (+ the
                              points delivered without a polygon)
  layers/rail.geojson, layers/rivers.geojson   replace the old USA_diaz layers
  layers/corridors.geojson    5- and 10-mile bands around active rail and the
                              main river system
  layers/grid.json            finer soybean density grids for zooming in
  (layers/roads.geojson is left as it was — the gdb has no roads.)
fields/ and layers/ go to the soy R2 bucket: scripts/upload-soy-fields-to-r2.mjs.

Definitions (stated in the app too):
  - Catchments are the client's own buffers, in nautical miles (ADM's
    request, 1 Oct 2026): Quincy 40 and 80 NM (74.08 / 148.16 km), each ADM
    elevator 20 NM (37.07 km). The third-party buffer was delivered at
    32.19 km (20 statute miles ≈ 17.4 NM, though the layer is named "20NM")
    and its fields only reach that far, so it stays as delivered.
  - A field is in a catchment when its outline touches ADM's buffer polygon
    for that facility (geodesic; reproduces the delivered sets), taken from the client's layer for that
    tier (Quincy from CP_80NM, ADM elevators from Compliant_Elevator_ADM,
    third parties from ThirdParty_Compliant). Non-compliant fields likewise
    (points without an outline: inside the circle).
  - Distances run from a field's centroid to the nearest active rail line
    (railusage M/O; X is shown but left out) and to the main river system:
    every connected set of NHD river areas of at least 50 km² (the
    Mississippi, Missouri, Ohio, Illinois, Tennessee and other large rivers;
    lakes on a river split it, so it can be several sets). Only fields in the 7
    states the rail/river data covers get a distance.
  - Conversion year / earlier cover of a non-compliant field come from its
    field-level CDL series; ADM's own flag uses the changed part (Change_Acr).

Run with the system Python (fiona, shapely 2, pyproj, numpy):
  python scripts/prepare-adm-soy-supply.py
"""
import collections
import json
import math
import os
import time

import fiona
import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GDB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Data Backup", "ADM_SOY.gdb")
# Outlines sent later (1 Oct 2026) for non-compliant points that came without
# a polygon; same CSB attributes and Albers projection as Non_Compliant_Polygons.
NC_EXTRA = [
    os.path.join(ROOT, "Data Storage", "ADM Soy", "Non_Compliant_Polygon_Tambahan", "Non_Compliant_Tambahan.shp"),
    # 3 more found by CSBID in USDA's national CSB (soybean 2025 subset); see its README.
    os.path.join(ROOT, "Data Storage", "ADM Soy", "Non_Compliant_Polygon_Tambahan_CSB", "Non_Compliant_Tambahan_CSB.shp"),
]
OUT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
GRID_DEG = 0.2
# Finer density grids for zooming in (layers/grid.json, loaded on demand):
# (cell size in degrees, first zoom it shows at) — about 6–13 px per cell.
GRID_LEVELS = [(0.1, 6.5), (0.05, 7.5), (0.025, 8.5)]
M_PER_MI = 1609.344
AC_TO_HA = 0.40468564224
BANDS_MI = [5, 10, 20]
MAJOR_KM2 = 50
# Field / non-compliant membership bits (mirrored in src/lib/soy-supply.ts).
FLAG_Q40, FLAG_Q80, FLAG_ADM, FLAG_TP, FLAG_CORE, FLAG_DUAL = 1, 2, 4, 8, 16, 32
COVERAGE = {"IL", "IN", "IA", "KY", "MN", "MO", "WI"}
FIPS = {
    "01": "AL", "05": "AR", "10": "DE", "13": "GA", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
    "21": "KY", "22": "LA", "24": "MD", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "31": "NE",
    "34": "NJ", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "42": "PA", "45": "SC",
    "46": "SD", "47": "TN", "51": "VA", "55": "WI",
}
STATE_NAMES = {
    "Illinois": "IL", "Iowa": "IA", "Missouri": "MO", "Indiana": "IN", "Kentucky": "KY", "Minnesota": "MN",
    "Wisconsin": "WI", "MN": "MN", "KY": "KY", "Arkansas": "AR", "Tennessee": "TN", "Mississippi": "MS",
    "Louisiana": "LA", "Ohio": "OH", "Michigan": "MI", "Nebraska": "NE", "Kansas": "KS", "Virginia": "VA",
    "North Carolina": "NC", "South Carolina": "SC", "Georgia": "GA", "Maryland": "MD", "Delaware": "DE",
    "New York": "NY", "New Jersey": "NJ", "Pennsylvania": "PA", "North Dakota": "ND", "Oklahoma": "OK",
}
SOY = {5, 26, 239, 240, 241, 254}
CORN = {1, 12, 13, 225, 226, 228, 237}
GRASS = {36, 37, 58, 59, 60, 62, 176, 224}
NON_CROP = {63, 64, 65, 81, 82, 83, 87, 88, 92, 111, 112, 121, 122, 123, 124, 131, 141, 142, 143, 152, 190, 195}
TREED = {63, 141, 142, 143, 190}
NATURAL = TREED | {64, 152, 176, 195, 62}
DEVELOPED = {111, 121, 122, 123, 124, 131}
YEARS = list(range(2018, 2026))
GROUPS = ["soy", "corn", "other", "grass", "fallow", "noncrop"]

to_wgs = Transformer.from_crs("ESRI:102003", "EPSG:4326", always_xy=True)


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


def log(msg, t0=[time.time()]):
    print(f"[soy-supply {time.time() - t0[0]:6.0f}s] {msg}", flush=True)


def read(layer, geom=True):
    rows, geoms = [], []
    with fiona.open(GDB, layer=layer) as src:
        for f in src:
            rows.append(dict(f["properties"]))
            if geom:
                g = shape(f["geometry"])
                geoms.append(shapely.force_2d(g))
    return rows, (np.array(geoms, dtype=object) if geom else None)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        # numpy scalars (int64 etc.) -> plain Python numbers
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


def main():
    # ---------------------------------------------------------------- network
    log("rail & rivers")
    rail_rows, rail_g = read("RailWay")
    usage = np.array([r["railusage"] for r in rail_rows])
    active = np.isin(usage, ["M", "O"])
    rail_active = shapely.simplify(rail_g[active], 25)
    rail_tree = STRtree(rail_active)

    riv_rows, riv_g = read("River")
    ftype = np.array([r["ftype"] for r in riv_rows])
    keep = np.isin(ftype, [460, 336, 398, 343])
    riv_g = shapely.make_valid(riv_g[keep])
    riv_ft = ftype[keep]
    rt = STRtree(riv_g)
    a, b = rt.query(riv_g, predicate="intersects")
    parent = np.arange(len(riv_g))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in zip(a, b):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj
    roots = np.array([find(i) for i in range(len(riv_g))])
    areas = shapely.area(riv_g)
    comp = collections.Counter()
    for r, ar in zip(roots, areas):
        comp[r] += ar
    # Lakes and reservoirs on the rivers (Lake Pepin, Kentucky Lake, …) are
    # NHD waterbodies, not river areas, so one river can split into several
    # systems here; every connected system of at least MAJOR_KM2 counts.
    major_roots = {r for r, a in comp.items() if a >= MAJOR_KM2 * 1e6}
    is_main = np.isin(roots, list(major_roots))
    major_km2 = sum(comp[r] for r in major_roots) / 1e6
    log(f"major river systems: {len(major_roots)} ({is_main.sum()} polygons, {major_km2:,.0f} km²)")
    river_main = shapely.simplify(riv_g[is_main], 25)
    river_tree = STRtree(river_main)

    # ------------------------------------------------------------- facilities
    # Catchments = the client's buffers (BUFF_DIST, metres): nautical miles for
    # Quincy 40/80 and ADM elevators 20; third parties as delivered (32.19 km —
    # their fields were selected with that radius, so a 20 NM circle could not
    # be filled from the data).
    log("facilities")
    plant_rows, plant_g = read("Crushing_Plant_Quincy")
    q40_rows, _ = read("Buffer_Quincy_40NM", geom=False)
    q80_rows, _ = read("Buffer_Quincy_80NM", geom=False)
    plant_xy = shapely.get_coordinates(plant_g)[0]
    R40, R80 = float(q40_rows[0]["BUFF_DIST"]), float(q80_rows[0]["BUFF_DIST"])
    rings = [
        {"id": "q40", "nm": 40, "radiusM": R40, "deliveredM": R40, "deliveredUnit": "NM"},
        {"id": "q80", "nm": 80, "radiusM": R80, "deliveredM": R80, "deliveredUnit": "NM"},
    ]
    adm_rows, adm_g = read("Point_Elevator_ADM")
    adm_buf_rows, _ = read("Buffer_Elevator_ADM_20NM", geom=False)
    tp_rows, tp_g = read("Point_ThirdParty_Polygons")
    tp56_rows, _ = read("Point_ThirdParty_Elevator_3_Estate", geom=False)
    tp_buf_rows, _ = read("Buffer_ThirdParty_Elevator_20NM", geom=False)
    core_names = {r["TRACT_Naming_Convention"] for r in tp56_rows}
    R20 = float(adm_buf_rows[0]["BUFF_DIST"])  # ADM elevators: 20 NM
    R_TP = float(tp_buf_rows[0]["BUFF_DIST"])  # third parties: as delivered
    delivered = {
        "q40": {"m": q40_rows[0]["BUFF_DIST"], "unit": "NM"},
        "q80": {"m": q80_rows[0]["BUFF_DIST"], "unit": "NM"},
        "adm": {"m": adm_buf_rows[0]["BUFF_DIST"], "unit": "NM"},
        "tp": {"m": tp_buf_rows[0]["BUFF_DIST"], "unit": "mi"},
    }

    def near(points):
        # One nearest geometry per input (ties would otherwise return several),
        # mapped back to input order.
        points = np.asarray(points, dtype=object)
        out = []
        for tree in (rail_tree, river_tree):
            (inp, _), dist = tree.query_nearest(points, return_distance=True, all_matches=False)
            d = np.full(len(points), np.nan)
            d[inp] = dist
            out.append(d / M_PER_MI)
        return out[0], out[1]

    adm_rd, adm_vd = near(adm_g)
    tp_rd, tp_vd = near(tp_g)
    plant_rd, plant_vd = near(plant_g)
    adm_ll = wgs(adm_g)
    tp_ll = wgs(tp_g)
    plant_ll = wgs(plant_g)[0]

    # Evansville is listed three times (an elevator and two grain terminals)
    # at separate points; each keeps its own row, but only one catchment.
    adm = []
    seen_catch = {}
    for i, r in enumerate(adm_rows):
        x, y = shapely.get_coordinates(adm_ll[i])[0]
        name = clean(r["Facility_N"]) or clean(r["Facility"]) or f"ADM elevator {i + 1}"
        key = clean(r["Facility"]) or name
        catch = key not in seen_catch
        seen_catch.setdefault(key, i)
        adm.append({
            "id": f"adm{i + 1}", "name": name, "city": clean(r["Facility"]), "county": clean(r["County"]),
            "state": STATE_NAMES.get(clean(r["State"]) or "", clean(r["State"])), "river": clean(r["River"]),
            "type": clean(r["Type_of_fa"]), "f50": clean(r["F50"]), "f100": clean(r["F100"]),
            "lat": round(y, 5), "lon": round(x, 5), "radiusM": R20 if catch else None,
            "site": f"adm{seen_catch[key] + 1}",
            "railMi": round(float(adm_rd[i]), 2), "riverMi": round(float(adm_vd[i]), 2),
            "missingAttrs": r["Latitude"] is None,
        })
    tp = []
    for i, r in enumerate(tp_rows):
        x, y = shapely.get_coordinates(tp_ll[i])[0]
        tp.append({
            "id": f"tp{i + 1}", "tract": clean(r["TRACT_Naming_Convention"]), "company": clean(r["Company_Name"]),
            "county": clean(r["County"]), "state": clean(r["State"]), "type": clean(r["Type_of_facility"]),
            "lat": round(y, 5), "lon": round(x, 5), "radiusM": R_TP,
            "core": r["TRACT_Naming_Convention"] in core_names,
            "railMi": round(float(tp_rd[i]), 2), "riverMi": round(float(tp_vd[i]), 2),
        })
    px, py = shapely.get_coordinates(plant_ll)[0]
    pr = plant_rows[0]
    plant = {
        "name": f"{clean(pr['Buyer'])} {clean(pr['Field2'])}", "company": clean(pr["Buyer"]), "city": clean(pr["Field2"]),
        "state": STATE_NAMES.get(clean(pr["State"]) or "", clean(pr["State"])), "lat": round(py, 5), "lon": round(px, 5),
        "f50": clean(pr["F50"]), "f100": clean(pr["F100"]),
        "railMi": round(float(plant_rd[0]), 2), "riverMi": round(float(plant_vd[0]), 2),
    }

    # ----------------------------------------------------------------- fields
    # Pools: which of the client's layers a field came from (bit per layer).
    POOLS = [("CP_Compliant_Polygons_40NM", 1), ("CP_Compliant_Polygons_80NM", 2),
             ("Compliant_Elevator_ADM_Polygons", 4), ("ThirdParty_Compliant_Polygons", 8)]
    idx = {}
    geoms, rows_out = [], []
    for layer, bit in POOLS:
        log(f"reading {layer}")
        with fiona.open(GDB, layer=layer) as src:
            for f in src:
                p = f["properties"]
                cid = str(p["CSBID"])
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
    log(f"distinct compliant fields delivered: {n_all:,}")

    # Membership: a field belongs to a catchment when its outline touches
    # ADM's own buffer polygon for that facility (geodesic, so not a perfect
    # circle in Albers — up to ~1.4 km wider than a planar circle). This
    # reproduces the delivered sets exactly (Quincy 40/80 NM, ADM elevators).
    log("catchment membership (ADM's buffer polygons)")
    tree = STRtree(geoms)
    buffers = {
        "q40": read("Buffer_Quincy_40NM")[1],
        "q80": read("Buffer_Quincy_80NM")[1],
        "adm": read("Buffer_Elevator_ADM_20NM")[1],
        "tp": read("Buffer_ThirdParty_Elevator_20NM")[1],
    }
    buffer_centres = {k: shapely.get_coordinates(shapely.centroid(v)) for k, v in buffers.items()}

    def area_for(center_xy, radius, kind):
        # The delivered buffer around this facility (nearest centre); a plain
        # circle only if none is within 2 km (should not happen).
        d = np.hypot(*(buffer_centres[kind] - center_xy).T)
        i = int(np.argmin(d))
        if d[i] < 2000:
            return buffers[kind][i]
        log(f"  no delivered {kind} buffer near {center_xy}; using a circle")
        return shapely.Point(center_xy).buffer(radius, quad_segs=64)

    def touching(center_xy, radius, pool_bit, kind):
        ix = tree.query(area_for(center_xy, radius, kind), predicate="intersects")
        return np.sort(ix[(pool[ix] & pool_bit) != 0])

    q80_ix = touching(plant_xy, R80, 2, "q80")
    q40_ix = touching(plant_xy, R40, 2, "q40")
    outer_ix = np.setdiff1d(q80_ix, q40_ix)
    cent = shapely.point_on_surface(geoms)
    adm_xy = shapely.get_coordinates(adm_g)
    tp_xy = shapely.get_coordinates(tp_g)
    adm_members = {e["id"]: touching(adm_xy[i], R20, 4, "adm") for i, e in enumerate(adm) if e["radiusM"]}
    tp_members = {e["id"]: touching(tp_xy[i], R_TP, 8, "tp") for i, e in enumerate(tp)}

    # Load units: one file per catchment the map can show (q40, the 40–80 mi
    # ring, each ADM elevator site, each third party); 0–80 mi loads q40 + q80r.
    units = {"q40": q40_ix, "q80r": outer_ix, **adm_members, **tp_members}
    member_of = collections.defaultdict(list)
    for uid, ix in units.items():
        for k in ix:
            member_of[int(k)].append(uid)
    keep = np.array(sorted(member_of))
    log(f"fields in any catchment: {len(keep):,} of {n_all:,}")

    in_q40 = np.zeros(n_all, bool); in_q40[q40_ix] = True  # noqa: E702
    in_q80 = np.zeros(n_all, bool); in_q80[q80_ix] = True  # noqa: E702
    in_adm = np.zeros(n_all, bool)
    for ix in adm_members.values():
        in_adm[ix] = True
    in_tp = np.zeros(n_all, bool)
    in_core = np.zeros(n_all, bool)
    for e in tp:
        in_tp[tp_members[e["id"]]] = True
        if e["core"]:
            in_core[tp_members[e["id"]]] = True

    nc_poly_rows, nc_poly_g = read("Non_Compliant_Polygons")
    known = {str(r["CSBID"]) for r in nc_poly_rows}
    extra_rows, extra_g = [], []
    for path in NC_EXTRA:
        if not os.path.exists(path):
            continue
        with fiona.open(path) as src, fiona.open(GDB, layer="Non_Compliant_Polygons") as ref:
            # Its Albers has latitude of origin 23° (USGS CONUS), the gdb's
            # 37.5° (ESRI:102003): same shape, shifted — reproject.
            to_gdb = Transformer.from_crs(src.crs_wkt, ref.crs_wkt, always_xy=True)
            for f in src:
                if str(f["properties"]["CSBID"]) in known:
                    continue
                known.add(str(f["properties"]["CSBID"]))
                extra_rows.append(dict(f["properties"]))
                g = shapely.force_2d(shape(f["geometry"]))
                extra_g.append(shapely.transform(g, lambda xy: np.column_stack(to_gdb.transform(xy[:, 0], xy[:, 1]))))
    if extra_rows:
        log(f"non-compliant outlines added later: {len(extra_rows)}")
        nc_poly_rows = nc_poly_rows + extra_rows
        nc_poly_g = np.concatenate([nc_poly_g, np.array(extra_g, dtype=object)])
    nc_pt_rows, nc_pt_g = read("Point_Non_Compliant")
    nc_ids = {str(r["CSBID"]) for r in nc_poly_rows} | {str(r["CSBID"]) for r in nc_pt_rows}
    dual = np.zeros(n_all, bool)
    for cid in nc_ids:
        k = idx.get(cid)
        if k is not None:
            dual[k] = True
    flags = (in_q40 * FLAG_Q40) | (in_q80 * FLAG_Q80) | (in_adm * FLAG_ADM) | (in_tp * FLAG_TP) | (in_core * FLAG_CORE) | (dual * FLAG_DUAL)

    in_cov = np.array([r["st"] in COVERAGE for r in rows_out])
    log("distances to rail / rivers")
    rail_mi = np.full(n_all, np.nan)
    river_mi = np.full(n_all, np.nan)
    sel = np.intersect1d(np.where(in_cov)[0], keep)
    rail_mi[sel], river_mi[sel] = near(cent[sel])

    # Non-compliant fields: polygons, plus points that came without one.
    log("non-compliant")
    pt_by = {str(r["CSBID"]): (r, g) for r, g in zip(nc_pt_rows, nc_pt_g)}
    nc = []
    nc_geoms = []
    for r, g in zip(nc_poly_rows, nc_poly_g):
        cid = str(r["CSBID"])
        pt = pt_by.get(cid, (None, None))[0]
        nc.append((cid, r, pt, False))
        nc_geoms.append(g)
    poly_ids = {str(r["CSBID"]) for r in nc_poly_rows}
    for cid, (pt, g) in pt_by.items():
        if cid not in poly_ids:
            nc.append((cid, None, pt, True))
            nc_geoms.append(g)
    nc_geoms = np.array(nc_geoms, dtype=object)
    nc_tree = STRtree(nc_geoms)

    def nc_touching(center_xy, radius, kind):
        m = np.zeros(len(nc), bool)
        m[nc_tree.query(area_for(center_xy, radius, kind), predicate="intersects")] = True
        return m

    nc_q40 = nc_touching(plant_xy, R40, "q40")
    nc_q80 = nc_touching(plant_xy, R80, "q80")
    nc_outer = nc_q80 & ~nc_q40
    nc_units = {"q40": nc_q40, "q80r": nc_outer}
    for i, e in enumerate(adm):
        if e["radiusM"]:
            nc_units[e["id"]] = nc_touching(adm_xy[i], R20, "adm")
    for i, e in enumerate(tp):
        nc_units[e["id"]] = nc_touching(tp_xy[i], R_TP, "tp")
    nc_member = [[u for u, m in nc_units.items() if m[k]] for k in range(len(nc))]
    nc_adm = np.any([nc_units[e["id"]] for e in adm if e["radiusM"]], axis=0)
    nc_tp = np.any([nc_units[e["id"]] for e in tp], axis=0)
    nc_core = np.any([nc_units[e["id"]] for e in tp if e["core"]], axis=0)

    comp_ids = set(idx)
    # Points without an outline carry crop names, not codes.
    with open(os.path.join(OUT, "soy.json"), encoding="utf-8") as fh:
        code_by_name = {v: int(k) for k, v in json.load(fh)["cdlNames"].items()}
    nc_rd, nc_vd = near(shapely.point_on_surface(nc_geoms))
    nc_props = []
    nc_info = []
    for k, (cid, r, pt, point_only) in enumerate(nc):
        if r is not None:
            cdl = [r[f"CDL{y}"] for y in YEARS]
            acres = float(r["CSBACRES"] or 0)
            st = FIPS.get(r["STATEFIPS"], r["STATEFIPS"])
            county = clean(r["CNTY"])
        else:
            cdl = [None] * 8
            acres = float(pt["CSBACRES"] or 0)
            st = STATE_NAMES.get(clean(pt["State"]) or "", clean(pt["State"]))
            county = clean(pt["County"])
        before = None
        conv = None
        if r is not None:
            early = [c for c in cdl[:3] if c is not None]
            before = "treed" if any(c in TREED for c in early) else ("natural" if any(c in NATURAL for c in early) else "crop")
            conv = next((y for y, c in zip(YEARS[3:], cdl[3:]) if c is not None and c not in NATURAL and c not in DEVELOPED), None)
        change = float(pt["Change_Acr"]) if pt and pt.get("Change_Acr") is not None else None
        soy26 = clean(pt["F2026_Soy"]) if pt else None
        crop24 = clean(pt["CDL2024"]) if pt else None
        crop25 = clean(pt["CDL2025"]) if pt else None
        f = (FLAG_Q40 if nc_q40[k] else 0) | (FLAG_Q80 if nc_q80[k] else 0) | (FLAG_ADM if nc_adm[k] else 0) | \
            (FLAG_TP if nc_tp[k] else 0) | (FLAG_CORE if nc_core[k] else 0) | (FLAG_DUAL if cid in comp_ids else 0)
        ex = extent_of(change, acres)
        use = use_of(cdl[7] if cdl[7] is not None else code_by_name.get(crop25 or ""))
        info = {"id": cid, "acres": acres, "change": change, "st": st, "county": county, "before": before,
                "conv": conv, "soy26": soy26, "flags": f, "pointOnly": point_only, "cdl": cdl, "extent": ex, "use": use}
        nc_info.append(info)
        nc_props.append({
            "id": cid, "a": round(acres, 1), "ch": None if change is None else round(change, 2), "s": st, "n": county,
            "c": ",".join("" if c is None else str(c) for c in cdl), "b": before, "y": conv, "s26": soy26,
            "c24": crop24, "c25": crop25, "f": f, "po": point_only, "k": "|".join(nc_member[k]),
            "sy": sum(1 for c in cdl if c in SOY) if r is not None else None,
            "ex": ex, "u": use,
            "r": round(float(nc_rd[k]), 1) if st in COVERAGE and not math.isnan(nc_rd[k]) else None,
            "v": round(float(nc_vd[k]), 1) if st in COVERAGE and not math.isnan(nc_vd[k]) else None,
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
        cov = ix[in_cov[ix]]
        cov_acres = float(acres_arr[cov].sum())
        corridor = {}
        for band in BANDS_MI:
            corridor[str(band)] = {
                "rail": round(float(acres_arr[cov][rail_mi[cov] <= band].sum()), 1),
                "river": round(float(acres_arr[cov][river_mi[cov] <= band].sum()), 1),
                "either": round(float(acres_arr[cov][min_mi[cov] <= band].sum()), 1),
                "both": round(float(acres_arr[cov][(rail_mi[cov] <= band) & (river_mi[cov] <= band)].sum()), 1),
            }
        return {
            "fields": int(len(ix)), "acres": round(float(acres.sum()), 1),
            "soyYears": [{"years": y, "fields": hist.get(y, 0)} for y in range(1, 9)],
            "cropHistoryHa": crop,
            "topCounties": [{"county": c, "state": s, "fields": cfields[(c, s)], "acres": round(a2, 1)}
                            for (c, s), a2 in counties.most_common(6)],
            "states": [{"state": s, "acres": round(a2, 1)} for s, a2 in states.most_common()],
            "coverageAcres": round(cov_acres, 1), "coverageFields": int(len(cov)), "corridor": corridor,
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
            "alsoCompliant": int(sum(1 for k in ix if nc_info[k]["flags"] & FLAG_DUAL)),
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

    nc_any = nc_q80 | nc_adm | nc_tp

    # Combinations (Quincy 0–40 / 0–80 mi, any set of ADM elevator sites,
    # third parties): fields grouped by which catchments they are in, so any
    # union can be summed in the browser without counting a field twice.
    sites = [e["id"] for e in adm if e["radiusM"]]
    combo_bits = {"q40": 0, "q80": 1, **{sid: 2 + i for i, sid in enumerate(sites)}}
    combo_bits["tp"] = 2 + len(sites)
    combo_bits["tpcore"] = 3 + len(sites)
    fmask = (in_q40.astype(np.int64) << combo_bits["q40"]) | (in_q80.astype(np.int64) << combo_bits["q80"]) | \
        (in_tp.astype(np.int64) << combo_bits["tp"]) | (in_core.astype(np.int64) << combo_bits["tpcore"])
    for sid in sites:
        m = np.zeros(n_all, np.int64)
        m[adm_members[sid]] = 1
        fmask |= m << combo_bits[sid]
    soy8 = soy_years == 8
    combo_fields = collections.defaultdict(lambda: [0, 0.0, 0.0, 0])
    for k in keep:
        row = combo_fields[int(fmask[k])]
        row[0] += 1
        row[1] += acres_arr[k]
        if in_cov[k] and min_mi[k] <= 10:
            row[2] += acres_arr[k]
        row[3] += int(soy8[k])
    nmask = (nc_q40.astype(np.int64) << combo_bits["q40"]) | (nc_q80.astype(np.int64) << combo_bits["q80"]) | \
        (nc_tp.astype(np.int64) << combo_bits["tp"]) | (nc_core.astype(np.int64) << combo_bits["tpcore"])
    for sid in sites:
        nmask |= nc_units[sid].astype(np.int64) << combo_bits[sid]
    combo_nc = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for k in np.where(nmask > 0)[0]:
        row = combo_nc[int(nmask[k])]
        row[0] += 1
        row[1] += nc_info[k]["acres"]
        row[2] += nc_info[k]["change"] or 0
    combos = {
        "bits": combo_bits,
        # [mask, fields, acres, acres within 10 mi of rail or river, fields with soybeans all 8 seasons]
        "fields": [[m, v[0], round(v[1], 1), round(v[2], 1), v[3]] for m, v in sorted(combo_fields.items())],
        # [mask, fields, field acres, changed (deforested) acres]
        "nc": [[m, v[0], round(v[1], 1), round(v[2], 1)] for m, v in sorted(combo_nc.items())],
    }
    log(f"combinations: {len(combos['fields'])} field groups, {len(combos['nc'])} non-compliant groups")
    # Level 1 and 2 (no fields drawn), then every load unit (level 3).
    add("all", "tier", "Quincy supply chain", keep, nc_any)
    add("direct", "tier", "Quincy direct catchment (80 NM)", q80_ix, nc_q80)
    add("adm", "tier", "ADM elevators", np.where(in_adm)[0], nc_adm)
    add("tp", "tier", "Third-party elevators", np.where(in_tp)[0], nc_tp)
    add("tpcore", "tier", "Third-party elevators (IL, IA, MO, KY, MN, IN)", np.where(in_core)[0], nc_core)
    add("q40", "plant", "Quincy 0–40 NM", q40_ix, nc_q40, {"radiusM": R40})
    add("q80r", "plant", "Quincy 40–80 NM", outer_ix, nc_outer, {"radiusM": R80})
    add("q80", "plant", "Quincy 0–80 NM", q80_ix, nc_q80, {"radiusM": R80})
    for e in adm:
        if e["radiusM"]:
            add(e["id"], "adm", e["name"], adm_members[e["id"]], nc_units[e["id"]])
    for e in tp:
        add(e["id"], "tp", e["tract"] or e["company"] or e["id"], tp_members[e["id"]], nc_units[e["id"]])
    log(f"{len(catchments)} catchments")

    # Density grids (fields in any catchment): [gx, gy, acres, coverage acres,
    # within 10 mi of rail / river / either, % of the cell under these fields].
    ll = shapely.get_coordinates(wgs(cent, 4))
    kk = keep
    w = acres_arr[kk]
    cv = in_cov[kk]

    def grid_for(deg):
        gx = np.floor(ll[kk, 0] / deg).astype(np.int64)
        gy = np.floor(ll[kk, 1] / deg).astype(np.int64)
        uniq, inv = np.unique((gx + 100000) * 1000000 + (gy + 100000), return_inverse=True)
        sums = [np.bincount(inv, weights=w * m, minlength=len(uniq)) for m in (
            np.ones(len(kk)), cv, cv & (rail_mi[kk] <= 10), cv & (river_mi[kk] <= 10), cv & (min_mi[kk] <= 10))]
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

    nc_simple = shapely.simplify(nc_geoms, 5, preserve_topology=True)
    nc_bytes = write_fc(os.path.join(OUT, "fields", "noncomply.geojson"), wgs(nc_simple, 6), nc_props)
    log(f"noncomply.geojson {nc_bytes / 1e6:.1f} MB")

    # ---------------------------------------------------------------- layers
    log("rail / river / corridor layers")
    rail_all = wgs(shapely.simplify(rail_g, 20), 5)
    rail_props = [{"u": r["railusage"], "n": clean(r["name"]), "d": clean(r["railsubdiv"])} for r in rail_rows]
    rb = write_fc(os.path.join(OUT, "layers", "rail.geojson"), rail_all, rail_props)
    # Shown: the main river system in full, plus other river areas of at
    # least 0.25 km² (the rest are ditches and slivers the map can't show).
    show = is_main | ((riv_ft == 460) & (areas >= 1e6))
    riv_simple = shapely.make_valid(shapely.simplify(riv_g[show], 80, preserve_topology=True))
    riv_ll = wgs(riv_simple, 4)
    riv_props = [{"m": bool(m), "t": int(t)} for m, t in zip(is_main[show], riv_ft[show])]
    vb = write_fc(os.path.join(OUT, "layers", "rivers.geojson"), riv_ll, riv_props)
    log(f"rail.geojson {rb / 1e6:.1f} MB, rivers.geojson {vb / 1e6:.1f} MB")

    # Bands: buffer each coarsened piece on its own and union the results
    # (buffering the whole network as one geometry runs out of memory).
    rail_parts = shapely.get_parts(shapely.line_merge(shapely.union_all(shapely.simplify(rail_active, 1000))))
    river_parts = shapely.get_parts(shapely.make_valid(shapely.simplify(river_main, 1000, preserve_topology=True)))
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
    log(f"grid.json {os.path.getsize(os.path.join(OUT, 'layers', 'grid.json')) / 1e6:.1f} MB")
    log(f"corridors.geojson {cb / 1e6:.1f} MB")

    # ----------------------------------------------------------- supply.json
    rail_km = {u: round(float(sum(r["lengthkm"] or 0 for r in rail_rows if r["railusage"] == u))) for u in ("M", "O", "X")}
    supply = {
        "source": "ADM_SOY.gdb (client, 30 Sep 2026): USDA NASS Crop Sequence Boundaries 2018–2025, FRA rail lines 07/2025, USGS NHD river areas",
        "gridDeg": GRID_DEG, "bandsMi": BANDS_MI, "coverageStates": sorted(COVERAGE),
        "plant": plant, "rings": rings, "admElevators": adm, "thirdParty": tp,
        "delivered": delivered, "directUnits": ["q40", "q80r", "q80"], "unitSets": {"q80": ["q40", "q80r"]},
        "catchments": catchments,
        "nonCompliantAll": nc_stats(np.ones(len(nc), bool)),
        "units": unit_index,
        "grid": grid_rows,
        "network": {"railKm": rail_km, "riverSystemKm2": round(major_km2),
                    "riverSystems": len(major_roots), "riverSystemPolygons": int(is_main.sum())},
        "fieldsTotal": int(len(keep)), "fieldsDelivered": n_all,
        "combos": combos,
    }
    sb = write_json(os.path.join(OUT, "supply.json"), supply)
    log(f"supply.json {sb / 1e3:,.0f} KB — done")


if __name__ == "__main__":
    main()
