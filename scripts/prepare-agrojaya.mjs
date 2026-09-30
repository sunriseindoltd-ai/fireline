#!/usr/bin/env node
/**
 * Ingests the AGROJAYA supplier group (ADM tenant) — a 6-mill sample checked on
 * 30 Sep 2026 in `…\Semua Delivery Ada di Sini\Cek UML 30092026\`
 * (see CEK_UML_NOTES.md there). Group and refinery are both "AGROJAYA" until
 * an official refinery/KCP name is known (user decision).
 *
 *  - SINTONG ABADI, KWALA SAWIT, SAWIT HULU: new to Kanopi. Their plots are the
 *    Kanopi plots intersecting each mill's 20 km buffer, one per identical
 *    geometry, re-identified to the new mill (folder 03 "Plot Mill Baru
 *    (Re-ID)"). The `Src_*` provenance fields name other groups' mills and
 *    are dropped here, so an AGROJAYA supplier login can't read who else
 *    those plots were first delivered for; the full mapping stays in
 *    "Mapping PlotID Mill Baru.xlsx".
 *  - PULAU TIGA (Permata) and INDOMAS MITRA TEKNIK (YORGO): already in Kanopi;
 *    AGROJAYA gets its own copy of the row and plot file (each chain holds its
 *    own copy — tenants.ts / mills rule). None of their plots is >100 km out.
 *  - PT OKTA PALM OIL: not in UML.xlsx — listed without UML ID, coordinates or
 *    plots (like MARIO KASIH in BRC), so it stays out of the group figures.
 *
 * Identity (UML ID, names, group, coordinates) comes from UML.xlsx (30 Sep).
 * Idempotent: AGROJAYA rows and plot files are replaced on every run.
 * Afterwards: prepare-eudr-stats.mjs, then upload "__AGROJAYA__" to R2.
 *
 * Usage: node scripts/prepare-agrojaya.mjs [--src "<Cek UML folder>"]
 */
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const MILLS = path.join(ROOT, "private-data", "mills.json");
const PLOTS = path.join(ROOT, "private-data", "plots");
const srcIdx = process.argv.indexOf("--src");
const SRC =
  srcIdx >= 0
    ? process.argv[srcIdx + 1]
    : "D:\\000 Work\\000 Databases\\002 Request\\Semua Delivery Ada di Sini\\Cek UML 30092026";
const REID_DIR = path.join(SRC, "03. Plot Mill Baru (Re-ID)");
const GROUP = "AGROJAYA";
const REFINERY = "AGROJAYA";
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024;

const idOf = (key) => `${key}__${GROUP}__${REFINERY}`;
const nodeOf = (uml) => `2026-IDN-${uml.replace(/^PO/, "")}-1`;

// From UML.xlsx, 30 Sep 2026. Traceability for the re-ID'd mills is the
// 20 km buffer their plots were selected with.
const NEW_MILLS = [
  {
    umlId: "PO1000004149",
    millName: "SINTONG ABADI",
    groupName: "DUPONT & LEOSK ENTERPRISES",
    parentCompany: "SINTONG ABADI",
    lat: 2.9239,
    lon: 99.707367,
    file: "PO1000004149__SINTONG ABADI.geojson",
  },
  {
    umlId: "PO1000007585",
    millName: "KWALA SAWIT",
    groupName: "PTPN III",
    parentCompany: "PERKEBUNAN NUSANTARA II",
    lat: 3.69194,
    lon: 98.153056,
    file: "PO1000007585__KWALA SAWIT.geojson",
  },
  {
    umlId: "PO1000004545",
    millName: "SAWIT HULU",
    groupName: "PTPN III",
    parentCompany: "PERKEBUNAN NUSANTARA II",
    lat: 3.843117,
    lon: 98.233,
    file: "PO1000004545__SAWIT HULU.geojson",
  },
];
// Existing Kanopi mills AGROJAYA also buys from: row + plot file copied.
const COPIED = [
  "PO1000004567__Permata__Permata KIM",
  "PO1000004286__YORGO__YORGO ANUGERAH NUSANTARA",
];

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}

function splitBySize(features, targetBytes) {
  const chunks = [];
  let current = [];
  let bytes = 2;
  for (const f of features) {
    const size = Buffer.byteLength(JSON.stringify(f)) + 1;
    if (current.length > 0 && bytes + size > targetBytes) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    current.push(f);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function writeParts(millId, features) {
  const chunks = splitBySize(features, TARGET_PART_BYTES);
  for (const [n, chunk] of chunks.entries()) {
    const suffix = n === 0 ? "" : `.part${n + 1}`;
    await writeFile(
      path.join(PLOTS, `${millId}${suffix}.geojson`),
      JSON.stringify({ type: "FeatureCollection", features: chunk }),
    );
  }
  return chunks.length;
}

async function main() {
  const mills = JSON.parse(await readFile(MILLS, "utf8"));
  const kept = mills.filter((m) => m.group !== GROUP);
  for (const f of (await readdir(PLOTS)).filter((f) => f.includes(`__${GROUP}__`)))
    await rm(path.join(PLOTS, f));

  const rows = [];
  for (const m of NEW_MILLS) {
    const id = idOf(m.umlId);
    rows.push({
      id,
      group: GROUP,
      refinery: REFINERY,
      millName: m.millName,
      umlId: m.umlId,
      nodeId: nodeOf(m.umlId),
      port: "",
      traceability: "buffer",
      traceabilityRaw: "Buffer 20KM",
      bufferKm: 20,
      groupName: m.groupName,
      parentCompany: m.parentCompany,
      lat: m.lat,
      lon: m.lon,
    });
    const fc = JSON.parse(await readFile(path.join(REID_DIR, m.file), "utf8"));
    const features = fc.features.map((f) => {
      if (f.properties.UML_ID !== m.umlId)
        throw new Error(`${m.file}: unexpected UML_ID ${f.properties.UML_ID}`);
      const props = Object.fromEntries(
        Object.entries(f.properties).filter(([k]) => !k.startsWith("Src_")),
      );
      return {
        type: "Feature",
        properties: { ...props, UML_ID: m.umlId, Mill_name: m.millName, NodeID: nodeOf(m.umlId) },
        geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, PRECISION) },
      };
    });
    const parts = await writeParts(id, features);
    console.log(`[prepare-agrojaya] ${m.millName}: ${features.length} plots in ${parts} file(s)`);
  }

  for (const srcId of COPIED) {
    const src = mills.find((m) => m.id === srcId);
    if (!src) throw new Error(`${srcId} not in mills.json`);
    const id = idOf(src.umlId);
    rows.push({ ...src, id, group: GROUP, refinery: REFINERY });
    const files = (await readdir(PLOTS)).filter(
      (f) => f.startsWith(`${srcId}.`) && f.endsWith(".geojson"),
    );
    for (const f of files)
      await copyFile(path.join(PLOTS, f), path.join(PLOTS, id + f.slice(srcId.length)));
    console.log(
      `[prepare-agrojaya] ${src.millName}: copied ${files.length} plot file(s) from ${src.group}`,
    );
  }

  rows.push({
    id: idOf("OKTA PALM OIL"),
    group: GROUP,
    refinery: REFINERY,
    millName: "OKTA PALM OIL",
    umlId: "",
    nodeId: "",
    port: "",
    traceability: "",
    traceabilityRaw: "",
    bufferKm: null,
    groupName: "",
    parentCompany: "OKTA PALM OIL",
    lat: null,
    lon: null,
  });
  console.log("[prepare-agrojaya] OKTA PALM OIL: listed without UML ID, coordinates or plots");

  await writeFile(MILLS, JSON.stringify([...kept, ...rows]));
  console.log(
    `[prepare-agrojaya] mills.json: ${rows.length} ${GROUP} row(s), ${kept.length + rows.length} total`,
  );
}

main().catch((err) => {
  console.error("[prepare-agrojaya] failed:", err?.message || err);
  process.exit(1);
});
