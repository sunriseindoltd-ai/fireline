"""
Merges the plots PalmTrace serves for a supply chain (ADM tenant,
private-data/plots/<millId>[.partN].geojson) into ONE feature class per group
and writes it to a new file geodatabase in that group's delivery folder:

  <delivery>\\<group folder>\\PalmTrace Plot (<date>)\\<GROUP>_Plot.gdb\\Plot

Per group the attributes are the union of the mills' attributes, with:
  - processing leftovers dropped (OBJECTID, Join_Count, TARGET_FID, FID_*,
    ROW_UID, SRC_ROW_ID, _dist_to_mill_km, _mit/_ncr (raw MULTIAGRO columns,
    already folded into Risk_Mitigation_Class/Desc_Issue), Shape_Length/Shape_Area — the gdb
    computes its own),
  - names that only differ in case merged (a gdb is case-insensitive):
    Mill_name/Mill_Name, Hectarage/HECTARAGE (BNS 'ha' too),
  - mill identity from mills.json added: Mill_PalmTrace, Mill_UML_ID, Mill_NodeID,
  - GeometryCollections (polygon + zero-area line left by make_valid) reduced to
    their polygons; shapes with a negative area in ArcGIS repaired (ESRI).

Step 1 (this Python: geopandas/pyogrio) writes a temporary FileGDB to the arcpy
scratch folder; step 2 runs ArcGIS Pro's Python to create the gdb.

  python scripts/export-group-plots-gdb.py [DOMAS "NAM & LTS" ...]
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import date

import geopandas as gpd
import pandas as pd
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PD = os.path.join(ROOT, "private-data")
DELIV = r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini"
SCRATCH = os.path.join(DELIV, "_ArcpyScratch")
ARCPY = r"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
TODAY = date.today().isoformat()

GROUPS = {  # platform group -> (delivery folder, gdb prefix)
    "NAM & LTS": ("01. NAM", "NAM_LTS"),
    "DOMAS": ("02. DOMAS", "DOMAS"),
    "YORGO": ("03. YORGO", "YORGO"),
    "SUNRISE": ("04. SUNRISE", "SUNRISE"),
    "BNS": ("05. BNS", "BNS"),
    "Permata": ("10. PERMATA - All Mill", "PERMATA"),
}
DROP = {"OBJECTID", "OBJECTID_1", "Join_Count", "TARGET_FID", "ROW_UID", "SRC_ROW_ID",
        "_dist_to_mill_km", "_mit", "_ncr", "Shape_Length", "Shape_Area", "Shape_Leng"}
# Same meaning, different spelling -> first name wins, others fill its gaps.
ALIASES = {"Mill_name": ["Mill_Name", "MILL_NAME"], "Hectarage": ["HECTARAGE", "ha"]}

mills = {m["id"]: m for m in json.load(open(os.path.join(PD, "mills.json"), encoding="utf-8"))}


def to_multi(g):
    if isinstance(g, Polygon):
        return MultiPolygon([g])
    if isinstance(g, GeometryCollection) and not isinstance(g, MultiPolygon):
        # make_valid leftovers: polygon + zero-area line -> keep the polygons
        polys = [p for x in g.geoms for p in (x.geoms if isinstance(x, MultiPolygon) else [x]) if isinstance(p, Polygon)]
        return MultiPolygon(polys)
    return g


def build(group):
    folder, prefix = GROUPS[group]
    files = sorted(f for f in os.listdir(os.path.join(PD, "plots"))
                   if f.endswith(".geojson") and f.split("__")[1] == group)
    parts = []
    for f in files:
        mid = f[: -len(".geojson")].split(".part")[0]
        m = mills[mid]
        df = gpd.read_file(os.path.join(PD, "plots", f), engine="pyogrio")
        df = df.set_crs(4326, allow_override=True)  # CRS84 vs EPSG:4326 — GeoJSON is lon/lat either way
        df["Mill_PalmTrace"] = m["millName"]
        df["Mill_UML_ID"] = m["umlId"]
        df["Mill_NodeID"] = m["nodeId"]
        parts.append(df)
    gdf = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs="EPSG:4326")
    gdf = gdf.drop(columns=[c for c in gdf.columns if c in DROP or c.startswith("FID_")])
    for keep, others in ALIASES.items():
        for o in others:
            if o in gdf.columns:
                gdf[keep] = gdf[keep].combine_first(gdf[o]) if keep in gdf.columns else gdf[o]
                gdf = gdf.drop(columns=[o])
    low = {}
    for c in gdf.columns:
        if c.lower() in low:
            raise SystemExit(f"{group}: columns differ only in case: {low[c.lower()]} / {c}")
        low[c.lower()] = c
    # Mixed-type columns (number in one mill, text in another) -> text.
    for c in gdf.columns:
        if c == "geometry" or gdf[c].dtype != object:
            continue
        kinds = {type(v) for v in gdf[c].dropna()}
        if len(kinds) > 1:
            gdf[c] = gdf[c].map(lambda v: None if pd.isna(v) else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)))
    n_gc = int((gdf.geom_type == "GeometryCollection").sum())
    gdf["geometry"] = gdf.geometry.map(to_multi)
    if n_gc:
        print(f"  {group}: {n_gc} GeometryCollection -> polygon parts only", flush=True)
    bad = gdf[gdf.geom_type != "MultiPolygon"]
    if len(bad):
        raise SystemExit(f"{group}: non-polygon geometry {bad.geom_type.value_counts().to_dict()}")
    lead = [c for c in ("PlotID", "NodeID", "Mill_name", "UML_ID", "Mill_PalmTrace", "Mill_UML_ID", "Mill_NodeID",
                        "COMPANY", "GROUP_", "TYPE", "Hectarage", "EUDR_Comply", "Risk_Mitigation_Class", "Desc_Issue")
            if c in gdf.columns]
    gdf = gdf[lead + [c for c in gdf.columns if c not in lead and c != "geometry"] + ["geometry"]]

    # Via a GDAL-written FileGDB: arcpy refuses OGC-invalid rings read from a
    # GeoPackage ("Shape integrity error"); shapes are passed on unchanged.
    tmp_gdb = os.path.join(SCRATCH, f"plots_{prefix}_tmp.gdb")
    if os.path.exists(tmp_gdb):
        shutil.rmtree(tmp_gdb)
    gdf.to_file(tmp_gdb, layer="Plot", driver="OpenFileGDB", engine="pyogrio", geometry_type="MultiPolygon")
    out_dir = os.path.join(DELIV, folder, f"PalmTrace Plot ({TODAY})")
    print(f"{group}: {len(files)} files, {gdf['Mill_PalmTrace'].nunique()} mills, {len(gdf):,} plots, "
          f"{len(gdf.columns) - 1} fields -> {out_dir}", flush=True)
    return tmp_gdb, out_dir, f"{prefix}_Plot.gdb", len(gdf)


ARC = r'''
import os, sys
os.environ["TEMP"] = os.environ["TMP"] = sys.argv[1]
import arcpy
tmp_gdb, out_dir, gdb_name, n = sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
arcpy.env.overwriteOutput = True
os.makedirs(out_dir, exist_ok=True)
gdb = os.path.join(out_dir, gdb_name)
if arcpy.Exists(gdb):
    arcpy.management.Delete(gdb)
arcpy.management.CreateFileGDB(out_dir, gdb_name)
arcpy.conversion.ExportFeatures(os.path.join(tmp_gdb, "Plot"), os.path.join(gdb, "Plot"))
fc = os.path.join(gdb, "Plot")
# Figure-eight rings whose net orientation reads as a hole get a negative area
# in ArcGIS; repair only those (a handful), leave every other shape as served.
neg = [oid for oid, a in arcpy.da.SearchCursor(fc, ["OID@", "SHAPE@AREA"]) if a < 0]
if neg:
    lyr = arcpy.management.MakeFeatureLayer(fc, "neg", f"OBJECTID IN ({','.join(map(str, neg))})")
    arcpy.management.RepairGeometry(lyr, "KEEP_NULL", "ESRI")
    arcpy.management.Delete(lyr)
    print("   repaired negative-area shapes:", len(neg))
got = int(arcpy.management.GetCount(fc)[0])
print("  ", gdb, "Plot:", got)
if got != n:
    raise SystemExit(f"count mismatch {got} != {n}")
'''

if __name__ == "__main__":
    todo = sys.argv[1:] or list(GROUPS)
    script = os.path.join(SCRATCH, "export_group_plots_arc.py")
    with open(script, "w", encoding="utf-8") as fh:
        fh.write(ARC)
    for g in todo:
        tmp_gdb, out_dir, gdb_name, n = build(g)
        subprocess.run([ARCPY, script, SCRATCH, tmp_gdb, out_dir, gdb_name, str(n)], check=True)
        shutil.rmtree(tmp_gdb)
    os.remove(script)
