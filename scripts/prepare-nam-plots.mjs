#!/usr/bin/env node
/**
 * One-off admin step for the NAM & LTS drop (`Data Storage/NAM - Plot
 * (GeoJSON)/`, exported from `Data Storage/NAM - Plot/OPI_NAM.gdb` by
 * `ANALISIS\NAM_pipeline\07_export_to_kanopi.py` — see
 * NAM_PIPELINE_NOTES.md in that folder).
 *
 * The drop has no `PlotID`/`NodeID`, so both are minted/attached here like
 * BNS: PlotID via prepare-plots.mjs's assignPlotIds() scheme, identity
 * (UML_ID, Mill_name, NodeID) from mills.json.
 *
 * Usage: node scripts/prepare-nam-plots.mjs
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "NAM - Plot (GeoJSON)");
const OUT_DIR = path.join(ROOT, "private-data", "plots");
const GROUP = "NAM & LTS";
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

function bpsPrefix(idBps) {
  const digits = String(idBps ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits.padEnd(6, "0");
  return digits.slice(0, 6);
}

function assignPlotIds(features, millUmlId, yymm) {
  const byPrefix = new Map();
  features.forEach((f, index) => {
    const prefix = bpsPrefix(f.properties?.ID_BPS_2020);
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
      if (latB !== latA) return latB - latA;
      return Number(a.LON ?? 0) - Number(b.LON ?? 0);
    });
    indices.forEach((featureIndex, i) => {
      plotIds[featureIndex] = `IDN${prefix}-${millUmlId}-${yymm}-${String(i + 1).padStart(4, "0")}`;
    });
  }
  return plotIds;
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

function generatedYyMm(now = new Date()) {
  return `${String(now.getFullYear() % 100).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const mills = JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8"));
  const byUml = new Map(mills.filter((m) => m.group === GROUP).map((m) => [m.umlId, m]));

  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-nam] ${files.length} file(s) in ${SRC_DIR}`);

  const yymm = generatedYyMm();
  const seenPlotIds = new Set();
  let totalFeatures = 0;
  for (const [i, file] of files.entries()) {
    const raw = JSON.parse(await readFile(path.join(SRC_DIR, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) continue;
    const umlId = String(features[0].properties?.UML_ID ?? "").trim();
    const mill = byUml.get(umlId);
    if (!mill) throw new Error(`${file}: UML_ID "${umlId}" not found in mills.json ${GROUP} rows`);
    for (const f of features) {
      if (f.properties?.UML_ID !== umlId) throw new Error(`${file}: mixed UML_IDs (${umlId} / ${f.properties?.UML_ID})`);
    }

    const plotIds = assignPlotIds(features, mill.umlId, yymm);
    const out = features.map((f, idx) => {
      if (seenPlotIds.has(plotIds[idx])) throw new Error(`${file}: duplicate PlotID ${plotIds[idx]}`);
      seenPlotIds.add(plotIds[idx]);
      return {
        type: "Feature",
        properties: {
          ...f.properties,
          UML_ID: mill.umlId,
          Mill_name: mill.millName,
          PlotID: plotIds[idx],
          NodeID: mill.nodeId,
        },
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
    const partNote = chunks.length > 1 ? `, split into ${chunks.length} parts` : "";
    console.log(`[prepare-nam] (${i + 1}/${files.length}) ${mill.millName} [${mill.id}]: ${out.length} plots${partNote}`);
  }
  console.log(`[prepare-nam] done — ${totalFeatures} plot(s) -> private-data/plots/`);
}

main().catch((err) => {
  console.error("[prepare-nam] failed:", err?.message || err);
  process.exit(1);
});
