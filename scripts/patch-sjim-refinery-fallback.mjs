#!/usr/bin/env node
/**
 * Second pass after patch-sjim-refinery.mjs: for SJIM mills that had no
 * direct NodeID match in the "Sinarjaya Agro - Master Mill" sheet (so were
 * left with the master workbook's bare 4-letter crusher code), resolve the
 * three codes that map 1:1 to a single real crusher regardless of which
 * mill carries them (verified against every matched row — see
 * tmp-verify-code-map.mjs's output during this data update):
 *   STIM  -> SINAR TAYAN INTI MULYA, KALBAR
 *   SBIM  -> SINAR BENGKULU INTI MULYA, BENGKULU
 *   STRIM -> SINAR TENGGARONG INTI MULYA, KALTIM
 * "SJIM" is deliberately NOT included here — that one code covers two
 * genuinely different crushers ("...LAMPUNG" and "...SAMPIT"), so an
 * unmatched mill still coded bare "SJIM" is left as-is rather than guessed.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const GROUP = "SJIM";
const SAFE_CODE_MAP = {
  STIM: "SINAR TAYAN INTI MULYA, KALBAR",
  SBIM: "SINAR BENGKULU INTI MULYA, BENGKULU",
  STRIM: "SINAR TENGGARONG INTI MULYA, KALTIM",
};

async function main() {
  const millsPath = path.join(ROOT, "private-data", "mills.json");
  const mills = JSON.parse(await readFile(millsPath, "utf-8"));

  let patched = 0;
  let stillAmbiguous = 0;
  for (const m of mills) {
    if (m.group !== GROUP) continue;
    const full = SAFE_CODE_MAP[m.refinery];
    if (full) {
      m.refinery = full;
      m.id = `${m.umlId || m.millName}__${m.group}__${m.refinery}`;
      patched++;
    } else if (m.refinery === "SJIM") {
      stillAmbiguous++;
    }
  }

  await writeFile(millsPath, JSON.stringify(mills));
  console.log(`[patch-sjim-refinery-fallback] ${patched} mill(s) resolved via the safe 1:1 code map`);
  console.log(
    `[patch-sjim-refinery-fallback] ${stillAmbiguous} mill(s) left as bare "SJIM" — ambiguous between LAMPUNG and SAMPIT crushers, no per-mill source to resolve them`,
  );
}

main().catch((err) => {
  console.error("[patch-sjim-refinery-fallback] failed:", err?.message || err);
  process.exit(1);
});
