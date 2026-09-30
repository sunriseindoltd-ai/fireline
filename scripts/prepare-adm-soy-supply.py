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
  RailWay (FRA 07/2025), River (NHD areas)       7 states: IL IN IA KY MN MO WI

Output (private-data/tenants/adm-soy/):
  supply.json                 facilities, catchment statistics, non-compliant
                              summary, rail & river proximity, density grid —
                              bundled, read by the workspace
  fields/cells/<cx>_<cy>.geojson  every distinct compliant field, split into
                              0.25° cells the map loads as you zoom in
  fields/noncomply.geojson    non-compliant fields at their true shape (+ the
                              points delivered without a polygon)
  layers/rail.geojson, layers/rivers.geojson   replace the old USA_diaz layers
  layers/corridors.geojson    5- and 10-mile bands around active rail and the
                              main river system
  (layers/roads.geojson is left as it was — the gdb has no roads.)
fields/ and layers/ go to the soy R2 bucket: scripts/upload-soy-fields-to-r2.mjs.

Definitions (stated in the app too):
  - A field's catchment membership follows the client's own layers (which
    set it is in); per-elevator figures assign a field to every elevator whose
    catchment holds its centroid (1.5 km tolerance for edge fields the client
    selected by intersection).
  - Non-compliant fields are tested by centroid against every catchment.
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
OUT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
CELL_DEG = 0.25
GRID_DEG = 0.2
M_PER_MI = 1609.344
AC_TO_HA = 0.40468564224
EDGE_TOL_M = 1500
BANDS_MI = [5, 10, 20]
MAJOR_KM2 = 50
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
    log("facilities")
    plant_rows, plant_g = read("Crushing_Plant_Quincy")
    q40_rows, _ = read("Buffer_Quincy_40NM", geom=False)
    q80_rows, _ = read("Buffer_Quincy_80NM", geom=False)
    plant_xy = shapely.get_coordinates(plant_g)[0]
    rings = [
        {"id": "q40", "nm": 40, "radiusM": q40_rows[0]["BUFF_DIST"]},
        {"id": "q80", "nm": 80, "radiusM": q80_rows[0]["BUFF_DIST"]},
    ]
    adm_rows, adm_g = read("Point_Elevator_ADM")
    adm_buf_rows, _ = read("Buffer_Elevator_ADM_20NM", geom=False)
    adm_radius = adm_buf_rows[0]["BUFF_DIST"]
    tp_rows, tp_g = read("Point_ThirdParty_Polygons")
    tp56_rows, _ = read("Point_ThirdParty_Elevator_3_Estate", geom=False)
    tp_buf_rows, _ = read("Buffer_ThirdParty_Elevator_20NM", geom=False)
    tp_radius = tp_buf_rows[0]["BUFF_DIST"]
    core_names = {r["TRACT_Naming_Convention"] for r in tp56_rows}

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
            "lat": round(y, 5), "lon": round(x, 5), "radiusM": adm_radius if catch else None,
            "railMi": round(float(adm_rd[i]), 2), "riverMi": round(float(adm_vd[i]), 2),
            "missingAttrs": r["Latitude"] is None,
        })
    tp = []
    for i, r in enumerate(tp_rows):
        x, y = shapely.get_coordinates(tp_ll[i])[0]
        tp.append({
            "id": f"tp{i + 1}", "tract": clean(r["TRACT_Naming_Convention"]), "company": clean(r["Company_Name"]),
            "county": clean(r["County"]), "state": clean(r["State"]), "type": clean(r["Type_of_facility"]),
            "lat": round(y, 5), "lon": round(x, 5), "radiusM": tp_radius,
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
    TIERS = [("CP_Compliant_Polygons_40NM", 1), ("CP_Compliant_Polygons_80NM", 2),
             ("Compliant_Elevator_ADM_Polygons", 4), ("ThirdParty_Compliant_Polygons", 8)]
    idx = {}
    geoms, rows_out = [], []
    for layer, bit in TIERS:
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
                        "id": cid, "acres": float(p["CSBACRES"] or 0), "flags": bit, "cdl": cdl,
                        "st": FIPS.get(p["STATEFIPS"], p["STATEFIPS"]), "county": clean(p["CNTY"]),
                    })
                    geoms.append(shapely.force_2d(shape(f["geometry"])))
                else:
                    rows_out[k]["flags"] |= bit
    geoms = np.array(geoms, dtype=object)
    n = len(rows_out)
    log(f"distinct compliant fields: {n:,}")

    nc_poly_rows, nc_poly_g = read("Non_Compliant_Polygons")
    nc_pt_rows, nc_pt_g = read("Point_Non_Compliant")
    nc_ids = {str(r["CSBID"]) for r in nc_poly_rows} | {str(r["CSBID"]) for r in nc_pt_rows}
    for cid in nc_ids:
        k = idx.get(cid)
        if k is not None:
            rows_out[k]["flags"] |= 32

    cent = shapely.point_on_surface(geoms)
    cxy = shapely.get_coordinates(cent)
    in_cov = np.array([r["st"] in COVERAGE for r in rows_out])
    log("distances to rail / rivers")
    rail_mi = np.full(n, np.nan)
    river_mi = np.full(n, np.nan)
    sel = np.where(in_cov)[0]
    rail_mi[sel], river_mi[sel] = near(cent[sel])

    # Per-elevator catchment membership (centroid within radius + tolerance).
    def members(centers_xy, radius, rows_mask_bit):
        pts_idx = np.where([(r["flags"] & rows_mask_bit) != 0 for r in rows_out])[0]
        pts = cxy[pts_idx]
        out = []
        for cx, cy in centers_xy:
            d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
            out.append(pts_idx[d <= radius + EDGE_TOL_M])
        return out

    adm_xy = shapely.get_coordinates(adm_g)
    tp_xy = shapely.get_coordinates(tp_g)
    adm_members = members(adm_xy, adm_radius, 4)
    tp_members = members(tp_xy, tp_radius, 8)

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
    nc_cent = shapely.point_on_surface(nc_geoms)
    nc_xy = shapely.get_coordinates(nc_cent)

    def within(xy, center, radius):
        return np.hypot(xy[:, 0] - center[0], xy[:, 1] - center[1]) <= radius

    nc_in_q40 = within(nc_xy, plant_xy, rings[0]["radiusM"])
    nc_in_q80 = within(nc_xy, plant_xy, rings[1]["radiusM"])
    nc_adm = [np.where(within(nc_xy, c, adm_radius))[0] for c in adm_xy]
    nc_tp = [np.where(within(nc_xy, c, tp_radius))[0] for c in tp_xy]
    nc_any_adm = np.zeros(len(nc), bool)
    for i, e in enumerate(adm):
        if e["radiusM"]:
            nc_any_adm[nc_adm[i]] = True
    nc_any_tp = np.zeros(len(nc), bool)
    nc_any_tp56 = np.zeros(len(nc), bool)
    for i, e in enumerate(tp):
        nc_any_tp[nc_tp[i]] = True
        if e["core"]:
            nc_any_tp56[nc_tp[i]] = True

    comp_ids = set(idx)
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
        flags = (1 if nc_in_q40[k] else 0) | (2 if nc_in_q80[k] else 0) | (4 if nc_any_adm[k] else 0) | \
                (8 if nc_any_tp[k] else 0) | (16 if nc_any_tp56[k] else 0) | (32 if cid in comp_ids else 0)
        info = {"id": cid, "acres": acres, "change": change, "st": st, "county": county, "before": before,
                "conv": conv, "soy26": soy26, "flags": flags, "pointOnly": point_only, "cdl": cdl}
        nc_info.append(info)
        nc_props.append({
            "id": cid, "a": round(acres, 1), "ch": None if change is None else round(change, 2), "s": st, "n": county,
            "c": ",".join("" if c is None else str(c) for c in cdl), "b": before, "y": conv, "s26": soy26,
            "c24": crop24, "c25": crop25, "f": flags, "po": point_only,
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
        return {
            "fields": int(len(ix)), "acres": round(sum(nc_info[k]["acres"] for k in ix), 1),
            "changeAcres": round(sum(nc_info[k]["change"] or 0 for k in ix), 1),
            "alsoCompliant": int(sum(1 for k in ix if nc_info[k]["flags"] & 32)),
            "pointOnly": int(sum(1 for k in ix if nc_info[k]["pointOnly"])),
            "byYear": [{"year": y, "fields": by_year.get(y, 0)} for y in range(2021, 2026)],
            "unknownYear": int(by_year.get(None, 0)),
            "byBefore": {k2 or "unknown": v for k2, v in by_before.items()},
            "byState": [{"state": s, "fields": v} for s, v in by_state.most_common()],
        }

    tier_ix = {bit: np.where([(r["flags"] & bit) != 0 for r in rows_out])[0] for bit in (1, 2, 4, 8)}
    tp56_ix = np.unique(np.concatenate([m for m, e in zip(tp_members, tp) if e["core"]] or [np.array([], int)]))
    all_ix = np.arange(n)
    catchments = []

    def add(cid, kind, name, ix, nc_mask, extra=None):
        catchments.append({"id": cid, "kind": kind, "name": name, **(extra or {}),
                           "compliant": field_stats(ix), "nonCompliant": nc_stats(nc_mask)})

    add("q40", "plant", "Quincy 40 NM", tier_ix[1], nc_in_q40, {"radiusM": rings[0]["radiusM"]})
    add("q80", "plant", "Quincy 80 NM", tier_ix[2], nc_in_q80, {"radiusM": rings[1]["radiusM"]})
    add("adm", "tier", "ADM elevators", tier_ix[4], nc_any_adm)
    add("tpcore", "tier", "Third-party elevators (IL, IA, MO, KY, MN, IN)", tp56_ix, nc_any_tp56)
    add("tp", "tier", "Third-party elevators", tier_ix[8], nc_any_tp)
    nc_all = np.ones(len(nc), bool)
    add("all", "tier", "All catchments", all_ix, nc_in_q80 | nc_any_adm | nc_any_tp)
    for i, e in enumerate(adm):
        if not e["radiusM"]:
            continue
        mask = np.zeros(len(nc), bool)
        mask[nc_adm[i]] = True
        add(e["id"], "adm", e["name"], adm_members[i], mask)
    for i, e in enumerate(tp):
        mask = np.zeros(len(nc), bool)
        mask[nc_tp[i]] = True
        add(e["id"], "tp", e["tract"] or e["company"] or e["id"], tp_members[i], mask)
    log(f"{len(catchments)} catchments")

    # Density grid for the zoomed-out map.
    ll = shapely.get_coordinates(wgs(cent, 4))
    gx = np.floor(ll[:, 0] / GRID_DEG).astype(int)
    gy = np.floor(ll[:, 1] / GRID_DEG).astype(int)
    grid = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0])
    for k in range(n):
        c = grid[(gx[k], gy[k])]
        c[0] += acres_arr[k]
        if in_cov[k]:
            c[1] += acres_arr[k]
            if rail_mi[k] <= 10:
                c[2] += acres_arr[k]
            if river_mi[k] <= 10:
                c[3] += acres_arr[k]
            if min_mi[k] <= 10:
                c[4] += acres_arr[k]
    grid_rows = [[int(x), int(y), *[round(v) for v in vals]] for (x, y), vals in grid.items()]

    # ------------------------------------------------------------ field cells
    log("writing field cells")
    cells_dir = os.path.join(OUT, "fields", "cells")
    os.makedirs(cells_dir, exist_ok=True)
    for f in os.listdir(cells_dir):
        os.remove(os.path.join(cells_dir, f))
    simple = shapely.simplify(geoms, 12, preserve_topology=True)
    simple_ll = wgs(simple)
    cx = np.floor(ll[:, 0] / CELL_DEG).astype(int)
    cy = np.floor(ll[:, 1] / CELL_DEG).astype(int)
    by_cell = collections.defaultdict(list)
    for k in range(n):
        by_cell[(cx[k], cy[k])].append(k)
    cell_index = []
    total_bytes = 0
    for (x, y), ks in sorted(by_cell.items()):
        props = []
        for k in ks:
            r = rows_out[k]
            props.append({
                "id": r["id"], "a": round(r["acres"], 1), "y": int(soy_years[k]),
                "c": ",".join("" if c is None else str(c) for c in r["cdl"]), "f": r["flags"],
                "r": None if math.isnan(rail_mi[k]) else round(float(rail_mi[k]), 1),
                "v": None if math.isnan(river_mi[k]) else round(float(river_mi[k]), 1),
                "s": r["st"], "n": r["county"],
            })
        cid = f"{x}_{y}"
        total_bytes += write_fc(os.path.join(cells_dir, f"{cid}.geojson"), simple_ll[ks], props)
        cell_index.append([x, y, len(ks)])
    log(f"{len(cell_index)} cells, {total_bytes / 1e6:,.1f} MB")

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
    log(f"corridors.geojson {cb / 1e6:.1f} MB")

    # ----------------------------------------------------------- supply.json
    rail_km = {u: round(float(sum(r["lengthkm"] or 0 for r in rail_rows if r["railusage"] == u))) for u in ("M", "O", "X")}
    supply = {
        "source": "ADM_SOY.gdb (client, 30 Sep 2026): USDA NASS Crop Sequence Boundaries 2018–2025, FRA rail lines 07/2025, USGS NHD river areas",
        "cellDeg": CELL_DEG, "gridDeg": GRID_DEG, "bandsMi": BANDS_MI, "coverageStates": sorted(COVERAGE),
        "plant": plant, "rings": rings, "admElevators": adm, "thirdParty": tp,
        "catchments": catchments,
        "nonCompliantAll": nc_stats(nc_all),
        "cells": cell_index,
        "grid": grid_rows,
        "network": {"railKm": rail_km, "riverSystemKm2": round(major_km2),
                    "riverSystems": len(major_roots), "riverSystemPolygons": int(is_main.sum())},
        "fieldsTotal": n,
    }
    sb = write_json(os.path.join(OUT, "supply.json"), supply)
    log(f"supply.json {sb / 1e3:,.0f} KB — done")


if __name__ == "__main__":
    main()
