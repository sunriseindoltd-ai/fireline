"""
One-off: build MULTIAGRO SUMATERAJAYA (PULAU DOGOM)'s DOMAS-group plot file
up to Kanopi's golden schema, from the raw per-mill drop found at
D:\\000 Work\\000 Databases\\002 Request\\Semua Delivery Ada di Sini\\02. DOMAS\\BRC\\
MULTIAGRO_SUMATERAJAYA_PULAU_DOGOM.geojson — this mill was absent from the
DOMAS.gdb master consolidation used for every other DOMAS mill already in
Kanopi, apparently because 265 of its 969 rows have a corrupted PlotID (a
blank UML_ID segment) that likely broke whatever join the consolidation
step used.

Every value written here is either copied verbatim from the source or
derived from a source field with a documented, checked rule — nothing is
invented. What's covered:
  - PlotID: the blank UML_ID segment ("IDN122307- -2607-100228") is filled
    in with this mill's own UML_ID; the 704 rows that already had it right
    are untouched.
  - NodeID: this mill's own fixed value from mills.json's DOMAS row
    (2026-IDN-1000006247-1) — confirmed elsewhere in this dataset that
    NodeID is one constant value per mill, not per-plot.
  - LAT/LON: shapely's representative_point() (guaranteed inside the
    polygon, unlike a true centroid for concave/multi-part shapes — same
    reasoning the YORGO ingestion used arcpy's labelPoint for).
  - Village/SubDistric/District/Administration: split from the existing
    "Village_Admin" field ("Village, SubDistrict, District"), which already
    matches Kanopi's own Administration format exactly.
  - Country/Province: Indonesia / Sumatera Utara — every District value in
    this file (Labuhan Batu Utara, Toba, Asahan) is a regency within that
    one province.
  - Overall_Risk: copied from "Risk_Level" (identical vocabulary already:
    Low/Medium/High Risk).
  - Risk_Mitigation_Class: rebuilt from "_mit" (already a computed A-F
    letter) + Kanopi's own canonical MITIGATION_DESCRIPTIONS text.
  - HL / HPT (the only two forest categories that ever actually appear in
    this file's "_ncr" free-text column) parsed out with their exact ha
    figures; every other forest-overlap column (HP, HPK, CA, FL_LAIN,
    KSA_KPA, SM, TAHURA, TB, TN, TWA, Community_F, Indigenous_F, Social_F)
    is a real, checked 0 — none of those categories appear anywhere in
    this mill's data, not a placeholder for missing data.
  - Def_21..Def_25: copied verbatim (already present and non-trivial —
    checked "_ncr"'s "Deforestasi pasca-2020 X ha" note against these and
    confirmed it's just a human-readable restatement of whichever Def_22/
    Def_24 value is already there, not a separate figure — using it again
    would have double-counted deforestation for 15 rows). Def_26: 0, since
    nothing in the source distinguishes a 2026-specific figure.
  - Desc_Issue: rebuilt from whichever of HL/HPT/Deforestation actually
    apply to that row, in the same code vocabulary describeNonComplyIssue()
    already expands elsewhere.
  - EUDR_Comply: copied as-is — cross-checked 969/969 consistent with
    whether "_ncr" is non-empty, so it's already trustworthy.

Left genuinely blank (no source data to derive them from, and deliberately
not guessed): TYPE, COMPANY, GROUP_, Physical_Score/Risk/Reason,
Social_Score/Risk/Reason (Overall_Risk covers what actually drives the
map/table's Risk column and filtering; the plot popup's "See more" slide
simply won't show a Physical/Social Risk line for these plots, which it
already handles gracefully when those fields are empty).

One known, disclosed limitation: exactly 1 of 969 rows has an unquantified
"Tanam pasca-2020 (2021)" note in "_ncr" with no matching Def_21 figure
anywhere in the source — left alone rather than guessing a number.

Usage: python scripts/build-multiagro-domas-plots.py
"""
import json
import re
from pathlib import Path

from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(
    r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini"
    r"\02. DOMAS\BRC\MULTIAGRO_SUMATERAJAYA_PULAU_DOGOM.geojson"
)
UML_ID = "PO1000006247"
NODE_ID = "2026-IDN-1000006247-1"
OUT_PATH = ROOT / "private-data" / "plots" / f"{UML_ID}__DOMAS__PT. DOMAS SAWIT INTI PERDANA.geojson"

# Mirrors src/lib/ledger-geo.ts's MITIGATION_DESCRIPTIONS exactly.
MITIGATION_DESCRIPTIONS = {
    "A": "Compliant — Low-Risk Area; Approved for Submission",
    "B": "Compliant — Medium-Risk Area; Approved with Routine Monitoring",
    "C": "Compliant — High-Risk Area; Approved with Enhanced Monitoring",
    "D": "Non-Compliant — Low-Risk Area; Pending Geospatial Review",
    "E": "Non-Compliant — Medium-Risk Area; Mitigation Required Before Submission",
    "F": "Non-Compliant — High-Risk Area; Not Approved for Submission",
}

# "_ncr" label -> golden-schema field code. Confirmed by scanning every
# distinct label in this file: only these two ever appear.
NCR_CATEGORY_CODE = {
    "Hutan Lindung": "HL",
    "Hutan Produksi Terbatas": "HPT",
}

FOREST_FIELDS_ALWAYS_ZERO = [
    "CA", "HP", "HPK", "FL_LAIN", "KSA_KPA", "SM", "TAHURA", "TB", "TN", "TWA",
    "Community_F", "Indigenous_F", "Social_F",
]

ncr_re = re.compile(r"^(.+?)\s+([\d.]+)\s*ha$")


def round7(x):
    return round(x, 7)


def round_coords(coords):
    if isinstance(coords[0], (int, float)):
        return [round7(c) for c in coords]
    return [round_coords(c) for c in coords]


def fix_plot_id(plot_id: str) -> str:
    # "IDN122307- -2607-100228" -> "IDN122307-PO1000006247-2607-100228"
    return plot_id.replace("- -", f"-{UML_ID}-") if "- -" in plot_id else plot_id


def parse_ncr(ncr: str):
    """Returns (dict of code -> ha, set of codes present) for one row's _ncr text."""
    codes = {}
    if not ncr:
        return codes
    for part in ncr.split("·"):
        part = part.strip()
        if not part:
            continue
        m = ncr_re.match(part)
        if not m:
            continue  # e.g. "Tanam pasca-2020 (2021)" — no ha figure, skip
        label, ha = m.group(1).strip(), float(m.group(2))
        code = NCR_CATEGORY_CODE.get(label)
        if code:
            codes[code] = ha
    return codes


def main():
    raw = json.loads(SRC.read_text(encoding="utf-8"))
    features = raw["features"]
    print(f"[build-multiagro] {len(features)} source feature(s)")

    fixed_ids = 0
    out_features = []
    for f in features:
        p = dict(f["properties"])
        geom = shape(f["geometry"])

        old_id = p["PlotID"]
        new_id = fix_plot_id(old_id)
        if new_id != old_id:
            fixed_ids += 1
        p["PlotID"] = new_id
        p["NodeID"] = NODE_ID

        village, subdistrict, district = [s.strip() for s in p["Village_Admin"].split(",")]
        p["Village"] = village
        p["SubDistric"] = subdistrict
        p["District"] = district
        p["Administration"] = p["Village_Admin"]
        p["Country"] = "Indonesia"
        p["Province"] = "Sumatera Utara"

        p["Overall_Risk"] = p["Risk_Level"]

        letter = p.get("_mit", "").strip().upper()
        if letter in MITIGATION_DESCRIPTIONS:
            p["Risk_Mitigation_Class"] = f"{letter}. {MITIGATION_DESCRIPTIONS[letter]}"

        ncr_codes = parse_ncr(p.get("_ncr", ""))
        p["HL"] = ncr_codes.get("HL", 0)
        p["HPT"] = ncr_codes.get("HPT", 0)
        for field in FOREST_FIELDS_ALWAYS_ZERO:
            p[field] = 0
        p["Def_26"] = 0

        total_defo = sum(float(p.get(f"Def_{y}", 0) or 0) for y in ("21", "22", "23", "24", "25", "26"))
        issue_codes = []
        if p["HL"] > 0:
            issue_codes.append("HL")
        if p["HPT"] > 0:
            issue_codes.append("HPT")
        if total_defo > 0:
            issue_codes.append("Deforestation")
        p["Desc_Issue"] = ", ".join(issue_codes)

        rep_point = geom.representative_point()
        p["LAT"] = round7(rep_point.y)
        p["LON"] = round7(rep_point.x)

        rounded_geom = mapping(geom)
        rounded_geom["coordinates"] = round_coords(rounded_geom["coordinates"])

        out_features.append({"type": "Feature", "properties": p, "geometry": rounded_geom})

    print(f"[build-multiagro] fixed {fixed_ids} blank-UML_ID PlotID(s)")

    out_ids = [f["properties"]["PlotID"] for f in out_features]
    assert len(out_ids) == len(set(out_ids)), "PlotID collision introduced — aborting"

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features}),
        encoding="utf-8",
    )
    print(f"[build-multiagro] wrote {len(out_features)} feature(s) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
