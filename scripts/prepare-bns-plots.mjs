#!/usr/bin/env node
/**
 * One-off admin step for the BNS drop (`Data Storage/BNS - Plot (GeoJSON)/`,
 * 24 mill files against a 33-mill BNS roster in mills.json — the other 9
 * mills simply have no plot data uploaded yet, same as most mills across
 * most chains).
 *
 * Unlike SJIM, this drop's own `UML_ID`/`Mill_name` properties are reliable:
 * cross-checking all 24 files against mills.json's BNS roster (matched by
 * normalized mill name, which also matches every file's basename directly —
 * no NAME_OVERRIDES needed here) found zero UML_ID mismatches. mills.json is
 * still treated as the identity source of truth (overwritten into every
 * feature) for consistency with the rest of the pipeline and because it's
 * the only place `NodeID` exists — this drop has neither `PlotID` nor
 * `NodeID` at all, so both are minted/attached here, same as SJIM.
 *
 * `PlotID` uses the same scheme as scripts/prepare-plots.mjs's
 * assignPlotIds() (grouped by ID_BPS_2020 prefix, sorted north-to-south/
 * west-to-east within each group) — reused verbatim.
 *
 * `HECTARAGE`/`Hectarage`/`ha`: this drop uses `ha`, already covered by
 * src/lib/ledger-geo.ts's hectarage() fallback chain (added for SJIM).
 *
 * Usage: node scripts/prepare-bns-plots.mjs
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "BNS - Plot (GeoJSON)");
const OUT_DIR = path.join(ROOT, "private-data", "plots");
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024;

function normName(s) {
  return String(s)
    .toUpperCase()
    .replace(/\b(PT|CV)\b\.?/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}
function roundGeometry(geometry, digits) {
  if (!geometry || !geometry.coordinates) return geometry;
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, digits) };
}

/** Mirrors prepare-plots.mjs's dedupeExactDuplicates() (by geometry only —
 * this drop has no OBJECTID to break ties with, so the first copy wins). */
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
    kept.push(group[0]);
    removed += group.length - 1;
  }
  return { kept, removed };
}

function bpsPrefix(idBps) {
  const digits = String(idBps ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits.padEnd(6, "0");
  return digits.slice(0, 6);
}

/** Mirrors prepare-plots.mjs's assignPlotIds() exactly, parameterized by
 * this mill's own (mills.json-authoritative) UML_ID instead of re-deriving
 * it from the feature properties. */
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
      const lonA = Number(a.LON ?? 0);
      const lonB = Number(b.LON ?? 0);
      return lonA - lonB;
    });
    indices.forEach((featureIndex, i) => {
      const seq = String(i + 1).padStart(4, "0");
      plotIds[featureIndex] = `IDN${prefix}-${millUmlId}-${yymm}-${seq}`;
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
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

async function main() {
  const mills = JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8"));
  const bns = mills.filter((m) => m.group === "BNS");
  const byNormName = new Map(bns.map((m) => [normName(m.millName), m]));

  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-bns] ${files.length} file(s) in ${SRC_DIR}`);

  const yymm = generatedYyMm();
  let totalFeatures = 0;
  let totalDuped = 0;
  let millsWritten = 0;
  const unmatched = [];

  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const base = file.replace(/\.geojson$/i, "");
    const mill = byNormName.get(normName(base));
    if (!mill) {
      unmatched.push(base);
      console.warn(`[prepare-bns] (${i + 1}/${files.length}) ${base}: no mills.json BNS match, SKIPPED`);
      continue;
    }
    if (!mill.umlId) {
      unmatched.push(base);
      console.warn(`[prepare-bns] (${i + 1}/${files.length}) ${base}: matched ${mill.millName} but it has no umlId in mills.json, SKIPPED`);
      continue;
    }

    const raw = JSON.parse(await readFile(path.join(SRC_DIR, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) {
      console.log(`[prepare-bns] (${i + 1}/${files.length}) ${base}: no features, skipped`);
      continue;
    }

    const { kept, removed } = dedupeExactDuplicates(features);
    const authoritativeUml = mill.umlId;
    const plotIds = assignPlotIds(kept, authoritativeUml, yymm);
    const withIds = kept.map((f, idx) => ({
      type: "Feature",
      properties: {
        ...(f.properties ?? {}),
        UML_ID: authoritativeUml, // overwrite for consistency with mills.json (verified 0 mismatches for this drop)
        Mill_Name: mill.millName,
        PlotID: plotIds[idx],
        NodeID: mill.nodeId,
      },
      geometry: roundGeometry(f.geometry, PRECISION),
    }));

    const chunks = splitBySize(withIds, TARGET_PART_BYTES);
    for (const [n, chunk] of chunks.entries()) {
      const suffix = n === 0 ? "" : `.part${n + 1}`;
      const outPath = path.join(OUT_DIR, `${mill.id}${suffix}.geojson`);
      await writeFile(outPath, JSON.stringify({ type: "FeatureCollection", features: chunk }));
    }

    totalFeatures += withIds.length;
    totalDuped += removed;
    millsWritten += 1;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const dupNote = removed > 0 ? `, ${removed} exact dup(s) dropped` : "";
    const partNote = chunks.length > 1 ? `, split into ${chunks.length} parts` : "";
    console.log(
      `[prepare-bns] (${i + 1}/${files.length}) ${mill.millName} [${mill.id}]: ${withIds.length} plots${dupNote}${partNote} in ${secs}s`,
    );
  }

  console.log(
    `\n[prepare-bns] done — ${totalFeatures} plot(s) across ${millsWritten} mill(s), ${totalDuped} exact duplicate(s) dropped -> private-data/plots/`,
  );
  if (unmatched.length) {
    console.log(`[prepare-bns] ${unmatched.length} file(s) had no usable mills.json BNS match:`, unmatched);
  }
}

main().catch((err) => {
  console.error("[prepare-bns] failed:", err?.message || err);
  process.exit(1);
});
