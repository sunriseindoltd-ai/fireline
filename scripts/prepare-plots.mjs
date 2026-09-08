#!/usr/bin/env node
/**
 * Offline admin step: turn a real per-mill plot GeoJSON drop — one
 * FeatureCollection per mill, e.g. `Data Storage/PERMATA- KIM - Plot
 * (GeoJSON)/` — into the static `private-data/plots/<UML_ID>.geojson`
 * files the app reads at runtime (via the existing auth-gated `/data/$`
 * route — see src/lib/kanopi-data.server.ts). Replaces
 * scripts/seed-plots.mjs now that plot data is static instead of
 * database-backed.
 *
 * Usage:
 *   node scripts/prepare-plots.mjs "<folder>"
 *
 * Example (the already-verified Permata KIM drop):
 *   node scripts/prepare-plots.mjs "Data Storage/PERMATA- KIM - Plot (GeoJSON)"
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--precision") flags.precision = Number(argv[++i]);
    else positional.push(a);
  }
  return { folder: positional[0], ...flags };
}

/** Round every coordinate in a GeoJSON geometry to `digits` decimal places. */
function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") {
    return coords.map((n) => Number(n.toFixed(digits)));
  }
  return coords.map((c) => roundCoords(c, digits));
}

function roundGeometry(geometry, digits) {
  if (!geometry || !geometry.coordinates) return geometry;
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, digits) };
}

/**
 * The raw per-mill drops carry exact row-level duplicates — the same
 * polygon (identical geometry AND identical properties apart from the
 * source GIS's own OBJECTID/TARGET_FID row numbers) appearing 2-3 times,
 * left over from an upstream spatial join (see the "Join_Count" property
 * these rows carry). Verified across every mill in the Permata KIM drop:
 * every duplicate group's properties are byte-identical once OBJECTID/
 * TARGET_FID/OBJECTID_1 are ignored — so keeping the lowest-OBJECTID copy
 * loses no information. This does NOT touch plots that merely overlap
 * geographically (neighboring smallholder claims with different geometry,
 * hectarage, or risk data) — those are real, distinct records and stay. */
function dedupeExactDuplicates(features) {
  const groups = new Map();
  for (const f of features) {
    const key = JSON.stringify(f.geometry?.coordinates);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  let removed = 0;
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const best = group.reduce((a, b) => {
      const idA = Number(a.properties?.OBJECTID ?? Infinity);
      const idB = Number(b.properties?.OBJECTID ?? Infinity);
      return idB < idA ? b : a;
    });
    kept.push(best);
    removed += group.length - 1;
  }
  return { kept, removed };
}

// ISO 3166-1 alpha-3 codes for every `Country` value seen in the source
// drops so far — add an entry here if a future drop introduces a new one
// (the script warns instead of failing when it hits an unmapped country).
const COUNTRY_ISO3 = {
  Indonesia: "IDN",
};

function isoCountry(name, millUmlId) {
  const key = String(name ?? "").trim();
  const code = COUNTRY_ISO3[key];
  if (code) return code;
  console.warn(
    `[prepare-plots] ${millUmlId}: unknown Country "${key}" — add it to COUNTRY_ISO3 in this script`,
  );
  return "UNK";
}

/** "2609" for September 2026 — the run's own generation month, computed
 * once in main() so every plot minted in the same run carries the same
 * stamp. */
function generatedYyMm(now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

function bpsPrefix(idBps, millUmlId) {
  const digits = String(idBps ?? "").replace(/\D/g, "");
  if (digits.length < 6) {
    console.warn(`[prepare-plots] ${millUmlId}: ID_BPS_2020 "${idBps}" has fewer than 6 digits`);
    return digits.padEnd(6, "0");
  }
  return digits.slice(0, 6);
}

/**
 * Adds a genuinely unique `PlotID` to every feature — the source `ID`
 * column (e.g. "ID-AC01-11.01.16-194") turned out to be a shared block/
 * batch code, not a per-plot identifier (confirmed: 135 different plots —
 * different HECTARAGE, different LAT/LON — carrying the identical `ID` in
 * one mill's file alone). `ID`/`ID_Dagri_2023` are left untouched.
 *
 * Format: `{ISO3}{first 6 digits of ID_BPS_2020}-{mill's UML ID}-{YYMM
 * this run generated the id}-{seq}`. `seq` resets per *BPS prefix* (the
 * same 6 digits embedded in the ID),
 * not per the separate `District` text field — this data has cases where
 * two genuinely different Districts (e.g. "Padang Lawas" and "Padang
 * Lawas Utara") share an identical first-6-digit BPS prefix, so grouping
 * by District text let their sequences collide into the same final
 * PlotID. Grouping by the literal prefix instead guarantees the (prefix,
 * seq) pair — and therefore the whole PlotID — is unique by construction,
 * whatever the District-label/BPS-code relationship turns out to be for a
 * given drop. Within each group, plots are ordered by their own LAT/LON:
 * highest latitude (northernmost) first, ties broken by lowest longitude
 * (westernmost), so plot 0001 is always that group's most north-western
 * plot and the sequence sweeps roughly top-left to bottom-right from there.
 */
function assignPlotIds(features, millUmlId, yymm) {
  const byPrefix = new Map();
  features.forEach((f, index) => {
    const prefix = bpsPrefix(f.properties?.ID_BPS_2020, millUmlId);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(index);
  });

  const plotIds = new Array(features.length);
  for (const [prefix, indices] of byPrefix) {
    indices.sort((ia, ib) => {
      const a = features[ia].properties ?? {};
      const b = features[ib].properties ?? {};
      const latA = Number(a.LAT ?? 0);
      const latB = Number(b.LAT ?? 0);
      if (latB !== latA) return latB - latA; // north first
      const lonA = Number(a.LON ?? 0);
      const lonB = Number(b.LON ?? 0);
      return lonA - lonB; // west first
    });
    indices.forEach((featureIndex, i) => {
      const p = features[featureIndex].properties ?? {};
      const iso3 = isoCountry(p.Country, millUmlId);
      const seq = String(i + 1).padStart(4, "0");
      plotIds[featureIndex] = `${iso3}${prefix}-${millUmlId}-${yymm}-${seq}`;
    });
  }

  return features.map((f, i) => ({
    ...f,
    properties: { ...(f.properties ?? {}), PlotID: plotIds[i] },
  }));
}

async function main() {
  const { folder, precision = 7 } = parseArgs(process.argv.slice(2));
  if (!folder) {
    console.error('Usage: node scripts/prepare-plots.mjs "<folder>"');
    process.exit(1);
  }

  const outDir = path.join(ROOT, "private-data", "plots");
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-plots] ${files.length} file(s) in ${folder}`);

  const yymm = generatedYyMm();
  let totalFeatures = 0;
  let totalRemoved = 0;
  let written = 0;
  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const raw = JSON.parse(await readFile(path.join(folder, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) {
      console.log(`[prepare-plots] (${i + 1}/${files.length}) ${file}: no features, skipped`);
      continue;
    }
    const first = features[0].properties ?? {};
    const millUmlId = String(first.UML_ID ?? first.uml_id ?? "").trim();
    const millName = String(first.Mill_name ?? first.mill_name ?? path.parse(file).name).trim();
    if (!millUmlId) {
      console.warn(`[prepare-plots] (${i + 1}/${files.length}) ${file}: no UML_ID found, skipped`);
      continue;
    }
    const rounded = features.map((f) => ({
      type: "Feature",
      properties: f.properties ?? {},
      geometry: roundGeometry(f.geometry, precision),
    }));
    const { kept, removed } = dedupeExactDuplicates(rounded);
    const withPlotIds = assignPlotIds(kept, millUmlId, yymm);
    const fc = { type: "FeatureCollection", features: withPlotIds };
    const outPath = path.join(outDir, `${millUmlId}.geojson`);
    await writeFile(outPath, JSON.stringify(fc));
    totalFeatures += kept.length;
    totalRemoved += removed;
    written += 1;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const dupNote = removed > 0 ? `, ${removed} exact duplicate(s) dropped` : "";
    console.log(
      `[prepare-plots] (${i + 1}/${files.length}) ${millName} [${millUmlId}]: ${kept.length} plots${dupNote} in ${secs}s`,
    );
  }

  console.log(
    `[prepare-plots] done — ${totalFeatures} plot(s) across ${written} mill(s), ${totalRemoved} exact duplicate(s) dropped -> private-data/plots/`,
  );
}

main().catch((err) => {
  console.error("[prepare-plots] failed:", err?.message || err);
  process.exit(1);
});
