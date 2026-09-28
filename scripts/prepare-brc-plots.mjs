#!/usr/bin/env node
/**
 * Fills the BRC tenant's plot files (private-data/tenants/brc/plots/) and
 * traceability areas, after scripts/build-brc-roster.mjs.
 *
 * Which plots belong to which BRC mill follows BRC's own dashboard, the
 * 24 Sep 2026 build (confirmed as current). The attributes come from
 * PalmTrace's full analysis, not the dashboard's 15-column export:
 *   - 34 mills: their plots are already processed as ADM's DOMAS group
 *     (same refinery, PT. DOMAS SAWIT INTI PERDANA) — copied from there,
 *     keeping exactly the PlotIDs the BRC dashboard lists for that mill;
 *   - 10 mills PalmTrace had never processed: from
 *     `Data Storage/BRC - Plot (GeoJSON)/`, the export of
 *     ANALISIS\BRC_28092026.gdb\BRC10_MASTER (same pipeline as SUNRISE; see
 *     that folder's BRC_PIPELINE_NOTES.md), including its NEEDS VERIFICATION/
 *     (>100 km) plots — for BRC these are shown, by user decision.
 * Mill identity (UML_ID, Mill_name, NodeID) is always re-asserted from the
 * BRC roster. Areas: ADM's DOMAS areas file (drawn for BRC's mills in the
 * first place — "30 MILL BRC") filtered to mills in the BRC roster only.
 *
 * Usage: node scripts/prepare-brc-plots.mjs "<BRC Dashboard/public/data folder>"
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const TENANT_DIR = path.join(ROOT, "private-data", "tenants", "brc");
const OUT_DIR = path.join(TENANT_DIR, "plots");
const ADM_PLOTS = path.join(ROOT, "private-data", "plots");
const PROCESSED_DIR = path.join(ROOT, "Data Storage", "BRC - Plot (GeoJSON)");
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024;

const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

function roundCoords(c, d) {
  return typeof c[0] === "number" ? c.map((n) => Number(n.toFixed(d))) : c.map((x) => roundCoords(x, d));
}
function roundGeometry(g) {
  return g && g.coordinates ? { ...g, coordinates: roundCoords(g.coordinates, PRECISION) } : g;
}
function splitBySize(features) {
  const chunks = [];
  let cur = [];
  let bytes = 2;
  for (const f of features) {
    const size = Buffer.byteLength(JSON.stringify(f)) + 1;
    if (cur.length && bytes + size > TARGET_PART_BYTES) {
      chunks.push(cur);
      cur = [];
      bytes = 2;
    }
    cur.push(f);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
async function readFc(file) {
  return JSON.parse(await readFile(file, "utf8")).features ?? [];
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error('usage: node scripts/prepare-brc-plots.mjs "<BRC Dashboard/public/data>"');
  const roster = JSON.parse(await readFile(path.join(TENANT_DIR, "mills.json"), "utf8"));
  const byId = new Map(roster.map((m) => [m.id, m]));
  const nameMap = JSON.parse(await readFile(path.join(TENANT_DIR, "brc-name-map.json"), "utf8"));

  // Dashboard membership: BRC mill id -> its PlotIDs.
  const members = new Map();
  for (const f of await readdir(path.join(dataDir, "mills"))) {
    for (const x of await readFc(path.join(dataDir, "mills", f))) {
      const id = nameMap[x.properties.Mill_name];
      if (!id) throw new Error(`dashboard mill not in roster: ${x.properties.Mill_name}`);
      if (!members.has(id)) members.set(id, new Set());
      members.get(id).add(x.properties.PlotID);
    }
  }

  const admFiles = await readdir(ADM_PLOTS);
  const processed = new Map(); // millName -> features from the BRC pipeline export
  for (const f of (await readdir(PROCESSED_DIR)).filter((f) => f.endsWith(".geojson"))) {
    for (const x of await readFc(path.join(PROCESSED_DIR, f))) {
      const name = x.properties.Mill_name;
      if (!processed.has(name)) processed.set(name, []);
      processed.get(name).push(x);
    }
  }

  // Unlike ADM's groups, BRC's plots >100 km from their mill are NOT held
  // back (user decision, 2026-09-28: BRC delivered them this way and won't
  // verify them) — the export's NEEDS VERIFICATION/ is folded back in.
  // `_dist_to_mill_km` stays on every plot, so they can still be found.
  const heldDir = path.join(PROCESSED_DIR, "NEEDS VERIFICATION");
  const held = new Map();
  for (const f of (await readdir(heldDir)).filter((f) => f.endsWith(".geojson"))) {
    for (const x of await readFc(path.join(heldDir, f))) {
      const name = x.properties.Mill_name;
      held.set(name, (held.get(name) ?? 0) + 1);
      if (!processed.has(name)) processed.set(name, []);
      processed.get(name).push(x);
    }
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  let total = 0;
  for (const m of roster) {
    let feats;
    let source;
    const admId = m.id.replace("__BRC__", "__DOMAS__");
    const admParts = admFiles.filter((f) => f === `${admId}.geojson` || (f.startsWith(`${admId}.part`) && f.endsWith(".geojson")));
    if (processed.has(m.millName)) {
      feats = processed.get(m.millName);
      source = `BRC pipeline${held.has(m.millName) ? `, incl. ${held.get(m.millName)} >100 km from the mill` : ""}`;
    } else if (admParts.length) {
      const want = members.get(m.id) ?? new Set();
      feats = [];
      for (const f of admParts) for (const x of await readFc(path.join(ADM_PLOTS, f))) if (want.has(x.properties.PlotID)) feats.push(x);
      source = `copied (${feats.length}/${want.size} dashboard plots)`;
      if (feats.length !== want.size) throw new Error(`${m.millName}: only ${feats.length} of ${want.size} dashboard plots found in ADM DOMAS`);
    } else {
      throw new Error(`${m.millName}: no plot source`);
    }
    const out = feats.map((x) => ({
      type: "Feature",
      properties: { ...x.properties, UML_ID: m.umlId, Mill_name: m.millName, NodeID: m.nodeId },
      geometry: roundGeometry(x.geometry),
    }));
    const chunks = splitBySize(out);
    for (const [n, chunk] of chunks.entries()) {
      await writeFile(path.join(OUT_DIR, `${m.id}${n ? `.part${n + 1}` : ""}.geojson`), JSON.stringify({ type: "FeatureCollection", features: chunk }));
    }
    total += out.length;
    console.log(`[prepare-brc] ${m.millName}: ${out.length} plots, ${source}${chunks.length > 1 ? `, ${chunks.length} parts` : ""}`);
  }

  // Areas: only features whose mill is in the BRC roster.
  const areaSrc = path.join(ROOT, "private-data", "areas", "pt-domas-sawit-inti-perdana.geojson");
  const umls = new Set(roster.map((m) => m.umlId).filter(Boolean));
  const names = new Set(roster.map((m) => norm(m.millName)));
  const areas = (await readFc(areaSrc)).filter((f) => umls.has(f.properties.UML_ID) || names.has(norm(f.properties.Mill_name)));
  await mkdir(path.join(TENANT_DIR, "areas"), { recursive: true });
  await writeFile(path.join(TENANT_DIR, "areas", "pt-domas-sawit-inti-perdana.geojson"), JSON.stringify({ type: "FeatureCollection", features: areas }));

  console.log(`[prepare-brc] done — ${total} plots across ${roster.length} mills; ${areas.length} area features`);
}

main().catch((err) => {
  console.error("[prepare-brc] failed:", err?.message || err);
  process.exit(1);
});
