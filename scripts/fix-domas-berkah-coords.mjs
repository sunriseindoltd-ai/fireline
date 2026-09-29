#!/usr/bin/env node
/**
 * Temporary correction to BERKAH SAWIT SEJAHTERA, CV's mill point in the DOMAS
 * roster (private-data/mills.json) and the BRC roster
 * (private-data/tenants/brc/mills.json), found from client feedback
 * (2026-09-29: "mill and plots are very far apart").
 *
 * The roster row carries UML ID PO1000007652, which UML.xlsx lists as BERKAT
 * SAWIT SEJAHTERA (Superventure, Indragiri Hilir, Riau) at -0.71, 102.66 — a
 * different mill. The DOMAS master's own UML check column is #N/A for this
 * row, and BRC's plot IDs leave the UML part blank. All 16,764 plots sit in
 * Asahan/Simalungun (North Sumatra), 502-551 km from that point, and no mill
 * named BERKAH SAWIT SEJAHTERA exists in UML.xlsx for Asahan, Simalungun or
 * Batu Bara.
 *
 * The mill is traced by a 20 km buffer, and the DOMAS traceability-areas drop
 * (private-data/areas/pt-domas-sawit-inti-perdana.geojson) draws that buffer
 * around 2.78000322732, 99.44 — the point the supplier used. The mean of the
 * plot centroids lands 0.6 km from it. So the row's lat/lon are set to the
 * buffer centre until the client supplies the real coordinates or UML ID;
 * the UML ID itself is left as delivered. Idempotent.
 *
 * Usage: node scripts/fix-domas-berkah-coords.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const ROSTERS = [
  path.join(ROOT, "private-data", "mills.json"),
  path.join(ROOT, "private-data", "tenants", "brc", "mills.json"),
];
const MILL_NAME = "BERKAH SAWIT SEJAHTERA, CV";
const BUFFER_CENTRE = { lat: 2.780003, lon: 99.44 };

async function main() {
  for (const file of ROSTERS) {
    const mills = JSON.parse(await readFile(file, "utf8"));
    const rows = mills.filter((m) => m.millName === MILL_NAME);
    if (rows.length === 0) throw new Error(`${MILL_NAME} not found in ${path.relative(ROOT, file)}`);
    let changed = 0;
    for (const m of rows) {
      if (m.lat === BUFFER_CENTRE.lat && m.lon === BUFFER_CENTRE.lon) continue;
      console.log(`[fix-berkah] ${m.id}: ${m.lat}, ${m.lon} -> ${BUFFER_CENTRE.lat}, ${BUFFER_CENTRE.lon}`);
      m.lat = BUFFER_CENTRE.lat;
      m.lon = BUFFER_CENTRE.lon;
      changed += 1;
    }
    if (changed) await writeFile(file, JSON.stringify(mills));
    console.log(`[fix-berkah] ${changed} row(s) updated -> ${path.relative(ROOT, file)}`);
  }
}

main().catch((err) => {
  console.error("[fix-berkah] failed:", err?.message || err);
  process.exit(1);
});
