"""
Removes overlapping duplicate plots inside each mill of a group (user rule,
30 Sep 2026, first applied to AGROJAYA):

  When two plots of the same mill overlap by at least 50% of the smaller
  plot's area, only the larger plot is kept.

Plots are taken largest-first; a plot is dropped when a larger plot that is
already kept covers >= THRESHOLD of its own area. Mills are cleaned
separately — the same plot legitimately appears under two mills whose
sourcing areas overlap (e.g. KWALA SAWIT and SAWIT HULU), so that is not a
duplicate. Areas are compared on the geometry (planar, longitude scaled by
cos(latitude)), not on the Hectarage fields, which differ by source group.

Dropped plots are written, not lost, to
  Data Storage/NEEDS VERIFICATION/<tenant>/overlap-50/<mill id>.geojson
with Overlap_Kept_PlotID (the plot that won) and Overlap_Share (the share of
the dropped plot covered by it). A re-run adds to that file (it never empties
it), so running twice is safe; after a fresh prepare-agrojaya.mjs, delete the
overlap folder first if the result should start clean.

For AGROJAYA run it after scripts/prepare-agrojaya.mjs (which rebuilds the
un-cleaned files), then prepare-eudr-stats.mjs, the R2 upload and
export-agrojaya-gdb.py. Needs shapely (the system Python has it; ArcGIS
Pro's Python doesn't).

Usage: python scripts/dedup-overlaps.py "__AGROJAYA__" [--tenant adm] [--threshold 0.5]
"""
import argparse
import json
import math
import os
import re

from shapely import STRtree
from shapely.geometry import shape
from shapely.validation import make_valid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PART_BYTES = 20 * 1024 * 1024


def polygonal(g):
    """Valid, polygon-only version of a geometry (make_valid can return collections)."""
    if not g.is_valid:
        g = make_valid(g)
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    if g.geom_type == "GeometryCollection":
        polys = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        if polys:
            from shapely.ops import unary_union
            return unary_union(polys)
    return None


def split_by_size(features):
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
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pattern", help='substring of the plot file names, e.g. "__AGROJAYA__"')
    ap.add_argument("--tenant", default="adm")
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    data_dir = os.path.join(ROOT, "private-data") if args.tenant == "adm" else os.path.join(ROOT, "private-data", "tenants", args.tenant)
    plots_dir = os.path.join(data_dir, "plots")
    held_dir = os.path.join(ROOT, "Data Storage", "NEEDS VERIFICATION", args.tenant, f"overlap-{round(args.threshold * 100)}")
    os.makedirs(held_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(plots_dir) if args.pattern in f and f.endswith(".geojson"))
    by_mill = {}
    for f in files:
        mill_id = re.sub(r"(\.part\d+)?\.geojson$", "", f)
        by_mill.setdefault(mill_id, []).append(f)

    totals = [0, 0]
    for mill_id, parts in sorted(by_mill.items()):
        feats = []
        for f in sorted(parts, key=lambda x: (x.count(".part"), x)):
            with open(os.path.join(plots_dir, f), encoding="utf-8") as fh:
                feats += json.load(fh)["features"]
        geoms, areas = [], []
        lat0 = None
        for ft in feats:
            g = polygonal(shape(ft["geometry"]))
            geoms.append(g)
            if g is not None and lat0 is None:
                lat0 = g.representative_point().y
        k = math.cos(math.radians(lat0 or 0))
        areas = [(g.area * k if g is not None else 0.0) for g in geoms]
        tree = STRtree([g if g is not None else shape({"type": "Point", "coordinates": [0, 0]}) for g in geoms])
        order = sorted(range(len(feats)), key=lambda i: (-areas[i], str(feats[i]["properties"].get("PlotID"))))
        kept = [False] * len(feats)
        dropped = []
        for i in order:
            g = geoms[i]
            if g is None or areas[i] == 0:
                kept[i] = True  # nothing to compare; leave it
                continue
            winner, share = None, 0.0
            for j in tree.query(g):
                j = int(j)
                if j == i or not kept[j]:
                    continue
                try:
                    inter = g.intersection(geoms[j]).area * k
                except Exception:
                    inter = g.buffer(0).intersection(geoms[j].buffer(0)).area * k
                s = inter / areas[i]
                if s >= args.threshold and s > share:
                    winner, share = j, s
            if winner is None:
                kept[i] = True
            else:
                dropped.append((i, winner, share))

        out = [ft for i, ft in enumerate(feats) if kept[i]]
        held = []
        for i, j, s in dropped:
            ft = dict(feats[i])
            ft["properties"] = {**ft["properties"], "Overlap_Kept_PlotID": feats[j]["properties"].get("PlotID"), "Overlap_Share": round(s, 4)}
            held.append(ft)

        for f in parts:
            os.remove(os.path.join(plots_dir, f))
        chunks = split_by_size(out)
        for n, chunk in enumerate(chunks):
            name = f"{mill_id}.geojson" if n == 0 else f"{mill_id}.part{n + 1}.geojson"
            with open(os.path.join(plots_dir, name), "w", encoding="utf-8") as fh:
                json.dump({"type": "FeatureCollection", "features": chunk}, fh, separators=(",", ":"), ensure_ascii=False)
        # Merge with plots dropped by an earlier run — a re-run drops nothing new
        # and must not wipe that record.
        held_path = os.path.join(held_dir, f"{mill_id}.geojson")
        prior = []
        if os.path.exists(held_path):
            with open(held_path, encoding="utf-8") as fh:
                prior = json.load(fh)["features"]
        seen = {ft["properties"].get("PlotID") for ft in held}
        merged = held + [ft for ft in prior if ft["properties"].get("PlotID") not in seen]
        with open(held_path, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": merged}, fh, separators=(",", ":"), ensure_ascii=False)
        totals[0] += len(feats)
        totals[1] += len(held)
        print(f"[dedup-overlaps] {mill_id.split('__')[0]}: {len(feats)} -> {len(out)} plots "
              f"({len(held)} dropped, {len(parts)} -> {len(chunks)} file(s))")
    print(f"[dedup-overlaps] done: {totals[0]} -> {totals[0] - totals[1]} plots, {totals[1]} dropped -> {os.path.relpath(held_dir, ROOT)}")


if __name__ == "__main__":
    main()
