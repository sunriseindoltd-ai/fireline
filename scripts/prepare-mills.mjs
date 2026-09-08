#!/usr/bin/env node
/**
 * Offline admin step: turn the real mill master workbook into the static
 * `private-data/mills.json` the app reads at runtime (via the existing
 * auth-gated `/data/$` route — see src/lib/kanopi-data.server.ts).
 *
 * Runs outside Vite (plain Node), so it imports src/lib/ledger.ts by
 * relative path rather than the `@/` alias Vite provides — that file has
 * zero `@/` imports of its own and only touches Web-standard APIs
 * (Blob/TextDecoder/DecompressionStream, all global in Node 22), so it
 * resolves the same way here as it does in the browser bundle.
 *
 * Usage (the workbook import needs Node's TS-stripping flag):
 *   node --experimental-strip-types scripts/prepare-mills.mjs "<path to master workbook.xlsx>"
 * or simply:
 *   npm run prepare:mills -- "<path to master workbook.xlsx>"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMasterWorkbook } from "../src/lib/ledger.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    console.error('Usage: node scripts/prepare-mills.mjs "<path to master workbook.xlsx>"');
    process.exit(1);
  }

  const buf = await readFile(workbookPath);
  const mills = await parseMasterWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  mills.sort((a, b) => a.group.localeCompare(b.group) || a.millName.localeCompare(b.millName));

  const outDir = path.join(ROOT, "private-data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "mills.json");
  await writeFile(outPath, JSON.stringify(mills));

  console.log(`[prepare-mills] ${mills.length} mill(s) from ${path.basename(workbookPath)} -> ${path.relative(ROOT, outPath)}`);
}

main().catch((err) => {
  console.error("[prepare-mills] failed:", err?.message || err);
  process.exit(1);
});
