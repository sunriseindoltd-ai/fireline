#!/usr/bin/env node
/**
 * One-off admin step for the SUNRISE drop (`Data Storage/SUNRISE - Plot
 * (GeoJSON)/`, exported from the analysis master
 * `ANALISIS\SUNRISE_28092026.gdb\SUNRISE_MASTER` — see that folder's
 * SUNRISE_PIPELINE_NOTES.md for how the master was built). Same shape as
 * scripts/prepare-yorgo-plots.mjs: this drop already carries its own
 * validated `PlotID`s, so they're kept verbatim rather than re-minted.
 *
 * Differences from YORGO:
 *   - `NodeID` is overwritten with mills.json's own `nodeId` (the drop
 *     carried a mix of `-1`/`-2` suffixes that don't match the registry;
 *     per user instruction the registry wins, same as SJIM/BNS). Already
 *     done once in the master GDB — re-applied here so the plot files can
 *     never drift from mills.json.
 *   - `UML_ID`/`Mill_name` are likewise re-asserted from mills.json.
 *   - PlotIDs are expected to be unique already (the drop's 519 repeats were
 *     exact duplicate rows, removed in the master) — checked, and the script
 *     fails rather than silently resolving if that ever stops being true.
 *   - `NEEDS VERIFICATION/` (plots >100km from their mill, YORGO precedent)
 *     is never read.
 *
 * Usage: node scripts/prepare-sunrise-plots.mjs
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "SUNRISE - Plot (GeoJSON)");
const OUT_DIR = path.join(ROOT, "private-data", "plots");
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024;

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}
function roundGeometry(geometry, digits) {
  if (!geometry || !geometry.coordinates) return geometry;
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, digits) };
}

function splitBySize(features, targetBytes) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  for (const f of features) {
    const size = Buffer.byteLength(JSON.stringify(f)) + 1;
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
  const byUml = new Map(mills.filter((m) => m.group === "SUNRISE").map((m) => [m.umlId, m]));

  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-sunrise] ${files.length} file(s) in ${SRC_DIR}`);

  const seenPlotIds = new Set();
  let totalFeatures = 0;
  let millsWritten = 0;
  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const raw = JSON.parse(await readFile(path.join(SRC_DIR, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) {
      console.log(`[prepare-sunrise] (${i + 1}/${files.length}) ${file}: no features, skipped`);
      continue;
    }
    const umlId = String(features[0].properties?.UML_ID ?? "").trim();
    const mill = byUml.get(umlId);
    if (!mill) throw new Error(`${file}: UML_ID "${umlId}" not found in mills.json SUNRISE rows`);

    const out = features.map((f) => {
      const p = f.properties ?? {};
      if (p.UML_ID !== umlId) throw new Error(`${file}: mixed UML_IDs (${umlId} / ${p.UML_ID})`);
      if (!p.PlotID || seenPlotIds.has(p.PlotID)) throw new Error(`${file}: missing/duplicate PlotID "${p.PlotID}"`);
      seenPlotIds.add(p.PlotID);
      return {
        type: "Feature",
        properties: { ...p, UML_ID: mill.umlId, Mill_name: mill.millName, NodeID: mill.nodeId },
        geometry: roundGeometry(f.geometry, PRECISION),
      };
    });

    const chunks = splitBySize(out, TARGET_PART_BYTES);
    for (const [n, chunk] of chunks.entries()) {
      const suffix = n === 0 ? "" : `.part${n + 1}`;
      await writeFile(
        path.join(OUT_DIR, `${mill.id}${suffix}.geojson`),
        JSON.stringify({ type: "FeatureCollection", features: chunk }),
      );
    }

    totalFeatures += out.length;
    millsWritten += 1;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const partNote = chunks.length > 1 ? `, split into ${chunks.length} parts` : "";
    console.log(
      `[prepare-sunrise] (${i + 1}/${files.length}) ${mill.millName} [${mill.id}]: ${out.length} plots${partNote} in ${secs}s`,
    );
  }

  console.log(`[prepare-sunrise] done — ${totalFeatures} plot(s) across ${millsWritten} mill(s) -> private-data/plots/`);
}

main().catch((err) => {
  console.error("[prepare-sunrise] failed:", err?.message || err);
  process.exit(1);
});
