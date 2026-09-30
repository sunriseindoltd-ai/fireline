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
 * Also writes `village-stats.json` beside it: each mill's plot area per
 * village, for the group Summary's Village → Mill → Refinery → Port flow
 * (feedback 3, A-06). Kept out of eudr-stats.json — it's ~20k rows and only
 * that one chart reads it.
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

// Permata's prepared plots use `HECTARAGE`; DOMAS's use `Hectarage`; SJIM's
// use `ha` (mirrors the same fallback in src/lib/ledger-geo.ts's
// hectarage()) — reading only one silently zeroed out every area figure for
// every mill in whichever group used a different name.
function hectarage(p) {
  return num(p.HECTARAGE ?? p.Hectarage ?? p.ha);
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

// Every other forest-category/social overlap flag a plot can carry besides
// deforestation — mirrors this file's own forestOverlap fields plus the
// Community_F/Indigenous_F/Social_F columns eudr-summary.tsx reads.
const NON_DEFORESTATION_ISSUE_KEYS = [
  "HL", "HP", "HPK", "HPT", "CA", "FL_LAIN", "KSA_KPA", "SM", "TAHURA", "TB", "TN", "TWA",
  "Community_F", "Indigenous_F", "Social_F",
];
// BNS-only: cross-checking BNS's own delivered per-plot deforestation
// figures found 92.5% of the nonzero Def_21..Def_26 values are under 0.5ha —
// sub-hectare, almost certainly satellite-resolution noise rather than real
// land-clearing. Per stakeholder decision, a BNS plot whose *only* issue is
// deforestation under this threshold (no genuine forest-category/social
// overlap) is counted as compliant here instead of inheriting the delivered
// data's flat "any nonzero year disqualifies it" rule. Scoped to the BNS
// group only — every other group's EUDR_Comply/Risk_Mitigation_Class is
// counted exactly as delivered. Mirrored in src/lib/ledger-geo.ts
// (effectiveComply/effectiveMitigation), which does the same for the
// per-plot map/table/detail-panel display.
const BNS_DEFORESTATION_NOISE_THRESHOLD_HA = 0.5;
const BNS_MITIGATION_DOWNGRADE = { D: "A", E: "B", F: "C" };

function bnsHasRealIssue(p) {
  if (NON_DEFORESTATION_ISSUE_KEYS.some((k) => num(p[k]) > 0)) return true;
  return DEF_YEARS.some(([col]) => num(p[col]) >= BNS_DEFORESTATION_NOISE_THRESHOLD_HA);
}

// Matches src/lib/eudr-aggregates.server.ts's getEudrSummary per-feature
// accumulation exactly (modulo the BNS-only adjustment above).
function accumulate(stats, p, isBns) {
  stats.totalPlots += 1;
  const ha = hectarage(p);
  stats.totalAreaHa += ha;

  const bnsAdjustedNo = isBns && p.EUDR_Comply === "NO" && !bnsHasRealIssue(p);

  if (p.EUDR_Comply === "YES" || bnsAdjustedNo) stats.comply.yes += 1;
  else if (p.EUDR_Comply === "NO") stats.comply.no += 1;

  if (p.Overall_Risk === "Low Risk") stats.risk.low += 1;
  else if (p.Overall_Risk === "Medium Risk") stats.risk.medium += 1;
  else if (p.Overall_Risk === "High Risk") stats.risk.high += 1;

  let mitLetter = String(p.Risk_Mitigation_Class ?? "").trim().charAt(0).toUpperCase();
  if (bnsAdjustedNo && BNS_MITIGATION_DOWNGRADE[mitLetter]) mitLetter = BNS_MITIGATION_DOWNGRADE[mitLetter];
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

// A village is named by its name + sub-district + district where the plot
// carries them — the ID columns follow different schemes per delivery (BPS
// codes, Permata's "ID-AC02-…"), so the same village would otherwise split
// in two when a group mixes deliveries. The ID is only the fallback.
function text(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" ? s : "";
}
function villageOf(p) {
  const name = text(p.Village) || text(p.Village_Admin);
  const sub = text(p.SubDistric) || text(p.SubDistrict);
  const district = text(p.District);
  const id = (text(p.village_id_bps) || text(p.ID_BPS_2020) || text(p.ID_Village) || text(p.ID)).replace(/\.0$/, "");
  if (name) return { key: [name, sub, district].map((x) => x.toLowerCase()).join("|"), name, district, id };
  return id ? { key: `id:${id}`, name: "", district, id } : null;
}

async function main() {
  // `--tenant brc` builds another client's stats from its own plot folder
  // (private-data/tenants/<id>/); without it, ADM's at the root as before.
  const tIdx = process.argv.indexOf("--tenant");
  const tenant = tIdx >= 0 ? process.argv[tIdx + 1] : "adm";
  const tenantDir = tenant === "adm" ? path.join(ROOT, "private-data") : path.join(ROOT, "private-data", "tenants", tenant);
  const plotsDir = path.join(tenantDir, "plots");
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
  const villageNames = {};
  const villageMills = {};
  // id → named key, learnt from plots that carry both; a plot with only the
  // id is folded into that village afterwards.
  const idToKey = new Map();
  for (const [millId, millFiles] of filesByMillId) {
    const stats = emptyStats();
    const isBns = millId.includes("__BNS__");
    const byVillage = new Map();
    for (const file of millFiles) {
      const fc = JSON.parse(await readFile(path.join(plotsDir, file), "utf8"));
      for (const feature of fc.features ?? []) {
        const p = feature.properties ?? {};
        accumulate(stats, p, isBns);
        const v = villageOf(p);
        const key = v ? v.key : "";
        byVillage.set(key, (byVillage.get(key) ?? 0) + hectarage(p));
        if (v && !villageNames[key]) villageNames[key] = [v.name || `#${v.id}`, v.district];
        if (v?.name && v.id && !idToKey.has(v.id)) idToKey.set(v.id, v.key);
      }
    }
    out[millId] = stats;
    villageMills[millId] = byVillage;
  }
  for (const [millId, byVillage] of Object.entries(villageMills)) {
    const merged = new Map();
    for (const [k, ha] of byVillage) {
      const named = k.startsWith("id:") ? idToKey.get(k.slice(3)) : undefined;
      merged.set(named ?? k, (merged.get(named ?? k) ?? 0) + ha);
    }
    villageMills[millId] = [...merged]
      .sort((a, b) => b[1] - a[1])
      .map(([k, ha]) => [k, Math.round(ha * 1000) / 1000]);
  }
  const used = new Set(Object.values(villageMills).flatMap((rows) => rows.map(([k]) => k)));
  for (const k of Object.keys(villageNames)) if (!used.has(k)) delete villageNames[k];

  const outPath = path.join(tenantDir, "eudr-stats.json");
  const json = JSON.stringify(out);
  await writeFile(outPath, json);
  console.log(
    `[prepare-eudr-stats] ${filesByMillId.size} mill(s) from ${files.length} file(s) -> ${path.relative(ROOT, outPath)} (${(json.length / 1024).toFixed(1)} KB)`,
  );
  const vPath = path.join(tenantDir, "village-stats.json");
  const vJson = JSON.stringify({ names: villageNames, mills: villageMills });
  await writeFile(vPath, vJson);
  console.log(
    `[prepare-eudr-stats] ${Object.keys(villageNames).length} village(s) -> ${path.relative(ROOT, vPath)} (${(vJson.length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error("[prepare-eudr-stats] failed:", err?.message || err);
  process.exit(1);
});
