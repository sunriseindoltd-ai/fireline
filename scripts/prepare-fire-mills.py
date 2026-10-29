"""Palm oil mills of Indonesia from the Universal Mill List (Rainforest Alliance) for the FireLine map layer.

python scripts/prepare-fire-mills.py ["D:/Earthline/02 Data/Referensi/UML.xlsx"]
  -> private-data/fire/layers/mills-uml.geojson (R2 fire/layers/mills-uml.geojson)

Download the latest list from https://knowledge.rainforest-alliance.org/docs/the-universal-mill-list (UML.xlsx,
updated monthly). Properties are short to keep the file small:
  id UML ID · n mill name · g group · pc parent company · r 1 = RSPO certified · rt RSPO type
  c confidence 1 fully verified / 2 high / 3 low · pv province · ds district · alt alternative name
"""
import json
import math
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/Earthline/02 Data/Referensi/UML.xlsx")
OUT = ROOT / "private-data" / "fire" / "layers" / "mills-uml.geojson"


def txt(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


df = pd.read_excel(SRC)
df = df[df["ISO"] == "IDN"]
feats, skipped = [], 0
for _, r in df.iterrows():
    lat, lon = r["Latitude"], r["Longitude"]
    if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))) or math.isnan(lat) or math.isnan(lon) or (lat == 0 and lon == 0):
        skipped += 1
        continue
    conf = txt(r["Confidence level"]) or ""
    props = {
        "id": txt(r["UML ID"]),
        "n": txt(r["Mill Name"]),
        "g": txt(r["Group Name"]),
        "pc": txt(r["Parent Company"]),
        "r": 1 if txt(r["RSPO Status"]) == "RSPO Certified" else 0,
        "rt": txt(r["RSPO type"]),
        "c": int(conf[0]) if conf[:1].isdigit() else None,
        "pv": txt(r["Province"]),
        "ds": txt(r["District"]),
        "alt": txt(r["Alternative name"]),
    }
    props = {k: v for k, v in props.items() if v is not None}
    feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [round(float(lon), 5), round(float(lat), 5)]}})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"type": "FeatureCollection", "source": SRC.name, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
rspo = sum(f["properties"]["r"] for f in feats)
print(f"{len(feats)} Indonesian mills ({rspo} RSPO certified), {skipped} without coordinates -> {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")
