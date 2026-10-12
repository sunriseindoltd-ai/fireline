// Prototype: FIRMS VIIRS hotspots (Indonesia bbox, N days) → Company/Scheme plots.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plotDistanceM, cellsAround } from "../src/lib/fire-geo.ts";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRE = path.join(ROOT, "private-data", "fire");
const DAYS = Number(process.argv[2] || 7), RAD = Number(process.argv[3] || 500);
const K = process.env.FIRMS_MAP_KEY;
const idx = JSON.parse(await readFile(path.join(FIRE, "cells-index.json"), "utf8"));
const t0 = Date.now();
const rows = [];
for (const src of ["VIIRS_NOAA21_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"]) {
  const t = await (await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${K}/${src}/95,-11,141,6/${DAYS}`)).text();
  const [h, ...L] = t.trim().split("\n"); const H = h.split(",");
  for (const l of L) { const c = l.split(","); const o = {}; H.forEach((k, i) => (o[k] = c[i])); rows.push(o); }
}
console.log(`hotspot ${rows.length} (${DAYS} hari, 3 satelit) ${((Date.now()-t0)/1000).toFixed(1)} s`);
const cache = new Map();
async function cell(id) {
  if (!idx.cells[id]) return [];
  if (!cache.has(id)) cache.set(id, JSON.parse(await readFile(path.join(FIRE, "cells", id + ".json"), "utf8")));
  return cache.get(id);
}
const hits = []; let cellsRead = 0;
for (const h of rows) {
  const x = +h.longitude, y = +h.latitude;
  const ids = cellsAround(x, y, RAD).filter((i) => idx.cells[i]);
  if (!ids.length) continue;
  let best = null;
  for (const id of ids) for (const p of await cell(id)) {
    const d = plotDistanceM(x, y, p, RAD);
    if (d < (best?.d ?? Infinity)) best = { d, p };
  }
  if (best) hits.push({ ...h, d: Math.round(best.d), plot: best.p });
}
const by = (f) => { const m = {}; for (const h of hits) { const k = f(h); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
console.log(`match ≤${RAD} m: ${hits.length} (di dalam plot: ${hits.filter(h=>h.d===0).length}); sel dibaca ${cache.size}; ${((Date.now()-t0)/1000).toFixed(1)} s`);
console.log("per grup:", by((h) => h.plot.group));
console.log("per PKS (top 12):", by((h) => `${h.plot.mill} (${h.plot.group})`).slice(0, 12));
console.log("per provinsi:", by((h) => h.plot.province));
console.log("per hari:", by((h) => h.acq_date).sort());
console.log("confidence:", by((h) => h.confidence));
console.log("contoh:", hits.slice(0, 3).map((h) => ({ lat: h.latitude, lon: h.longitude, d: h.d, date: h.acq_date, time: h.acq_time, frp: h.frp, plot: h.plot.id, company: h.plot.company, type: h.plot.type, village: h.plot.village })));
