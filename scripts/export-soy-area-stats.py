"""SoyTrace: compliant and non-compliant soybean fields per State, County and City/Town/Township, as an Excel
workbook for ADM management.

Sources (nothing recomputed from ArcGIS):
  Data Storage/ADM Soy/Data Baru/Soy_National1825.gdb   every 2025 US soybean field (USDA NASS CSB, ADM delivery)
  private-data/tenants/adm-soy/fields/units/*.geojson   the supply chain's compliant fields + catchments (k)
  private-data/tenants/adm-soy/fields/noncomply.geojson ADM's non-compliant list (k = catchments, "" = none)
  private-data/tenants/adm-soy/supply.json              facility names, catchment figures
  Data Storage/ADM Soy/Boundaries/cb_2024_us_cousub_500k.zip  US Census county subdivisions (township/city/town/CCD)

Each field is placed by its interior point (USDA INSIDE_X/Y, or the outline's centroid) in a Census county
subdivision, so subdivision, county and state rows add up.

Usage: python scripts/export-soy-area-stats.py [out.xlsx]
"""
import collections
import glob
import json
import os
import re
import sys
import time

import fiona
import numpy as np
import shapely
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from pyproj import CRS, Transformer
from shapely.geometry import shape

t0 = time.time()
log = lambda m: print(f"[soy-area-stats {time.time() - t0:5.0f}s] {m}", flush=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = os.path.join(ROOT, "private-data", "tenants", "adm-soy")
NATIONAL = os.path.join(ROOT, "Data Storage", "ADM Soy", "Data Baru", "Soy_National1825.gdb")
COUSUB = os.path.join(ROOT, "Data Storage", "ADM Soy", "Boundaries", "cb_2024_us_cousub_500k.zip")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "Downloads", "ADM Soy - Fields by State, County and Township (9 Oct 2026).xlsx")

supply = json.load(open(os.path.join(TENANT, "supply.json"), encoding="utf-8"))

# ------------------------------------------------------------------ non-compliant (ADM's list)
nc_fc = json.load(open(os.path.join(TENANT, "fields", "noncomply.geojson"), encoding="utf-8"))["features"]
nc_ids = {str(f["properties"]["id"]) for f in nc_fc}
log(f"non-compliant list: {len(nc_fc):,} fields")

# ------------------------------------------------------------------ supply chain (compliant, in catchments)
inside = {}  # id -> [acres, set(catchment units), geometry-or-None]
for path in sorted(glob.glob(os.path.join(TENANT, "fields", "units", "*.geojson"))):
    if re.search(r"\.part\d+\.geojson$", path):
        continue
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        p = f["properties"]
        fid = str(p["id"])
        ks = {k for k in str(p.get("k") or "").split("|") if k}
        hit = inside.get(fid)
        if hit is None:
            inside[fid] = [float(p.get("a") or 0), ks, f["geometry"]]
        else:
            hit[1] |= ks
log(f"supply chain: {len(inside):,} compliant fields in catchments")

# ------------------------------------------------------------------ every US soybean field (attributes only)
ids, acres, xs, ys = [], [], [], []
with fiona.open(NATIONAL, layer="Soy_National1825", ignore_geometry=True) as src:
    natcrs = CRS.from_wkt(src.crs_wkt)
    for f in src:
        p = f["properties"]
        ids.append(str(p["CSBID"]))
        acres.append(float(p["CSBACRES"] or 0))
        xs.append(p["INSIDE_X"])
        ys.append(p["INSIDE_Y"])
lon, lat = Transformer.from_crs(natcrs, "EPSG:4269", always_xy=True).transform(np.array(xs, float), np.array(ys, float))
nat_index = {fid: i for i, fid in enumerate(ids)}
log(f"national: {len(ids):,} fields")

# Points to place: every national field + supply-chain fields missing from it + the non-compliant fields.
rec_id, rec_ac, rec_nc, rec_x, rec_y = [], [], [], [], []
for i, fid in enumerate(ids):
    rec_id.append(fid)
    rec_ac.append(acres[i])
    rec_nc.append(fid in nc_ids)
    rec_x.append(lon[i])
    rec_y.append(lat[i])
missing = [fid for fid in inside if fid not in nat_index]
for fid in missing:
    c = shapely.get_coordinates(shapely.point_on_surface(shape(inside[fid][2])))[0]
    rec_id.append(fid)
    rec_ac.append(inside[fid][0])
    rec_nc.append(fid in nc_ids)
    rec_x.append(c[0])
    rec_y.append(c[1])
nc_extra = 0
nc_place = {}
for f in nc_fc:
    fid = str(f["properties"]["id"])
    c = shapely.get_coordinates(shapely.point_on_surface(shape(f["geometry"])))[0]
    nc_place[fid] = c
    if fid not in nat_index and fid not in inside:
        rec_id.append(fid)
        rec_ac.append(float(f["properties"].get("a") or 0))
        rec_nc.append(True)
        rec_x.append(c[0])
        rec_y.append(c[1])
        nc_extra += 1
log(f"supply-chain fields not in the national layer: {len(missing):,}; non-compliant not in it: {nc_extra:,}")

# ------------------------------------------------------------------ place every field in a county subdivision
# Census LSAD codes → the kind of subdivision (the Type column).
LSAD = {"20": "barrio", "21": "borough", "22": "census county division", "23": "census subarea", "24": "subdistrict",
        "25": "city", "26": "county", "27": "district", "28": "district", "29": "precinct", "30": "precinct", "31": "gore",
        "32": "grant", "36": "location", "37": "municipality", "39": "plantation", "41": "barrio-pueblo", "42": "purchase",
        "43": "town", "44": "township", "45": "township", "46": "unorganized territory", "47": "village",
        "49": "charter township", "86": "reservation"}
subs = []
with fiona.open(f"zip://{COUSUB}") as src:
    geoms = []
    for f in src:
        p = f["properties"]
        name, lsad = p["NAME"], p["NAMELSAD"]
        kind = LSAD.get(p["LSAD"]) or (lsad[len(name):].strip() if lsad.startswith(name) else "")
        subs.append((p["STUSPS"], p["STATE_NAME"], p["NAMELSADCO"], lsad, kind))
        geoms.append(shapely.force_2d(shape(f["geometry"])))
tree = shapely.STRtree(geoms)
pts = shapely.points(np.column_stack([rec_x, rec_y]))
pi, si = tree.query(pts, predicate="intersects")
where = np.full(len(pts), -1)
where[pi] = si  # a point on a shared border takes the last match — one place either way
unplaced = int((where < 0).sum())
log(f"placed {len(pts) - unplaced:,} of {len(pts):,} fields; {unplaced:,} outside every subdivision (nearest used)")
if unplaced:
    loose = np.nonzero(where < 0)[0]
    near = tree.nearest(pts[loose])
    where[loose] = near

# ------------------------------------------------------------------ aggregate
FIELDS = ("cf", "ca", "cif", "cia", "nf", "na", "nif", "nia")
lev = {"state": collections.defaultdict(lambda: dict.fromkeys(FIELDS, 0) | {"k": set()}),
       "county": collections.defaultdict(lambda: dict.fromkeys(FIELDS, 0) | {"k": set()}),
       "sub": collections.defaultdict(lambda: dict.fromkeys(FIELDS, 0) | {"k": set()})}
nc_props = {str(f["properties"]["id"]): f["properties"] for f in nc_fc}
seen = set()
for r in range(len(rec_id)):
    fid = rec_id[r]
    if fid in seen:
        continue
    seen.add(fid)
    st, stname, co, sub, kind = subs[where[r]]
    keys = {"state": (st, stname), "county": (st, stname, co), "sub": (st, stname, co, sub, kind)}
    if rec_nc[r]:
        # Non-compliant: ADM's list; "in catchments" when ADM's field touches one (k).
        np_ = nc_props.get(fid, {})
        a = float(np_.get("a") or rec_ac[r])
        ks = {k for k in str(np_.get("k") or "").split("|") if k}
        for lv, key in keys.items():
            row = lev[lv][key]
            row["nf"] += 1
            row["na"] += a
            if ks:
                row["nif"] += 1
                row["nia"] += a
                row["k"] |= ks
    else:
        sc = inside.get(fid)
        a = rec_ac[r]
        for lv, key in keys.items():
            row = lev[lv][key]
            row["cf"] += 1
            row["ca"] += a
            if sc:
                row["cif"] += 1
                row["cia"] += a
                row["k"] |= sc[1]
tot = {f: sum(v[f] for v in lev["state"].values()) for f in FIELDS}
log("totals: " + ", ".join(f"{k} {v:,.0f}" for k, v in tot.items()))

# ------------------------------------------------------------------ catchment names
plants = {p["key"]: p for p in supply["plants"]}
adm = {e["id"]: e for e in supply["admElevators"]}
adm_dupe = collections.Counter(e["name"] for e in supply["admElevators"])
tps = {e["id"]: e for e in supply["thirdParty"]}


def adm_label(e):
    if adm_dupe[e["name"]] > 1:
        return f"{e['name']} ({(e.get('address') or '').split(',')[0]})"
    return f"{e['name']} ({e.get('city')}, {e.get('state')})"


def tp_label(e):
    return f"{e.get('ref') or e['id']} {e.get('company') or ''} ({e.get('city')}, {e.get('state')})".replace("  ", " ")


def catch_lists(ks):
    pl, ad, tp = [], [], []
    for key, p in plants.items():
        has40 = f"{key}40" in ks
        has80r = f"{key}80r" in ks or f"{key}80" in ks
        city = p.get("city") or p["name"]
        if has40 and has80r:
            pl.append(f"{city} 0–80 NM")
        elif has40:
            pl.append(f"{city} 0–40 NM")
        elif has80r:
            pl.append(f"{city} 40–80 NM")
    for k in sorted(ks, key=lambda x: int(re.sub(r"\D", "", x) or 0)):
        if k in adm:
            ad.append(adm_label(adm[k]))
        elif k in tps:
            tp.append(tp_label(tps[k]))
    return pl, ad, tp


# ------------------------------------------------------------------ workbook
ARIAL = "Arial"
# Two decimals at most; a share too small for that reads "< 0.01%", never 0% (SoyTrace rule).
PCT = '[=0]"0%";[<0.0001]"< 0.01%";0.00%'
F = lambda **kw: Font(name=ARIAL, size=kw.pop("size", 10), **kw)
HEAD_FILL = PatternFill("solid", fgColor="1D1D1F")
TOT_FILL = PatternFill("solid", fgColor="F2F2F2")
OK_FILL = PatternFill("solid", fgColor="E8F5EC")
NC_FILL = PatternFill("solid", fgColor="FBECEA")
thin = Side(style="thin", color="D2D2D7")
wb = Workbook()

COLS = [
    ("Compliant fields (all)", "cf", "#,##0", OK_FILL),
    ("Compliant acres (all)", "ca", "#,##0", OK_FILL),
    ("Compliant fields in catchments", "cif", "#,##0", OK_FILL),
    ("Compliant acres in catchments", "cia", "#,##0", OK_FILL),
    ("% of compliant acres in catchments", "=pct_in", PCT, OK_FILL),
    ("Non-compliant fields (ADM list)", "nf", "#,##0", NC_FILL),
    ("Non-compliant acres (ADM list)", "na", "#,##0", NC_FILL),
    ("Non-compliant fields in catchments", "nif", "#,##0", NC_FILL),
    ("Non-compliant acres in catchments", "nia", "#,##0", NC_FILL),
    ("Non-compliant share of catchment acres", "=nc_share", PCT, NC_FILL),
    ("Catchments (count)", "kn", "#,##0", None),
    ("Crushing plants (buffer)", "kp", "@", None),
    ("ADM elevators (20 NM)", "ka", "@", None),
    ("Third-party facilities (20 NM)", "kt", "@", None),
]


def sheet(title, heading, keycols, rows):
    ws = wb.create_sheet(title)
    n_key = len(keycols)
    allcols = keycols + COLS
    ws["A1"] = heading
    ws["A1"].font = F(size=14, bold=True)
    ws["A2"] = ("Compliant = 2025 soybean fields not on ADM's non-compliant list. In catchments = the field touches a crushing "
                "plant (40 / 80 NM), ADM elevator or third-party facility (20 NM) catchment, each field counted once. See README.")
    ws["A2"].font = F(color="6E6E73")
    hr, tr, first = 5, 4, 6
    last = first + len(rows) - 1
    letter = {}
    for j, (name, key, fmt, fill) in enumerate(allcols, start=1):
        c = ws.cell(hr, j, name)
        c.font = F(bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
        letter[key] = get_column_letter(j)
    ws.row_dimensions[hr].height = 62
    L = letter
    for i, row in enumerate(rows):
        r = first + i
        for j, (name, key, fmt, fill) in enumerate(allcols, start=1):
            if key == "=pct_in":
                v = f'=IFERROR({L["cia"]}{r}/{L["ca"]}{r},"")'
            elif key == "=nc_share":
                v = f'=IFERROR({L["nia"]}{r}/({L["cia"]}{r}+{L["nia"]}{r}),"")'
            else:
                v = row[key]
                if isinstance(v, float):
                    v = round(v, 1)
            c = ws.cell(r, j, v)
            c.font = F()
            if fmt != "@":
                c.number_format = fmt
            if fill is not None:
                c.fill = fill
            c.border = Border(bottom=thin)
    # totals above the header, so sorting and filtering the table leaves them alone
    ws.cell(tr, 1, "Total").font = F(bold=True)
    for j, (name, key, fmt, fill) in enumerate(allcols, start=1):
        if j <= n_key:
            ws.cell(tr, j).fill = TOT_FILL
            continue
        col = get_column_letter(j)
        if key == "=pct_in":
            v = f'=IFERROR({L["cia"]}{tr}/{L["ca"]}{tr},"")'
        elif key == "=nc_share":
            v = f'=IFERROR({L["nia"]}{tr}/({L["cia"]}{tr}+{L["nia"]}{tr}),"")'
        elif fmt == "@" or key == "kn":
            v = None
        else:
            v = f"=SUBTOTAL(9,{col}{first}:{col}{last})"
        c = ws.cell(tr, j, v)
        c.font = F(bold=True)
        c.fill = TOT_FILL
        if fmt != "@":
            c.number_format = fmt
    ws.cell(3, 1, "Totals follow the filter (SUBTOTAL).").font = F(size=9, color="6E6E73")
    ws.auto_filter.ref = f"A{hr}:{get_column_letter(len(allcols))}{last}"
    ws.freeze_panes = ws.cell(first, n_key + 1)
    widths = {"State": 16, "County": 22, "City / Town / Township": 30, "Type": 16}
    for j, (name, key, fmt, fill) in enumerate(allcols, start=1):
        w = widths.get(name, 14 if fmt != "@" else 44)
        if key == "kn":
            w = 11
        ws.column_dimensions[get_column_letter(j)].width = w
    return ws


def rows_of(level, keyfn):
    out = []
    for key, v in lev[level].items():
        pl, ad, tp = catch_lists(v["k"])
        out.append(keyfn(key) | {f: v[f] for f in FIELDS} | {
            "kn": len(pl) + len(ad) + len(tp), "kp": "; ".join(pl), "ka": "; ".join(ad), "kt": "; ".join(tp)})
    # biggest supply-chain share first, then all compliant acres
    out.sort(key=lambda r: (-r["cia"], -r["ca"]))
    return out


wb.remove(wb.active)
readme = wb.create_sheet("README")
sheet("By State", "Soybean fields by State — ADM soy supply chain, 2025",
      [("State", "st", "@", None)], rows_of("state", lambda k: {"st": k[1]}))
sheet("By County", "Soybean fields by County — ADM soy supply chain, 2025",
      [("State", "st", "@", None), ("County", "co", "@", None)], rows_of("county", lambda k: {"st": k[1], "co": k[2]}))
sheet("By City-Town-Township", "Soybean fields by City / Town / Township — ADM soy supply chain, 2025",
      [("State", "st", "@", None), ("County", "co", "@", None), ("City / Town / Township", "sub", "@", None), ("Type", "kind", "@", None)],
      rows_of("sub", lambda k: {"st": k[1], "co": k[2], "sub": k[3], "kind": k[4] or "—"}))

# Catchment index (figures as on the SoyTrace dashboard)
ws = wb.create_sheet("Catchments")
ws["A1"] = "Catchments — figures as on the SoyTrace dashboard"
ws["A1"].font = F(size=14, bold=True)
ws["A2"] = "A field can sit in several catchments: each catchment counts it, so rows here do not add up to the totals."
ws["A2"].font = F(color="6E6E73")
head = ["Catchment", "Type", "Location", "Radius", "Compliant fields", "Compliant acres", "Non-compliant fields", "Non-compliant acres", "Non-compliant share of acres"]
for j, h in enumerate(head, start=1):
    c = ws.cell(4, j, h)
    c.font = F(bold=True, color="FFFFFF")
    c.fill = HEAD_FILL
    c.alignment = Alignment(wrap_text=True, vertical="center")
ws.row_dimensions[4].height = 32
cat = {k["id"]: k for k in supply["catchments"]}
crow = []
for key, p in plants.items():
    for ring, nm in (("40", 40), ("80", 80)):
        k = cat.get(f"{key}{ring}")
        if k:
            crow.append((f"{p['name']} 0–{nm} NM", "Crushing plant", f"{p.get('city')}, {p.get('state')}", f"{nm} NM", k))
for e in supply["admElevators"]:
    k = cat.get(e["id"])
    if k:
        crow.append((adm_label(e), "ADM elevator", f"{e.get('city')}, {e.get('state')}", "20 NM", k))
for e in supply["thirdParty"]:
    k = cat.get(e["id"])
    if k:
        crow.append((tp_label(e), "Third-party facility", f"{e.get('city')}, {e.get('county')} County, {e.get('state')}", "20 NM", k))
for i, (name, kind, loc, rad, k) in enumerate(crow):
    r = 5 + i
    vals = [name, kind, loc, rad, k["compliant"]["fields"], round(k["compliant"]["acres"], 1), k["nonCompliant"]["fields"],
            round(k["nonCompliant"]["acres"], 1), f'=IFERROR(H{r}/(F{r}+H{r}),"")']
    fmts = ["@", "@", "@", "@", "#,##0", "#,##0", "#,##0", "#,##0", PCT]
    for j, (v, fm) in enumerate(zip(vals, fmts), start=1):
        c = ws.cell(r, j, v)
        c.font = F()
        if fm != "@":
            c.number_format = fm
        c.border = Border(bottom=thin)
ws.auto_filter.ref = f"A4:I{4 + len(crow)}"
ws.freeze_panes = "B5"
for j, w in enumerate([44, 18, 34, 9, 14, 14, 14, 14, 14], start=1):
    ws.column_dimensions[get_column_letter(j)].width = w

# README
lines = [
    ("ADM soy supply chain — soybean fields by State, County and City / Town / Township", "title"),
    ("Prepared by Earthline (SoyTrace), 9 October 2026, from ADM's delivery of 7 October 2026.", "sub"),
    ("", None),
    ("What each column means", "h"),
    ("Compliant fields / acres (all): every 2025 soybean field in the area (USDA NASS Crop Sequence Boundaries, single and double crop, as delivered by ADM) that is not on ADM's non-compliant list.", None),
    ("… in catchments: the subset whose outline touches an ADM catchment — a crushing plant's 40 or 80 NM circle, an ADM elevator's or a third-party facility's 20 NM circle. Each field is counted once, however many catchments it touches. These are the fields in the SoyTrace dashboard.", None),
    ("% of compliant acres in catchments: compliant acres in catchments ÷ compliant acres (all).", None),
    ("Non-compliant fields / acres (ADM list): the fields on ADM's non-compliant list located in the area (1,073 in all; some are points without an outline).", None),
    ("… in catchments: those that touch a catchment (268 in all) — the non-compliant figures shown in SoyTrace.", None),
    ("Non-compliant share of catchment acres: non-compliant acres in catchments ÷ (compliant + non-compliant acres in catchments), as in SoyTrace.", None),
    ("Catchments: the catchments the area's fields touch. Crushing plants show the buffer reached: 0–40 NM, 40–80 NM (only beyond 40 NM) or 0–80 NM (both). ADM elevators and third-party facilities have 20 NM catchments; third parties carry their facility number (TP-NN).", None),
    ("", None),
    ("How fields are placed", "h"),
    ("Each field is placed by its interior point (USDA INSIDE_X / INSIDE_Y; the outline's centroid for the few fields not in the national layer) in a US Census 2024 county subdivision (cb_2024_us_cousub_500k). Subdivisions are townships, cities, towns, villages or census county divisions (CCD), depending on the state — the Type column says which.", None),
    ("Because every level uses the same placement, subdivisions add up to counties and counties to states. A field near a boundary counts where its interior point lies, so county figures can differ slightly from USDA's county attribute or SoyTrace's county filter.", None),
    ("Acres: USDA CSB acres (CSBACRES) per field; non-compliant acres as in ADM's list.", None),
    ("", None),
    ("Totals", "h"),
    (f"All US 2025 soybean fields not on ADM's list: {tot['cf']:,.0f} fields, {tot['ca']:,.0f} acres.", None),
    (f"In catchments: {tot['cif']:,.0f} compliant fields, {tot['cia']:,.0f} acres; {tot['nif']:,.0f} non-compliant fields, {tot['nia']:,.0f} acres.", None),
    (f"ADM's non-compliant list: {tot['nf']:,.0f} fields, {tot['na']:,.0f} acres.", None),
    ("", None),
    ("Sheets", "h"),
    ("By State, By County, By City-Town-Township: one row per area with soybean fields, largest supply-chain area first. Use the filter arrows to sort or pick a state; the Total row follows the filter.", None),
    ("Catchments: each catchment with its own figures, as on the dashboard (a field in several catchments is counted in each).", None),
    ("Owner names and addresses are not included.", None),
]
for i, (t, kind) in enumerate(lines, start=1):
    c = readme.cell(i, 1, t)
    c.font = F(size=16, bold=True) if kind == "title" else F(bold=True, size=11) if kind == "h" else F(color="6E6E73") if kind == "sub" else F()
    c.alignment = Alignment(wrap_text=True, vertical="top")
readme.column_dimensions["A"].width = 120
wb.active = 0
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
log(f"rows: states {len(lev['state'])}, counties {len(lev['county']):,}, subdivisions {len(lev['sub']):,}")
log(f"written {OUT}")
json.dump({k: round(v, 1) for k, v in tot.items()}, open(os.path.join(os.path.dirname(OUT), ".soy-area-stats-totals.json"), "w"))
