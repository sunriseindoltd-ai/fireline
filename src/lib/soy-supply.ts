/**
 * Shapes of `supply.json` (scripts/prepare-adm-soy-supply.py) — the Quincy
 * supply chain from the client's ADM_SOY.gdb — plus small helpers shared by
 * the supply-chain and rail & river views.
 */
import type { SoyGroup } from "@/lib/soy-copy";

export type Band = 5 | 10 | 20;
export type Basis = "rail" | "river" | "either";

export type CorridorAcres = { rail: number; river: number; either: number; both: number };

export type SupplyFieldStats = {
  fields: number;
  acres: number;
  soyYears: { years: number; fields: number }[];
  cropHistoryHa: ({ year: number } & Record<SoyGroup, number>)[];
  topCounties: { county: string; state: string; fields: number; acres: number }[];
  states: { state: string; acres: number }[];
  /** Fields in the 7 states the rail/river data covers. */
  coverageAcres: number;
  coverageFields: number;
  corridor: Record<string, CorridorAcres>;
};

export type SupplyNcStats = {
  fields: number;
  acres: number;
  changeAcres: number;
  alsoCompliant: number;
  pointOnly: number;
  byYear: { year: number; fields: number }[];
  unknownYear: number;
  byBefore: Record<string, number>;
  byState: { state: string; fields: number }[];
  /** How much of each field changed: whole (≥90%), most (≥50%), part, unknown. */
  byExtent?: Record<string, number>;
  /** 2025 land use: crop, pasture, nonag, unknown. */
  byUse?: Record<string, number>;
};

export type Catchment = {
  id: string;
  kind: "plant" | "tier" | "adm" | "tp";
  name: string;
  radiusM?: number;
  compliant: SupplyFieldStats;
  nonCompliant: SupplyNcStats;
};

export type AdmElevator = {
  id: string;
  name: string;
  city: string | null;
  county: string | null;
  state: string | null;
  river: string | null;
  type: string | null;
  f50: string | null;
  f100: string | null;
  lat: number;
  lon: number;
  /** Null for a second/third point at the same site (one catchment per site). */
  radiusM: number | null;
  /** The catchment this point belongs to (its site's first point). */
  site?: string;
  railMi: number;
  riverMi: number;
  missingAttrs: boolean;
};

export type ThirdParty = {
  id: string;
  tract: string | null;
  company: string | null;
  county: string | null;
  state: string | null;
  type: string | null;
  lat: number;
  lon: number;
  radiusM: number;
  /** One of the 56 in IL, IA, MO, KY, MN, IN. */
  core: boolean;
  railMi: number;
  riverMi: number;
};

export type SupplyData = {
  source: string;
  cellDeg: number;
  gridDeg: number;
  bandsMi: Band[];
  coverageStates: string[];
  plant: {
    name: string;
    company: string | null;
    city: string | null;
    state: string | null;
    lat: number;
    lon: number;
    f50: string | null;
    f100: string | null;
    railMi: number;
    riverMi: number;
  };
  /** Catchment circles in statute miles; `deliveredM` is the client's buffer (nautical miles). */
  rings: { id: "q40" | "q80"; nm: number; radiusM: number; deliveredM: number; deliveredUnit: string }[];
  admElevators: AdmElevator[];
  thirdParty: ThirdParty[];
  /** The client's own buffer radii, for the notes (metres + unit it was in). */
  delivered: Record<"q40" | "q80" | "adm" | "tp", { m: number; unit: string }>;
  /** Level-3 catchments under "direct": q40 (0–40 mi), q80r (40–80 mi ring), q80 (0–80 mi). */
  directUnits: string[];
  /** Catchments drawn from several unit files (q80 = q40 + q80r). */
  unitSets?: Record<string, string[]>;
  catchments: Catchment[];
  nonCompliantAll: SupplyNcStats;
  /** [id, fields, bytes] — one fields/units/<id>.geojson per catchment the map can show. */
  units: [string, number, number][];
  /** [gx, gy, acres, coverageAcres, rail10, river10, either10, % of the cell] per `gridDeg` cell; finer levels in layers/grid.json. */
  grid: number[][];
  network: { railKm: Record<string, number>; riverSystemKm2: number; riverSystems?: number; riverSystemPolygons: number };
  fieldsTotal: number;
  fieldsDelivered?: number;
  /** Fields grouped by the catchments they are in (bit per catchment), so any
   * union can be summed without counting a field twice. */
  combos?: {
    bits: Record<string, number>;
    /** [mask, fields, acres, acres within 10 mi of rail or river, fields soy all 8 seasons] */
    fields: number[][];
    /** [mask, fields, field acres, changed (deforested) acres] */
    nc: number[][];
  };
};

/** Field properties in fields/units/*.geojson. */
export type SupplyFieldProps = {
  id: string;
  a: number;
  y: number;
  c: string;
  f: number;
  /** Every catchment the field is in, "|"-separated (q40, q80r, adm3, tp17…). */
  k: string;
  r: number | null;
  v: number | null;
  s: string;
  n: string | null;
};
/** Non-compliant field properties in fields/noncomply.geojson. */
export type NcProps = {
  id: string;
  a: number;
  ch: number | null;
  s: string | null;
  n: string | null;
  c: string;
  b: "treed" | "natural" | "crop" | null;
  y: number | null;
  s26: string | null;
  c24: string | null;
  c25: string | null;
  f: number;
  k: string;
  po: boolean;
  /** Soybean seasons 2018–2025 (null for points without a polygon). */
  sy: number | null;
  /** Share of the field that changed: whole (≥90%), most (≥50%), part. */
  ex: "whole" | "most" | "part" | null;
  /** 2025 land use: crop (incl. soybeans), pasture/hay, not agricultural. */
  u: "crop" | "pasture" | "nonag" | null;
  /** Miles to active rail / the main river system (null outside the 7 states). */
  r: number | null;
  v: number | null;
};

/** Membership bits (see the prepare script): Quincy 0–40 / 0–80 mi, any ADM
 * elevator, any third party, any 6-state third party, also on ADM's
 * non-compliant list. */
export const FLAG = { q40: 1, q80: 2, adm: 4, tp: 8, core: 16, dual: 32 } as const;

export const AC_TO_HA = 0.40468564224;

/** US state names for the abbreviations in the data. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AR: "Arkansas", DE: "Delaware", GA: "Georgia", IA: "Iowa", IL: "Illinois", IN: "Indiana",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MD: "Maryland", MI: "Michigan", MN: "Minnesota", MO: "Missouri",
  MS: "Mississippi", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NJ: "New Jersey", NY: "New York",
  OH: "Ohio", OK: "Oklahoma", PA: "Pennsylvania", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  VA: "Virginia", WI: "Wisconsin",
  // The rest of the lower 48 (all US soybean fields reach a few of them).
  AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", FL: "Florida", ID: "Idaho",
  MA: "Massachusetts", ME: "Maine", MT: "Montana", NH: "New Hampshire", NM: "New Mexico", NV: "Nevada", OR: "Oregon",
  RI: "Rhode Island", TX: "Texas", UT: "Utah", VT: "Vermont", WA: "Washington", WV: "West Virginia", WY: "Wyoming",
}; // prettier-ignore
export const stateName = (st: string | null | undefined) => (st ? (US_STATES[st] ? `${US_STATES[st]} (${st})` : st) : "—");

export type ComboTotals = { fields: number; acres: number; ncFields: number; ncAcres: number; defo: number };

/** Totals for the union of catchments `ids` (q40, q80, adm<n>, tp, tpcore). */
export function comboTotals(data: SupplyData, ids: string[]): ComboTotals | null {
  const cb = data.combos;
  if (!cb) return null;
  let sel = 0;
  for (const id of ids) if (cb.bits[id] != null) sel |= 1 << cb.bits[id]!;
  const out = { fields: 0, acres: 0, ncFields: 0, ncAcres: 0, defo: 0 };
  if (!sel) return out;
  for (const [m, n, a] of cb.fields) {
    if ((m! & sel) === 0) continue;
    out.fields += n!;
    out.acres += a!;
  }
  for (const [m, n, a, ch] of cb.nc) {
    if ((m! & sel) === 0) continue;
    out.ncFields += n!;
    out.ncAcres += a!;
    out.defo += ch!;
  }
  return out;
}
export const M_PER_MI = 1609.344;

/** The supply chain as PalmTrace's portfolio → group → mill:
 *  level 1 "all" (Quincy), level 2 the supplier type ("direct" Quincy
 *  catchment, "adm" elevators, "tp" third parties), level 3 one catchment —
 *  the only level whose fields are drawn. */
export const GROUPS = ["direct", "adm", "tp"] as const;
export type Group = (typeof GROUPS)[number];

/** A union of catchments drawn together on the map: "combo:q40+adm1+adm3".
 * Members: q40, q80 (0–80 NM) and ADM elevator sites. */
export const COMBO = "combo:";
export function isCombo(scope: string | null): boolean {
  return !!scope && scope.startsWith(COMBO);
}
export function comboMembers(scope: string): string[] {
  return scope.slice(COMBO.length).split("+").filter(Boolean);
}
/** The map scope for a set of catchments: one id stays itself, more become a combo. */
export function comboScope(ids: string[]): string {
  // 0–40 NM lies inside 0–80 NM.
  const uniq = [...new Set(ids)].filter((id, _, all) => !(id === "q40" && all.includes("q80")));
  return uniq.length === 1 ? uniq[0]! : COMBO + uniq.join("+");
}

export function levelOf(scope: string | null): 1 | 2 | 3 {
  if (!scope || scope === "all") return 1;
  if (isCombo(scope)) return 3;
  if ((GROUPS as readonly string[]).includes(scope) || scope === "tpcore") return 2;
  return 3;
}
export function groupOf(scope: string | null): Group | null {
  if (!scope || scope === "all" || isCombo(scope)) return null;
  if ((GROUPS as readonly string[]).includes(scope)) return scope as Group;
  if (scope === "tpcore") return "tp";
  if (scope === "q40" || scope.startsWith("q80")) return "direct";
  if (scope.startsWith("adm")) return "adm";
  if (scope.startsWith("tp")) return "tp";
  return null;
}

/** Whether a field (or non-compliant field) belongs to a scope. */
export function inScope(scope: string | null, f: { flags: number; k?: string }): boolean {
  const has = (bit: number) => (f.flags & bit) !== 0;
  if (!scope || scope === "all") return has(FLAG.q80) || has(FLAG.adm) || has(FLAG.tp);
  if (scope === "direct" || scope === "q80") return has(FLAG.q80);
  if (scope === "adm") return has(FLAG.adm);
  if (scope === "tp") return has(FLAG.tp);
  if (scope === "tpcore") return has(FLAG.core);
  if (isCombo(scope)) return comboMembers(scope!).some((m) => inScope(m, f));
  if (scope === "q40") return has(FLAG.q40);
  return (f.k ?? "").split("|").includes(scope);
}

/** Points along a circle of radiusM from bearing b0 to b1 (degrees, clockwise from north). */
export function arc(lon: number, lat: number, radiusM: number, b0: number, b1: number, steps = 48): number[][] {
  const R = 6371008.8;
  const d = radiusM / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const out: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = ((b0 + ((b1 - b0) * i) / steps) * Math.PI) / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 =
      λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([Number(((λ2 * 180) / Math.PI).toFixed(5)), Number(((φ2 * 180) / Math.PI).toFixed(5))]);
  }
  return out;
}

/** A geodesic circle (the catchments are plain buffers around a point). */
export function circle(lon: number, lat: number, radiusM: number, steps = 96): number[][] {
  return arc(lon, lat, radiusM, 0, 360, steps);
}

/** The unit files a level-3 catchment is drawn from, or null when it has none. */
export function unitParts(scope: string | null, data: SupplyData): string[] | null {
  if (!scope) return null;
  if (isCombo(scope)) {
    const parts = comboMembers(scope!).flatMap((m) => unitParts(m, data) ?? []);
    return parts.length ? [...new Set(parts)] : null;
  }
  const set = data.unitSets?.[scope];
  if (set) return set;
  return data.units.some(([id]) => id === scope) ? [scope] : null;
}

export function ringBounds(ring: number[][]): [[number, number], [number, number]] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // prettier-ignore
  for (const [x, y] of ring) {
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export function circleBounds(lon: number, lat: number, radiusM: number): [[number, number], [number, number]] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
}

/** The map area a scope covers, for fitting the view. */
export function scopeBounds(scope: string | null, data: SupplyData): [[number, number], [number, number]] | null {
  const { lon, lat } = data.plant;
  const r40 = data.rings.find((r) => r.id === "q40")!.radiusM;
  const r80 = data.rings.find((r) => r.id === "q80")!.radiusM;
  let b: [[number, number], [number, number]] | null = null;
  const merge = (bb: [[number, number], [number, number]]) => {
    b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; // prettier-ignore
  };
  if (isCombo(scope)) {
    for (const m of comboMembers(scope!)) {
      const bb = scopeBounds(m, data);
      if (bb) merge(bb);
    }
    return b;
  }
  if (scope === "q40") return circleBounds(lon, lat, r40);
  if (scope === "direct" || scope === "q80" || scope === "q80r") return circleBounds(lon, lat, r80);
  const adm = data.admElevators.find((e) => e.id === scope && e.radiusM);
  if (adm) return circleBounds(adm.lon, adm.lat, adm.radiusM!);
  const tp = data.thirdParty.find((e) => e.id === scope);
  if (tp) return circleBounds(tp.lon, tp.lat, tp.radiusM);
  if (scope === "adm") data.admElevators.filter((e) => e.radiusM).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM!)));
  else if (scope === "tp" || scope === "tpcore")
    data.thirdParty.filter((e) => scope === "tp" || e.core).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
  else {
    merge(circleBounds(lon, lat, r80));
    data.admElevators.filter((e) => e.radiusM).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM!)));
    data.thirdParty.forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
  }
  return b;
}

/** "20 mi · 32 km" */
export function radiusLabel(m: number, lang: "en" | "id") {
  const loc = lang === "id" ? "id-ID" : "en-US";
  // Nautical miles, as ADM's buffers (third parties come to 17.4 NM = 20 mi).
  const nm = m / 1852;
  const nmText = nm.toLocaleString(loc, { maximumFractionDigits: Math.abs(nm - Math.round(nm)) < 0.05 ? 0 : 1 });
  return `${nmText} NM · ${Math.round(m / 1000).toLocaleString(loc)} km`;
}

/** Distance-band colours, near → far (rail & river view). */
export const BAND_COLORS = {
  b5: "#155433",
  b10: "#3b8757",
  b20: "#8cc29a",
  far: "#d8d3c4",
  none: "#b9b9bd",
};
export const NC_COLOR = "#c9695e";
export const NC_INK = "#8f3a31";
/** The zoomed-out marker ring: stronger than the fill so a few fields stand out among many. */
export const NC_MARK = "#c8372b";
export const FIELD_COLOR = "#3b8757";
export const TP_COLOR = "#d2a95b";
export const ADM_COLOR = "#ffffff";
export const PLANT_COLOR = "#1f6fd1";
export const RAIL_COLOR = "#2b2b2e";
export const RIVER_COLOR = "#4a93ea";

export const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
