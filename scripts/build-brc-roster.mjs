#!/usr/bin/env node
/**
 * Builds the BRC (Bakrie Renewable Chemicals) tenant's mill roster,
 * private-data/tenants/brc/mills.json, from the 44 mills of BRC's own
 * dashboard (the 24 Sep 2026 build in "BRC Dashboard/Final/BRC Dashboard",
 * confirmed by the user as the current one).
 *
 * BRC buys through PT. DOMAS SAWIT INTI PERDANA — the same refinery as ADM's
 * DOMAS group — so the mill details come, in order, from:
 *   1. ADM's DOMAS roster row for the same mill (matched by UML ID, or by
 *      name for the mills with no UML ID) — 38 mills;
 *   2. UML.xlsx (D:\000 Work\000 Databases\UML.xlsx) for the 6 mills ADM's
 *      roster doesn't have, copied below (traceability/port aren't in
 *      UML.xlsx and are left empty, not guessed).
 * Only the tenant's own group label changes ("BRC"); the file never
 * references ADM, and ADM's roster is only read.
 *
 * Usage: node scripts/build-brc-roster.mjs "<BRC Dashboard/public/data folder>"
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const GROUP = "BRC";
const REFINERY = "PT. DOMAS SAWIT INTI PERDANA";

// From UML.xlsx, 2026-09-28.
const FROM_UML_XLSX = {
  PO1000020030: { millName: "ARTHA NIAGA SIMPANG PETE", groupName: "UNKNOWN", parentCompany: "ARTHA NIAGA SIMPANG PETE", lat: 2.965278, lon: 99.409167 },
  PO1000004203: { millName: "HARKAT SEJAHTERA", groupName: "UNKNOWN", parentCompany: "HARKAT SEJAHTERA", lat: 3.065017, lon: 99.428267 },
  PO1000020094: { millName: "JIUR ASAHAN MAKMUR", groupName: "UNKNOWN", parentCompany: "JIUR ASAHAN MAKMUR", lat: 2.666039, lon: 99.609733 },
  PO1000004329: { millName: "KARYA SERASI JAYA ABADI", groupName: "SUMBER TANI AGUNG (STA)", parentCompany: "KARYA SERASI JAYA ABADI", lat: 3.34228, lon: 99.22248 },
  PO1000007572: { millName: "RAJA MARGA", groupName: "UNKNOWN", parentCompany: "RAJA MARGA", lat: 3.98547, lon: 96.627139 },
  PO1000004336: { millName: "TUNAS HARAPAN SAWIT", groupName: "UNKNOWN", parentCompany: "TUNAS HARAPAN SAWIT", lat: 3.367467, lon: 99.017833 },
};

const norm = (s) => String(s ?? "").toUpperCase().replace(/\b(PT|CV)\b\.?/g, "").replace(/[^A-Z0-9]+/g, "");
const cleanUml = (s) => (/^(PO\d+|8\d+)$/.test(String(s ?? "").trim()) ? String(s).trim() : "");

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error('usage: node scripts/build-brc-roster.mjs "<BRC Dashboard/public/data>"');
  const stats = JSON.parse(await readFile(path.join(dataDir, "stats.json"), "utf8"));

  // The UML ID each BRC mill's own plots carry (first valid one per mill).
  const umlByName = new Map();
  for (const f of await readdir(path.join(dataDir, "mills"))) {
    const fc = JSON.parse(await readFile(path.join(dataDir, "mills", f), "utf8"));
    for (const x of fc.features) {
      const name = x.properties.Mill_name;
      const uml = cleanUml(x.properties.UML_ID);
      if (uml && !umlByName.has(name)) umlByName.set(name, uml);
    }
  }

  const adm = JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8"));
  const domas = adm.filter((m) => m.group === "DOMAS");

  const roster = [];
  const unresolved = [];
  for (const s of stats.mills) {
    const name = s.mill;
    const uml = umlByName.get(name) ?? "";
    const row =
      (uml && domas.find((m) => m.umlId === uml)) ||
      domas.find((m) => norm(m.millName) === norm(name));
    let rec;
    if (row) {
      rec = { ...row };
      // ADM's roster gives a few mills a temporary 8000… ID; where UML.xlsx
      // has the real UML ID for the same mill (e.g. JIUR ASAHAN MAKMUR →
      // PO1000020094, same coordinates), the real one wins.
      if (/^8/.test(rec.umlId) && FROM_UML_XLSX[uml]) {
        const u = FROM_UML_XLSX[uml];
        Object.assign(rec, { umlId: uml, nodeId: `2026-IDN-${uml.replace(/^PO/, "")}-1`, groupName: u.groupName, parentCompany: u.parentCompany });
      }
    } else if (FROM_UML_XLSX[uml]) {
      const u = FROM_UML_XLSX[uml];
      rec = {
        umlId: uml, millName: u.millName, nodeId: `2026-IDN-${uml.replace(/^PO/, "")}-1`, port: "",
        traceability: "unknown", traceabilityRaw: "", bufferKm: null,
        groupName: u.groupName, parentCompany: u.parentCompany, lat: u.lat, lon: u.lon,
      };
    } else {
      unresolved.push(name);
      continue;
    }
    rec.group = GROUP;
    rec.refinery = REFINERY;
    rec.id = `${rec.umlId || rec.millName}__${GROUP}__${REFINERY}`;
    rec.brcName = name; // BRC dashboard's own spelling, for matching its plot files
    roster.push(rec);
  }
  if (unresolved.length) throw new Error(`no source for: ${unresolved.join(", ")}`);
  if (new Set(roster.map((m) => m.id)).size !== roster.length) throw new Error("duplicate mill id");

  roster.sort((a, b) => a.millName.localeCompare(b.millName));
  const outDir = path.join(ROOT, "private-data", "tenants", "brc");
  await mkdir(outDir, { recursive: true });
  // brcName is a build-time join key only — not part of the served roster.
  await writeFile(path.join(outDir, "mills.json"), JSON.stringify(roster.map(({ brcName, ...m }) => m)));
  await writeFile(path.join(outDir, "brc-name-map.json"), JSON.stringify(Object.fromEntries(roster.map((m) => [m.brcName, m.id])), null, 1));
  console.log(`[build-brc-roster] ${roster.length} mills -> private-data/tenants/brc/mills.json`);
  for (const m of roster) console.log(`  ${m.id}${m.lat == null ? "  (no coordinates)" : ""}`);
}

main().catch((err) => {
  console.error("[build-brc-roster] failed:", err?.message || err);
  process.exit(1);
});
