import type { SoyFeature } from "@/components/soy-supply-map";

/** File downloads of SoyTrace fields, shared by Map & data and the facility pages. */

export function downloadBlob(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

// Downloads carry neither the map centre nor the owner's name and address: fieldRow lists
// every column that goes out. One set of columns for compliant and non-compliant fields,
// blank where one doesn't apply. review_flag: already cropland in 2018–2020 (a note, ADM's
// status unchanged); in_any_catchment: counted in the figures.
export function fieldRow(f: SoyFeature, nc: boolean) {
  const p = f.properties;
  return {
    status: nc ? "non-compliant" : "compliant",
    field_id: p.id,
    state: p.s,
    county: p.n,
    field_acres: p.a,
    soy_seasons_2018_2025: nc ? (p.sy ?? null) : p.y,
    rail_mi: p.r ?? null,
    river_mi: p.v ?? null,
    cdl_2018_2025: nc ? null : String(p.c ?? "").replace(/,/g, " "),
    cover_2018_2020: nc ? p.b : null,
    first_cropped: nc ? p.y : null,
    crop_2024: nc ? p.c24 : null,
    crop_2025: nc ? p.c25 : null,
    F2026_Soy: nc ? p.s26 : null,
    review_flag: nc ? (p.rf ?? "") : "",
    in_any_catchment: String(p.k ?? "") ? "true" : "false",
    township: p.sub ?? null,
    point_only: nc && p.po ? "yes" : "no",
  } as unknown as Record<string, string | number | null | undefined>;
}

export type FieldRows = { f: SoyFeature; nc: boolean }[];

export function downloadFieldsCsv(rows: FieldRows, filename: string) {
  if (!rows.length) return;
  const rowsOut = rows.map(({ f, nc }) => {
    const r = fieldRow(f, nc);
    return [...Object.values(r), Number(f.properties._x).toFixed(5), Number(f.properties._y).toFixed(5)];
  });
  const head = [...Object.keys(fieldRow(rows[0]!.f, rows[0]!.nc)), "lon", "lat"];
  downloadBlob(filename, csv([head, ...rowsOut]), "text/csv");
}

export function downloadFieldsGeo(rows: FieldRows, filename: string) {
  if (!rows.length) return;
  // Built in pieces: a whole 0–80 NM catchment is over 100,000 outlines.
  const parts: string[] = ['{"type":"FeatureCollection","features":['];
  rows.forEach(({ f, nc }, i) => {
    parts.push((i ? "," : "") + JSON.stringify({ type: "Feature", properties: fieldRow(f, nc), geometry: f.geometry }));
  });
  parts.push("]}");
  const url = URL.createObjectURL(new Blob(parts, { type: "application/geo+json" }));
  const el = document.createElement("a");
  el.href = url;
  el.download = filename;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
