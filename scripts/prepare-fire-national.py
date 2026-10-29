"""
Lookup index for the national FireLine view (every VIIRS hotspot in Indonesia, not only those near our plots):

  private-data/fire/national/index.json     kabupaten/kota polygons (with their province) and named boundaries with their area (ha), in priority order:
                                            Earthline customer boundaries (company + estate), RSPO Grower+Scheme, GFW oil palm
                                            concessions 2014 — for point-in-polygon on the server
  private-data/fire/layers/provinces.geojson province outlines for the map (light)

Sources: Earthline customer boundaries (shapefile, path = first argument; default the copy the user put in FireLine/,
Customer_Boundary_Updated_January 2026), geoBoundaries IDN ADM1/ADM2 (BPS 2020, 34 provinces; copy in PalmTrace/Data Storage/Boundaries/IDN), the RSPO layer
written by prepare-fire-layers.py, and the GFW 2014 copy in D:\\Earthline\\02 Data\\Referensi\\Konsesi Sawit 2026-10 (NOTES.md there).
Kabupaten polygons are grown by ~1 km so coastal hotspots on simplified shorelines still land in a kabupaten.

Run with the system Python (geopandas): python scripts/prepare-fire-national.py ["<customer boundary .shp>"]
Upload afterwards: node --env-file=.env.local scripts/upload-fire-to-r2.mjs --only=national/   (and --only=layers/)
"""
import json, os, re, sys, warnings
warnings.filterwarnings("ignore", message="Geometry is in a geographic CRS")  # the 1 km coastal margin is in degrees on purpose
import geopandas as gpd, pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(HERE, "private-data", "fire")
BND = os.path.join(os.path.dirname(HERE), "PalmTrace", "Data Storage", "Boundaries", "IDN")
SRC = r"D:\Earthline\02 Data\Referensi\Konsesi Sawit 2026-10"
EL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "Customer_Boundary_Updated_January 2026", "Customer_Boundary_Updated_January 2026.shp")
NAT = os.path.join(ROOT, "national"); LAY = os.path.join(ROOT, "layers")
os.makedirs(NAT, exist_ok=True)

# geoBoundaries names (English) -> Indonesian names as written in BPS / PalmTrace.
PROV_ID = {
    "Aceh": "Aceh", "Bali": "Bali", "Bangka-Belitung Islands": "Kepulauan Bangka Belitung", "Banten": "Banten", "Bengkulu": "Bengkulu",
    "Central Java": "Jawa Tengah", "Central Kalimantan": "Kalimantan Tengah", "Central Sulawesi": "Sulawesi Tengah", "East Java": "Jawa Timur",
    "East Kalimantan": "Kalimantan Timur", "East Nusa Tenggara": "Nusa Tenggara Timur", "Gorontalo": "Gorontalo", "Jakarta Special Capital Region": "DKI Jakarta",
    "Jambi": "Jambi", "Lampung": "Lampung", "Maluku": "Maluku", "North Kalimantan": "Kalimantan Utara", "North Maluku": "Maluku Utara",
    "North Sulawesi": "Sulawesi Utara", "North Sumatra": "Sumatera Utara", "Papua": "Papua", "Riau": "Riau", "Riau Islands": "Kepulauan Riau",
    "South Kalimantan": "Kalimantan Selatan", "South Sulawesi": "Sulawesi Selatan", "South Sumatra": "Sumatera Selatan", "Southeast Sulawesi": "Sulawesi Tenggara",
    "Special Region of Yogyakarta": "DI Yogyakarta", "West Java": "Jawa Barat", "West Kalimantan": "Kalimantan Barat", "West Nusa Tenggara": "Nusa Tenggara Barat",
    "West Papua": "Papua Barat", "West Sulawesi": "Sulawesi Barat", "West Sumatra": "Sumatera Barat",
}


def rings(g, nd=4):
    """Polygon / MultiPolygon -> [[outer, *holes], ...] with rounded coordinates."""
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms) if g.geom_type == "MultiPolygon" else []
    out = []
    for p in polys:
        if p.is_empty:
            continue
        rs = [p.exterior, *p.interiors]
        out.append([[[round(x, nd), round(y, nd)] for x, y in r.coords] for r in rs])
    return out


def clean(s):
    s = "" if s is None or (isinstance(s, float) and pd.isna(s)) else " ".join(str(s).split())
    return "" if s.lower() in ("no group", "none", "-", "n/a") else s


a1 = gpd.read_file(os.path.join(BND, "geoBoundaries-IDN-ADM1_simplified.geojson")).to_crs(4326)
a2 = gpd.read_file(os.path.join(BND, "geoBoundaries-IDN-ADM2_simplified.geojson")).to_crs(4326)
a1["id"] = a1.shapeName.map(PROV_ID)
assert a1.id.notna().all(), a1[a1.id.isna()].shapeName.tolist()
prov = sorted(a1.id.tolist())
pidx = {p: i for i, p in enumerate(prov)}
en = dict(zip(a1.id, a1.shapeName))

# Province of each kabupaten: the province holding most of its area.
pts = a2.copy()
pts["geometry"] = a2.geometry.representative_point()
j = gpd.sjoin(pts, a1[["id", "geometry"]], how="left", predicate="within")
a2["prov"] = j.groupby(level=0).id.first()
miss = a2.prov.isna()
if miss.any():  # representative point fell in a gap: nearest province
    near = gpd.sjoin_nearest(pts[miss].to_crs(3857), a1[["id", "geometry"]].to_crs(3857), how="left")
    a2.loc[miss, "prov"] = near.groupby(level=0).id.first()
print("kabupaten:", len(a2), "without province:", int(a2.prov.isna().sum()))

# Grow by ~1 km (0.01 deg) so hotspots on the simplified coast still count, then simplify for speed.
a2g = a2.copy()
a2g["geometry"] = a2.geometry.buffer(0.01, resolution=2).simplify(0.002, preserve_topology=True)
kab = [{"n": r.shapeName, "p": pidx[r.prov], "g": rings(r.geometry)} for r in a2g.itertuples()]

# Named boundaries; the server takes the first that holds a hotspot: Earthline, then RSPO, then GFW 2014.
conc = []
el = gpd.read_file(EL).to_crs(4326)
n_all = len(el)
# Oil palm only (user, 27 Oct 2026): "Oil Palm", "OIl Palm", "Oil Palm & Rubber"; forestry, rubber, mining… left out.
el = el[el.geometry.notna() & el.CROP.fillna("").str.lower().str.contains("oil palm")]
print("Earthline boundaries:", n_all, "rows,", len(el), "oil palm")
el["geometry"] = el.geometry.make_valid().simplify(0.0002, preserve_topology=True)


def code(s):
    """Short company codes (SAM, MPE, PHS, BPP … in the Multi Prima Entakai drone project): the group is the name people know."""
    return not s or len(s) <= 4 and not re.search(r"[a-z]", s)


def junk(s):
    """Rows whose columns slipped: an area figure, 'N/A', an afdeling or division where the group should be."""
    return not s or re.fullmatch(r"[\d.,\s]+|n/?a", s, re.I) or re.match(r"(afdeling|divisi)", s, re.I) or re.search(r"AFD \d", s)


# Not a company group: a placeholder, and a person's name (personal data stays out of the product).
NOT_A_GROUP = {"area1", "mohandas nair"}
el_skipped = []
for r in el.itertuples():
    g = r.geometry
    if g is None or g.is_empty:
        continue
    if g.geom_type == "GeometryCollection":
        g = g.__class__([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
        g = g.buffer(0) if not g.is_empty else g
    company, group, estate = clean(r.COMPANY).strip("- "), clean(r.GROUP), clean(r.ESTATE).strip("- ")
    # Slipped columns (Dharma Satya Nusantara drone rows: GROUP = row number, ESTATE = area, block code in PUBLIC_LIS).
    if junk(group) or group.lower() in NOT_A_GROUP:
        group = ""
    if junk(estate):
        estate = ""
    block = clean(r.PUBLIC_LIS)
    if not estate and re.fullmatch(r"[A-Z]{1,2}\d{1,3}", block):
        estate = f"Blok {block}"
    if code(company):
        name, unit = group or company, " · ".join(x for x in (company, estate) if x and x != group)
    else:
        name, unit = company, estate
    if junk(name) or g.is_empty:
        el_skipped.append(f"{r.Index}: GROUP={group!r} COMPANY={company!r} ESTATE={estate!r} {r.PROVINCE}")
        continue
    conc.append({"s": "el", "c": name, "gr": group if group and group != name else "", "u": unit, "crop": clean(r.CROP), "g": rings(g)})
print("Earthline boundaries:", sum(1 for c in conc if c["s"] == "el"), "kept,", len(el_skipped), "without a usable name:")
for x in el_skipped:
    print("   ", x)

rs = gpd.read_file(os.path.join(LAY, "rspo.geojson"))
gfw = gpd.read_file(os.path.join(SRC, r"GFW oil palm concessions (salinan lpk ArcGIS Online 2021)\extract\commondata\storymap\Oil_Palm_Concessions.shp"))
gfw = gfw[gfw.geometry.notna() & (gfw["country"] == "IDN")].to_crs(4326)
gfw["geometry"] = gfw.geometry.buffer(0).simplify(0.0005, preserve_topology=True)
for r in rs.itertuples():
    if r.geometry is None or r.geometry.is_empty:
        continue
    c = clean(r.Subsidiary) or clean(r.Parent)
    if not c:
        continue
    conc.append({"s": "rspo", "c": c, "gr": clean(r.Parent) if clean(r.Parent) != c else "", "u": clean(r.ManageUnit), "g": rings(r.geometry)})
for r in gfw.itertuples():
    if r.geometry is None or r.geometry.is_empty:
        continue
    c = clean(r.company) or clean(r.name)
    if not c:
        continue
    conc.append({"s": "gfw", "c": c, "gr": clean(r.group_comp), "u": clean(r.name) if clean(r.name) != c else "", "g": rings(r.geometry)})
print("concessions:", sum(1 for c in conc if c["s"] == "rspo"), "RSPO,", sum(1 for c in conc if c["s"] == "gfw"), "GFW 2014")

# Area of every boundary (ha), geodesic-equivalent from its own geometry (equal-area Eckert IV), not copied from the source.
from shapely.geometry import shape
areas = gpd.GeoSeries([shape({"type": "MultiPolygon", "coordinates": c["g"]}) for c in conc], crs=4326).to_crs("ESRI:54012").area / 1e4
for c, ha in zip(conc, areas):
    c["ha"] = round(float(ha), 1)
print("boundary area:", round(float(areas.sum())), "ha")

out = os.path.join(NAT, "index.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"generated": pd.Timestamp.now("UTC").isoformat(), "prov": [{"id": p, "en": en[p]} for p in prov], "kab": kab, "conc": conc}, f, ensure_ascii=False, separators=(",", ":"))
print(out, round(os.path.getsize(out) / 1e6, 1), "MB")

# Province outlines for the map.
a1s = a1.copy()
a1s["geometry"] = a1.geometry.simplify(0.01, preserve_topology=True)
feats = [{"type": "Feature", "properties": {"id": r.id, "en": r.shapeName}, "geometry": {"type": "MultiPolygon", "coordinates": rings(r.geometry, 3)}} for r in a1s.itertuples()]
out = os.path.join(LAY, "provinces.geojson")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
print(out, round(os.path.getsize(out) / 1e6, 1), "MB")
