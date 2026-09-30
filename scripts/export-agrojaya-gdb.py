"""
Exports the AGROJAYA group (ADM tenant) as three file geodatabases, the same
split as the other groups' deliveries:

  AGROJAYA_Mill.gdb          Mill_Point          — the 6 mills as on the platform
  AGROJAYA_Traceability.gdb  Traceability_Area   — 20 km buffers (SINTONG ABADI,
                                                   KWALA SAWIT, SAWIT HULU, OKTA
                                                   PALM OIL) and village areas
                                                   (PULAU TIGA, INDOMAS MITRA TEKNIK)
  AGROJAYA_Plot.gdb          one feature class per mill, the plots as served

Sources: private-data/mills.json + eudr-stats.json and the prepared plot files
(scripts/prepare-agrojaya.mjs); buffers from "Cek UML 30092026\02. Buffer 20 Km";
PULAU TIGA's villages from the Permata KIM traceability areas; INDOMAS MITRA
TEKNIK has no delivered village area (its YORGO polygon is a 20 km buffer), so
its villages are the ones its plots sit in (ID_BPS_2020), cut from the national
village layer (Village Risk Assessment.gdb\\A002_Village) and marked as derived.

Run with ArcGIS Pro's Python:
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" scripts/export-agrojaya-gdb.py
"""
import json
import os

os.environ["TEMP"] = os.environ["TMP"] = r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini\_ArcpyScratch"
import arcpy  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PD = os.path.join(ROOT, "private-data")
CEK = r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini\Cek UML 30092026"
OUT = os.path.join(CEK, "05. GDB AGROJAYA")
VILLAGES = r"D:\000 Work\000 Databases\Village Risk Assessment.gdb\A002_Village"
TMP = os.environ["TEMP"]
WGS = arcpy.SpatialReference(4326)
arcpy.env.overwriteOutput = True

mills = [m for m in json.load(open(os.path.join(PD, "mills.json"), encoding="utf-8")) if m["group"] == "AGROJAYA"]
stats = json.load(open(os.path.join(PD, "eudr-stats.json"), encoding="utf-8"))
SOURCE = {
    "PO1000004567": "Kanopi — copy of Permata / Permata KIM",
    "PO1000004286": "Kanopi — copy of YORGO / YORGO ANUGERAH NUSANTARA",
    "900000000128": "User coordinates; non-UML ID; plots re-ID'd from Kanopi (20 km buffer)",
}


def fc_name(mill_name):
    return "".join(c if c.isalnum() else "_" for c in mill_name.upper()).strip("_")


def write_fc(features, gdb, name, geom):
    path = os.path.join(TMP, f"agro_{name}.geojson")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh)
    arcpy.conversion.JSONToFeatures(path, os.path.join(gdb, name), geometry_type=geom)
    os.remove(path)
    print(f"  {os.path.basename(gdb)}\\{name}: {arcpy.management.GetCount(os.path.join(gdb, name))[0]}")


os.makedirs(OUT, exist_ok=True)
gdbs = {}
for key in ("Mill", "Traceability", "Plot"):
    g = os.path.join(OUT, f"AGROJAYA_{key}.gdb")
    if arcpy.Exists(g):
        arcpy.management.Delete(g)
    arcpy.management.CreateFileGDB(OUT, f"AGROJAYA_{key}.gdb")
    gdbs[key] = g

# 1 — mill points (OKTA's row has coordinates since 30 Sep 11:43).
pts = []
for m in mills:
    s = stats.get(m["id"], {})
    pts.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [m["lon"], m["lat"]]}, "properties": {
        "MILL_NAME": m["millName"], "UML_ID": m["umlId"], "NodeID": m["nodeId"], "GROUP_": m["group"],
        "REFINERY": m["refinery"], "TRACEABILITY_LEVEL": m["traceabilityRaw"], "BUFF_DIST_KM": m["bufferKm"],
        "GROUP_NAME": m["groupName"], "PARENT_COMPANY": m["parentCompany"], "LAT": m["lat"], "LON": m["lon"],
        "PORT": m["port"], "PLOT_COUNT": s.get("totalPlots"), "AREA_HA": round(s.get("totalAreaHa", 0), 2),
        "EUDR_COMPLY_YES": (s.get("comply") or {}).get("yes"), "EUDR_COMPLY_NO": (s.get("comply") or {}).get("no"),
        "SOURCE": SOURCE.get(m["umlId"], "UML.xlsx; plots re-ID'd from Kanopi (20 km buffer)"),
    }})
write_fc(pts, gdbs["Mill"], "Mill_Point", "POINT")

# 2 — traceability areas.
areas = []
by_uml = {m["umlId"]: m for m in mills}
for f in ("Buffer_20km_3Mill.geojson", "Buffer_20km_OKTA_PALM_OIL.geojson"):
    for ft in json.load(open(os.path.join(CEK, "02. Buffer 20 Km", f), encoding="utf-8"))["features"]:
        p = ft["properties"]
        uml = str(p.get("UML_ID") or p.get("UML") or "")
        m = by_uml.get(uml) or next((x for x in mills if x["millName"] in str(p.get("Mill", "")).upper()), None)
        if not m:
            raise SystemExit(f"buffer {f}: can't match {p}")
        areas.append({"type": "Feature", "geometry": ft["geometry"], "properties": {
            "MILL_NAME": m["millName"], "UML_ID": m["umlId"], "METHOD": "Buffer 20 Km",
            "Village": None, "SubDistric": None, "District": None, "Province": None, "ID_BPS_2020": None,
            "NOTE": "Geodesic 20 km buffer around the mill point"}})
permata = json.load(open(os.path.join(PD, "areas", "permata-kim.geojson"), encoding="utf-8"))["features"]
for ft in permata:
    p = ft["properties"]
    if p.get("UML_ID") != "PO1000004567":
        continue
    areas.append({"type": "Feature", "geometry": ft["geometry"], "properties": {
        "MILL_NAME": "PULAU TIGA", "UML_ID": "PO1000004567", "METHOD": p.get("METHOD") or "Village Level",
        "Village": p.get("Village"), "SubDistric": p.get("SubDistric"), "District": p.get("District"),
        "Province": p.get("Province"), "ID_BPS_2020": str(p.get("ID") or p.get("ID_Village") or ""),
        "NOTE": "Delivered village area (Permata KIM)"}})
# INDOMAS: villages its plots sit in.
indomas_plots = json.load(open(os.path.join(PD, "plots", "PO1000004286__AGROJAYA__AGROJAYA.geojson"), encoding="utf-8"))["features"]
ids = sorted({str(f["properties"].get("ID_BPS_2020")) for f in indomas_plots if f["properties"].get("ID_BPS_2020")})
if not ids:
    raise SystemExit("INDOMAS plots carry no ID_BPS_2020")
flds = ["Village", "SubDistric", "District", "Province", "ID_BPS_2020", "SHAPE@"]
found = 0
for v, sd, d, pr, idb, geom in arcpy.da.SearchCursor(VILLAGES, flds, spatial_reference=WGS):
    if str(idb).split(".")[0] not in ids:
        continue
    found += 1
    areas.append({"type": "Feature", "geometry": geom.__geo_interface__, "properties": {
        "MILL_NAME": "INDOMAS MITRA TEKNIK", "UML_ID": "PO1000004286", "METHOD": "Village Level",
        "Village": v, "SubDistric": sd, "District": d, "Province": pr, "ID_BPS_2020": idb,
        "NOTE": "Derived: villages of the mill's plots (no delivered village area)"}})
print(f"  INDOMAS villages from plots: {found} of {len(ids)} ID_BPS_2020 found")
if found != len(ids):
    raise SystemExit("some INDOMAS villages are missing from A002_Village")
write_fc(areas, gdbs["Traceability"], "Traceability_Area", "POLYGON")

# 3 — plots, one feature class per mill.
for m in mills:
    feats = []
    for f in sorted(os.listdir(os.path.join(PD, "plots"))):
        if f.startswith(m["id"] + ".") and f.endswith(".geojson"):
            feats += json.load(open(os.path.join(PD, "plots", f), encoding="utf-8"))["features"]
    write_fc(feats, gdbs["Plot"], fc_name(m["millName"]), "POLYGON")

print("done:", OUT)
