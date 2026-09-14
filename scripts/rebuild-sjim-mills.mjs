#!/usr/bin/env node
/**
 * Offline admin step, run after `prepare-mills.mjs`: replaces every
 * SJIM-group row in `private-data/mills.json` with a fresh list built from
 * SJIM's own dedicated master list (the "Sinarjaya Agro - Master Mill"
 * sheet) instead of the general "ADM - All Supply Chain Information"
 * workbook.
 *
 * Priority, per the source of truth for each field:
 *   1. SJIM's own master list (Data B) — the mill list itself (which mills
 *      exist at all) and its Crusher/Refinery Name, Mill Name, NodeID,
 *      Mill ID and Parent Name always win when present.
 *   2. The general master workbook (Data A), joined by NodeID — fills
 *      whatever Data B doesn't carry at all: UML ID (2026)'s canonical
 *      form, Traceability Level, Port, Group Name, Lat/Lon.
 *   3. The global UML reference list (UML.xlsx), joined by UML ID — last
 *      resort for Lat/Lon/Group Name when a mill has no Data A match
 *      either (a mill dropped from — or never entered into — Data A).
 *
 * Usage:
 *   node --experimental-strip-types scripts/rebuild-sjim-mills.mjs \
 *     "<ADM All Supply Chain Information workbook.xlsx>" \
 *     "<SJIM master workbook.xlsx>" \
 *     "<UML.xlsx>"
 * or:
 *   npm run rebuild:sjim-mills -- "<A>" "<B>" "<UML>"
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSheetRows, rowsToObjects } from "../src/lib/xlsx-lite.ts";
import { classifyTrace, parseBufferKm } from "../src/lib/ledger.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const GROUP = "SJIM";
const B_SHEET = "Sinarjaya Agro - Master Mill";

async function loadWorkbook(filePath, sheet = 0) {
  const buf = await readFile(filePath);
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return rowsToObjects(await readSheetRows(arrayBuf, sheet));
}

/** Data B's "Mill ID" is a bare number in one of two native ID ranges: the
 * 12-digit "8..." range is already a complete UML ID as-is (matches Data
 * A's own UML ID (2026) column unprefixed); every other (10-digit) range
 * needs the "PO" prefix Data A's UML IDs use. Verified against all 146
 * mills joinable by NodeID during this data update: 145/146 exact matches
 * (the one mismatch, "BUMI HUTANI LESTARI", is resolved anyway since a
 * NodeID match always prefers Data A's own UML ID over this derivation). */
function candidateUmlId(millId) {
  const id = String(millId ?? "").trim();
  if (!id) return "";
  return id.startsWith("8") ? id : `PO${id}`;
}

function trimmed(v) {
  return String(v ?? "").trim();
}

async function main() {
  const [aPath, bPath, umlPath] = process.argv.slice(2);
  if (!aPath || !bPath || !umlPath) {
    console.error(
      'Usage: node scripts/rebuild-sjim-mills.mjs "<ADM workbook.xlsx>" "<SJIM master workbook.xlsx>" "<UML.xlsx>"',
    );
    process.exit(1);
  }

  const millsPath = path.join(ROOT, "private-data", "mills.json");
  const mills = JSON.parse(await readFile(millsPath, "utf-8"));
  const others = mills.filter((m) => m.group !== GROUP);
  const removedCount = mills.length - others.length;

  const aRows = await loadWorkbook(aPath, 0);
  const aByNode = new Map();
  for (const r of aRows) {
    const node = trimmed(r["NodeID"]);
    if (node) aByNode.set(node, r);
  }

  const umlRows = await loadWorkbook(umlPath, 0);
  const umlById = new Map();
  for (const r of umlRows) {
    const id = trimmed(r["UML ID"]);
    if (id) umlById.set(id, r);
  }

  const bRows = await loadWorkbook(bPath, B_SHEET);

  let fromA = 0;
  let fromUmlOnly = 0;
  let bOnly = 0;
  const seenIds = new Map();
  const rebuilt = [];

  for (const r of bRows) {
    const millName = trimmed(r["Mill Name"]);
    const refinery = trimmed(r["Crusher  Name"] ?? r["Crusher Name"]);
    if (!millName) continue; // the sheet's one blank/junk row

    const nodeId = trimmed(r["ID on TRACT"]);
    const aRow = nodeId ? aByNode.get(nodeId) : undefined;
    const candidate = candidateUmlId(r["Mill ID"]);
    const umlRow = !aRow && candidate ? umlById.get(candidate) : undefined;

    const umlId = aRow ? trimmed(aRow["UML ID (2026)"]) || candidate : candidate;
    const traceabilityRaw = aRow ? trimmed(aRow["TRACEABILITY LEVEL"]) : "";
    // Neither Data B nor UML.xlsx carry traceability or port at all, so an
    // unmatched-to-A mill is honestly left "unknown"/blank rather than
    // guessed — same contract classifyTrace("") already returns.
    const port = aRow ? trimmed(aRow["PORT"]) : "";
    // Data B's own Parent Name wins whenever it has one — Data A/UML.xlsx
    // only fill in Group Name, which Data B has no equivalent column for.
    const parentCompany = trimmed(r["Mills Parent Name"]);
    let groupName = aRow ? trimmed(aRow["GROUP NAME"]) : "";
    if (!groupName && umlRow) {
      const g = trimmed(umlRow["Group Name"]);
      groupName = g && g.toUpperCase() !== "UNKNOWN" ? g : "";
    }
    let lat = aRow ? Number(aRow["LAT"]) : NaN;
    let lon = aRow ? Number(aRow["LON"]) : NaN;
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && umlRow) {
      lat = Number(umlRow["Latitude"]);
      lon = Number(umlRow["Longitude"]);
    }

    if (aRow) fromA++;
    else if (umlRow) fromUmlOnly++;
    else bOnly++;

    const baseId = `${umlId || millName}__${GROUP}__${refinery}`;
    const seenCount = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, seenCount);
    const id = seenCount > 1 ? `${baseId}__${seenCount}` : baseId;

    rebuilt.push({
      id,
      group: GROUP,
      refinery,
      millName,
      umlId,
      nodeId,
      port,
      traceability: classifyTrace(traceabilityRaw),
      traceabilityRaw,
      bufferKm: parseBufferKm(traceabilityRaw),
      groupName,
      parentCompany,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    });
  }

  const finalMills = [...others, ...rebuilt];
  finalMills.sort((a, b) => a.group.localeCompare(b.group) || a.millName.localeCompare(b.millName));
  await writeFile(millsPath, JSON.stringify(finalMills));

  console.log(`[rebuild-sjim-mills] removed ${removedCount} old SJIM row(s), rebuilt ${rebuilt.length} from "${B_SHEET}"`);
  console.log(`[rebuild-sjim-mills]   ${fromA} enriched from Data A (NodeID match)`);
  console.log(`[rebuild-sjim-mills]   ${fromUmlOnly} enriched from UML.xlsx only (no Data A match)`);
  console.log(`[rebuild-sjim-mills]   ${bOnly} have no Data A or UML.xlsx match — Data B fields only (no lat/lon/traceability/port)`);
  console.log(`[rebuild-sjim-mills] total mills now: ${finalMills.length}`);
}

main().catch((err) => {
  console.error("[rebuild-sjim-mills] failed:", err?.message || err);
  process.exit(1);
});
