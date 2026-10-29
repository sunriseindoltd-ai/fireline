"""
Context layers for the FireLine map, from the curated sources in
D:\Earthline\02 Data\Referensi\Konsesi Sawit 2026-10 (see NOTES.md there):

  private-data/fire/layers/rspo.geojson     RSPO member concessions, Indonesia, Grower + Scheme (simplified, WGS84)
  private-data/fire/layers/plots-grid.geojson  Earthline plot coverage as 0.02 deg cells (count per cell) for the national view
  private-data/fire/layers/burned-2026.geojson KLHK burned areas 2026 to date (simplified)
  private-data/fire/sales/contacts.json     sales-team attribution (Kalbar OPI workbook), keyed by normalised company name

Run with the system Python (geopandas): python scripts/prepare-fire-layers.py
Upload afterwards: node --env-file=.env.local scripts/upload-fire-to-r2.mjs --only=layers/   (and --only=sales/)
"""
import json, os, re, sys
import geopandas as gpd, pandas as pd

SRC = r"D:\Earthline\02 Data\Referensi\Konsesi Sawit 2026-10"
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "private-data", "fire")
LAY = os.path.join(ROOT, "layers"); SALES = os.path.join(ROOT, "sales")
os.makedirs(LAY, exist_ok=True); os.makedirs(SALES, exist_ok=True)

def write(gdf, path, props, nd=5):
    feats = []
    for i, row in gdf.iterrows():
        g = row.geometry
        if g is None or g.is_empty: continue
        gj = json.loads(json.dumps(g.__geo_interface__))
        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
        gj["coordinates"] = rnd(gj["coordinates"])
        feats.append({"type": "Feature", "id": int(row[props[0]]) if isinstance(row[props[0]], (int,)) else i, "properties": {k: (None if pd.isna(row[k]) else row[k]) for k in props}, "geometry": gj})
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    print(path, len(feats), "features", round(os.path.getsize(path) / 1e6, 1), "MB")

# 1. RSPO Grower + Scheme (Independent Smallholder plots are 92k tiny polygons: left out of the map layer).
rs = gpd.read_file(os.path.join(SRC, r"RSPO GeoRSPO master data (ArcGIS, 2026-10-20)\rspo_concessions_indonesia.geojson"))
rs = rs[rs.geometry.notna() & rs["MemberCat"].isin(["Grower", "Scheme Smallholder"])].copy()
rs["ha"] = (rs.to_crs("ESRI:54034").area / 1e4).round(0)
rs["geometry"] = rs.geometry.simplify(0.0004, preserve_topology=True)
rs = rs[~rs.geometry.is_empty]
rs = rs.rename(columns={"FID": "fid"})
write(rs, os.path.join(LAY, "rspo.geojson"), ["fid", "Parent", "Subsidiary", "ManageUnit", "MemberCat", "MemberYear", "Province", "ha"], nd=5)
print("RSPO groups:", rs["Parent"].nunique(), "| ha", int(rs["ha"].sum()))

# 2. Earthline plot coverage grid from the FireLine cells (bbox centres), 0.02 deg.
import glob
cells = os.path.join(ROOT, "v2", "cells")
seen = set(); grid = {}
for f in glob.glob(os.path.join(cells, "*.json")):
    for p in json.load(open(f, encoding="utf-8")):
        if p["id"] in seen: continue
        seen.add(p["id"])
        b = p["bbox"]; x = (b[0] + b[2]) / 2; y = (b[1] + b[3]) / 2
        k = (int(x // 0.02), int(y // 0.02))
        c = grid.setdefault(k, [0, 0, 0])  # n, company-type n, smallholder n
        c[0] += 1
        if p.get("type") == "Company": c[1] += 1
        elif p.get("type") in ("Scheme Smallholder", "Smallholder", "Outgrower"): c[2] += 1
feats = [{"type": "Feature", "properties": {"n": v[0], "co": v[1], "sh": v[2]}, "geometry": {"type": "Point", "coordinates": [round((kx + 0.5) * 0.02, 4), round((ky + 0.5) * 0.02, 4)]}} for (kx, ky), v in grid.items()]
with open(os.path.join(LAY, "plots-grid.geojson"), "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
print("plots-grid", len(feats), "cells from", len(seen), "plots", round(os.path.getsize(os.path.join(LAY, "plots-grid.geojson")) / 1e6, 1), "MB")

# 3. KLHK burned area 2026 (Jan–Jul), simplified.
ba = gpd.read_file(os.path.join(SRC, r"KLHK Areal Kebakaran (geoportal planologi, 2026-10-20)\areal_kebakaran_2026_periode_berjalan.geojson"))
ba = ba[ba.geometry.notna()].copy()
ba["ha"] = (ba.to_crs("ESRI:54034").area / 1e4).round(1)
ba["geometry"] = ba.geometry.simplify(0.0005, preserve_topology=True)
ba = ba[~ba.geometry.is_empty]
ba["oid"] = range(len(ba))
write(ba, os.path.join(LAY, "burned-2026.geojson"), ["oid", "KET", "PERIODE", "AKURASI", "ha"], nd=5)

# 4. Sales attribution (Kalbar OPI). Personal contact fields stay server-side; served only to signed-in users.
df = pd.read_excel(os.path.join(SRC, r"Tim Sales\Kalbar OPI Archive Searching.xlsx"), sheet_name=0)
df.columns = [str(c).strip() for c in df.columns]
def norm(s):
    s = re.sub(r"\b(pt|plasma|tbk|cv|group|grup)\b", " ", str(s).lower())
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())
out = {}
for _, r in df.iterrows():
    k = norm(r["COMPANY"])
    if not k: continue
    rec = out.setdefault(k, {"company": r["COMPANY"], "group": r.get("GROUP"), "estates": [], "contacts": []})
    rec["estates"].append({"rights": r.get("TIPE_HAK"), "district": r.get("District"), "province": r.get("Province"), "ha": None if pd.isna(r.get("HA")) else round(float(r["HA"])), "archive": r.get("Comments"), "deck": r.get("Link")})
    if isinstance(r.get("Contact Person"), str) and r["Contact Person"].strip():
        # One cell may hold several people separated by line breaks (name / position / phone line up by index).
        lines = lambda v: [] if (v is None or (isinstance(v, float) and pd.isna(v))) else [x.strip() for x in str(v).replace("\r", "").split("\n") if x.strip()]
        names, poss, phones, mails = lines(r["Contact Person"]), lines(r.get("Position")), lines(r.get("Phone Number")), lines(r.get("Email"))
        addr = " ".join(lines(r.get("Address"))) or None
        for i, nm in enumerate(names):
            pick = lambda arr: (arr[i] if i < len(arr) else (arr[0] if len(arr) == 1 and len(names) == 1 else None))
            c = {"name": nm, "position": pick(poss), "phone": pick(phones), "email": pick(mails), "address": addr}
            if c not in rec["contacts"]: rec["contacts"].append(c)
def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    if isinstance(o, float) and pd.isna(o): return None
    return o
json.dump({"source": "Tim sales Earthline, Kalbar OPI Archive Searching.xlsx (20 Oct 2026)", "companies": clean(out)}, open(os.path.join(SALES, "contacts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("sales contacts:", len(out), "companies,", sum(len(v["contacts"]) for v in out.values()), "contacts")
