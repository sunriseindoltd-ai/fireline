/**
 * FireLine — PalmTrace (ADM tenant) plots in a cell-partitioned index for
 * hotspot attribution. Geometry is kept exactly as PalmTrace has it (every
 * vertex, holes, every part of a multipart or geometry collection); only
 * coordinates are rounded to 6 decimals (≈ 0.1 m).
 *
 * Output (<root>/private-data/fire/v2/, uploaded under fire/v2/):
 *   cells/<cellId>.json   plots touching that 0.05° cell: {id, mill, uml, group,
 *                         company, type, village, district, province, ha, bbox,
 *                         g: [[outer, ...holes], …] (polygons, [lon,lat] rings)}
 *   cells-index.json      {cell: 0.05, generated, types, plots, cells: {<id>: {n, bbox}}}
 *   mills.json            per mill: plots, ha, bbox, group, companies
 *
 * Usage: node scripts/prepare-fire-plots.mjs [--root "../Kanopi 0.0.13"] [--exclude "Independent Smallholder"]
 * Every plot type is kept except the excluded ones (user decision, 19 Oct 2026).
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  if (a) return a.slice(k.length + 3);
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(HERE, arg("root", path.join("..", "Kanopi 0.0.13")));
const PLOTS = path.join(ROOT, "private-data", "plots");
const OUT = path.join(ROOT, "private-data", "fire", "v2");
const CELL = 0.05;
const EXCLUDE = new Set(arg("exclude", "Independent Smallholder").split(",").map((s) => s.trim().toLowerCase()));

const r6 = (v) => Math.round(v * 1e6) / 1e6;
function ring(coords) {
  const pts = coords.map((c) => [r6(c[0]), r6(c[1])]);
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  return pts;
}
/** Every polygon of the geometry as [outer, ...holes]. */
function polygons(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates.map(ring)];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => p.map(ring));
  if (geom.type === "GeometryCollection") return (geom.geometries ?? []).flatMap(polygons);
  return [];
}
function bboxOf(polys) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}
const str = (v) => (v == null ? "" : String(v).trim());

const cells = new Map();
const mills = new Map();
const typeCounts = {};
let total = 0, kept = 0, files = 0, noGeom = 0, vertices = 0;

// Mill names: some plot files (SJIM buffer plots) carry an empty Mill_name,
// so fall back to mills.json (the plot file is named after the mill id).
const millsById = new Map(JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8")).map((m) => [m.id, m]));
const names = (await readdir(PLOTS)).filter((f) => f.endsWith(".geojson")).sort();
const t0 = Date.now();
for (const file of names) {
  const m = /^([^_]+)__([^_]+)__/.exec(file);
  const group = m ? m[2] : "";
  const millRec = millsById.get(file.replace(/(\.part\d+)?\.geojson$/, ""));
  const fc = JSON.parse(await readFile(path.join(PLOTS, file), "utf8"));
  files++;
  for (const f of fc.features ?? []) {
    total++;
    const p = f.properties ?? {};
    const type = str(p.TYPE);
    typeCounts[type || "(blank)"] = (typeCounts[type || "(blank)"] ?? 0) + 1;
    if (EXCLUDE.has(type.toLowerCase())) continue;
    const g = polygons(f.geometry).filter((poly) => poly[0]?.length >= 4);
    if (!g.length) {
      noGeom++;
      continue;
    }
    const bbox = bboxOf(g);
    const uml = str(p.UML_ID) || str(millRec?.umlId) || (m ? m[1] : "");
    const mill = str(p.Mill_name) || str(millRec?.millName);
    const ha = Number(p.Hectarage ?? p.HECTARAGE) || 0;
    const rec = {
      id: str(p.PlotID), mill, uml, group, company: str(p.COMPANY), type,
      village: str(p.Village), district: str(p.District), province: str(p.Province),
      ha: Math.round(ha * 100) / 100, bbox, g,
    };
    kept++;
    for (const poly of g) for (const r of poly) vertices += r.length;
    const seen = new Set();
    for (let y = Math.floor(bbox[1] / CELL); y <= Math.floor(bbox[3] / CELL); y++)
      for (let x = Math.floor(bbox[0] / CELL); x <= Math.floor(bbox[2] / CELL); x++) {
        const id = `${y}_${x}`;
        if (seen.has(id)) continue;
        seen.add(id);
        let c = cells.get(id);
        if (!c) cells.set(id, (c = []));
        c.push(rec);
      }
    const mk = `${uml}|${mill}`;
    let mm = mills.get(mk);
    if (!mm) mills.set(mk, (mm = { uml, mill, group, plots: 0, ha: 0, bbox: [180, 90, -180, -90], companies: new Set(), types: {} }));
    mm.plots++;
    mm.ha += rec.ha;
    mm.companies.add(rec.company);
    mm.types[type] = (mm.types[type] ?? 0) + 1;
    const b = mm.bbox;
    if (bbox[0] < b[0]) b[0] = bbox[0];
    if (bbox[1] < b[1]) b[1] = bbox[1];
    if (bbox[2] > b[2]) b[2] = bbox[2];
    if (bbox[3] > b[3]) b[3] = bbox[3];
  }
  if (files % 50 === 0) console.log(`${files}/${names.length} files, kept ${kept}/${total}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

await rm(path.join(OUT, "cells"), { recursive: true, force: true });
await mkdir(path.join(OUT, "cells"), { recursive: true });
const index = { cell: CELL, generated: new Date().toISOString(), exclude: [...EXCLUDE], plots: kept, exact: true, cells: {} };
let bytes = 0, biggest = 0;
for (const [id, feats] of cells) {
  const [y, x] = id.split("_").map(Number);
  const body = JSON.stringify(feats);
  bytes += body.length;
  biggest = Math.max(biggest, body.length);
  await writeFile(path.join(OUT, "cells", `${id}.json`), body);
  index.cells[id] = { n: feats.length, bbox: [r6(x * CELL), r6(y * CELL), r6((x + 1) * CELL), r6((y + 1) * CELL)] };
}
await writeFile(path.join(OUT, "cells-index.json"), JSON.stringify(index));
const millsOut = [...mills.values()].map((mm) => ({ ...mm, ha: Math.round(mm.ha * 100) / 100, companies: [...mm.companies].sort() })).sort((a, b) => b.plots - a.plots);
await writeFile(path.join(OUT, "mills.json"), JSON.stringify(millsOut));
console.log(
  JSON.stringify(
    { files, total, kept, noGeom, typeCounts, vertices, cells: cells.size, mills: millsOut.length, cellBytesMB: +(bytes / 1e6).toFixed(1), biggestCellMB: +(biggest / 1e6).toFixed(1), seconds: +((Date.now() - t0) / 1000).toFixed(0) },
    null,
    1,
  ),
);
