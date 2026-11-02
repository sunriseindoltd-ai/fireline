"""Darkening outside Indonesia on every FireLine map (user, 2 Nov 2026: "laut dan daratan luar Indonesia gelap"):
one world polygon with Indonesia's land as holes -> public/geo/idn-mask.json, drawn above the basemap and imagery.

Land = geoBoundaries IDN ADM1 (BPS 2020, the boundaries FireLine already uses), grown ~2 km so the coast and small
islands stay lit, then simplified. Run:  python scripts/prepare-idn-mask.py
"""
import json
import os

import geopandas as gpd
import shapely

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"D:\Earthline\01 Produk\PalmTrace\Data Storage\Boundaries\IDN\geoBoundaries-IDN-ADM1_simplified.geojson"
OUT = os.path.join(HERE, "..", "public", "geo", "idn-mask.json")
GROW = 0.02  # deg, ~2 km
SIMPLIFY = 0.006

land = shapely.unary_union(gpd.read_file(SRC).to_crs(4326).geometry.values)
land = land.buffer(GROW, resolution=3).simplify(SIMPLIFY, preserve_topology=True)
parts = [p for p in shapely.get_parts(land) if p.area > 0.0004]  # drop specks (< ~5 km² after growing)
holes = [[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords] for p in parts]
world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [world, *holes]}}]}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(fc, fh, separators=(",", ":"))
print(len(holes), "land parts,", round(os.path.getsize(OUT) / 1024), "kB ->", OUT)
