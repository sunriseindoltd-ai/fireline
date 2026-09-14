#!/usr/bin/env node
/**
 * Offline admin step, run right after `prepare-mills.mjs`: corrects the
 * `refinery` (Refinery/KCP Name) field for every SJIM-group mill in
 * `private-data/mills.json`.
 *
 * The master workbook (ADM - All Supply Chain Information) only carries a
 * short 4-letter crusher code for SJIM mills (STIM/SJIM/SBIM/STRIM) — and
 * that code collapses two genuinely different crushers ("SINAR JAYA INTI
 * MULYA, LAMPUNG" and "SINAR JAYA INTI MULYA, SAMPIT") under the single
 * code "SJIM". SJIM's own dedicated master list (the
 * "Sinarjaya Agro - Master Mill" sheet) carries the real, distinct crusher
 * name per mill, so this patches `refinery` from there — joined by NodeID
 * (present in both workbooks in the identical "2026-IDN-<uml>-1" format).
 *
 * Usage:
 *   node --experimental-strip-types scripts/patch-sjim-refinery.mjs "<path to SJIM master workbook.xlsx>"
 * or:
 *   npm run patch:sjim-refinery -- "<path to SJIM master workbook.xlsx>"
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSheetRows, rowsToObjects } from "../src/lib/xlsx-lite.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SHEET_NAME = "Sinarjaya Agro - Master Mill";
const GROUP = "SJIM";

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    console.error(
      'Usage: node scripts/patch-sjim-refinery.mjs "<path to SJIM master workbook.xlsx>"',
    );
    process.exit(1);
  }

  const millsPath = path.join(ROOT, "private-data", "mills.json");
  const mills = JSON.parse(await readFile(millsPath, "utf-8"));

  const buf = await readFile(workbookPath);
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const rows = await readSheetRows(arrayBuf, SHEET_NAME);
  const objs = rowsToObjects(rows);

  const crusherByNode = new Map();
  for (const r of objs) {
    const node = String(r["ID on TRACT"] ?? "").trim();
    const crusher = String(r["Crusher  Name"] ?? r["Crusher Name"] ?? "").trim();
    if (node && crusher) crusherByNode.set(node, crusher);
  }

  let patched = 0;
  let unmatched = 0;
  const unmatchedMills = [];
  const refineriesAfter = new Set();
  for (const m of mills) {
    if (m.group !== GROUP) continue;
    const crusher = crusherByNode.get(m.nodeId);
    if (crusher) {
      if (m.refinery !== crusher) patched++;
      m.refinery = crusher;
      // `id` embeds the refinery name (see ledger.ts's recordsFromRows) —
      // keep it in sync so it stays a stable, meaningful row key.
      m.id = `${m.umlId || m.millName}__${m.group}__${m.refinery}`;
    } else {
      unmatched++;
      unmatchedMills.push({ millName: m.millName, umlId: m.umlId, nodeId: m.nodeId, refinery: m.refinery });
    }
    refineriesAfter.add(m.refinery);
  }

  await writeFile(millsPath, JSON.stringify(mills));

  console.log(`[patch-sjim-refinery] ${patched} mill(s) patched from ${path.basename(workbookPath)}`);
  console.log(`[patch-sjim-refinery] ${unmatched} SJIM mill(s) had no match in "${SHEET_NAME}" (left as-is)`);
  console.log(`[patch-sjim-refinery] SJIM now has ${refineriesAfter.size} distinct refineries:`, [...refineriesAfter].sort());
  if (unmatchedMills.length) {
    console.log("[patch-sjim-refinery] unmatched mills:");
    for (const u of unmatchedMills) console.log("  -", JSON.stringify(u));
  }
}

main().catch((err) => {
  console.error("[patch-sjim-refinery] failed:", err?.message || err);
  process.exit(1);
});
