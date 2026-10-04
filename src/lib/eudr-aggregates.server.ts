import { tenantPrefix, type Tenant } from "@/lib/tenants";

export type EudrSummary = {
  totalPlots: number;
  totalAreaHa: number;
  comply: { yes: number; no: number };
  risk: { low: number; medium: number; high: number };
  mitigation: Record<"A" | "B" | "C" | "D" | "E" | "F", { count: number; areaHa: number }>;
  deforestationByYear: Record<string, number>;
  forestOverlap: { HL: number; HP: number; HPK: number; HPT: number };
  plotType: Record<string, { count: number; areaHa: number }>;
};

// Only Permata KIM's plots have been uploaded so far — most mills across
// every other refinery/chain have no prepared stats entry at all. Silently
// summing whichever few requested UML IDs happen to have data (the previous
// behavior) let a whole-chain summary look like a complete picture — e.g.
// "SJIM, 203 mills, 100% EUDR Comply" when in reality only 1-2 of those 203
// mills contributed any numbers. millsWithData/millsRequested let the UI
// (eudr-summary.tsx) tell "fully covered" apart from "mostly missing" and
// warn accordingly, instead of presenting a partial aggregate as complete.
export type EudrSummaryResult = EudrSummary & {
  millsWithData: number;
  millsRequested: number;
  /** Per-mill counts for every requested mill that has stats — what the
   * "where are the non-compliant plots?" list is built from (ADM feedback 1:
   * "click EUDR Comply 92% → a location list with non-comply cases"). */
  mills: { id: string; totalPlots: number; comply: number; nonComply: number; areaHa: number }[];
};

const MITIGATION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
const DEF_YEARS = [
  ["Def_21", "2021"],
  ["Def_22", "2022"],
  ["Def_23", "2023"],
  ["Def_24", "2024"],
  ["Def_25", "2025"],
  ["Def_26", "2026"],
] as const;
const PLOT_TYPES = ["Independent Smallholder", "Company", "Scheme Smallholder"] as const;

function emptySummary(): EudrSummary {
  return {
    totalPlots: 0,
    totalAreaHa: 0,
    comply: { yes: 0, no: 0 },
    risk: { low: 0, medium: 0, high: 0 },
    mitigation: Object.fromEntries(MITIGATION_LETTERS.map((l) => [l, { count: 0, areaHa: 0 }])) as EudrSummary["mitigation"],
    deforestationByYear: Object.fromEntries(DEF_YEARS.map(([, y]) => [y, 0])),
    forestOverlap: { HL: 0, HP: 0, HPK: 0, HPT: 0 },
    plotType: Object.fromEntries(PLOT_TYPES.map((t) => [t, { count: 0, areaHa: 0 }])),
  };
}

// Per-mill totals, precomputed offline by scripts/prepare-eudr-stats.mjs
// from the full plot files (prepared by scripts/prepare-plots.mjs), keyed by
// each mill's own `id` (umlId__group__refinery) rather than the bare UML ID
// — the same physical mill can supply more than one chain with a genuinely
// different plot set for each. Some
// prepared plot files are tens of MB — nearly all of it geometry this
// aggregation never reads — so loading and JSON.parse-ing every mill's full
// file on every request doesn't scale: a large refinery (e.g. Permata KIM,
// 44 mills) blew past the serverless function's memory/time budget
// (FUNCTION_INVOCATION_FAILED on Vercel). Every field below is a plain
// per-plot count/sum, so precomputing per mill and summing those small
// numbers here gives byte-identical results for a fraction of the cost.
const statsLoader = import.meta.glob(
  ["../../private-data/eudr-stats.json", "../../private-data/tenants/*/eudr-stats.json"],
  { query: "?raw", eager: false, import: "default" },
) as Record<string, () => Promise<string>>;

/** One stats file per tenant: ADM's at the root, the rest under tenants/<id>/. */
function statsLoaderFor(tenant: Tenant) {
  const suffix = `/private-data/${tenantPrefix(tenant)}eudr-stats.json`;
  const key = Object.keys(statsLoader).find((k) => k.replace(/\\/g, "/").endsWith(suffix));
  return key ? statsLoader[key] : undefined;
}

const statsCache = new Map<Tenant, Record<string, EudrSummary>>();
async function millStats(tenant: Tenant): Promise<Record<string, EudrSummary>> {
  const cached = statsCache.get(tenant);
  if (cached) return cached;
  const load = statsLoaderFor(tenant);
  const stats = JSON.parse(load ? await load() : "{}") as Record<string, EudrSummary>;
  statsCache.set(tenant, stats);
  return stats;
}

/** Per-mill stats for a tenant, keyed by mill id (the data assistant reads these). */
export function millStatsFor(tenant: Tenant): Promise<Record<string, EudrSummary>> {
  return millStats(tenant);
}

function addInto(target: EudrSummary, src: EudrSummary) {
  target.totalPlots += src.totalPlots;
  target.totalAreaHa += src.totalAreaHa;
  target.comply.yes += src.comply.yes;
  target.comply.no += src.comply.no;
  target.risk.low += src.risk.low;
  target.risk.medium += src.risk.medium;
  target.risk.high += src.risk.high;
  for (const l of MITIGATION_LETTERS) {
    target.mitigation[l].count += src.mitigation[l].count;
    target.mitigation[l].areaHa += src.mitigation[l].areaHa;
  }
  for (const [, year] of DEF_YEARS) {
    target.deforestationByYear[year] += src.deforestationByYear[year] ?? 0;
  }
  target.forestOverlap.HL += src.forestOverlap.HL;
  target.forestOverlap.HP += src.forestOverlap.HP;
  target.forestOverlap.HPK += src.forestOverlap.HPK;
  target.forestOverlap.HPT += src.forestOverlap.HPT;
  for (const t of PLOT_TYPES) {
    target.plotType[t].count += src.plotType[t].count;
    target.plotType[t].areaHa += src.plotType[t].areaHa;
  }
}

// Summing precomputed per-mill numbers is fast enough that this cache is
// mostly about not re-reading+parsing the (still-tiny) stats file — data
// only changes via a redeploy (which clears this module-level cache), same
// as before.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: EudrSummaryResult }>();

/** Real EUDR aggregates for the given mills — summed from precomputed per-mill totals. */
export async function getEudrSummary(tenant: Tenant, millIds: string[]): Promise<EudrSummaryResult> {
  // De-duped defensively — each `id` already uniquely identifies one
  // group/refinery row in mills.json, so callers shouldn't produce repeats,
  // but summing the same id's plots twice would silently double-count them.
  const distinctIds = [...new Set(millIds)];
  // JSON.stringify, not .join(",") — some refinery names contain a literal
  // comma (e.g. SJIM's "SINAR TAYAN INTI MULYA, KALBAR"), which a plain
  // join could in principle collide with a different id combination that
  // happens to concatenate the same way; this key is only ever used as an
  // opaque Map key, never split back apart, so unambiguous is all it needs.
  const cacheKey = JSON.stringify([tenant, ...distinctIds.sort()]);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (distinctIds.length === 0) return { ...emptySummary(), millsWithData: 0, millsRequested: 0, mills: [] };

  const stats = await millStats(tenant);
  const summary = emptySummary();
  let millsWithData = 0;
  const mills: EudrSummaryResult["mills"] = [];
  for (const millId of distinctIds) {
    const s = stats[millId];
    if (s) {
      addInto(summary, s);
      millsWithData++;
      mills.push({ id: millId, totalPlots: s.totalPlots, comply: s.comply.yes, nonComply: s.comply.no, areaHa: s.totalAreaHa });
    }
  }
  mills.sort((a, b) => b.nonComply - a.nonComply || b.totalPlots - a.totalPlots);

  const result: EudrSummaryResult = { ...summary, millsWithData, millsRequested: distinctIds.length, mills };
  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

/** Ids of every mill that has plot-level stats — the portfolio's coverage pills. */
export async function millIdsWithStats(tenant: Tenant): Promise<Set<string>> {
  return new Set(Object.keys(await millStats(tenant)));
}

// Plot area per village per mill (scripts/prepare-eudr-stats.mjs →
// village-stats.json), for the group Summary's Village → Mill → Refinery →
// Port flow (feedback 3, A-06). Separate from eudr-stats.json: it's ~20k
// rows and only that chart reads it.
type VillageStats = { names: Record<string, [string, string]>; mills: Record<string, [string, number][]> };

const villageLoader = import.meta.glob(
  ["../../private-data/village-stats.json", "../../private-data/tenants/*/village-stats.json"],
  { query: "?raw", eager: false, import: "default" },
) as Record<string, () => Promise<string>>;

const villageCache = new Map<Tenant, VillageStats>();
async function villageStats(tenant: Tenant): Promise<VillageStats> {
  const cached = villageCache.get(tenant);
  if (cached) return cached;
  const suffix = `/private-data/${tenantPrefix(tenant)}village-stats.json`;
  const key = Object.keys(villageLoader).find((k) => k.replace(/\\/g, "/").endsWith(suffix));
  const stats = JSON.parse(key ? await villageLoader[key]!() : '{"names":{},"mills":{}}') as VillageStats;
  villageCache.set(tenant, stats);
  return stats;
}

export type VillageFlows = {
  /** The largest villages by plot area across the requested mills. */
  villages: { key: string; name: string; district: string; ha: number }[];
  /** Area from a village (a key above, "other" for every smaller village,
   * "none" for plots outside any village) into a mill. */
  flows: { village: string; millId: string; ha: number }[];
  /** Distinct villages in the requested mills, before the top-N cut. */
  villageCount: number;
};

/** Village → mill plot area for the given mills, top `topN` villages kept by name. */
export async function getVillageFlows(tenant: Tenant, millIds: string[], topN = 12): Promise<VillageFlows> {
  const stats = await villageStats(tenant);
  const ids = [...new Set(millIds)].filter((id) => stats.mills[id]);
  const totals = new Map<string, number>();
  for (const id of ids) {
    for (const [k, ha] of stats.mills[id]!) if (k) totals.set(k, (totals.get(k) ?? 0) + ha);
  }
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, topN);
  const topKeys = new Set(top.map(([k]) => k));
  const flows: VillageFlows["flows"] = [];
  for (const id of ids) {
    const bucket = new Map<string, number>();
    for (const [k, ha] of stats.mills[id]!) {
      const v = !k ? "none" : topKeys.has(k) ? k : "other";
      bucket.set(v, (bucket.get(v) ?? 0) + ha);
    }
    for (const [village, ha] of bucket) if (ha > 0) flows.push({ village, millId: id, ha });
  }
  return {
    villages: top.map(([key, ha]) => {
      const [name, district] = stats.names[key] ?? ["", ""];
      return { key, name, district, ha };
    }),
    flows,
    villageCount: totals.size,
  };
}
