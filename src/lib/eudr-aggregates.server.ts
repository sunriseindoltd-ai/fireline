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
// from the full plot files (prepared by scripts/prepare-plots.mjs). Some
// prepared plot files are tens of MB — nearly all of it geometry this
// aggregation never reads — so loading and JSON.parse-ing every mill's full
// file on every request doesn't scale: a large refinery (e.g. Permata KIM,
// 44 mills) blew past the serverless function's memory/time budget
// (FUNCTION_INVOCATION_FAILED on Vercel). Every field below is a plain
// per-plot count/sum, so precomputing per mill and summing those small
// numbers here gives byte-identical results for a fraction of the cost.
const statsLoader = import.meta.glob("../../private-data/eudr-stats.json", {
  query: "?raw",
  eager: false,
  import: "default",
}) as Record<string, () => Promise<string>>;
const loadStatsFile = Object.values(statsLoader)[0];

let statsCache: Record<string, EudrSummary> | null = null;
async function millStats(): Promise<Record<string, EudrSummary>> {
  if (statsCache) return statsCache;
  const text = loadStatsFile ? await loadStatsFile() : "{}";
  statsCache = JSON.parse(text) as Record<string, EudrSummary>;
  return statsCache;
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
const cache = new Map<string, { at: number; value: EudrSummary }>();

/** Real EUDR aggregates for the given mills — summed from precomputed per-mill totals. */
export async function getEudrSummary(umlIds: string[]): Promise<EudrSummary> {
  const cacheKey = [...umlIds].sort().join(",");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (umlIds.length === 0) return emptySummary();

  const stats = await millStats();
  const summary = emptySummary();
  for (const umlId of umlIds) {
    const s = stats[umlId];
    if (s) addInto(summary, s);
  }

  cache.set(cacheKey, { at: Date.now(), value: summary });
  return summary;
}
