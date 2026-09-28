#!/usr/bin/env python3
"""
Build the TRACT upload package for BNS (Banyuasin Nusantara Sejahtera) from
the plot data already ingested into Kanopi (private-data/plots/*__BNS__*,
see scripts/prepare-bns-plots.mjs) — one GeoJSON + one Farmer Group master
data .xlsx per mill, same shape as SJIM's `TRACT Upload - Ready\\` package.

Rules carried over from SJIM's TRACT round (SJIM_PIPELINE_NOTES.md):
  - Only `EUDR_Comply == "YES"` plots go to TRACT.
  - Geometry goes through the same "brutal" cleaner SJIM used
    (eudr_clean_plots_brutal.py, ported below): make_valid, fill every hole
    (TRACT rejects holes outright), explode, drop parts < 0.02 ha and
    < 1.5 m-wide slivers, light 0.4 m simplify, drop nested polygons,
    reassemble, drop features < 0.1 ha. Coordinates are snap-rounded to the
    6-decimal grid TRACT validates on (see snap_to_tract_grid). Exterior rings are
    additionally forced counter-clockwise (RFC 7946) — clockwise Esri rings
    were the single biggest cause of TRACT's "self-intersection" rejections.
  - Master data: data goes in row 3 of "2. Farmer_Groups Template" (row 2
    is the field-name row), Farmer_Group_Name = Reference_ID = NodeID,
    Total_Cultivated_Area = sum of the cleaned `Area` actually exported,
    Country = Indonesia, Lat/Lon blank, Radius 20 km.

PlotIDs are Kanopi's own (unchanged), so a PlotID in any TRACT error or
deforestation report maps straight back to the Kanopi plot.

NodeIDs come from mills.json as-is. A mill already registered on TRACT
under another chain (ALREADY_ON_TRACT) keeps that existing NodeID and gets
no master data file — its node is not re-uploaded (TRACT would reject it:
"The Node ID already exists in the system"); only its plots are exported.

Usage: python scripts/export-bns-tract.py
"""
from __future__ import annotations

import csv
import json
import math
import re
import shutil
from pathlib import Path

import geopandas as gpd
import pandas as pd
from openpyxl import load_workbook
from shapely import force_2d, set_precision
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent.parent
PLOTS_DIR = ROOT / "private-data" / "plots"
MILLS_JSON = ROOT / "private-data" / "mills.json"
TEMPLATE_XLSX = ROOT / "Data Storage" / "TRACT Templates" / "farmer_group_master_data_template_v5.xlsx"
OUT_DIR = ROOT / "Data Storage" / "BNS - TRACT Upload - Ready"
OUT_GEOJSON = OUT_DIR / "GeoJSON"
OUT_MASTERDATA = OUT_DIR / "Master Data"
# TRACT's post-upload deforestation check, saved by hand as raw HTML pages.
DEFO_REPORT_DIR = OUT_DIR / "Deforestation Report"

GROUP = "BNS"
CRUSHER_CODE = "BNS"

# Already on TRACT as SJIM nodes (TRACT Recap.xlsx, SJIM sheet): KENANGA MILL
# (2026-09-02), GARUDA BUMI PERKASA and SAWINDO KENCANA (2026-09-18) — the
# latter two's BNS master data upload FAILED on 2026-09-24 for that reason.
ALREADY_ON_TRACT = {"PO1000016377", "PO1000004064", "PO1000004516"}

# BNS mills with no plot data of their own (dropped from mills.json at
# ingest) whose TRACT slot is filled by *reusing* already-exported BNS plots
# that sit fully inside a REUSE_RADIUS_KM buffer around the mill (user
# instruction, 2026-09-25): same geometry/attributes, re-identified with the
# mill's own UML_ID / name / NodeID and a freshly minted PlotID (the original
# kept as Source_PlotID). Coordinates from "D:/000 Work/000 Databases/UML.xlsx".
#
# MANGSANG has no plot within 20 km in any chain (nearest: 23 km), so per the
# user it uses 30 km, and its only plots in range are SJIM's AGRO SINERGI
# SUKSES ABADI (800000000089). Those come from SJIM's own TRACT-uploaded file
# (after TRACT's deforestation drop, copied from D:\...\11. SJIM\Ada Plot\
# Ada Plot\Dropped_Deforestation\) rather than Kanopi's SJIM plots, and go
# through the same clean() as BNS.
REUSE_RADIUS_KM = 20
REUSE_YYMM = "2609"  # same minting month as every other BNS PlotID
REUSE_SOURCES_DIR = ROOT / "Data Storage" / "TRACT Reuse Sources"
REUSE_MILLS = [
    dict(umlId="PO1000018001", millName="TAMA BUANA JAYA", lat=-2.839995, lon=106.466355),
    dict(umlId="PO1000018007", millName="BANKA AGRO PLANTARI", lat=-2.723663, lon=106.209233),
    dict(umlId="PO1000020091", millName="BHUMI PALMINDO KENCANA", lat=-2.581225, lon=106.12355),
    dict(umlId="PO1000007628", millName="MANGSANG", lat=-2.173, lon=103.987, radius_km=30,
         extra_pool=["SJIM - AGRO SINERGI SUKSES ABADI (on TRACT, defo dropped).geojson"]),
]

MIN_AREA_HA = 0.1
MIN_PART_HA = 0.02
SLIVER_WIDTH_M = 1.5
SIMPLIFY_M = 0.4
COORD_DECIMALS = 6
# MultiPolygon parts closer than PART_GAP_M are pulled PART_CUT_M apart
# (TRACT rejects touching parts; see snap_to_tract_grid).
PART_GAP_M = 0.3
PART_CUT_M = 0.5
M_PER_DEG = 111_320.0


def get_utm_epsg(gdf_4326: gpd.GeoDataFrame) -> str:
    c = gdf_4326.geometry.union_all().centroid
    zone = max(1, min(60, int((float(c.x) + 180.0) / 6.0) + 1))
    return f"EPSG:{(32600 if float(c.y) >= 0 else 32700) + zone}"


def fill_holes(geom):
    if geom is None or geom.is_empty:
        return None
    geom = force_2d(geom)
    try:
        geom = make_valid(geom)
    except Exception:
        try:
            geom = geom.buffer(0)
        except Exception:
            return None
    if geom is None or geom.is_empty:
        return None
    gtype = geom.geom_type
    if gtype == "Polygon":
        return Polygon(geom.exterior) if geom.exterior and not geom.exterior.is_empty else None
    if gtype == "MultiPolygon":
        parts = [Polygon(p.exterior) for p in geom.geoms if p is not None and not p.is_empty and p.exterior]
        if not parts:
            return None
        return parts[0] if len(parts) == 1 else MultiPolygon(parts)
    if gtype == "GeometryCollection":
        polys = []
        for g in geom.geoms:
            cleaned = fill_holes(g)
            if cleaned is None or cleaned.is_empty:
                continue
            polys.extend([cleaned] if cleaned.geom_type == "Polygon" else list(cleaned.geoms))
        if not polys:
            return None
        return polys[0] if len(polys) == 1 else MultiPolygon(polys)
    return None


def _polygons(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for g in geom.geoms for p in _polygons(g)]
    return []


def _grid_ring(p: Polygon, ndigits: int) -> Polygon | None:
    """Exterior ring rounded to the grid, or None if it isn't a simple,
    valid ring there — the exact check TRACT runs (see snap_to_tract_grid)."""
    ring = [(round(x, ndigits), round(y, ndigits)) for x, y, *_ in p.exterior.coords]
    if len(set(ring)) < 3 or not LineString(ring).is_simple:
        return None
    out = Polygon(ring)
    return orient(out, sign=1.0) if out.is_valid and out.area > 0 else None


def _close_pair(parts: list[Polygon], tol_deg: float) -> tuple[int, int] | None:
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            if parts[i].distance(parts[j]) < tol_deg:
                return i, j
    return None


def snap_to_tract_grid(geom, ndigits: int = COORD_DECIMALS):
    """snap_to_grid_parts(), plus TRACT's second rule: MultiPolygon parts that
    touch are also "Boundary has self-intersections" (round 2 — all 14
    rejected plots were exactly that: a neck narrower than the grid, which
    snap-rounding splits into two parts sharing a vertex). Merging them back
    doesn't survive the grid (a closing doesn't widen a neck), so pull them
    apart instead: cut PART_CUT_M around the larger part out of the smaller
    one, leaving a clear gap — a few m² lost per plot. Drops the plot if the
    parts still sit closer than PART_GAP_M after a few passes."""
    parts = snap_to_grid_parts(geom, ndigits)
    tol = PART_GAP_M / M_PER_DEG
    for _ in range(5):
        pair = _close_pair(parts, tol)
        if pair is None:
            break
        i, j = sorted(pair, key=lambda k: -parts[k].area)
        cut = parts[j].difference(parts[i].buffer(PART_CUT_M / M_PER_DEG, quad_segs=4))
        rest = [p for k, p in enumerate(parts) if k != j]
        parts = rest + snap_to_grid_parts(fill_holes(cut), ndigits)
    else:
        if _close_pair(parts, tol) is not None:
            return None
    # Snapping and the cut above can leave crumbs the earlier MIN_PART_HA pass
    # never saw — TRACT's analysis stage rejects any part under 0.001 ha
    # (round 3: a 0.00001 ha part), so re-apply the cleaner's own part floor.
    parts = [p for p in parts if _approx_ha(p) >= MIN_PART_HA]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def _approx_ha(p: Polygon) -> float:
    """Area of a lon/lat polygon in ha (equirectangular — fine for a floor)."""
    return p.area * M_PER_DEG**2 * math.cos(math.radians(p.centroid.y)) / 10_000.0


def snap_to_grid_parts(geom, ndigits: int = COORD_DECIMALS) -> list[Polygon]:
    """TRACT validates geometry at 6 decimals (~11 cm): 83 of the 84 plots it
    rejected in BNS's first upload round ("Boundary has self-intersections")
    were valid at 7 decimals but self-intersecting once rounded to 6 —
    narrow necks/spikes whose opposite sides sit ~2 cm apart. None of 320
    accepted plots behaved that way. So snap-round with GEOS (which keeps
    the result valid on the grid) instead of naively rounding, write exactly
    6 decimals, and verify every ring on that grid. A part that still fails
    gets one make_valid + re-snap retry, then is dropped."""
    if geom is None or geom.is_empty:
        return []
    grid = 10.0 ** -ndigits
    parts = []
    for p in _polygons(set_precision(geom, grid)):
        fixed = _grid_ring(Polygon(p.exterior), ndigits)
        if fixed is None:
            for q in _polygons(set_precision(make_valid(Polygon(p.exterior)), grid)):
                fixed_q = _grid_ring(Polygon(q.exterior), ndigits)
                if fixed_q is not None:
                    parts.append(fixed_q)
            continue
        parts.append(fixed)
    return parts


def is_sliver_metric(geom, width_m: float) -> bool:
    if geom is None or geom.is_empty:
        return True
    try:
        shrunk = geom.buffer(-width_m, join_style=2, mitre_limit=2.0)
        return shrunk is None or shrunk.is_empty
    except Exception:
        return True


def drop_nested(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, int]:
    if len(gdf) <= 1:
        return gdf, 0
    gdf = gdf.reset_index(drop=True)
    drop_idx = set()
    sindex = gdf.sindex
    geoms = gdf.geometry.values
    for i, geom in enumerate(geoms):
        if i in drop_idx or geom is None or geom.is_empty:
            drop_idx.add(i)
            continue
        for j in sindex.query(geom, predicate="within"):
            if i == j or j in drop_idx:
                continue
            other = geoms[j]
            if other is None or other.is_empty:
                continue
            try:
                if geom.within(other) or (geom.covered_by(other) and not other.covered_by(geom)):
                    drop_idx.add(i)
                    break
            except Exception:
                continue
    if drop_idx:
        gdf = gdf.drop(index=list(drop_idx)).reset_index(drop=True)
    return gdf, len(drop_idx)


def clean(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, dict]:
    stats = dict(input=len(gdf), invalid=0, small_part=0, sliver=0, nested=0, small_feature=0)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf["_orig_fid"] = range(len(gdf))

    gdf["geometry"] = gdf.geometry.apply(fill_holes)
    before = len(gdf)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    stats["invalid"] = before - len(gdf)

    gdf = gdf.explode(index_parts=False).reset_index(drop=True)
    gdf["geometry"] = gdf.geometry.apply(fill_holes)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()

    utm = get_utm_epsg(gdf)
    gdf_m = gdf.to_crs(utm)

    small = gdf_m.geometry.area / 10_000.0 < MIN_PART_HA
    stats["small_part"] = int(small.sum())
    gdf_m = gdf_m.loc[~small].copy()

    sliver = gdf_m.geometry.apply(lambda g: is_sliver_metric(g, SLIVER_WIDTH_M))
    stats["sliver"] = int(sliver.sum())
    gdf_m = gdf_m.loc[~sliver].copy()

    gdf_m["geometry"] = gdf_m.geometry.simplify(SIMPLIFY_M, preserve_topology=True).apply(fill_holes)
    gdf_m = gdf_m[gdf_m.geometry.notna() & ~gdf_m.geometry.is_empty].copy()

    gdf_m, stats["nested"] = drop_nested(gdf_m)

    def _union_parts(s):
        geoms = [g for g in s if g is not None and not g.is_empty]
        if not geoms:
            return None
        if len(geoms) == 1:
            return geoms[0]
        try:
            u = geoms[0]
            for g in geoms[1:]:
                u = u.union(g)
            return fill_holes(make_valid(u))
        except Exception:
            return MultiPolygon(geoms)

    prop_cols = [c for c in gdf_m.columns if c not in ("geometry", "_orig_fid")]
    grouped = (
        gdf_m.groupby("_orig_fid", sort=True)
        .agg({**{c: "first" for c in prop_cols}, "geometry": _union_parts})
        .reset_index(drop=True)
    )
    grouped = gpd.GeoDataFrame(grouped, geometry="geometry", crs=utm)
    grouped = grouped[grouped.geometry.notna() & ~grouped.geometry.is_empty].copy()

    grouped["Area"] = grouped.geometry.area / 10_000.0
    small_feat = grouped["Area"] < MIN_AREA_HA
    stats["small_feature"] = int(small_feat.sum())
    grouped = grouped.loc[~small_feat].copy()

    out = grouped.to_crs(4326)
    out["geometry"] = out.geometry.apply(lambda g: snap_to_tract_grid(fill_holes(g)))
    before = len(out)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    stats["tract_grid"] = before - len(out)
    out["Area"] = (out.to_crs(utm).geometry.area / 10_000.0).round(4)
    stats["output"] = len(out)
    stats["area_ha"] = float(out["Area"].sum())
    return out, stats


def write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
    payload = json.loads(gdf.to_json(drop_id=True, to_wgs84=True))
    payload.pop("crs", None)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def write_master_data(path: Path, node_id: str, area_ha: float) -> None:
    shutil.copyfile(TEMPLATE_XLSX, path)
    wb = load_workbook(path)
    ws = wb["2. Farmer_Groups Template"]
    ws["A3"] = node_id
    ws["B3"] = round(area_ha, 4)
    ws["C3"] = "Indonesia"
    ws["D3"] = None
    ws["E3"] = None
    ws["F3"] = 20
    ws["G3"] = node_id
    wb.save(path)


DEF_YEAR_KEYS = ["Def_21", "Def_22", "Def_23", "Def_24", "Def_25", "Def_26"]


def load_tract_defo_ids() -> set[str]:
    """PlotIDs TRACT's own deforestation check flagged, from every saved
    report page (one giant-line HTML table, one row per plot:
    `<td>PlotID</td><td>...<p>Deforestation detected</p>` — the same format
    SJIM's process_defo_report.py parsed). Those plots are excluded from the
    export and the master data area, so re-running this keeps them out."""
    row = re.compile(r"<td[^>]*>([A-Za-z0-9\-]+)</td><td[^>]*>.*?<p[^>]*>([^<]+)</p>", re.DOTALL)
    ids = set()
    for f in sorted(DEFO_REPORT_DIR.glob("*.htm*")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        ids |= {pid for pid, status in row.findall(text) if "deforestation" in status.lower()}
    return ids


def _bps_prefix(id_bps) -> str:
    digits = re.sub(r"\D", "", str(id_bps or ""))
    return digits.ljust(6, "0") if len(digits) < 6 else digits[:6]


def mint_plot_ids(gdf: gpd.GeoDataFrame, uml_id: str, yymm: str) -> list[str]:
    """Same scheme as prepare-bns-plots.mjs's assignPlotIds(): grouped by
    ID_BPS_2020 prefix, numbered north-to-south / west-to-east per group."""
    ids = [None] * len(gdf)
    groups: dict[str, list[int]] = {}
    for i, v in enumerate(gdf["ID_BPS_2020"]):
        groups.setdefault(_bps_prefix(v), []).append(i)
    lat = [float(v or 0) for v in gdf["LAT"]]
    lon = [float(v or 0) for v in gdf["LON"]]
    for prefix, idx in groups.items():
        idx.sort(key=lambda i: (-lat[i], lon[i]))
        for seq, i in enumerate(idx, start=1):
            ids[i] = f"IDN{prefix}-{uml_id}-{yymm}-{seq:04d}"
    return ids


def load_extra_pool(filename: str) -> gpd.GeoDataFrame:
    """A plot file from another chain's TRACT package, harmonized to the BNS
    field names mint_plot_ids()/the report rely on and run through the same
    clean() (geometry rules + 6-decimal grid) as every BNS plot."""
    gdf = gpd.read_file(REUSE_SOURCES_DIR / filename).to_crs(4326)
    gdf = gdf[gdf["EUDR_Comply"] == "YES"].copy()
    renames = {"village_id_bps": "ID_BPS_2020", "LATITUDE": "LAT", "LONGITUDE": "LON"}
    gdf = gdf.rename(columns={k: v for k, v in renames.items() if k in gdf.columns and v not in gdf.columns})
    cleaned, _ = clean(gdf)
    return cleaned


def export_reuse_mills(pool: gpd.GeoDataFrame, defo_ids: set[str], defo_rows: list[dict]) -> list[dict]:
    rows = []
    for rm in REUSE_MILLS:
        uml = rm["umlId"]
        radius_km = rm.get("radius_km", REUSE_RADIUS_KM)
        node_id = f"2026-IDN-{uml[2:]}-1"
        mill_pool = pool
        if rm.get("extra_pool"):
            extra = [load_extra_pool(f) for f in rm["extra_pool"]]
            mill_pool = gpd.GeoDataFrame(pd.concat([pool, *extra], ignore_index=True), geometry="geometry", crs=4326)
        center = gpd.GeoSeries([Point(rm["lon"], rm["lat"])], crs=4326)
        utm = get_utm_epsg(center.to_frame("geometry"))
        buf = center.to_crs(utm).iloc[0].buffer(radius_km * 1000)
        picked = mill_pool[mill_pool.to_crs(utm).within(buf)].copy().reset_index(drop=True)
        if picked.empty:
            print(f"  REUSE {rm['millName']}: no plot within {radius_km} km, skipped")
            continue
        sources = picked["Mill_name"].value_counts().to_dict()
        picked["Source_PlotID"] = picked["PlotID"]
        picked["PlotID"] = mint_plot_ids(picked, uml, REUSE_YYMM)
        # TRACT's deforestation check may flag a reused plot under its new
        # PlotID (or, for a non-BNS source, its original one).
        flagged = picked["PlotID"].isin(defo_ids) | picked["Source_PlotID"].isin(defo_ids)
        for _, p in picked[flagged].iterrows():
            defo_rows.append(dict(mill=rm["millName"], PlotID=p["PlotID"], Area=p["Area"],
                                  kanopi_max_def_ha=max(float(p.get(k) or 0) for k in DEF_YEAR_KEYS)))
        picked = picked[~flagged].copy()
        picked["UML_ID"] = uml
        picked["Mill_name"] = rm["millName"]
        picked["Mill_Name"] = rm["millName"]
        picked["NodeID"] = node_id
        safe_name = re.sub(r'[\\/:*?"<>|]', "-", rm["millName"]).strip()
        write_geojson(picked, OUT_GEOJSON / f"{safe_name}.geojson")
        area = float(picked["Area"].sum())
        write_master_data(
            OUT_MASTERDATA / f"farmer_group_master_data_{safe_name}_{CRUSHER_CODE}.xlsx", node_id, area
        )
        rows.append(dict(mill=rm["millName"], uml_id=uml, node_id=node_id, radius_km=radius_km,
                         plots=len(picked), tract_defo=int(flagged.sum()), area_ha=round(area, 4),
                         source_mills=json.dumps(sources, ensure_ascii=False)))
        print(f"  REUSE {rm['millName']:34} {len(picked):6} plots, {area:10.2f} ha  [{node_id}]  "
              f"{radius_km} km, from {sources}")
    return rows


def main() -> None:
    mills = json.loads(MILLS_JSON.read_text(encoding="utf-8"))
    mills = mills if isinstance(mills, list) else mills["mills"]
    roster = [m for m in mills if m["group"] == GROUP]

    # Only the generated folders are replaced — OUT_DIR also holds TRACT's
    # error reports and whatever else the user stages there by hand.
    for d in (OUT_GEOJSON, OUT_MASTERDATA):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)

    defo_ids = load_tract_defo_ids()
    print(f"TRACT deforestation report: {len(defo_ids)} flagged PlotIDs")
    defo_rows = []

    report = []
    exported = []
    for m in sorted(roster, key=lambda m: m["millName"]):
        files = sorted(PLOTS_DIR.glob(f"{m['umlId']}__{GROUP}__*.geojson"))
        if not files:
            print(f"  SKIP {m['millName']}: no plot file")
            continue
        gdf = pd.concat([gpd.read_file(f) for f in files], ignore_index=True)
        gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs=4326)
        total = len(gdf)
        gdf = gdf[gdf["EUDR_Comply"] == "YES"].copy()

        node_id = m["nodeId"]
        gdf["NodeID"] = node_id

        cleaned, stats = clean(gdf)
        flagged = cleaned["PlotID"].isin(defo_ids)
        for _, p in cleaned[flagged].iterrows():
            defo_rows.append(dict(
                mill=m["millName"], PlotID=p["PlotID"], Area=p["Area"],
                kanopi_max_def_ha=max(float(p.get(k) or 0) for k in DEF_YEAR_KEYS),
            ))
        cleaned = cleaned[~flagged].copy()
        stats["tract_defo"] = int(flagged.sum())
        stats["output"] = len(cleaned)
        stats["area_ha"] = float(cleaned["Area"].sum())
        safe_name = re.sub(r'[\\/:*?"<>|]', "-", m["millName"]).strip()
        write_geojson(cleaned, OUT_GEOJSON / f"{safe_name}.geojson")
        exported.append(cleaned)
        on_tract = m["umlId"] in ALREADY_ON_TRACT
        if not on_tract:
            write_master_data(
                OUT_MASTERDATA / f"farmer_group_master_data_{safe_name}_{CRUSHER_CODE}.xlsx",
                node_id,
                stats["area_ha"],
            )
        row = dict(mill=m["millName"], uml_id=m["umlId"], node_id=node_id, all_plots=total,
                   compliant=stats["input"], **{k: v for k, v in stats.items() if k != "input"},
                   master_data="already on TRACT" if on_tract else "yes")
        row["area_ha"] = round(row["area_ha"], 4)
        report.append(row)
        print(f"  {m['millName']:45} {total:6} plots -> {stats['input']:6} YES -> {stats['output']:6} exported, "
              f"{stats['area_ha']:10.2f} ha  [{node_id}]{'  (node already on TRACT, no master data)' if on_tract else ''}")

    with open(OUT_DIR / "_export_report.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(report[0].keys()))
        w.writeheader()
        w.writerows(report)

    print("\nReusing exported plots for mills with no plot data:")
    pool = gpd.GeoDataFrame(pd.concat(exported, ignore_index=True), geometry="geometry", crs=4326)
    reuse_rows = export_reuse_mills(pool, defo_ids, defo_rows)
    if reuse_rows:
        with open(OUT_DIR / "_reuse_report.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(reuse_rows[0].keys()))
            w.writeheader()
            w.writerows(reuse_rows)

    with open(OUT_DIR / "_tract_defo_excluded.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["mill", "PlotID", "Area", "kanopi_max_def_ha"])
        w.writeheader()
        w.writerows(defo_rows)
    unmatched = defo_ids - {r["PlotID"] for r in defo_rows}
    print(f"\nTRACT defo: {len(defo_rows)} plots excluded, {len(unmatched)} flagged PlotIDs not in this export")

    print(f"Mills: {len(report)} | all plots: {sum(r['all_plots'] for r in report)} | "
          f"compliant: {sum(r['compliant'] for r in report)} | exported: {sum(r['output'] for r in report)} | "
          f"area: {sum(r['area_ha'] for r in report):.2f} ha")


if __name__ == "__main__":
    main()
