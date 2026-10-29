/**
 * Mill coordinates for FireLine's "route from the mill" (bundled, small).
 * Reads PalmTrace's ADM mills.json and writes src/data/mill-points.json:
 *   { "<UML>|<MILL NAME>": [lat, lon], … }  (names upper-cased, 0,0 skipped)
 * Where the mill's UML ID is in the Universal Mill List (private-data/fire/layers/mills-uml.geojson, from
 * scripts/prepare-fire-mills.py) and the two points are at most 1 km apart, the UML point is used: the UML
 * location is checked on satellite imagery. Farther apart = the UML ID itself is doubtful; the mills.json point stays.
 *
 * Usage: node scripts/prepare-mill-points.mjs ["../PalmTrace/private-data/mills.json"]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? path.join(ROOT, "..", "PalmTrace", "private-data", "mills.json");
const SNAP_KM = 1;
const mills = JSON.parse(await readFile(src, "utf8"));
const uml = new Map();
try {
  const fc = JSON.parse(await readFile(path.join(ROOT, "private-data", "fire", "layers", "mills-uml.geojson"), "utf8"));
  for (const ft of fc.features) uml.set(ft.properties.id, ft.geometry.coordinates);
} catch {
  console.warn("mills-uml.geojson not found: run scripts/prepare-fire-mills.py first (mills.json points kept)");
}
const km = (la1, lo1, la2, lo2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};
const out = {};
const snapped = [];
const far = [];
for (const m of mills) {
  let lat = Number(m.lat), lon = Number(m.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
  const id = String(m.umlId ?? "").trim();
  const name = String(m.millName ?? "").trim().toUpperCase();
  const u = uml.get(id);
  if (u) {
    const d = km(lat, lon, u[1], u[0]);
    if (d <= SNAP_KM) {
      if (d > 0.01) snapped.push(`${id} ${name}: ${Math.round(d * 1000)} m`);
      [lon, lat] = u;
    } else far.push(`${id} ${name}: ${d.toFixed(1)} km from the UML point, kept`);
  }
  out[`${id}|${name}`] = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
}
await writeFile(path.join(ROOT, "src", "data", "mill-points.json"), JSON.stringify(out));
console.log(`${Object.keys(out).length} mills with coordinates (of ${mills.length}); moved to the UML point (>10 m): ${snapped.length}`);
for (const s of snapped) console.log("  moved", s);
for (const s of far) console.log("  check", s);
