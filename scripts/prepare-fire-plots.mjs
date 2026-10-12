/**
 * Fire monitoring — extract Company + Scheme Smallholder plots from PalmTrace
 * (ADM tenant) into a compact, cell-partitioned index for hotspot attribution.
 *
 * Output (private-data/fire/):
 *   cells/<cellId>.json   features in that 0.05° cell: {id, mill, uml, group,
 *                         company, type, village, district, province, ha, bbox,
 *                         g: [[lon,lat],…] outer ring, simplified ±10 m}
 *   cells-index.json      {cell: 0.05, cells: {<cellId>: {n, bbox}}, totals…}
 *   mills.json            per mill: plots, ha, bbox, group, company list
 *
 * Usage: node scripts/prepare-fire-plots.mjs [--types "Company,Scheme Smallholder"]
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLOTS = path.join(ROOT, "private-data", "plots");
const OUT = path.join(ROOT, "private-data", "fire");
const CELL = 0.05;
const TOL = 0.0001; // ≈ 11 m
const argTypes = process.argv.find((a) => a.startsWith("--types="));
const TYPES = new Set((argTypes ? argTypes.slice(8) : "Company,Scheme Smallholder").split(",").map((s) => s.trim()));

// --- Douglas–Peucker on [lon,lat] rings -------------------------------------
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
function dp(points, tol2) {
  const n = points.length;
  if (n <= 4) return points;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = tol2, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = sqSegDist(points[i], points[s], points[e]); if (d > max) { max = d; idx = i; } }
    if (idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out.length >= 4 ? out : points;
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
function ring(coords) {
  const pts = coords.map((c) => [c[0], c[1]]);
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]);
  return dp(pts, TOL * TOL).map((p) => [r6(p[0]), r6(p[1])]);
}
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [ring(geom.coordinates[0])];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => ring(p[0]));
  return [];
}
function bboxOf(rings) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [r6(w), r6(s), r6(e), r6(n)];
}
const cellId = (x, y) => `${Math.floor(y / CELL)}_${Math.floor(x / CELL)}`;
const str = (v) => (v == null ? "" : String(v).trim());

const cells = new Map();
const mills = new Map();
const typeCounts = {};
let total = 0, kept = 0, files = 0;

const names = (await readdir(PLOTS)).filter((f) => f.endsWith(".geojson")).sort();
const t0 = Date.now();
for (const file of names) {
  const m = /^([^_]+)__([^_]+)__/.exec(file);
  const group = m ? m[2] : "";
  const fc = JSON.parse(await readFile(path.join(PLOTS, file), "utf8"));
  files++;
  for (const f of fc.features ?? []) {
    total++;
    const p = f.properties ?? {};
    const type = str(p.TYPE);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (!TYPES.has(type)) continue;
    const rings = outerRings(f.geometry);
    if (!rings.length) continue;
    const bbox = bboxOf(rings);
    const uml = str(p.UML_ID) || (m ? m[1] : "");
    const mill = str(p.Mill_name);
    const rec = {
      id: str(p.PlotID), mill, uml, group, company: str(p.COMPANY), type,
      village: str(p.Village), district: str(p.District), province: str(p.Province),
      ha: Math.round((Number(p.Hectarage) || 0) * 100) / 100, bbox, g: rings,
    };
    kept++;
    // register in every cell the bbox touches
    const seen = new Set();
    for (let y = Math.floor(bbox[1] / CELL); y <= Math.floor(bbox[3] / CELL); y++)
      for (let x = Math.floor(bbox[0] / CELL); x <= Math.floor(bbox[2] / CELL); x++) {
        const id = `${y}_${x}`;
        if (seen.has(id)) continue; seen.add(id);
        let c = cells.get(id); if (!c) { c = []; cells.set(id, c); }
        c.push(rec);
      }
    const mk = `${uml}|${mill}`;
    let mm = mills.get(mk);
    if (!mm) { mm = { uml, mill, group, plots: 0, ha: 0, bbox: [180, 90, -180, -90], companies: new Set(), types: {} }; mills.set(mk, mm); }
    mm.plots++; mm.ha += rec.ha; mm.companies.add(rec.company); mm.types[type] = (mm.types[type] ?? 0) + 1;
    const b = mm.bbox; if (bbox[0] < b[0]) b[0] = bbox[0]; if (bbox[1] < b[1]) b[1] = bbox[1]; if (bbox[2] > b[2]) b[2] = bbox[2]; if (bbox[3] > b[3]) b[3] = bbox[3];
  }
  if (files % 50 === 0) console.log(`${files}/${names.length} files, kept ${kept}/${total}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

await rm(path.join(OUT, "cells"), { recursive: true, force: true });
await mkdir(path.join(OUT, "cells"), { recursive: true });
const index = { cell: CELL, generated: new Date().toISOString(), types: [...TYPES], plots: kept, cells: {} };
let bytes = 0;
for (const [id, feats] of cells) {
  const [y, x] = id.split("_").map(Number);
  const body = JSON.stringify(feats);
  bytes += body.length;
  await writeFile(path.join(OUT, "cells", `${id}.json`), body);
  index.cells[id] = { n: feats.length, bbox: [r6(x * CELL), r6(y * CELL), r6((x + 1) * CELL), r6((y + 1) * CELL)] };
}
await writeFile(path.join(OUT, "cells-index.json"), JSON.stringify(index));
const millsOut = [...mills.values()].map((m) => ({ ...m, ha: Math.round(m.ha * 100) / 100, companies: [...m.companies].sort() }))
  .sort((a, b) => b.plots - a.plots);
await writeFile(path.join(OUT, "mills.json"), JSON.stringify(millsOut));
console.log(JSON.stringify({ files, total, kept, typeCounts, cells: cells.size, mills: millsOut.length, cellBytesMB: +(bytes / 1e6).toFixed(1), seconds: +((Date.now() - t0) / 1000).toFixed(0) }, null, 1));
