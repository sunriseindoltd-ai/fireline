"""
Export the LINGGA TIGA SAWIT 2 (PKS Kampung Pajak) plots for the NAM & LTS
group — the replacement for DJAYA GLOBALINDO SENTOSA (Nagamas, 1 Oct 2026:
Djaya is not a supplier).

Input (analysed by the user): Data Storage/NAM - Tambahan/PLOT_LTS_KP_01102026_Analisis/
  PLOT_LTS_KP_01102026.gdb, layer PLOT_LTS_KP_01102026_EUDR_v2 (overlays, EUDR_Comply,
  Describe_Issue, village risk, Risk_Mitigation_Class already computed).
Output: Data Storage/NAM - Plot (GeoJSON)/LINGGA TIGA SAWIT 2.geojson in the same
  property schema as the other NAM files (what scripts/prepare-nam-plots.mjs reads),
  plus NEEDS VERIFICATION/LINGGA TIGA SAWIT 2 - over 100 km.geojson (ADM rule: plots
  more than 100 km from the mill are held back).

Same steps as the first NAM drop's 07_export_to_kanopi.py:
  - Describe_Issue -> Desc_Issue; Hectarage recomputed geodesic (the source `ha`
    column is a joined attribute, not the plot area); LAT/LON = label point.
  - Slivers (< 0.0001 ha) and identical geometries dropped.
  - UML_ID / Mill_name set to the new mill (the source labels every plot
    "PT PRIMA JAYA LESTARI UTAMA" — a leftover; the folder and TTP form are LTS KP).

System Python (fiona, shapely, pyproj). Usage: python scripts/export-nam-lts2.py
"""
import json
import math
import os

import fiona
import shapely
from pyproj import Geod
from shapely.geometry import mapping, shape

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "Data Storage", "NAM - Tambahan", "PLOT_LTS_KP_01102026_Analisis", "PLOT_LTS_KP_01102026.gdb")
LAYER = "PLOT_LTS_KP_01102026_EUDR_v2"
OUT_DIR = os.path.join(ROOT, "Data Storage", "NAM - Plot (GeoJSON)")
OUT = os.path.join(OUT_DIR, "LINGGA TIGA SAWIT 2.geojson")
HELD = os.path.join(OUT_DIR, "NEEDS VERIFICATION", "LINGGA TIGA SAWIT 2 - over 100 km.geojson")

UML_ID = "PO1000017061"          # from the plot file; confirm against UML.xlsx
MILL_NAME = "LINGGA TIGA SAWIT 2"
MILL_LAT, MILL_LON = 2.312175, 99.741939   # TTP form, PKS Kampung Pajak
MAX_KM = 100
SLIVER_HA = 0.0001

KEEP = ["COMPANY", "GROUP_", "TYPE", "UML_ID", "Def_21", "Def_22", "Def_23", "Def_24", "Def_25", "Def_26",
        "CA", "HL", "HP", "HPK", "HPT", "FL_LAIN", "KSA_KPA", "SM", "TAHURA", "TB", "TN", "TWA",
        "Community_F", "Indigenous_F", "Social_F", "EUDR_Comply", "Desc_Issue", "Social_Score", "Social_Risk",
        "Social_Reason", "Physical_Score", "Physical_Risk", "Physical_Reason", "Overall_Score", "Overall_Risk",
        "Village", "SubDistric", "District", "Province", "Country", "Administration", "ID_Dagri_2023",
        "ID_BPS_2020", "Risk_Mitigation_Class", "Mill_name", "Hectarage", "LAT", "LON", "_dist_to_mill_km"]

geod = Geod(ellps="WGS84")


def hav_km(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(x))


def clean(v):
    if isinstance(v, str):
        v = " ".join(v.split())
        return v or None
    return v


def main():
    kept, held = [], []
    seen = set()
    n_in = slivers = dupes = 0
    with fiona.open(SRC, layer=LAYER) as src:
        for f in src:
            n_in += 1
            g = shapely.force_2d(shape(f["geometry"]))
            if not g.is_valid:
                g = shapely.make_valid(g)
            ha = abs(geod.geometry_area_perimeter(g)[0]) / 10_000
            if ha < SLIVER_HA:
                slivers += 1
                continue
            key = shapely.to_wkb(shapely.normalize(g), output_dimension=2)
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            p = dict(f["properties"])
            p["Desc_Issue"] = p.pop("Describe_Issue", "") or ""
            pt = g.representative_point()
            props = {k: clean(p.get(k)) for k in KEEP}
            props.update({
                "UML_ID": UML_ID, "Mill_name": MILL_NAME, "Hectarage": ha,
                "LAT": pt.y, "LON": pt.x,
                "_dist_to_mill_km": round(hav_km(MILL_LAT, MILL_LON, pt.y, pt.x), 1),
                "Desc_Issue": p["Desc_Issue"] or "",
            })
            feat = {"type": "Feature", "geometry": mapping(g), "properties": props}
            (held if props["_dist_to_mill_km"] > MAX_KM else kept).append(feat)
    os.makedirs(os.path.dirname(HELD), exist_ok=True)
    for path, feats in ((OUT, kept), (HELD, held)):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False)
    comply = sum(1 for f in kept if f["properties"]["EUDR_Comply"] == "YES")
    print(f"in {n_in}; slivers {slivers}; identical {dupes}; kept {len(kept)} ({comply} comply, "
          f"{len(kept) - comply} non-comply, {sum(f['properties']['Hectarage'] for f in kept):,.0f} ha); "
          f"held >{MAX_KM} km {len(held)}")


if __name__ == "__main__":
    main()
