#!/usr/bin/env node
/**
 * One-off correction to private-data/mills.json's SUNRISE roster, found while
 * ingesting SUNRISE's plot drop (2026-09-28).
 *
 * ADM's own master workbook ("ADM - All Supply Chain Information.xlsx",
 * which mills.json was built from) has its `UML ID (2026)` column rotated by
 * one row across a 15-row block of SUNRISE mills (SAWIT LANGKAT … SOSA (PN),
 * in name order): each row carries the *next* row's UML ID, and the last row
 * wraps around to the first's. The row's own MILL NAME and LAT/LON are
 * consistent with each other — checked against UML.xlsx, every one of these
 * 15 names sits 0.0-0.2 km from the UML.xlsx coordinate of the UML ID
 * mapped below, and 97-351 km from the one the workbook gave it. SUNRISE's
 * plot drop (SUNRISE.gdb, keyed by the real UML IDs) agrees: each mill's plots
 * sit 1-10 km from its real UML.xlsx location.
 *
 * So the name/refinery/port/traceability/lat/lon on each row are right and
 * only the identity is wrong — fixed here by setting `umlId` to the name's
 * real UML ID and re-deriving the two fields built from it (`id`, `nodeId`,
 * same `2026-IDN-<digits>-1` scheme as every other roster row). Nothing
 * else on the row changes. Idempotent: rows already carrying the right UML ID
 * are left alone.
 *
 * Usage: node scripts/fix-sunrise-mill-ids.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const MILLS = path.join(ROOT, "private-data", "mills.json");

// ADM MILL NAME -> real UML ID (UML.xlsx name in the comment where it differs).
const REAL_UML_BY_NAME = {
  "SAWIT LANGKAT": "PO1000004524", // SUNGAI LANGKAT
  "SEI BARUHUR": "PO1000001784",
  "SEI BUATAN": "PO1000004225",
  "SEI DAUN": "PO1000004477",
  "SEI GALUH": "PO1000007604", // SUNGAI GALUH
  "SEI GARO": "PO1000007605",
  "SEI INTAN": "PO1000006147",
  "SEI MANGKEI": "PO1000000879",
  "SEI MERANTI (PN)": "PO1000004927", // SEI MERANTI
  "SEI PAGAR": "PO1000006159", // SUNGAI PAGAR
  "SEI ROKAN": "PO1000005128",
  "SEI SILAU": "PO1000004948",
  "SEI TAPUNG": "PO1000008074",
  "SISUMUT": "PO1000003112",
  "SOSA (PN)": "PO1000004428", // SOSA
};

async function main() {
  const mills = JSON.parse(await readFile(MILLS, "utf8"));
  let changed = 0;
  for (const m of mills) {
    if (m.group !== "SUNRISE") continue;
    const real = REAL_UML_BY_NAME[m.millName];
    if (!real || m.umlId === real) continue;
    const before = `${m.umlId} / ${m.nodeId}`;
    m.umlId = real;
    m.id = `${real}__${m.group}__${m.refinery}`;
    m.nodeId = `2026-IDN-${real.replace(/^PO/, "")}-1`;
    console.log(`[fix-sunrise] ${m.millName}: ${before} -> ${m.umlId} / ${m.nodeId}`);
    changed += 1;
  }

  const sunrise = mills.filter((m) => m.group === "SUNRISE");
  const ids = new Set(sunrise.map((m) => m.umlId));
  if (ids.size !== sunrise.length) throw new Error("SUNRISE roster would end up with a duplicate UML ID");

  await writeFile(MILLS, JSON.stringify(mills));
  console.log(`[fix-sunrise] ${changed} row(s) corrected -> private-data/mills.json`);
}

main().catch((err) => {
  console.error("[fix-sunrise] failed:", err?.message || err);
  process.exit(1);
});
