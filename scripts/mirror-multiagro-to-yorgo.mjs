#!/usr/bin/env node
/**
 * MULTIAGRO SUMATERAJAYA / PULAU DOGOM (UML_ID PO1000006247) is one
 * physical mill supplying three chains — Permata (buffer 20km, already
 * ingested, 16,261 plots — a different, broader catchment), DOMAS (village
 * level, 969 plots — see scripts/build-multiagro-domas-plots.py), and
 * YORGO (also declared "Village Level" in mills.json, but its own native
 * batch — 1,323 plots, 100% flagged >100km from the registered mill point
 * — turned out to be a mis-attribution in YORGO's master gdb, not usable;
 * see scripts/prepare-yorgo-plots.mjs's own history/commit for that
 * investigation).
 *
 * Since YORGO's declared traceability method for this mill matches
 * DOMAS's (village level) rather than Permata's (buffer), and DOMAS's
 * plot set is the only verified, geographically-sensible village-level
 * source available, YORGO's slot mirrors DOMAS's file verbatim rather
 * than inventing separate data or reusing Permata's differently-scoped
 * buffer catchment. NodeID is identical across all three mills.json rows
 * for this UML_ID already, so no property needs to change — this is a
 * straight byte-for-byte copy.
 *
 * Usage: node scripts/mirror-multiagro-to-yorgo.mjs
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PLOTS_DIR = path.join(ROOT, "private-data", "plots");
const SRC = path.join(PLOTS_DIR, "PO1000006247__DOMAS__PT. DOMAS SAWIT INTI PERDANA.geojson");
const DEST = path.join(PLOTS_DIR, "PO1000006247__YORGO__YORGO ANUGERAH NUSANTARA.geojson");

await copyFile(SRC, DEST);
console.log(`[mirror-multiagro-to-yorgo] copied -> ${DEST}`);
