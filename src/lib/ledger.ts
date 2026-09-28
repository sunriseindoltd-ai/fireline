import { readFirstSheetRows, rowsToObjects } from "./xlsx-lite.ts";

export type TraceLevel = "village" | "buffer" | "unknown";

export type MillRecord = {
  id: string;
  /** Refinery/KCP Group — column B, e.g. "BNS", "Permata". Top tier. */
  group: string;
  /** Refinery/KCP Name — column C, e.g. "Permata PAA Duri". Middle tier. */
  refinery: string;
  millName: string;
  umlId: string;
  nodeId: string;
  port: string;
  traceability: TraceLevel;
  traceabilityRaw: string;
  /** Radius in km when `traceability` is "buffer" (10/20/30…) — parsed from traceabilityRaw. */
  bufferKm: number | null;
  /** Owning company group (column M) — distinct from the Refinery/KCP Group. */
  groupName: string;
  parentCompany: string;
  lat: number | null;
  lon: number | null;
};

export type Fc = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates: unknown } | null;
  }>;
};

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CSV_HEADERS = [
  "Mill",
  "Refinery/KCP Group",
  "Refinery/KCP Name",
  "UML ID",
  "NodeID",
  "Traceability",
  "Port",
  "Group name",
  "Parent company",
  "Lat",
  "Lon",
];

export function downloadMillsCsv(filename: string, mills: MillRecord[]) {
  const rows = mills.map((m) => [
    m.millName,
    m.group,
    m.refinery,
    m.umlId,
    m.nodeId,
    m.traceabilityRaw || m.traceability,
    m.port,
    m.groupName,
    m.parentCompany,
    m.lat ?? "",
    m.lon ?? "",
  ]);
  const csv = [CSV_HEADERS, ...rows]
    .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadBlob(filename, csv, "text/csv;charset=utf-8");
}

export function downloadGeojson(filename: string, fc: Fc) {
  downloadBlob(filename, JSON.stringify(fc), "application/geo+json;charset=utf-8");
}

function normHeader(h: unknown) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pick(row: Record<string, unknown>, aliases: string[]) {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const hit = keys.find((k) => k === a);
    if (hit && row[hit] != null && String(row[hit]).trim() !== "") {
      return String(row[hit]).trim();
    }
  }
  for (const a of aliases) {
    const hit = keys.find((k) => k.startsWith(a) || a.startsWith(k));
    if (hit && row[hit] != null && String(row[hit]).trim() !== "") {
      return String(row[hit]).trim();
    }
  }
  return "";
}

function pickNumber(row: Record<string, unknown>, aliases: string[]): number | null {
  const raw = pick(row, aliases);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function classifyTrace(raw: string): TraceLevel {
  const s = raw.toLowerCase();
  if (s.includes("village") || s.includes("desa") || s.includes("ttv")) return "village";
  if (s.includes("buffer") || s.includes("ttm") || /\d+\s*km/.test(s)) return "buffer";
  return "unknown";
}

/** Buffer radius in km from text like "Buffer 10KM" / "Buffer 30 km" — any size, not just 20. */
export function parseBufferKm(raw: string): number | null {
  const m = raw.toLowerCase().match(/(\d+(?:\.\d+)?)\s*km/);
  return m ? Number(m[1]) : null;
}

function recordsFromRows(raw: Record<string, unknown>[]): MillRecord[] {
  const mills: MillRecord[] = [];
  // A mill can genuinely supply more than one Refinery/KCP (same UML ID,
  // different rows) — keyed by row identity so those stay distinct, with a
  // counter suffix as a last-resort tiebreaker for exact duplicate rows.
  const seenIds = new Map<string, number>();
  raw.forEach((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) mapped[normHeader(k)] = v;
    const millName = pick(mapped, ["mill name", "mill", "pabrik", "nama pabrik"]);
    const umlId = pick(mapped, ["uml id", "uml", "uml id 2026"]);
    // "Refinery/KCP Group/Name" must be tried before the shorter "group"/
    // "refinery" aliases — those old aliases would otherwise prefix-match
    // this sheet's unrelated blank "REFINERY" and ownership "GROUP NAME"
    // columns first.
    const group = pick(mapped, [
      "refinery kcp group",
      "refinery group",
      "group",
      "grup",
      "rantai",
    ]);
    if (!millName && !umlId) return;
    const traceabilityRaw = pick(mapped, [
      "traceability level",
      "traceability",
      "tingkat ketertelusuran",
    ]);
    const refinery = pick(mapped, ["refinery kcp name", "refinery name", "refinery", "kilang"]);
    const baseId = `${umlId || millName}__${group}__${refinery}`;
    const seenCount = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, seenCount);
    const id = seenCount > 1 ? `${baseId}__${seenCount}` : baseId;

    mills.push({
      id,
      group: group || "Ungrouped",
      refinery,
      millName: millName || umlId,
      umlId,
      nodeId: pick(mapped, ["nodeid", "node id"]),
      port: pick(mapped, ["port", "pelabuhan"]),
      traceability: classifyTrace(traceabilityRaw),
      traceabilityRaw,
      bufferKm: parseBufferKm(traceabilityRaw),
      groupName: pick(mapped, ["group name", "nama grup"]),
      parentCompany: pick(mapped, ["parent company", "induk perusahaan"]),
      lat: pickNumber(mapped, ["lat", "latitude"]),
      lon: pickNumber(mapped, ["lon", "long", "longitude"]),
    });
  });
  return mills;
}

/**
 * Matches the real "ADM - All Supply Chain Information" workbook, columns
 * B, C, D, I (relabeled "UML ID"), K, M, N, O, P, Q, T. Everything else in
 * that sheet (plot/data status, district/province, file-name columns) is
 * pipeline bookkeeping, not master data — not imported.
 */
export async function parseMasterWorkbook(buf: ArrayBuffer): Promise<MillRecord[]> {
  const rows = await readFirstSheetRows(buf);
  return recordsFromRows(rowsToObjects(rows));
}

export type Chain = {
  id: string;
  name: string;
  mills: MillRecord[];
  village: number;
  buffer: number;
  /** Distinct Refinery/KCP Names in this group — the middle tier. */
  refineries: string[];
};

export function groupChains(mills: MillRecord[]): Chain[] {
  const map = new Map<string, MillRecord[]>();
  for (const m of mills) {
    const list = map.get(m.group) ?? [];
    list.push(m);
    map.set(m.group, list);
  }
  return [...map.entries()]
    .map(([name, rows]) => ({
      id: name,
      name,
      mills: rows,
      village: rows.filter((r) => r.traceability === "village").length,
      buffer: rows.filter((r) => r.traceability === "buffer").length,
      refineries: [...new Set(rows.map((r) => r.refinery).filter(Boolean))],
    }))
    .sort((a, b) => b.mills.length - a.mills.length);
}

/**
 * Group names arrive in whatever case each source sheet used ("Permata" next
 * to "SJIM", "HOK HUAT") — shown uppercase everywhere so a group reads the
 * same on its card, in the dropdown and in the breadcrumb (feedback 2,
 * B-07). The raw name stays the identity; the URL uses groupSlug.
 */
export function groupLabel(name: string) {
  return name.toUpperCase();
}

export function groupSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Localized traceability badge: "Village Level" -> "Tingkat desa",
 * "Buffer 20KM" -> "Buffer 20 km", and the one combined
 * "Village Level+Buffer 10KM" row keeps both parts.
 */
export function traceLabel(
  m: Pick<MillRecord, "traceability" | "traceabilityRaw">,
  t: { traceVillage: string; traceBuffer: string; traceBufferPlain: string },
): string {
  const raw = m.traceabilityRaw.toLowerCase();
  const parts: string[] = [];
  if (raw.includes("village") || raw.includes("desa")) parts.push(t.traceVillage);
  const km = parseBufferKm(m.traceabilityRaw);
  if (km != null) parts.push(t.traceBuffer.replace("{km}", String(km)));
  else if (raw.includes("buffer")) parts.push(t.traceBufferPlain);
  if (parts.length) return parts.join(" + ");
  if (m.traceability === "village") return t.traceVillage;
  if (m.traceability === "buffer") return t.traceBufferPlain;
  return "";
}
