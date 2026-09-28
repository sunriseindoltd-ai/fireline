import type { Fc, MillRecord, TraceLevel } from "@/lib/ledger";

export type TraceFilter = "all" | "village" | "buffer";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function propsMap(props: Record<string, unknown> | null | undefined) {
  const out: Record<string, string> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    const val = String(v ?? "").trim();
    if (val) out[norm(k)] = val;
  }
  return out;
}

function pickProp(pm: Record<string, string>, names: string[]) {
  for (const n of names) {
    const v = pm[norm(n)];
    if (v) return v;
  }
  return "";
}

export function featureMillKey(props: Record<string, unknown> | null | undefined) {
  const pm = propsMap(props);
  return {
    uml: pickProp(pm, ["uml", "uml id", "uml_id", "umlid", "uml id 2026", "mill uml", "mill_uml"]),
    node: pickProp(pm, ["nodeid", "node id", "node_id"]),
    mill: pickProp(pm, ["mill name", "mill", "mill_name", "pabrik", "nama pabrik", "millname"]),
  };
}

export function hasJoinKey(props: Record<string, unknown> | null | undefined) {
  const k = featureMillKey(props);
  return Boolean(k.uml || k.node || k.mill);
}

export function featureMatchesMill(
  props: Record<string, unknown> | null | undefined,
  mill: MillRecord,
): boolean {
  const k = featureMillKey(props);
  if (mill.umlId && k.uml && norm(k.uml) === norm(mill.umlId)) return true;
  if (mill.nodeId && k.node && norm(k.node) === norm(mill.nodeId)) return true;
  if (mill.millName && k.mill && norm(k.mill) === norm(mill.millName)) return true;
  return false;
}

export function matchMill(
  props: Record<string, unknown> | null | undefined,
  mills: MillRecord[],
): MillRecord | undefined {
  return mills.find((m) => featureMatchesMill(props, m));
}

export function collectionHasJoinKeys(fc: Fc | null): boolean {
  return Boolean(fc?.features.some((f) => hasJoinKey(f.properties)));
}

export function classifyAreaKind(props: Record<string, unknown> | null | undefined): TraceLevel {
  const pm = propsMap(props);
  const blob = `${Object.keys(pm).join(" ")} ${Object.values(pm).join(" ")}`.toLowerCase();
  if (/village|desa|batas\s*desa|kelurahan|admin/.test(blob)) return "village";
  if (/buffer|\d+\s*km/.test(blob)) return "buffer";
  return "unknown";
}

export function filterByMills(
  fc: Fc | null,
  mills: MillRecord[],
  keepUnmatched: boolean,
): Fc | null {
  if (!fc) return null;
  if (mills.length === 0) return fc;
  const features = fc.features.filter((f) => {
    if (!hasJoinKey(f.properties)) return keepUnmatched;
    return mills.some((m) => featureMatchesMill(f.properties, m));
  });
  return { type: "FeatureCollection", features };
}

export function filterAreas(
  fc: Fc | null,
  mills: MillRecord[],
  trace: TraceFilter,
): Fc | null {
  if (!fc) return null;
  const join = mills.length > 0 && collectionHasJoinKeys(fc);
  const features = fc.features.filter((f) => {
    const kind = classifyAreaKind(f.properties);
    if (trace !== "all" && kind !== "unknown" && kind !== trace) return false;
    if (!join || !hasJoinKey(f.properties)) return true;
    return mills.some((m) => featureMatchesMill(f.properties, m));
  });
  return { type: "FeatureCollection", features };
}

/** "YES"/"NO" -> "yes"/"no", anything else (missing, blank) -> "". */
function normComply(props: Record<string, unknown> | null | undefined): "yes" | "no" | "" {
  const v = String(props?.EUDR_Comply ?? "")
    .trim()
    .toUpperCase();
  return v === "YES" ? "yes" : v === "NO" ? "no" : "";
}

/** "Low Risk"/"Medium Risk"/"High Risk" -> "low"/"medium"/"high". */
function normRisk(props: Record<string, unknown> | null | undefined): "low" | "medium" | "high" | "" {
  const v = String(props?.Overall_Risk ?? "").toLowerCase();
  if (v.startsWith("low")) return "low";
  if (v.startsWith("medium")) return "medium";
  if (v.startsWith("high")) return "high";
  return "";
}

const MITIGATION_LETTERS = new Set(["A", "B", "C", "D", "E", "F"]);

/**
 * Canonical text for each mitigation class — the single source of truth
 * used everywhere a letter (A–F) needs a human-readable explanation (plot
 * popup, plot table tooltip, EUDR summary chart legend), instead of each
 * plot's own free-text `Risk_Mitigation_Class` value, which isn't always
 * worded identically across rows/mills even for the same letter.
 */
export const MITIGATION_DESCRIPTIONS: Record<string, string> = {
  A: "Compliant — Low-Risk Area; Approved for Submission",
  B: "Compliant — Medium-Risk Area; Approved with Routine Monitoring",
  C: "Compliant — High-Risk Area; Approved with Enhanced Monitoring",
  D: "Non-Compliant — Low-Risk Area; Pending Geospatial Review",
  E: "Non-Compliant — Medium-Risk Area; Mitigation Required Before Submission",
  F: "Non-Compliant — High-Risk Area; Not Approved for Submission",
};

/**
 * `Desc_Issue` on a non-compliant plot is a comma-separated list of short
 * codes (e.g. "HP, HPK") naming which protected/production forest category
 * (or other issue) it overlaps — the same KLHK/BIG kawasan-hutan codes
 * already used elsewhere in this app (eudr-summary.tsx's forest-overlap
 * chart, HL/HP/HPK/HPT). Expanded here into a readable label so a plot
 * popup can say *why* a plot failed, not just a bare code.
 */
export const ISSUE_DESCRIPTIONS: Record<string, string> = {
  Deforestation: "Deforestation detected after the 2020 cutoff",
  HL: "HL — Hutan Lindung (Protected Forest)",
  HP: "HP — Hutan Produksi (Production Forest)",
  HPK: "HPK — Hutan Produksi Konversi (Convertible Production Forest)",
  HPT: "HPT — Hutan Produksi Terbatas (Limited Production Forest)",
  KSA_KPA: "KSA/KPA — Kawasan Suaka Alam / Pelestarian Alam (Nature Reserve / Conservation Area)",
  TWA: "TWA — Taman Wisata Alam (Nature Recreation Park)",
  TN: "TN — Taman Nasional (National Park)",
  "Indigenous Forest": "Overlaps recognized Indigenous Forest",
  "Community Forest": "Overlaps recognized Community Forest",
};

/** Indonesian counterparts of the two tables above — same keys. */
export const MITIGATION_DESCRIPTIONS_ID: Record<string, string> = {
  A: "Patuh — area risiko rendah; disetujui untuk pengajuan",
  B: "Patuh — area risiko sedang; disetujui dengan pemantauan rutin",
  C: "Patuh — area risiko tinggi; disetujui dengan pemantauan ketat",
  D: "Tidak patuh — area risiko rendah; menunggu tinjauan geospasial",
  E: "Tidak patuh — area risiko sedang; perlu mitigasi sebelum pengajuan",
  F: "Tidak patuh — area risiko tinggi; tidak disetujui untuk pengajuan",
};

export const ISSUE_DESCRIPTIONS_ID: Record<string, string> = {
  Deforestation: "Deforestasi terdeteksi setelah cutoff 2020",
  HL: "HL — Hutan Lindung",
  HP: "HP — Hutan Produksi",
  HPK: "HPK — Hutan Produksi Konversi",
  HPT: "HPT — Hutan Produksi Terbatas",
  KSA_KPA: "KSA/KPA — Kawasan Suaka Alam / Pelestarian Alam",
  TWA: "TWA — Taman Wisata Alam",
  TN: "TN — Taman Nasional",
  "Indigenous Forest": "Tumpang tindih dengan hutan adat yang diakui",
  "Community Forest": "Tumpang tindih dengan hutan kemasyarakatan yang diakui",
};

export function mitigationText(letter: string, lang: "en" | "id"): string | undefined {
  return (lang === "id" ? MITIGATION_DESCRIPTIONS_ID : MITIGATION_DESCRIPTIONS)[letter];
}

export function issueText(code: string, lang: "en" | "id"): string {
  return (lang === "id" ? ISSUE_DESCRIPTIONS_ID : ISSUE_DESCRIPTIONS)[code] ?? code;
}

/** "HP, HPK" -> "HP — Hutan Produksi (Production Forest); HPK — Hutan Produksi Konversi (...)" */
export function describeNonComplyIssue(descIssue: unknown, lang: "en" | "id" = "en"): string {
  const raw = String(descIssue ?? "").trim();
  if (!raw) return "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => issueText(part, lang))
    .join("; ");
}

/**
 * "Village, SubDistrict, District" for a plot — lets someone with only
 * dashboard access (no ArcGIS/raw GIS file) tell where a plot actually is,
 * e.g. to identify and exclude a non-compliant one from the supply chain.
 * `Administration` already carries this exact combined string on every
 * prepared plot; the fallback only matters if a future drop omits it.
 */
export function locationText(props: Record<string, unknown> | null | undefined): string {
  const admin = String(props?.Administration ?? "").trim();
  if (admin) return admin;
  return [props?.Village, props?.SubDistric, props?.District]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** "B. Compliant — Medium-Risk Area…" -> "B" (mirrors eudr-aggregates.server.ts). */
function normMitigation(props: Record<string, unknown> | null | undefined): string {
  const letter = String(props?.Risk_Mitigation_Class ?? "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return MITIGATION_LETTERS.has(letter) ? letter : "";
}

/**
 * Permata's prepared plots use `HECTARAGE`; DOMAS's use `Hectarage`; SJIM's
 * use `ha` (all three traced back to how each source's original GDB/CSV
 * happened to name the column) — reading only one silently zeroed out
 * every area figure (Mapped Area KPI, EUDR area charts, this popup's own
 * Hectare row) for every mill in whichever group used a different name.
 * Checked all three here rather than renaming the field in gigabytes of
 * already-uploaded plot files.
 */
function hectarage(props: Record<string, unknown> | null | undefined): number {
  const raw = props?.HECTARAGE ?? props?.Hectarage ?? props?.ha;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const DEF_YEAR_KEYS = ["Def_21", "Def_22", "Def_23", "Def_24", "Def_25", "Def_26"];
// Every other forest-category/social overlap flag a plot can carry besides
// deforestation — mirrors eudr-aggregates.server.ts's forestOverlap fields
// plus the Community_F/Indigenous_F/Social_F columns eudr-summary.tsx reads.
const NON_DEFORESTATION_ISSUE_KEYS = [
  "HL",
  "HP",
  "HPK",
  "HPT",
  "CA",
  "FL_LAIN",
  "KSA_KPA",
  "SM",
  "TAHURA",
  "TB",
  "TN",
  "TWA",
  "Community_F",
  "Indigenous_F",
  "Social_F",
];
// BNS-only: cross-checking BNS's own delivered per-plot deforestation
// figures found 92.5% of the nonzero Def_21..Def_26 values are under 0.5ha —
// sub-hectare, almost certainly satellite-resolution noise rather than real
// land-clearing. Per stakeholder decision, a BNS plot whose *only* issue is
// deforestation under this threshold (no genuine forest-category/social
// overlap) is treated as compliant instead of inheriting the delivered
// data's flat "any nonzero year disqualifies it" rule. Scoped to group ===
// "BNS" only — every other group's EUDR_Comply/Risk_Mitigation_Class is left
// exactly as delivered. Mirrored in scripts/prepare-eudr-stats.mjs.
const BNS_DEFORESTATION_NOISE_THRESHOLD_HA = 0.5;

function bnsHasRealIssue(props: Record<string, unknown> | null | undefined): boolean {
  if (NON_DEFORESTATION_ISSUE_KEYS.some((k) => Number(props?.[k] ?? 0) > 0)) return true;
  return DEF_YEAR_KEYS.some((k) => Number(props?.[k] ?? 0) >= BNS_DEFORESTATION_NOISE_THRESHOLD_HA);
}

const BNS_MITIGATION_DOWNGRADE: Record<string, string> = { D: "A", E: "B", F: "C" };

/** `normComply`, adjusted for BNS's deforestation-noise threshold (see above). */
function effectiveComply(
  props: Record<string, unknown> | null | undefined,
  group: string | undefined,
): "yes" | "no" | "" {
  const raw = normComply(props);
  if (raw !== "no" || group !== "BNS") return raw;
  return bnsHasRealIssue(props) ? "no" : "yes";
}

/** `normMitigation`, adjusted for BNS's deforestation-noise threshold (see above). */
function effectiveMitigation(
  props: Record<string, unknown> | null | undefined,
  group: string | undefined,
): string {
  const letter = normMitigation(props);
  if (group !== "BNS") return letter;
  const downgrade = BNS_MITIGATION_DOWNGRADE[letter];
  if (!downgrade) return letter;
  return bnsHasRealIssue(props) ? letter : downgrade;
}

export function decoratePlots(fc: Fc | null, mills: MillRecord[]): Fc | null {
  if (!fc) return null;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => {
      const mill = matchMill(f.properties, mills);
      return {
        ...f,
        properties: {
          ...(f.properties ?? {}),
          _trace: mill?.traceability ?? "unknown",
          _mill: mill?.millName ?? "",
          _id: mill?.id ?? "",
          _comply: effectiveComply(f.properties, mill?.group),
          _risk: normRisk(f.properties),
          _mitigation: effectiveMitigation(f.properties, mill?.group),
          _location: locationText(f.properties),
          _hectarage: hectarage(f.properties),
        },
      };
    }),
  };
}

export function decorateMillGeom(fc: Fc | null, mills: MillRecord[]): Fc | null {
  if (!fc) return null;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => {
      const mill = matchMill(f.properties, mills);
      return {
        ...f,
        properties: {
          ...(f.properties ?? {}),
          _trace: mill?.traceability ?? "unknown",
          _mill: mill?.millName ?? String(f.properties?.name ?? f.properties?.MILL ?? ""),
          _id: mill?.id ?? "",
        },
      };
    }),
  };
}

/**
 * Mill points built directly from the master workbook's LAT/LON columns —
 * the primary source for mill locations on the map. Mills without valid
 * coordinates are skipped; a separately uploaded "Mill locations" GeoJSON
 * can still cover those (see `mergeMillPoints`).
 */
/**
 * Whether a mill's master-list coordinates are usable. 0,0 ("Null Island",
 * in the Gulf of Guinea) is what an empty coordinate cell becomes in the
 * source sheet — it put an SJIM mill "in Africa" (ADM feedback 1, point 4) —
 * so it counts as missing, like a blank.
 */
export function hasCoords(m: Pick<MillRecord, "lat" | "lon">): boolean {
  if (typeof m.lat !== "number" || typeof m.lon !== "number") return false;
  if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) return false;
  if (m.lat === 0 && m.lon === 0) return false;
  return Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180;
}

export function millPointsFromMaster(mills: MillRecord[]): Fc {
  return {
    type: "FeatureCollection",
    features: mills
      .filter(hasCoords)
      .map((m) => ({
        type: "Feature",
        properties: { _trace: m.traceability, _mill: m.millName, _id: m.id, _refinery: m.refinery },
        geometry: { type: "Point", coordinates: [m.lon as number, m.lat as number] },
      })),
  };
}

/**
 * Master-derived points first; any mill missing from that set (no LAT/LON
 * yet) falls back to the uploaded "Mill locations" GeoJSON, matched by join
 * key (UML ID / NodeID / mill name).
 */
export function mergeMillPoints(fromMaster: Fc, uploaded: Fc | null): Fc {
  if (!uploaded) return fromMaster;
  const covered = new Set(fromMaster.features.map((f) => f.properties?._id).filter(Boolean));
  const extra = uploaded.features.filter((f) => {
    const id = f.properties?._id;
    return typeof id === "string" && id && !covered.has(id);
  });
  return { type: "FeatureCollection", features: [...fromMaster.features, ...extra] };
}

export function decorateAreas(fc: Fc | null): Fc | null {
  if (!fc) return null;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...(f.properties ?? {}),
        _kind: classifyAreaKind(f.properties),
      },
    })),
  };
}

export function millHaystack(m: MillRecord) {
  return [
    m.millName,
    m.refinery,
    m.group,
    m.umlId,
    m.nodeId,
    m.groupName,
    m.parentCompany,
    m.port,
  ]
    .join(" ")
    .toLowerCase();
}
