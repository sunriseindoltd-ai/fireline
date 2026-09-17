#!/usr/bin/env node
/**
 * One-off admin step for the YORGO drop, mirroring the DOMAS ingestion
 * pattern — deliberately NOT scripts/prepare-plots.mjs, because that script
 * mints a brand-new PlotID for every feature (assignPlotIds()), which would
 * clobber the PlotID/NodeID this data already carries from its own
 * validated pipeline (see "Data Storage/YORGO - Plot (GeoJSON)/
 * YORGO_PIPELINE_NOTES.md"). The one hard rule from every prior round of
 * this: never regenerate/alter PlotID or NodeID.
 *
 * What this does, per mill file:
 *   1. Look up the mill's own composite `id` (umlId__group__refinery) in
 *      private-data/mills.json by UML_ID + group="YORGO" — plot files are
 *      keyed by this composite id, not the bare UML ID, since a physical
 *      mill can supply more than one chain (see kanopi-data.server.ts).
 *   2. Round coordinates to 7 decimal places (matches prepare-plots.mjs's
 *      own default precision) — geometry-only, never touches properties.
 *   3. Keep every property completely verbatim, PlotID/NodeID included.
 *   4. Split into <id>.geojson, <id>.part2.geojson, ... if the mill's
 *      output would exceed ~20MB, so every uploaded part stays under
 *      Cloudflare R2 / the app's per-request comfort zone.
 *
 * Two mills are deliberately skipped here — KOPERASI PRIMA JASA and SAWIT
 * JAYA MAKMUR SENTOSA — because they have PlotID collisions (the same
 * PlotID string on two features with different geometry/properties), a
 * genuine upstream defect that needs a decision before ingestion, not a
 * silent workaround. See SKIP_MILLS below.
 *
 * Usage: node scripts/prepare-yorgo-plots.mjs
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "YORGO - Plot (GeoJSON)");
const OUT_DIR = path.join(ROOT, "private-data", "plots");
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024; // stay comfortably under the 25MB cap

// PlotID collisions found during review — hold these out until resolved.
const SKIP_MILLS = new Set(["KOPERASI PRIMA JASA.geojson", "SAWIT JAYA MAKMUR SENTOSA.geojson"]);

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}
function roundGeometry(geometry, digits) {
  if (!geometry || !geometry.coordinates) return geometry;
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, digits) };
}

/** Splits `features` into chunks whose serialized size stays under
 * `targetBytes`, estimating per-feature size cheaply (stringify once) rather
 * than re-stringifying the whole growing array on every push. */
function splitBySize(features, targetBytes) {
  const chunks = [];
  let current = [];
  let currentBytes = 2; // "[]"
  for (const f of features) {
    const size = Buffer.byteLength(JSON.stringify(f)) + 1; // +1 for the comma/bracket
    if (current.length > 0 && currentBytes + size > targetBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(f);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function main() {
  const mills = JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8"));
  const yorgoByUml = new Map(mills.filter((m) => m.group === "YORGO").map((m) => [m.umlId, m]));

  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-yorgo] ${files.length} file(s) in ${SRC_DIR}`);

  let totalFeatures = 0;
  let millsWritten = 0;
  for (const [i, file] of files.entries()) {
    if (SKIP_MILLS.has(file)) {
      console.log(`[prepare-yorgo] (${i + 1}/${files.length}) ${file}: SKIPPED (PlotID collision, needs a decision first)`);
      continue;
    }
    const start = Date.now();
    const raw = JSON.parse(await readFile(path.join(SRC_DIR, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) {
      console.log(`[prepare-yorgo] (${i + 1}/${files.length}) ${file}: no features, skipped`);
      continue;
    }
    const umlId = String(features[0].properties?.UML_ID ?? "").trim();
    const mill = yorgoByUml.get(umlId);
    if (!mill) {
      console.warn(`[prepare-yorgo] (${i + 1}/${files.length}) ${file}: UML_ID "${umlId}" not found in mills.json YORGO rows, SKIPPED`);
      continue;
    }

    const rounded = features.map((f) => ({
      type: "Feature",
      properties: f.properties ?? {}, // verbatim — PlotID/NodeID untouched
      geometry: roundGeometry(f.geometry, PRECISION),
    }));

    const chunks = splitBySize(rounded, TARGET_PART_BYTES);
    for (const [n, chunk] of chunks.entries()) {
      const suffix = n === 0 ? "" : `.part${n + 1}`;
      const outPath = path.join(OUT_DIR, `${mill.id}${suffix}.geojson`);
      await writeFile(outPath, JSON.stringify({ type: "FeatureCollection", features: chunk }));
    }

    totalFeatures += rounded.length;
    millsWritten += 1;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const partNote = chunks.length > 1 ? `, split into ${chunks.length} parts` : "";
    console.log(
      `[prepare-yorgo] (${i + 1}/${files.length}) ${mill.millName} [${mill.id}]: ${rounded.length} plots${partNote} in ${secs}s`,
    );
  }

  console.log(`[prepare-yorgo] done — ${totalFeatures} plot(s) across ${millsWritten} mill(s) -> private-data/plots/`);
}

main().catch((err) => {
  console.error("[prepare-yorgo] failed:", err?.message || err);
  process.exit(1);
});
