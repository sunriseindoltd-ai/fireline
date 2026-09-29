#!/usr/bin/env node
/**
 * Port of loading for SUNRISE and NAM & LTS, per the user (2026-09-28):
 * SUNRISE's 12 mills supplying PPKO Tandun ship through Dumai, the other 28
 * through Belawan; every NAM & LTS mill ships through Belawan. ADM's workbook
 * (which mills.json was built from) left 7 SUNRISE ports blank and had
 * SEI MERANTI (PN) / NAGAMAS AGRO MULYA / TALIKUMAIN on Dumai. Idempotent.
 *
 * Usage: node scripts/fix-sunrise-nam-ports.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const FILE = path.join(ROOT, "private-data", "mills.json");

function portFor(m) {
  if (m.group === "SUNRISE") return m.refinery === "PPKO Tandun" ? "Dumai" : "Belawan";
  if (m.group === "NAM & LTS") return "Belawan";
  return undefined;
}

const mills = JSON.parse(await readFile(FILE, "utf8"));
let changed = 0;
for (const m of mills) {
  const port = portFor(m);
  if (port && m.port !== port) {
    console.log(`${m.group} · ${m.millName}: ${m.port || "(blank)"} -> ${port}`);
    m.port = port;
    changed += 1;
  }
}
const dumai = mills.filter((m) => m.group === "SUNRISE" && m.port === "Dumai").length;
if (dumai !== 12) throw new Error(`expected 12 SUNRISE mills on Dumai, got ${dumai}`);
await writeFile(FILE, JSON.stringify(mills));
console.log(`${changed} port(s) changed`);
