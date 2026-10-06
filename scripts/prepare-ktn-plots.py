"""
Ingests the KTN group (ADM tenant, 6 Oct 2026) from the KTN delivery
`…\\Semua Delivery Ada di Sini\\12. KTN\\KTN_EUDR.gdb`.

Decisions (user, 6 Oct 2026):
  - KTN is a new group in ADM's portfolio, but the plots and their analysis are
    KTN's own (Agriplot), not Earthline's. Only layer KTN_AGRIPLOT is used;
    PLOT_EARTHLINE (Earthline's re-analysis of the same area) is NOT shown yet.
  - So these plots carry KTN's criteria (DF / LB / PRF, final Compliance,
    Risk_Dist, land registration) and no Earthline A–F class or village risk.
    `Analysis` = "KTN (Agriplot)" marks every plot; the app reads it.

Personal data is never copied: Email, NIB, Address, Kode_Pos, ProducerName and
Sup_KTN (the supplier list names individual farmers) stay in the GDB.

Mills: the GDB names mills only by text (`Mill_Name`). Each is matched to
UML.xlsx by name and by distance to its plots (scratch matcher, 6 Oct);
identity and coordinates come from UML.xlsx. `CHECK` marks matches made on
location/parent company rather than an exact name — listed in
KTN_PIPELINE_NOTES.md for the client to confirm. A mill with no UML match is
held back (not shown) with its plots.

Held back, written to Data Storage/NEEDS VERIFICATION/adm/ktn/ (no personal
fields): plots of an unmatched mill, plots with no KTN analysis, plots
>100 km from their mill (ADM rule), identical geometries after the first per
mill (pipeline dedup rule).

Idempotent: KTN rows in mills.json and `__KTN__` plot files are replaced.
Afterwards: node scripts/prepare-eudr-stats.mjs, update DATA_AS_OF,
node --env-file=.env.local scripts/upload-plots-to-r2.mjs "__KTN__".

Usage: python scripts/prepare-ktn-plots.py [--gdb <path>] [--uml <UML.xlsx>]
"""
import argparse
import collections
import datetime
import glob
import hashlib
import json
import math
import os

import fiona
import openpyxl
from shapely.geometry import mapping, shape

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
PD = os.path.join(ROOT, "private-data")
PLOTS = os.path.join(PD, "plots")
HELD = os.path.join(ROOT, "Data Storage", "NEEDS VERIFICATION", "adm", "ktn")
NOTES_DIR = os.path.join(ROOT, "Data Storage", "KTN")
GROUP = "KTN"
REFINERY = "Kurnia Tunggal Nugraha"
ANALYSIS = "KTN (Agriplot)"
MAX_KM = 100
PRECISION = 7
TARGET_PART_BYTES = 20 * 1024 * 1024

# Mill_Name in the GDB → UML ID. Matched 6 Oct 2026 (name similarity ≥0.85
# and ≤60 km from the median of the mill's plots, unless marked CHECK).
MILLS = {
    "Adimulia_Palmo_Lestari": "PO1000010257",
    "Agrindo_Panca_Tunggal_Perkasa": "PO1000016966",
    "Agrindo_Sawit_Mandiri": "PO1000010047",
    "Agro_Jaya_Perdana": "PO1000007469",
    "Agro_Mitra_Madani": "PO1000000884",
    "Agro_Wijaya_Industri": "PO1000008386",
    "Angso_Duo_Sawit": "PO1000008202",
    "Bastian_Olah_Sawit": "PO1000008178",
    "Bayung_Agro_Sawita": "PO1000008407",
    "Brahma_Binabakti": "PO1000001619",
    "Bukit_Belaban_Jaya": "PO1000009566",
    "Bukit_Bintang_Sawit": "PO1000004457",
    "Bukit_Makmur": "PO1000005302",
    "Bukit_Palem": "PO1000008176",
    "Bumi_Mekar_Tani": "PO1000007637",
    "Bumi_Sawit_Sejahtera": "PO1000020024",
    "Bungo_Suko_Menanti": "PO1000009558",
    "Cipta_Lestari_Sawit": "PO1000008604",
    "Citra_Sawit_Harum": "PO1000006208",
    "Damasraya_Sawit_Lestari": "PO1000007496",
    "Dharmasraya_Palma_Sejahtera": "PO1000010013",
    "Erasakti_Wira_Forestama_2_Mill": "PO1000008383",
    "Erasakti_Wira_Forestama_3_Mill": "PO1000010014",
    "Erasakti_Wira_Forestama_4_Mill": "PO1000015875",
    "First_Lamandau_Timber_International": "PO1000005222",
    "Gunung_Sejahtera_Dua_Indah": "PO1000004165",
    "Inti_Guna_Nabati": "PO1000004852",
    "Kasih_Agro_Mandiri": "PO1000013486",
    "Katari_Agro": "PO1000005104",
    "Kurnia_Merangin_Berjaya": "PO1000016969",
    "Kurnia_Palma_Agung_Lestari": "PO1000013888",
    "Ladang_Panjang": "PO1000000315",
    "Manis_Mata": "PO1000001208",
    "Menthobi_Makmur_Lestari": "PO1000013512",
    "Muara_Bulian": "PO1000000279",
    "Nirmala_Agro_Lestari": "PO1000004932",
    "PT_Surya_Inti_Palmoil": "PO1000015878",
    "Perdana": "PO1000011188",
    "Rengas": "PO1000008397",
    "Satria_Hupasarana": "PO1000008610",
    "Sei_Kerandi": "PO1000008599",
    "Sinar_Bengkulu_Selatan": "PO1000004059",
    "Siriham": "PO1000004158",
    "Sukses_Karya_Mandiri": "PO1000011196",
    "Sukses_Karya_Sawit": "PO1000004867",
    "Sumber_Guna_Nabati": "PO1000008188",
    "Sumber_Kencana_Indo_PalmaRingin": "PO1000007448",
    "Sumbertama_Nusapertiwi": "PO1000004101",
    "Sungai_Cempaga": "PO1000009211",
    "Sungai_Rasau": "PO1000008180",
    "Surya_Sumber_Sawit_Abadi": "PO1000010015",
    "Surya_Utama_Agrolestari": "PO1000006212",
    "Tanjung_Dalam": "PO1000009068",
    "Tantahan_Panduhup_Asi": "PO1000007635",
    "Trimitra_Lestari": "PO1000004432",
    "Usaha_Agro_Indonesia": "PO1000006365",
    # Abbreviation, short form or parent company — nearest UML mill of that name.
    "BBIP": "PO1000004454",  # BUKIT BARISAN INDAH PRIMA, 2 km
    "SAL_2": "PO1000008403",  # SARI ADITYA LOKA 2, 3 km
    "SINP": "PO1000005203",  # SURYA INDAH NUSANTARA PAGI, 4 km
    "Selatan_Agro_Makmur_Lestari": "PO1000008607",  # SAML, 5 km
    "Rantau_Panjang_Factory": "PO1000000320",  # RANTAU PANJANG POM, PT GPI, 8 km
    "Rudyagung_Agralaksana": "PO1000004112",  # RAAL, 2 km
    "Danau_LamoMaro_Sebo": "PO1000004465",  # MARO SEBO, 12 km
    "Binakarya_Eramandiri": "PO1000007628",  # MANGSANG (parent BINAKARYA ERAMANDIRI), 13 km
    "Betung": "PO1000006340",  # UNIT BETUNG (PTPN VII), nearest "Betung"
}
CHECK = {
    "BBIP", "SAL_2", "SINP", "Selatan_Agro_Makmur_Lestari", "Rantau_Panjang_Factory",
    "Rudyagung_Agralaksana", "Danau_LamoMaro_Sebo", "Binakarya_Eramandiri", "Betung",
}

PERSONAL = {"Email", "NIB", "Address", "Kode_Pos", "ProducerName", "Sup_KTN"}

TYPES = {
    "independent smallholder": "Independent Smallholder",
    "indepemdent smallholder": "Independent Smallholder",
    "schemed smallholder": "Scheme Smallholder",
    "company": "Company",
    "field boundary": "Field Boundary",
    "outgrower": "Outgrower",
}
REGISTERED = {"progres hgu": "Progress HGU", "counregistered": "Unregistered"}


def text(v):
    s = str(v if v is not None else "").strip()
    return "" if s in ("-", "None") else s


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def hav(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    x = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(x, PRECISION) for x in c]
    return [round_coords(x) for x in c]


def uml_rows(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = list(wb["UML"].iter_rows(values_only=True))
    head = rows[0]
    return {r[0]: dict(zip(head, r)) for r in rows[1:] if r[0]}


def write_parts(mill_id, feats):
    parts, cur, size = [], [], 2
    for f in feats:
        s = json.dumps(f, ensure_ascii=False, separators=(",", ":"))
        if cur and size + len(s.encode("utf-8")) + 1 > TARGET_PART_BYTES:
            parts.append(cur)
            cur, size = [], 2
        cur.append(s)
        size += len(s.encode("utf-8")) + 1
    if cur:
        parts.append(cur)
    for n, chunk in enumerate(parts):
        suffix = "" if n == 0 else f".part{n + 1}"
        with open(os.path.join(PLOTS, f"{mill_id}{suffix}.geojson"), "w", encoding="utf-8") as fh:
            fh.write('{"type":"FeatureCollection","features":[' + ",".join(chunk) + "]}")
    return len(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gdb", default=r"D:\000 Work\000 Databases\002 Request\Semua Delivery Ada di Sini\12. KTN\KTN_EUDR.gdb")
    ap.add_argument("--uml", default=r"D:\000 Work\000 Databases\UML.xlsx")
    a = ap.parse_args()

    uml = uml_rows(a.uml)
    mills = {}
    for name, uid in MILLS.items():
        u = uml.get(uid)
        if not u:
            raise SystemExit(f"{name}: {uid} not in UML.xlsx")
        mills[name] = {
            "id": f"{uid}__{GROUP}__{REFINERY}",
            "group": GROUP,
            "refinery": REFINERY,
            "millName": str(u["Mill Name"]).strip(),
            "umlId": uid,
            "nodeId": f"2026-IDN-{uid[2:]}-1",
            "port": "",
            "traceability": "plot",
            "traceabilityRaw": "Plot level (Agriplot)",
            "bufferKm": None,
            "groupName": str(u.get("Group Name") or "").replace("\xa0", " ").strip(),
            "parentCompany": str(u.get("Parent Company") or "").strip(),
            "lat": num(u["Latitude"]),
            "lon": num(u["Longitude"]),
        }

    yymm = datetime.date.today().strftime("%y%m")
    kept = collections.defaultdict(list)
    held = collections.defaultdict(list)  # reason → features
    seen = collections.defaultdict(set)
    far = collections.Counter()
    with fiona.open(a.gdb, layer="KTN_AGRIPLOT") as src:
        for f in src:
            p = dict(f["properties"])
            for k in PERSONAL:
                p.pop(k, None)
            name = p.get("Mill_Name")
            g = shape(f["geometry"]) if f["geometry"] else None
            if g is None or g.is_empty:
                held["no-geometry"].append((p, None))
                continue
            pt = g.representative_point()
            geom = {"type": g.geom_type, "coordinates": round_coords(mapping(g)["coordinates"])}
            if name not in mills:
                held["unmatched-mill"].append((p, geom))
                continue
            if not text(p.get("Compliance")):
                held["no-analysis"].append((p, geom))
                continue
            m = mills[name]
            if m["lat"] is not None and hav(pt.y, pt.x, m["lat"], m["lon"]) > MAX_KM:
                far[name] += 1
                held["over-100km"].append((p, geom))
                continue
            key = hashlib.sha1(json.dumps(geom["coordinates"]).encode()).hexdigest()
            if key in seen[name]:
                held["duplicate-geometry"].append((p, geom))
                continue
            seen[name].add(key)
            typ = TYPES.get(text(p.get("TypeOfSupp")).lower(), text(p.get("TypeOfSupp")))
            reg = text(p.get("Registered"))
            reg = REGISTERED.get(reg.lower(), reg)
            company = text(p.get("Company"))
            props = {
                "Analysis": ANALYSIS,
                "AgriplotID": text(p.get("AgriplotID")),
                "COMPANY": "" if company.lower() == "unknown" else company,
                "TYPE": typ,
                "Village": text(p.get("Village")) or None,
                "SubDistric": text(p.get("SubDistric")) or None,
                "District": text(p.get("District")) or None,
                "Province": text(p.get("Province")) or None,
                "Hectarage": num(p.get("HA")) or 0,
                "EUDR_Comply": "YES" if text(p.get("Compliance")) == "Comply" else "NO",
                "Compliance": text(p.get("Compliance")),
                "DF_Comp": text(p.get("DF_Comp")),
                "LB_Comp": text(p.get("LB_Comp")),
                "PRF_Comp": text(p.get("PRF_Comp")),
                "PRF": text(p.get("PRF")),
                "PRF_Ar": num(p.get("PRF_Ar")) or 0,
                "Forest_GFC": num(p.get("Forest_GFC")) or 0,
                "Forest_TMF": num(p.get("Forest_TMF")) or 0,
                "Note_EQ": text(p.get("Note_EQ")),
                "Risk_Dist": text(p.get("Risk_Dist")),
                "Registered": reg,
                "LAT": round(pt.y, 7),
                "LON": round(pt.x, 7),
                "UML_ID": m["umlId"],
                "Mill_name": m["millName"],
                "NodeID": m["nodeId"],
            }
            kept[name].append({"type": "Feature", "properties": props, "geometry": geom})

    # Fresh run: drop old KTN files and rows.
    for fp in glob.glob(os.path.join(PLOTS, f"*__{GROUP}__*.geojson")):
        os.remove(fp)
    rows, summary = [], []
    for name, feats in sorted(kept.items(), key=lambda kv: mills[kv[0]]["millName"]):
        m = mills[name]
        feats.sort(key=lambda f: (-f["properties"]["LAT"], f["properties"]["LON"]))
        for i, f in enumerate(feats):
            f["properties"]["PlotID"] = f"KTN-{m['umlId']}-{yymm}-{i + 1:05d}"
        n = write_parts(m["id"], feats)
        rows.append(m)
        ha = sum(f["properties"]["Hectarage"] for f in feats)
        nc = sum(1 for f in feats if f["properties"]["EUDR_Comply"] == "NO")
        summary.append((name, m["millName"], m["umlId"], len(feats), ha, nc, far.get(name, 0), name in CHECK))
        print(f"[prepare-ktn] {m['millName']:<38} {len(feats):>6} plots  {ha:>10,.0f} ha  {nc:>5} NC  ({n} file{'s' if n > 1 else ''})")

    mills_path = os.path.join(PD, "mills.json")
    all_rows = [r for r in json.load(open(mills_path, encoding="utf-8")) if r["group"] != GROUP]
    with open(mills_path, "w", encoding="utf-8") as fh:
        json.dump(all_rows + rows, fh, ensure_ascii=False, separators=(",", ":"))

    os.makedirs(HELD, exist_ok=True)
    for fp in glob.glob(os.path.join(HELD, "*.geojson")):
        os.remove(fp)
    for reason, items in held.items():
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": p, "geometry": g} for p, g in items]}
        with open(os.path.join(HELD, f"{reason}.geojson"), "w", encoding="utf-8") as fh:
            json.dump(fc, fh, ensure_ascii=False, default=str)

    os.makedirs(NOTES_DIR, exist_ok=True)
    with open(os.path.join(NOTES_DIR, "ktn-mills.csv"), "w", encoding="utf-8-sig") as fh:
        fh.write("Mill_Name (KTN);Mill (UML);UML ID;Plots;Hectares;Non comply;Held >100 km;Match to confirm\n")
        for r in summary:
            fh.write(f"{r[0]};{r[1]};{r[2]};{r[3]};{r[4]:.2f};{r[5]};{r[6]};{'yes' if r[7] else ''}\n")
    total = sum(r[3] for r in summary)
    print(f"[prepare-ktn] {len(rows)} mills, {total:,} plots, {sum(r[4] for r in summary):,.0f} ha")
    for reason, items in held.items():
        names = collections.Counter(p.get("Mill_Name") for p, _ in items)
        print(f"[prepare-ktn] held {reason}: {len(items):,} — {dict(names.most_common(6))}")


if __name__ == "__main__":
    main()
