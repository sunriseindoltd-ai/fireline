#!/usr/bin/env node
/**
 * Offline admin step: turns the JRC global forest-cover raster export
 * (Data Storage/JRC Forest Cover V3.geojson — one polygon per connected
 * component of forest pixels, GDAL-polygonize style, ~30m/pixel staircase
 * boundaries) into the static `private-data/forest/forest-cover.geojson`
 * file the app reads at runtime (via the existing auth-gated `/data/$`
 * route), simplified to fit the project's 25MB static-file budget.
 *
 * The source file is ~66MB across 22,813 features (avg ~71 vertices each —
 * real raster-boundary detail, not padding: collinear-point dedupe alone
 * only saves ~0.4%, and clipping to the plots' own bounding box saves
 * almost nothing either — the JRC export is already cropped to roughly the
 * same extent). Coordinate-precision rounding alone can't close the gap
 * without going coarser than the ~30m pixel size (digits=3, ~111m, barely
 * fits at ~24.9MB). Instead this simplifies each ring with a
 * Douglas-Peucker pass at a sub-pixel tolerance (~22m, smaller than one
 * JRC pixel) before rounding — removes ~40% of vertices with no visible
 * shape change, landing at ~19MB with headroom to spare.
 *
 * Properties are dropped entirely: the layer is always rendered as a flat
 * green fill (see chain-map.tsx's "forest-fill" layer), never styled or
 * filtered by property, so OBJECTID/Id/gridcode/Shape_Length/Shape_Area
 * would only cost bytes here.
 *
 * Usage:
 *   node scripts/prepare-forest-cover.mjs ["<file.geojson>"]
 *
 * Example (the real JRC drop):
 *   node scripts/prepare-forest-cover.mjs "Data Storage/JRC Forest Cover V3.geojson"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DEFAULT_INPUT = "Data Storage/JRC Forest Cover V3.geojson";
const MAX_BYTES = 25 * 1024 * 1024;
const SIMPLIFY_EPSILON_DEG = 0.0002; // ~22m at the equator — sub-pixel for ~30m JRC cells
const ROUND_DIGITS = 5; // ~1.1m — far finer than the source's ~30m resolution

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}

function perpDist([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

/** Simplifies one closed ring. Plain Douglas-Peucker degenerates on closed
 * loops (start === end gives a zero-length anchor segment), so this first
 * splits the ring at its two most distant points, simplifies each half as
 * an open path, then rejoins. */
function simplifyRing(ring, epsilon) {
  const n = ring.length;
  if (n <= 5) return ring;
  const pts = ring.slice(0, n - 1); // drop the closing duplicate of [0]
  const m = pts.length;
  let farI = 1;
  let farD = -1;
  for (let i = 1; i < m; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      farI = i;
    }
  }
  const half1 = pts.slice(0, farI + 1);
  const half2 = pts.slice(farI).concat([pts[0]]);
  const merged = douglasPeucker(half1, epsilon).slice(0, -1).concat(douglasPeucker(half2, epsilon));
  if (merged.length < 4) return ring;
  return [...merged, merged[0]];
}

function simplifyGeometry(geometry, epsilon) {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((r) => simplifyRing(r, epsilon)) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((poly) => poly.map((r) => simplifyRing(r, epsilon))),
    };
  }
  return geometry;
}

async function main() {
  const input = process.argv[2] || DEFAULT_INPUT;
  const raw = JSON.parse(await readFile(path.join(ROOT, input), "utf8"));
  const features = raw.features ?? [];
  if (features.length === 0) {
    console.error("[prepare-forest-cover] no features found in", input);
    process.exit(1);
  }

  const fc = {
    type: "FeatureCollection",
    features: features
      .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
      .map((f) => {
        const simplified = simplifyGeometry(f.geometry, SIMPLIFY_EPSILON_DEG);
        return {
          type: "Feature",
          properties: {},
          geometry: { ...simplified, coordinates: roundCoords(simplified.coordinates, ROUND_DIGITS) },
        };
      }),
  };

  const outDir = path.join(ROOT, "private-data", "forest");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "forest-cover.geojson");
  const json = JSON.stringify(fc);
  await writeFile(outPath, json);

  const mb = json.length / (1024 * 1024);
  console.log(
    `[prepare-forest-cover] ${features.length} -> ${fc.features.length} feature(s), ${path.relative(ROOT, outPath)} (${mb.toFixed(2)} MB)`,
  );
  if (json.length > MAX_BYTES) {
    console.error(
      `[prepare-forest-cover] WARNING: output is over the 25MB budget (${mb.toFixed(2)} MB) — increase SIMPLIFY_EPSILON_DEG or lower ROUND_DIGITS.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[prepare-forest-cover] failed:", err?.message || err);
  process.exit(1);
});
