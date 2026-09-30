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
  rings: { id: "q40" | "q80"; nm: number; radiusM: number }[];
  admElevators: AdmElevator[];
  thirdParty: ThirdParty[];
  catchments: Catchment[];
  nonCompliantAll: SupplyNcStats;
  /** [cellX, cellY, fields] — cells of `cellDeg` that have a file. */
  cells: [number, number, number][];
  /** [gx, gy, acres, coverageAcres, rail10, river10, either10] per `gridDeg` cell. */
  grid: [number, number, number, number, number, number, number][];
  network: { railKm: Record<string, number>; riverSystemKm2: number; riverSystems?: number; riverSystemPolygons: number };
  fieldsTotal: number;
};

/** Field properties in fields/cells/*.geojson. */
export type SupplyFieldProps = {
  id: string;
  a: number;
  y: number;
  c: string;
  f: number;
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
  po: boolean;
};

/** Field / non-compliant membership bits (see the prepare script). */
export const FLAG = { q40: 1, q80: 2, adm: 4, tp: 8, tp56: 16, dual: 32 } as const;

export const AC_TO_HA = 0.40468564224;
export const M_PER_MI = 1609.344;

/** The tier a catchment id belongs to, for highlighting fields by flag. */
export function tierBit(id: string | null): number | null {
  if (!id || id === "all") return null;
  if (id === "q40") return FLAG.q40;
  if (id === "q80") return FLAG.q80;
  if (id === "adm" || id.startsWith("adm")) return FLAG.adm;
  // Fields carry no "6 states" bit; highlight the third-party tier.
  if (id === "tpcore") return FLAG.tp;
  if (id === "tp" || id.startsWith("tp")) return FLAG.tp;
  return null;
}

/** A geodesic circle (the catchments are plain buffers around a point). */
export function circle(lon: number, lat: number, radiusM: number, steps = 96): number[][] {
  const R = 6371008.8;
  const d = radiusM / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 =
      λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([Number(((λ2 * 180) / Math.PI).toFixed(5)), Number(((φ2 * 180) / Math.PI).toFixed(5))]);
  }
  return ring;
}

export function circleBounds(lon: number, lat: number, radiusM: number): [[number, number], [number, number]] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
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
export const FIELD_COLOR = "#3b8757";
export const TP_COLOR = "#d2a95b";
export const ADM_COLOR = "#ffffff";
export const PLANT_COLOR = "#1f6fd1";
export const RAIL_COLOR = "#2b2b2e";
export const RIVER_COLOR = "#4a93ea";

export const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
