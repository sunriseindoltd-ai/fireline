#!/usr/bin/env node
/**
 * Holds back one mill's plots that sit too far from its mill point: removes
 * them from the prepared plot file(s) the app serves and writes them to
 * `Data Storage/NEEDS VERIFICATION/<tenant>/<file>` (outside private-data/, so
 * never bundled or served) — the same ">100 km from the mill = needs
 * verification" rule ADM's groups follow at ingest, applied after the fact.
 *
 * First use (2026-09-29): KARYA TANAH SUBUR (PO1000004571) in DOMAS and BRC —
 * 1,523 plots in Indragiri Hulu, Riau, ~850 km from the mill in Aceh Barat,
 * all 0-15 km from Tunggal Perkasa Plantations' mill (PO1000004372). Hidden
 * until the client confirms which mill they supply.
 *
 * Distance = great-circle km from the mill's lat/lon in the tenant's
 * mills.json to the plot's vertex-mean centroid. Re-running is safe: plots
 * already held are not in the prepared file any more, and a held file is
 * merged rather than overwritten. Afterwards re-run prepare-eudr-stats.mjs
 * (with the same --tenant) and re-upload the mill's plot file to R2.
 *
 * Usage: node scripts/hold-far-plots.mjs <mill id prefix> [--tenant <id>] [--km 100]
 *   e.g. node scripts/hold-far-plots.mjs "PO1000004571__DOMAS__"
 *        node scripts/hold-far-plots.mjs "PO1000004571__BRC__" --tenant brc
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

function parseArgs(argv) {
  const out = { prefix: null, tenant: "adm", km: 100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tenant") out.tenant = argv[++i];
    else if (argv[i] === "--km") out.km = Number(argv[++i]);
    else out.prefix = argv[i];
  }
  if (!out.prefix || !Number.isFinite(out.km)) {
    console.error('usage: node scripts/hold-far-plots.mjs "<mill id prefix>" [--tenant <id>] [--km 100]');
    process.exit(1);
  }
  return out;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function centroid(geometry) {
  let lat = 0;
  let lon = 0;
  let n = 0;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      lon += c[0];
      lat += c[1];
      n++;
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return [lat / n, lon / n];
}

async function main() {
  const { prefix, tenant, km } = parseArgs(process.argv.slice(2));
  const dataDir = tenant === "adm" ? path.join(ROOT, "private-data") : path.join(ROOT, "private-data", "tenants", tenant);
  const plotsDir = path.join(dataDir, "plots");
  const heldDir = path.join(ROOT, "Data Storage", "NEEDS VERIFICATION", tenant);

  const mills = JSON.parse(await readFile(path.join(dataDir, "mills.json"), "utf8"));
  const mill = mills.find((m) => m.id.startsWith(prefix));
  if (!mill) throw new Error(`no mill with id starting "${prefix}" in ${tenant}'s mills.json`);
  if (mill.lat == null || mill.lon == null) throw new Error(`${mill.id} has no coordinates`);

  const files = (await readdir(plotsDir)).filter((f) => f.startsWith(prefix) && f.endsWith(".geojson")).sort();
  if (files.length === 0) throw new Error(`no plot files starting "${prefix}" in ${path.relative(ROOT, plotsDir)}`);

  await mkdir(heldDir, { recursive: true });
  let kept = 0;
  let held = 0;
  for (const file of files) {
    const fc = JSON.parse(await readFile(path.join(plotsDir, file), "utf8"));
    const keep = [];
    const hold = [];
    for (const f of fc.features) {
      const [lat, lon] = centroid(f.geometry);
      (distanceKm(mill.lat, mill.lon, lat, lon) > km ? hold : keep).push(f);
    }
    kept += keep.length;
    held += hold.length;
    if (hold.length === 0) continue;
    // A later part file emptied out would leave a gap the loader doesn't expect.
    if (keep.length === 0 && /\.part\d+\.geojson$/i.test(file)) {
      throw new Error(`${file} would end up empty — handle part files by hand`);
    }

    const heldPath = path.join(heldDir, file);
    const prior = existsSync(heldPath) ? JSON.parse(await readFile(heldPath, "utf8")).features : [];
    await writeFile(heldPath, JSON.stringify({ ...fc, features: [...prior, ...hold] }));
    await writeFile(path.join(plotsDir, file), JSON.stringify({ ...fc, features: keep }));
    console.log(`[hold-far-plots] ${file}: kept ${keep.length}, held ${hold.length} (> ${km} km)`);
  }
  console.log(
    `[hold-far-plots] ${mill.millName} (${tenant}): ${kept} plot(s) shown, ${held} newly held -> ${path.relative(ROOT, heldDir)}`,
  );
}

main().catch((err) => {
  console.error("[hold-far-plots] failed:", err?.message || err);
  process.exit(1);
});
