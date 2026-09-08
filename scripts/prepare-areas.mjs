#!/usr/bin/env node
/**
 * Offline admin step: turn a real traceability-areas GeoJSON drop (village
 * boundary + mill buffer-radius polygons for one Refinery/KCP) into the
 * static `private-data/areas/<refinery-slug>.geojson` file the app reads at
 * runtime (via the existing auth-gated `/data/$` route). One file per
 * Refinery/KCP — `workspace.tsx` fetches whichever slug(s) match the mills
 * currently in view and quietly treats a 404 as "no area data prepared for
 * this refinery yet", so refineries without a file just show none.
 *
 * The area/village-vs-buffer classification (`classifyAreaKind` in
 * ledger-geo.ts) and the mill join-key matching (UML_ID/NodeID/Mill name)
 * already work against this file's real property names (`METHOD`,
 * `UML_ID`, `Mill_name`) with no code changes — this script only needs to
 * place the file and round coordinates, matching prepare-plots.mjs.
 *
 * Usage:
 *   node scripts/prepare-areas.mjs "<file.geojson>" --refinery "<Refinery/KCP Name>"
 *
 * Example (the real Permata KIM traceability-areas drop):
 *   node scripts/prepare-areas.mjs "Data Storage/PERMATA_KIM_TACEABILITY.geojson" --refinery "Permata KIM"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--refinery") flags.refinery = argv[++i];
    else if (a === "--precision") flags.precision = Number(argv[++i]);
    else positional.push(a);
  }
  return { file: positional[0], ...flags };
}

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

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const { file, refinery, precision = 7 } = parseArgs(process.argv.slice(2));
  if (!file || !refinery) {
    console.error(
      'Usage: node scripts/prepare-areas.mjs "<file.geojson>" --refinery "<Refinery/KCP Name>"',
    );
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(file, "utf8"));
  const features = raw.features ?? [];
  if (features.length === 0) {
    console.error("[prepare-areas] no features found in", file);
    process.exit(1);
  }

  const fc = {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: f.properties ?? {},
      geometry: roundGeometry(f.geometry, precision),
    })),
  };

  const outDir = path.join(ROOT, "private-data", "areas");
  await mkdir(outDir, { recursive: true });
  const slug = slugify(refinery);
  const outPath = path.join(outDir, `${slug}.geojson`);
  await writeFile(outPath, JSON.stringify(fc));

  const methodCounts = {};
  for (const f of features) {
    const m = String(f.properties?.METHOD ?? "(blank)");
    methodCounts[m] = (methodCounts[m] ?? 0) + 1;
  }
  console.log(`[prepare-areas] ${features.length} area(s) for "${refinery}" -> ${path.relative(ROOT, outPath)}`);
  console.log("[prepare-areas] METHOD breakdown:", methodCounts);
}

main().catch((err) => {
  console.error("[prepare-areas] failed:", err?.message || err);
  process.exit(1);
});
