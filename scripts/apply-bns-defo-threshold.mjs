#!/usr/bin/env node
/**
 * One-off correction: `Data Storage/BNS - Plot (GeoJSON)/` (the 24 delivered
 * BNS mill files, and the master analysis GDB's `BNS_MASTER_4326` layer they
 * were split from — corrected separately, outside this repo) flags a plot
 * `EUDR_Comply="NO"` for *any* nonzero per-year deforestation figure, even
 * sub-hectare noise-level readings — cross-checking found 92.5% of the
 * nonzero Def_21..Def_26 values across BNS are under 0.5ha. Per stakeholder
 * decision, a plot whose *only* issue is deforestation under 0.5ha/year (no
 * genuine forest-category/social overlap) is corrected to compliant here, at
 * the delivered source, so the fix isn't only a display-layer patch.
 *
 * Mirrors src/lib/ledger-geo.ts's bnsHasRealIssue()/BNS_MITIGATION_DOWNGRADE
 * and scripts/prepare-eudr-stats.mjs's identical accumulate()-time check —
 * this is the third mirror of the same rule (raw source, display layer,
 * aggregate stats) because each operates on data that isn't reachable from
 * the others: this one edits the delivered drop itself.
 *
 * After running this, re-run scripts/prepare-bns-plots.mjs (to regenerate
 * private-data/plots/*BNS* from the corrected source — PlotIDs are unchanged
 * since minting doesn't depend on EUDR_Comply) and
 * scripts/prepare-eudr-stats.mjs, then re-upload the 24 BNS plot files to R2.
 *
 * Usage: node scripts/apply-bns-defo-threshold.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "BNS - Plot (GeoJSON)");
const THRESHOLD_HA = 0.5;

const DEF_YEAR_KEYS = ["Def_21", "Def_22", "Def_23", "Def_24", "Def_25", "Def_26"];
const NON_DEFORESTATION_ISSUE_KEYS = [
  "HL", "HP", "HPK", "HPT", "CA", "FL_LAIN", "KSA_KPA", "SM", "TAHURA", "TB", "TN", "TWA",
  "Community_F", "Indigenous_F", "Social_F",
];

// Exact text already used by every genuinely-compliant A/B/C row in this
// same drop — captured directly from the live data, not reconstructed, so a
// flipped row is indistinguishable from an originally-compliant row of the
// same class.
const MITIGATION_TEXT_DOWNGRADE = {
  "D. Non-Compliant — Low-Risk Area; Pending Geospatial Review":
    "A. Compliant — Low-Risk Area; Approved for Submission",
  "E. Non-Compliant — Medium-Risk Area; Mitigation Required Before Submission":
    "B. Compliant — Medium-Risk Area; Approved with Routine Monitoring",
  "F. Non-Compliant — High-Risk Area; Not Approved for Submission":
    "C. Compliant — High-Risk Area; Approved with Enhanced Monitoring",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hasRealIssue(p) {
  if (NON_DEFORESTATION_ISSUE_KEYS.some((k) => num(p[k]) > 0)) return true;
  return DEF_YEAR_KEYS.some((k) => num(p[k]) >= THRESHOLD_HA);
}

async function main() {
  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  let totalFeatures = 0;
  let totalFlipped = 0;

  for (const file of files) {
    const filePath = path.join(SRC_DIR, file);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    let flipped = 0;
    for (const f of raw.features ?? []) {
      const p = f.properties ?? {};
      totalFeatures += 1;
      if (p.EUDR_Comply !== "NO" || hasRealIssue(p)) continue;
      const newText = MITIGATION_TEXT_DOWNGRADE[String(p.Risk_Mitigation_Class ?? "")];
      if (!newText) {
        throw new Error(
          `${file}: unexpected Risk_Mitigation_Class text on a NO-comply row, refusing to guess: ${JSON.stringify(p.Risk_Mitigation_Class)}`,
        );
      }
      p.EUDR_Comply = "YES";
      p.Desc_Issue = "";
      p.Risk_Mitigation_Class = newText;
      flipped += 1;
    }
    if (flipped > 0) {
      await writeFile(filePath, JSON.stringify(raw));
    }
    totalFlipped += flipped;
    console.log(`[apply-bns-defo-threshold] ${file}: ${flipped} row(s) flipped NO -> YES`);
  }

  console.log(
    `\n[apply-bns-defo-threshold] done — ${totalFlipped} of ${totalFeatures} feature(s) flipped across ${files.length} file(s)`,
  );
}

main().catch((err) => {
  console.error("[apply-bns-defo-threshold] failed:", err?.message || err);
  process.exit(1);
});
