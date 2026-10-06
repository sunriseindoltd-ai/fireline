"""
National soybean statistics for SoyTrace from the USDA NASS Crop Sequence
Boundaries layer the client's team prepared: every field classed as soybeans
in 2025, 2018–2025 crop history (Soy_National1825.gdb, 2.4 million fields).

Output: private-data/tenants/adm-soy/national.json (bundled with the app):
  fields, acres, soybean-season distribution, per state (fields, acres, share,
  fields in soybeans all 8 seasons) and the largest counties nationally and
  per state.

System Python (fiona). Usage: python scripts/prepare-soy-national-stats.py
"""
import collections
import json
import os
import time

import fiona

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = r"D:\000 Work\000 Databases\002 Request\999 Request Lainnya\ADM Soybean\Soy_National1825\Soy_National1825.gdb"
LAYER = "Soy_National1825"
OUT = os.path.join(ROOT, "private-data", "tenants", "adm-soy", "national.json")
YEARS = list(range(2018, 2026))
# Soybeans and the double crops with soybeans (CDL codes) — as SOY in src/lib/soy-copy.ts.
SOY = {5, 26, 239, 240, 241, 254}
FIPS = {
    "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
    "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
}


def main():
    t = time.time()
    fields = 0
    acres = 0.0
    seasons = collections.Counter()
    st = collections.defaultdict(lambda: {"fields": 0, "acres": 0.0, "all8": 0})
    county = collections.defaultdict(lambda: {"fields": 0, "acres": 0.0})
    with fiona.open(SRC, layer=LAYER, ignore_geometry=True) as src:
        for i, f in enumerate(src, 1):
            p = f["properties"]
            a = float(p["CSBACRES"] or 0)
            n = sum(1 for y in YEARS if p[f"CDL{y}"] in SOY)
            s = FIPS.get(p["STATEFIPS"], p["STATEFIPS"])
            fields += 1
            acres += a
            seasons[n] += 1
            st[s]["fields"] += 1
            st[s]["acres"] += a
            if n == 8:
                st[s]["all8"] += 1
            k = (s, p["CNTY"] or "—")
            county[k]["fields"] += 1
            county[k]["acres"] += a
            if i % 500000 == 0:
                print(f"  {i:,} fields …")
    states = sorted(
        ({"state": s, "fields": v["fields"], "acres": round(v["acres"]), "all8": v["all8"]} for s, v in st.items()),
        key=lambda x: -x["acres"],
    )
    counties = sorted(
        ({"state": s, "county": c, "fields": v["fields"], "acres": round(v["acres"])} for (s, c), v in county.items()),
        key=lambda x: -x["acres"],
    )
    per_state = collections.defaultdict(list)
    for c in counties:
        if len(per_state[c["state"]]) < 10:
            per_state[c["state"]].append({"county": c["county"], "fields": c["fields"], "acres": c["acres"]})
    out = {
        "source": "USDA NASS Crop Sequence Boundaries 2018–2025, fields in soybeans in 2025 (Soy_National1825)",
        "fields": fields,
        "acres": round(acres),
        "counties": len(county),
        "soyYears": [{"years": y, "fields": seasons.get(y, 0)} for y in range(0, 9)],
        "states": states,
        "topCounties": counties[:25],
        "stateCounties": per_state,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{fields:,} fields, {acres:,.0f} acres, {len(states)} states, {len(county):,} counties — {time.time() - t:.0f} s")
    print("top states:", ", ".join(f"{s['state']} {s['acres'] / 1e6:.2f}M" for s in states[:8]))
    print("seasons:", dict(sorted(seasons.items())))


if __name__ == "__main__":
    main()
