"""
Gives SJIM mills that have no plot delivery an estimated supply base: the
Kanopi plots (all supply chains) within a 20 km buffer of the mill, re-
identified to that mill. Same method as AGROJAYA (Cek UML 30092026 /
CEK_UML_NOTES.md §02-§06), user decision 5 Oct 2026: "better some data than
none"; sharing a plot with another SJIM mill is fine, duplicates inside one
mill are not.

Per mill:
  1. 20 km geodesic circle (WGS84, 720 points) around the mills.json point
     (checked against UML.xlsx, 5 Oct).
  2. Every plot in private-data/plots/ that intersects it — except AGROJAYA
     files (re-ID copies of other groups) and the target mills' own files.
  3. Identical geometries: keep one; Src_All_UML_ID / Src_Dup_Count record
     every source mill.
  4. Re-ID: UML_ID, Mill_name, NodeID, Group_Name -> target mill;
     PlotID = <first segment of the source PlotID>-<UML>-2610-<seq>, seq 1..N
     per mill, north to south then west to east. Parent_Com and Refinery (the
     crusher code SJIM plots use, e.g. "SBIM") also follow the target mill.
     `_dist_to_mill_km` / NEAR_DIST / NEAR_FID (measured to the source mill)
     are dropped; Dist_to_Mill_km is added, plus
     Fully_Within_20km / Centroid_Inside_20km.
  5. scripts/dedup-overlaps.py on each mill (>= 50% overlap -> keep largest).
  6. mills.json rows: traceability "buffer", "Buffer 20KM", bufferKm 20.

The platform files carry no Src_* fields (a supplier login must not see which
other mills a plot was first delivered for). Provenance goes to
  Data Storage/SJIM - Buffer 20 km/
    <UML>__<mill>.geojson          final plots + Src_* fields
    Buffer_20km_<mill>.geojson     the circle
    Mapping PlotID SJIM Buffer 20 km.xlsx
Idempotent: target mill files, their overlap-50 records and the folder above
are rebuilt on every run. NOTE: rebuild-sjim-mills.mjs resets the mills.json
rows from the SJIM workbook — re-run this script after it.
Afterwards: prepare-eudr-stats.mjs, then upload the 6 mill ids to R2.

Mill baru: tambahkan ke TARGETS (+ COORDS kalau tidak ada di UML.xlsx) lalu jalankan
dengan --only <uml>[,<uml>] — tanpa --only SEMUA mill dibangun ulang dan PlotID 6 mill
yang sudah di TRACT bisa bergeser.

Usage: python scripts/prepare-sjim-buffer-plots.py [--only 800000000078]
Needs shapely + pyproj + openpyxl (system Python).
"""
import glob
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter

import openpyxl
from pyproj import Geod
from shapely.geometry import Point, Polygon, shape
from shapely.validation import make_valid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MILLS = os.path.join(ROOT, "private-data", "mills.json")
PLOTS = os.path.join(ROOT, "private-data", "plots")
HELD = os.path.join(ROOT, "Data Storage", "NEEDS VERIFICATION", "adm", "overlap-50")
OUT = os.path.join(ROOT, "Data Storage", "SJIM - Buffer 20 km")
RADIUS_M = 20000
YYMM = "2610"
PART_BYTES = 20 * 1024 * 1024

# SJIM mills with no plots in any delivery, coordinates present (5 Oct 2026).
TARGETS = [
    "PO1000020103",  # PERLANG SAWITINDO MAS
    "PO1000009588",  # SEI INAI
    "PO1000020102",  # PT. SELUMA SAWIT MANDIRI
    "PO1000006188",  # BUMI JAYA
    "PO1000017677",  # JAMERAS
    "PO1000004107",  # MUARATOYU SUBUR LESTARI
    "800000000078",  # SINAR RANDU INDAH (9 Okt; non-UML, koordinat dari user)
]
# Koordinat dari user untuk mill yang tidak ada di UML.xlsx — ditulis ke
# mills.json di akhir (rebuild-sjim-mills.mjs tidak tahu koordinat ini).
COORDS = {
    "800000000078": (-4.331106, 105.213407),  # PT SINAR RANDU INDAH, Lampung (user, 9 Okt 2026)
}

geod = Geod(ellps="WGS84")


def circle(lat, lon):
    return Polygon([geod.fwd(lon, lat, i * 0.5, RADIUS_M)[:2] for i in range(720)])


def polygonal(g):
    if not g.is_valid:
        g = make_valid(g)
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    if g.geom_type == "GeometryCollection":
        from shapely.ops import unary_union
        polys = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        return unary_union(polys) if polys else None
    return None


def bbox(geom):
    c = geom["coordinates"]
    while isinstance(c[0][0], list):
        c = [p for part in c for p in part]
    xs = [p[0] for p in c]
    ys = [p[1] for p in c]
    return min(xs), min(ys), max(xs), max(ys)


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', "-", name).strip()


def write_parts(mill_id, features):
    chunks, cur, size = [], [], 2
    for f in features:
        n = len(json.dumps(f, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) + 1
        if cur and size + n > PART_BYTES:
            chunks.append(cur)
            cur, size = [], 2
        cur.append(f)
        size += n
    if cur:
        chunks.append(cur)
    for i, chunk in enumerate(chunks):
        name = f"{mill_id}.geojson" if i == 0 else f"{mill_id}.part{i + 1}.geojson"
        with open(os.path.join(PLOTS, name), "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": chunk}, fh, separators=(",", ":"), ensure_ascii=False)
    return len(chunks)


def read_mill(mill_id):
    feats = []
    for f in sorted(glob.glob(os.path.join(PLOTS, glob.escape(mill_id) + "*.geojson")), key=lambda x: (x.count(".part"), x)):
        if re.fullmatch(re.escape(mill_id) + r"(\.part\d+)?\.geojson", os.path.basename(f)):
            with open(f, encoding="utf-8") as fh:
                feats += json.load(fh)["features"]
    return feats


def main():
    with open(MILLS, encoding="utf-8") as fh:
        mills = json.load(fh)
    targets = {}
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else TARGETS
    for uml in only:
        rows = [m for m in mills if m["group"] == "SJIM" and m["umlId"] == uml]
        if len(rows) == 1 and uml in COORDS:
            rows[0]["lat"], rows[0]["lon"] = COORDS[uml]
        if len(rows) != 1 or not rows[0].get("lat") or not rows[0].get("lon"):
            sys.exit(f"{uml}: expected one SJIM row with coordinates in mills.json")
        m = rows[0]
        targets[m["id"]] = {"mill": m, "buf": circle(m["lat"], m["lon"]), "hits": {}}

    # Clean previous output for the targets.
    os.makedirs(OUT, exist_ok=True)
    for mill_id in targets:
        for f in glob.glob(os.path.join(PLOTS, glob.escape(mill_id) + "*.geojson")):
            if re.fullmatch(re.escape(mill_id) + r"(\.part\d+)?\.geojson", os.path.basename(f)):
                os.remove(f)
        held = os.path.join(HELD, f"{mill_id}.geojson")
        if os.path.exists(held):
            os.remove(held)

    # Scan every other plot file once.
    t = time.time()
    # Plot mill buffer lain = salinan re-ID, bukan sumber.
    buffer_ids = {m["id"] for m in mills if m["group"] == "SJIM" and m["umlId"] in TARGETS}
    # KTN (sejak 6 Okt) = analisis milik KTN, skema lain -> tidak dipakai.
    files = [f for f in sorted(glob.glob(os.path.join(PLOTS, "*.geojson")))
             if "__AGROJAYA__" not in f and "__KTN__" not in f and not any(os.path.basename(f).startswith(t + ".") for t in buffer_ids)]
    refinery_codes = {}  # SJIM crusher name -> plot `Refinery` code (e.g. "SBIM")
    for f in files:
        with open(f, encoding="utf-8") as fh:
            fc = json.load(fh)
        crusher = re.sub(r"(__\d+)?(\.part\d+)?\.geojson$", "", os.path.basename(f)).split("__")[2] if "__SJIM__" in f else None
        for ft in fc["features"]:
            if crusher and str(ft["properties"].get("Refinery") or "").strip():
                refinery_codes.setdefault(crusher, Counter())[ft["properties"]["Refinery"].strip()] += 1
            g = ft.get("geometry")
            if not g:
                continue
            try:
                x0, y0, x1, y1 = bbox(g)
            except (KeyError, IndexError, TypeError):
                x0, y0, x1, y1 = shape(g).bounds
            s = None
            for mill_id, t_ in targets.items():
                bx0, by0, bx1, by1 = t_["buf"].bounds
                if x1 < bx0 or x0 > bx1 or y1 < by0 or y0 > by1:
                    continue
                if s is None:
                    s = polygonal(shape(g))
                if s is None or not s.intersects(t_["buf"]):
                    continue
                key = json.dumps(g["coordinates"] if "coordinates" in g else g, separators=(",", ":"))
                hit = t_["hits"].get(key)
                p = ft["properties"]
                if hit is None:
                    t_["hits"][key] = {"ft": ft, "geom": s, "src": [p]}
                else:
                    hit["src"].append(p)
    print(f"[sjim-buffer] scanned {len(files)} files in {time.time() - t:.0f}s")

    # Re-ID.
    for mill_id, t_ in targets.items():
        m = t_["mill"]
        uml = m["umlId"]
        node = m["nodeId"] or f"2026-IDN-{uml.replace('PO', '')}-1"
        centre = Point(m["lon"], m["lat"])
        items = []
        for hit in t_["hits"].values():
            c = hit["geom"].centroid
            items.append((hit, c))
        items.sort(key=lambda it: (-round(it[1].y, 7), round(it[1].x, 7)))
        full = []
        for seq, (hit, c) in enumerate(items, 1):
            src = hit["src"][0]
            first = str(src.get("PlotID") or "").split("-")[0]
            prefix = first if re.fullmatch(r"[A-Z]{3}\d+", first) else "IDN000000"
            props = {k: v for k, v in src.items() if k not in ("_dist_to_mill_km", "Dist_to_Mill_km", "Mill_Name", "NEAR_DIST", "NEAR_FID")}
            props.update({
                "UML_ID": uml,
                "Mill_name": m["millName"],
                "NodeID": node,
                "Group_Name": m.get("groupName") or m.get("parentCompany") or "",
                "Parent_Com": m.get("parentCompany") or "",
                "Refinery": refinery_codes.get(m["refinery"], Counter({"": 1})).most_common(1)[0][0],
                "PlotID": f"{prefix}-{uml}-{YYMM}-{seq:04d}",
                "Dist_to_Mill_km": round(geod.inv(m["lon"], m["lat"], c.x, c.y)[2] / 1000, 3),
                "Fully_Within_20km": "YES" if hit["geom"].within(t_["buf"]) else "NO",
                "Centroid_Inside_20km": "YES" if t_["buf"].contains(c) else "NO",
            })
            all_uml = sorted({str(p.get("UML_ID") or "") for p in hit["src"]})
            prov = {
                "Src_UML_ID": src.get("UML_ID"),
                "Src_Mill_name": src.get("Mill_name") or src.get("Mill_Name"),
                "Src_PlotID": src.get("PlotID"),
                "Src_NodeID": src.get("NodeID"),
                "Src_All_UML_ID": ";".join(all_uml),
                "Src_Dup_Count": len(hit["src"]),
            }
            feature = {"type": "Feature", "properties": props, "geometry": hit["ft"]["geometry"]}
            full.append((feature, prov))
        t_["full"] = full
        write_parts(mill_id, [f for f, _ in full])
        print(f"[sjim-buffer] {m['millName']}: {sum(len(h['src']) for h in t_['hits'].values())} intersect -> {len(full)} unique")

    # Overlap rule, per mill.
    for mill_id, t_ in targets.items():
        subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "dedup-overlaps.py"), mill_id], check=True)

    # Provenance copies + mapping.
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Mapping"
    cols = ["Mill_name", "UML_ID", "PlotID", "Status", "Overlap_Kept_PlotID", "Overlap_Share", "Src_UML_ID",
            "Src_Mill_name", "Src_PlotID", "Src_NodeID", "Src_All_UML_ID", "Src_Dup_Count",
            "Fully_Within_20km", "Centroid_Inside_20km", "Dist_to_Mill_km", "EUDR_Comply", "COMPANY"]
    ws.append(cols)
    summary = wb.create_sheet("Ringkasan")
    summary.append(["Mill", "UML ID", "Lat", "Lon", "Intersect", "Unik", "Dibuang (overlap >=50%)", "Final"])
    for mill_id, t_ in targets.items():
        m = t_["mill"]
        final_ids = {f["properties"]["PlotID"] for f in read_mill(mill_id)}
        held = {}
        held_path = os.path.join(HELD, f"{mill_id}.geojson")
        if os.path.exists(held_path):
            with open(held_path, encoding="utf-8") as fh:
                for f in json.load(fh)["features"]:
                    held[f["properties"]["PlotID"]] = f["properties"]
        kept = []
        for feature, prov in t_["full"]:
            p = feature["properties"]
            h = held.get(p["PlotID"], {})
            status = "kept" if p["PlotID"] in final_ids else "dropped_overlap50"
            ws.append([p["Mill_name"], p["UML_ID"], p["PlotID"], status, h.get("Overlap_Kept_PlotID"),
                       h.get("Overlap_Share"), *[prov[k] for k in cols[6:12]], p["Fully_Within_20km"],
                       p["Centroid_Inside_20km"], p["Dist_to_Mill_km"], p.get("EUDR_Comply"), p.get("COMPANY")])
            if status == "kept":
                kept.append({**feature, "properties": {**p, **prov}})
        base = f"{m['umlId']}__{safe(m['millName'])}"
        with open(os.path.join(OUT, base + ".geojson"), "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": kept}, fh, separators=(",", ":"), ensure_ascii=False)
        with open(os.path.join(OUT, f"Buffer_20km_{safe(m['millName'])}.geojson"), "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
                "Mill_name": m["millName"], "UML_ID": m["umlId"], "Buffer_km": 20},
                "geometry": json.loads(json.dumps(t_["buf"].__geo_interface__))}]}, fh)
        summary.append([m["millName"], m["umlId"], m["lat"], m["lon"],
                        sum(len(h["src"]) for h in t_["hits"].values()), len(t_["full"]),
                        len(t_["full"]) - len(kept), len(kept)])
    suffix = "" if only == TARGETS else f" ({'+'.join(only)})"
    wb.save(os.path.join(OUT, f"Mapping PlotID SJIM Buffer 20 km{suffix}.xlsx"))

    # mills.json traceability.
    for m in mills:
        if m["id"] in targets:
            m.update({"traceability": "buffer", "traceabilityRaw": "Buffer 20KM", "bufferKm": 20})
    with open(MILLS, "w", encoding="utf-8") as fh:
        json.dump(mills, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"[sjim-buffer] done -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
