/**
 * Shapes of `supply.json` (scripts/prepare-adm-soy-supply.py) — ADM's soybean
 * supply chain from the client's ADM_Facilities.gdb: four crushing plants with
 * their 40 / 80 NM catchments, and the ADM and third-party elevators (not tied
 * to a plant) — plus small helpers shared by the supply-chain and rail & river
 * views.
 */
import type { SoyGroup } from "@/lib/soy-copy";

export type Band = 5 | 10 | 20;
export type Basis = "rail" | "river" | "either";

export type CorridorAcres = { rail: number; river: number; either: number; both: number };

export type SupplyFieldStats = {
  fields: number;
  acres: number;
  /** Double-cropped with soybeans in 2025 (winter wheat/soybeans etc.). */
  doubleCropFields?: number;
  doubleCropAcres?: number;
  soyYears: { years: number; fields: number }[];
  cropHistoryHa: ({ year: number } & Record<SoyGroup, number>)[];
  topCounties: { county: string; state: string; fields: number; acres: number }[];
  states: { state: string; acres: number }[];
  /** Fields the rail/river data covers (all of them since the 7 Oct delivery). */
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
  /** The crushing plant of a plant catchment. */
  plant?: string;
  compliant: SupplyFieldStats;
  nonCompliant: SupplyNcStats;
};

export type AdmElevator = {
  id: string;
  name: string;
  /** ADM's facility code. */
  code?: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  address?: string | null;
  river?: string | null;
  type: string | null;
  f50?: string | null;
  f100?: string | null;
  lat: number;
  lon: number;
  /** Null for a second/third point at the same site (one catchment per site). */
  radiusM: number | null;
  /** The catchment this point belongs to (its site's first point). */
  site?: string;
  /** Crushing plants this elevator delivers to; absent = not known (shown under all plants only). */
  plants?: string[];
  railMi: number;
  riverMi: number;
  missingAttrs?: boolean;
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
  /** One of the 56 in IL, IA, MO, KY, MN, IN (earlier delivery; false since 7 Oct). */
  core: boolean;
  /** Crushing plants this elevator delivers to; absent = not known (shown under all plants only). */
  plants?: string[];
  railMi: number;
  riverMi: number;
};

export type Ring = { id: string; nm: number; radiusM: number };

/** A crushing plant; its catchments are <key>40, <key>80r (the 40–80 NM ring) and <key>80. */
export type Plant = {
  id: string;
  key: string;
  name: string;
  company: string | null;
  city: string | null;
  state: string | null;
  address?: string | null;
  lat: number;
  lon: number;
  f50: string | null;
  f100: string | null;
  railMi: number;
  riverMi: number;
  rings: Ring[];
};

export type SupplyData = {
  version?: number;
  source: string;
  cellDeg: number;
  gridDeg: number;
  bandsMi: Band[];
  coverageStates: string[];
  plants: Plant[];
  /** The first plant (Quincy), for older code paths. */
  plant: Plant;
  rings: Ring[];
  admElevators: AdmElevator[];
  thirdParty: ThirdParty[];
  /** Export terminals (NOLA). */
  terminals?: { name: string; address: string | null; lat: number; lon: number }[];
  /** The client's own buffer radii, for the notes (metres + unit it was in). */
  delivered: Record<string, { m: number; unit: string }>;
  /** Level-3 catchments under "direct": per plant <key>40, <key>80r, <key>80. */
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
  doubleCropFields?: number;
  /** Fields grouped by the catchments they are in (bit per catchment), so any
   * union can be summed without counting a field twice. Masks are hex strings
   * (more than 32 catchments). */
  combos?: {
    bits: Record<string, number>;
    /** [hex mask, fields, acres, acres within 10 mi of rail or river, fields soy all 8 seasons] */
    fields: (string | number)[][];
    /** [hex mask, fields, field acres, changed (deforested) acres] */
    nc: (string | number)[][];
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

/** Membership bits (see the prepare script): any plant 0–40 / 0–80 NM, any ADM
 * elevator, any third party, (unused) 6-state third party, also on ADM's
 * non-compliant list, double crop in 2025. */
export const FLAG = { q40: 1, q80: 2, adm: 4, tp: 8, core: 16, dual: 32, dc: 64 } as const;

/** A plant catchment id: q40, q80r, q80 (Quincy), dw… (Decatur West), ln… (Lincoln), dm… (Des Moines). */
const PLANT_UNIT = /^(q|dw|ln|dm)(40|80r|80)$/;
export function plantUnit(id: string | null | undefined): { key: string; ring: "40" | "80r" | "80" } | null {
  const m = id ? PLANT_UNIT.exec(id) : null;
  return m ? { key: m[1]!, ring: m[2] as "40" | "80r" | "80" } : null;
}
export const isPlantUnit = (id: string | null | undefined) => plantUnit(id) != null;
export function plantByKey(data: SupplyData, key: string): Plant | undefined {
  return data.plants.find((p) => p.key === key);
}
export function plantById(data: SupplyData, id: string): Plant | undefined {
  return data.plants.find((p) => p.id === id);
}
/** The plant a catchment belongs to (plant catchments only). */
export function plantOfScope(scope: string | null, data: SupplyData): Plant | undefined {
  const u = plantUnit(scope);
  return u ? plantByKey(data, u.key) : undefined;
}
/** "Lincoln 0–40 NM" for a plant catchment id; null for anything else. */
export function unitName(id: string | null | undefined, data: SupplyData, c: { scopeQ40: string; scopeQ80: string; scopeQ80r: string }): string | null {
  const u = plantUnit(id);
  const p = u ? plantByKey(data, u.key) : undefined;
  if (!u || !p) return null;
  return `${p.city ?? p.name} ${u.ring === "40" ? c.scopeQ40 : u.ring === "80" ? c.scopeQ80 : c.scopeQ80r}`;
}
export function ringRadius(p: Plant, nm: 40 | 80): number {
  return p.rings.find((r) => r.nm === nm)?.radiusM ?? nm * 1852;
}

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

const maskCache = new WeakMap<(string | number)[][], bigint[]>();
function masks(rows: (string | number)[][]): bigint[] {
  let m = maskCache.get(rows);
  if (!m) {
    m = rows.map((r) => (typeof r[0] === "string" ? BigInt(`0x${r[0]}`) : BigInt(r[0]!)));
    maskCache.set(rows, m);
  }
  return m;
}

/** Totals for the union of catchments `ids` (<plant>40, <plant>80, adm<n>, tp). */
export function comboTotals(data: SupplyData, ids: string[]): ComboTotals | null {
  const cb = data.combos;
  if (!cb) return null;
  let sel = 0n;
  let ring = false;
  for (const raw of ids) {
    // A plant's 40–80 NM ring has no bit of its own: its 0–80 NM bit stands in (see below).
    const u = plantUnit(raw);
    if (u?.ring === "80r") ring = true;
    const id = u?.ring === "80r" ? `${u.key}80` : raw;
    if (cb.bits[id] != null) sel |= 1n << BigInt(cb.bits[id]!);
  }
  const out = { fields: 0, acres: 0, ncFields: 0, ncAcres: 0, defo: 0 };
  if (!sel) return out;
  // The ring alone: 0–80 NM minus 0–40 NM.
  let not = 0n;
  if (ring && ids.length === 1) {
    const u = plantUnit(ids[0])!;
    const b40 = cb.bits[`${u.key}40`];
    if (b40 != null) not = 1n << BigInt(b40);
  }
  const fm = masks(cb.fields);
  cb.fields.forEach((row, i) => {
    if ((fm[i]! & sel) === 0n || (fm[i]! & not) !== 0n) return;
    out.fields += Number(row[1]);
    out.acres += Number(row[2]);
  });
  const nm = masks(cb.nc);
  cb.nc.forEach((row, i) => {
    if ((nm[i]! & sel) === 0n || (nm[i]! & not) !== 0n) return;
    out.ncFields += Number(row[1]);
    out.ncAcres += Number(row[2]);
    out.defo += Number(row[3]);
  });
  return out;
}
export const M_PER_MI = 1609.344;

/** The supply chain as PalmTrace's portfolio → group → mill:
 *  level 1 "all" (ADM's whole soybean supply chain), level 2 the supplier type
 *  ("direct" the crushing plants' own catchments, "adm" elevators, "tp" third
 *  parties), level 3 one catchment — the only level whose fields are drawn. */
export const GROUPS = ["direct", "adm", "tp"] as const;
export type Group = (typeof GROUPS)[number];

/** A union of catchments drawn together on the map: "combo:q40+adm1+adm3".
 * Members: plant catchments and ADM elevator sites. */
export const COMBO = "combo:";
export function isCombo(scope: string | null): boolean {
  return !!scope && scope.startsWith(COMBO);
}
export function comboMembers(scope: string): string[] {
  return scope.slice(COMBO.length).split("+").filter(Boolean);
}
/** The map scope for a set of catchments: one id stays itself, more become a combo. */
export function comboScope(ids: string[]): string {
  // A plant's 0–40 NM lies inside its 0–80 NM.
  const uniq = [...new Set(ids)].filter((id, _, all) => {
    const u = plantUnit(id);
    return !(u && u.ring !== "80" && all.includes(`${u.key}80`));
  });
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
  if (isPlantUnit(scope)) return "direct";
  if (scope.startsWith("adm")) return "adm";
  if (scope.startsWith("tp")) return "tp";
  return null;
}

/** Whether a field (or non-compliant field) belongs to a scope. */
export function inScope(scope: string | null, f: { flags: number; k?: string }): boolean {
  const has = (bit: number) => (f.flags & bit) !== 0;
  if (!scope || scope === "all") return has(FLAG.q80) || has(FLAG.adm) || has(FLAG.tp);
  if (scope === "direct") return has(FLAG.q80);
  if (scope === "adm") return has(FLAG.adm);
  if (scope === "tp") return has(FLAG.tp);
  if (scope === "tpcore") return has(FLAG.core);
  if (isCombo(scope)) return comboMembers(scope!).some((m) => inScope(m, f));
  const k = (f.k ?? "").split("|");
  const u = plantUnit(scope);
  if (u?.ring === "80") return k.includes(`${u.key}40`) || k.includes(`${u.key}80r`);
  return k.includes(scope);
}

/**
 * The Summary's selection (the sidebar) is a list of catchment ids: none =
 * the whole chain; one or more are combined, each field counted once.
 * Members: <plant>40, <plant>80 (0–80 NM), <plant>80r (40–80 NM ring, alone),
 * adm<n> (ADM elevators), tp (all third parties) and tp<n> (one third party,
 * alone). The map's scope string is derived from it.
 */
export const isExclusiveId = (id: string) => plantUnit(id)?.ring === "80r" || /^tp\d+$/.test(id);

/** The ADM elevator sites that have a catchment (one id per site). */
export function admSiteIds(data: SupplyData): string[] {
  return data.admElevators.filter((e) => e.radiusM).map((e) => e.id);
}

/** Selection ids for a scope string (the map's tree, a stored scope). */
export function idsFromScope(scope: string | null, data: SupplyData): string[] {
  if (!scope || scope === "all") return [];
  if (isCombo(scope)) return comboMembers(scope);
  if (scope === "direct") return data.plants.map((p) => `${p.key}80`);
  if (scope === "adm") return admSiteIds(data);
  return [scope];
}

/** The one catchment whose own statistics a selection equals, or null for a true combination. */
export function statsKey(sel: string[], data: SupplyData): string | null {
  if (!sel.length) return "all";
  const set = new Set(sel);
  for (const p of data.plants) if (set.has(`${p.key}80`)) set.delete(`${p.key}40`); // 0–40 NM lies inside 0–80 NM
  if (set.size === 1) return [...set][0]!;
  const adm = admSiteIds(data);
  if (set.size === adm.length && adm.every((id) => set.has(id))) return "adm";
  const p80 = data.plants.map((p) => `${p.key}80`);
  if (set.size === p80.length && p80.every((id) => set.has(id))) return "direct";
  return null;
}

/** The map-safe scope for a selection (third parties are too many fields to draw with others). */
export function scopeForSel(sel: string[], data: SupplyData): string {
  const key = statsKey(sel, data);
  if (key) return key;
  if (sel.includes("tp")) return "all";
  return comboScope(sel);
}

/** Toggle one member: exclusive ids (one third party, the 40–80 NM ring) stand alone. */
export function toggleSel(sel: string[], id: string): string[] {
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  if (isExclusiveId(id)) return [id];
  return [...sel.filter((x) => !isExclusiveId(x)), id];
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
  const pu = plantUnit(scope);
  const pl = pu ? plantByKey(data, pu.key) : undefined;
  if (pl) return circleBounds(pl.lon, pl.lat, ringRadius(pl, pu!.ring === "40" ? 40 : 80));
  if (scope === "direct") {
    data.plants.forEach((p) => merge(circleBounds(p.lon, p.lat, ringRadius(p, 80))));
    return b;
  }
  const adm = data.admElevators.find((e) => e.id === scope && e.radiusM);
  if (adm) return circleBounds(adm.lon, adm.lat, adm.radiusM!);
  const tp = data.thirdParty.find((e) => e.id === scope);
  if (tp) return circleBounds(tp.lon, tp.lat, tp.radiusM);
  if (scope === "adm") data.admElevators.filter((e) => e.radiusM).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM!)));
  else if (scope === "tp" || scope === "tpcore")
    data.thirdParty.filter((e) => scope === "tp" || e.core).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
  else {
    data.plants.forEach((p) => merge(circleBounds(p.lon, p.lat, ringRadius(p, 80))));
    data.admElevators.filter((e) => e.radiusM).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM!)));
    data.thirdParty.forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
  }
  return b;
}

/** "20 mi · 32 km" */
export function radiusLabel(m: number, lang: "en" | "id") {
  const loc = lang === "id" ? "id-ID" : "en-US";
  // Nautical miles, as ADM's buffers.
  const nm = m / 1852;
  const nmText = nm.toLocaleString(loc, { maximumFractionDigits: Math.abs(nm - Math.round(nm)) < 0.1 ? 0 : 1 });
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
