#!/usr/bin/env node
/**
 * Offline aggregation step: precomputes each mill's EUDR summary totals
 * (comply/risk/mitigation/deforestation/forest-overlap/plot-type counts —
 * the same math as getEudrSummary in src/lib/eudr-aggregates.server.ts)
 * from its prepared plot file(s), into one small `private-data/eudr-stats.json`
 * keyed by each mill's own `id` (umlId__group__refinery) — not the bare UML
 * ID, since the same physical mill can supply more than one chain with a
 * genuinely different plot set for each.
 *
 * Why this exists: getEudrSummary only ever reads `feature.properties`, but
 * used to load and JSON.parse each mill's *entire* plot file — mostly
 * geometry it never touches — on every request. Some prepared plot files
 * are tens of MB; summing a large refinery's mills (e.g. Permata KIM, 44
 * mills) that way blew past the serverless function's memory/time budget
 * (FUNCTION_INVOCATION_FAILED on Vercel). Since every field this aggregates
 * is a plain per-plot count/sum, precomputing per mill and summing those
 * small numbers at request time gives byte-identical results for a
 * fraction of the memory and CPU.
 *
 * Re-run this whenever scripts/prepare-plots.mjs output changes.
 *
 * Usage: node scripts/prepare-eudr-stats.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

const MITIGATION_LETTERS = ["A", "B", "C", "D", "E", "F"];
const DEF_YEARS = [
  ["Def_21", "2021"],
  ["Def_22", "2022"],
  ["Def_23", "2023"],
  ["Def_24", "2024"],
  ["Def_25", "2025"],
  ["Def_26", "2026"],
];
const PLOT_TYPES = ["Independent Smallholder", "Company", "Scheme Smallholder"];

// Matches src/lib/eudr-aggregates.server.ts's `num` exactly — some text
// fields use a lone space as their "blank" marker rather than being absent.
function num(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Permata's prepared plots use `HECTARAGE`; DOMAS's use `Hectarage` (mirrors
// the same fallback in src/lib/ledger-geo.ts's hectarage()) — reading only
// the first silently zeroed out every area figure for all 38 DOMAS mills.
function hectarage(p) {
  return num(p.HECTARAGE ?? p.Hectarage);
}

function emptyStats() {
  return {
    totalPlots: 0,
    totalAreaHa: 0,
    comply: { yes: 0, no: 0 },
    risk: { low: 0, medium: 0, high: 0 },
    mitigation: Object.fromEntries(MITIGATION_LETTERS.map((l) => [l, { count: 0, areaHa: 0 }])),
    deforestationByYear: Object.fromEntries(DEF_YEARS.map(([, y]) => [y, 0])),
    forestOverlap: { HL: 0, HP: 0, HPK: 0, HPT: 0 },
    plotType: Object.fromEntries(PLOT_TYPES.map((t) => [t, { count: 0, areaHa: 0 }])),
  };
}

// Matches src/lib/eudr-aggregates.server.ts's getEudrSummary per-feature
// accumulation exactly.
function accumulate(stats, p) {
  stats.totalPlots += 1;
  const ha = hectarage(p);
  stats.totalAreaHa += ha;

  if (p.EUDR_Comply === "YES") stats.comply.yes += 1;
  else if (p.EUDR_Comply === "NO") stats.comply.no += 1;

  if (p.Overall_Risk === "Low Risk") stats.risk.low += 1;
  else if (p.Overall_Risk === "Medium Risk") stats.risk.medium += 1;
  else if (p.Overall_Risk === "High Risk") stats.risk.high += 1;

  const mitLetter = String(p.Risk_Mitigation_Class ?? "").trim().charAt(0).toUpperCase();
  if (MITIGATION_LETTERS.includes(mitLetter)) {
    stats.mitigation[mitLetter].count += 1;
    stats.mitigation[mitLetter].areaHa += ha;
  }

  for (const [col, year] of DEF_YEARS) stats.deforestationByYear[year] += num(p[col]);

  stats.forestOverlap.HL += num(p.HL);
  stats.forestOverlap.HP += num(p.HP);
  stats.forestOverlap.HPK += num(p.HPK);
  stats.forestOverlap.HPT += num(p.HPT);

  const type = String(p.TYPE ?? "");
  if (PLOT_TYPES.includes(type)) {
    stats.plotType[type].count += 1;
    stats.plotType[type].areaHa += ha;
  }
}

async function main() {
  const plotsDir = path.join(ROOT, "private-data", "plots");
  const files = (await readdir(plotsDir)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  if (files.length === 0) {
    console.error("[prepare-eudr-stats] no plot files found in", plotsDir);
    process.exit(1);
  }

  // A mill over the per-file upload size limit is split into
  // `<id>.geojson`, `<id>.part2.geojson`, `<id>.part3.geojson`, … (see
  // kanopi-data.server.ts's loadPlotFeatureCollection, which merges them the
  // same way at request time) — grouped back into one stats entry per mill
  // id here so a split mill's totals aren't scattered across phantom
  // "<id>.part2" keys getEudrSummary never looks up.
  const filesByMillId = new Map();
  for (const file of files) {
    const millId = file.replace(/(\.part\d+)?\.geojson$/i, "");
    if (!filesByMillId.has(millId)) filesByMillId.set(millId, []);
    filesByMillId.get(millId).push(file);
  }

  const out = {};
  for (const [millId, millFiles] of filesByMillId) {
    const stats = emptyStats();
    for (const file of millFiles) {
      const fc = JSON.parse(await readFile(path.join(plotsDir, file), "utf8"));
      for (const feature of fc.features ?? []) {
        accumulate(stats, feature.properties ?? {});
      }
    }
    out[millId] = stats;
  }

  const outPath = path.join(ROOT, "private-data", "eudr-stats.json");
  const json = JSON.stringify(out);
  await writeFile(outPath, json);
  console.log(
    `[prepare-eudr-stats] ${filesByMillId.size} mill(s) from ${files.length} file(s) -> ${path.relative(ROOT, outPath)} (${(json.length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error("[prepare-eudr-stats] failed:", err?.message || err);
  process.exit(1);
});
