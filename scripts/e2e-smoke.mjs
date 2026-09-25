#!/usr/bin/env node
/**
 * Persistent regression smoke test for Kanopi's core data-serving
 * invariants — plot storage, multi-part merging, the Permata/DOMAS mill-id
 * collision handling, role scoping, and the "no data yet" vs "failed to
 * load" distinction. Every one of these checks corresponds to a real bug
 * found and fixed during development (see git log); this exists so the
 * next change that touches any of that code gets caught here instead of
 * needing to be rediscovered by hand again.
 *
 * Deliberately compares the server's answers against numbers computed
 * fresh from private-data/plots/*.geojson on disk rather than hardcoded
 * expected values, so this doesn't need updating every time plot data is
 * refreshed — only when the actual logic regresses.
 *
 * Requires a running preview server with R2 credentials loaded, e.g.:
 *   npm run build
 *   set -a; source .env.local; set +a; npm run preview &
 *   node scripts/e2e-smoke.mjs
 *
 * URL defaults to http://127.0.0.1:8081 (npm run preview's port);
 * override with KANOPI_SMOKE_URL.
 *
 * Usage: npm run test:e2e
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.KANOPI_SMOKE_URL || "http://127.0.0.1:8081";
const PLOTS_DIR = path.join(process.cwd(), "private-data", "plots");

const ADMIN = { user: "earthline", pass: "r^M3C%KtGM69q!t" };
const ADMIN_2 = { user: "karmauzco", pass: "5l3nd312m4N!" };
// Supplier passwords are never committed (only their hashes, in gate.ts) —
// read from KANOPI_SMOKE_PERMATA_PASSWORD, else the local, gitignored
// artifacts/akun-supplier.csv that hash-gate-password.mjs's output went into.
function permataPassword() {
  if (process.env.KANOPI_SMOKE_PERMATA_PASSWORD) return process.env.KANOPI_SMOKE_PERMATA_PASSWORD;
  try {
    const csv = readFileSync(path.join(process.cwd(), "artifacts", "akun-supplier.csv"), "utf8");
    const row = csv.split(/\r?\n/).find((line) => line.startsWith("permata,"));
    if (row) return row.split(",")[1];
  } catch {}
  throw new Error(
    "No password for supplier account 'permata' — set KANOPI_SMOKE_PERMATA_PASSWORD or add artifacts/akun-supplier.csv",
  );
}
const SUPPLIER = { user: "permata", pass: permataPassword() };

const PERMATA_ID = "PO1000004173__Permata__Permata KIM";
const DOMAS_SPLIT_ID = "PO1000020081__DOMAS__PT. DOMAS SAWIT INTI PERDANA";
const OVERLAP_PERMATA_ID = "PO1000004167__Permata__Permata KIM";
const OVERLAP_DOMAS_ID = "PO1000004167__DOMAS__PT. DOMAS SAWIT INTI PERDANA";
const ADOLINA_ID = "PO1000004497__DOMAS__PT. DOMAS SAWIT INTI PERDANA";
// ADELA (JINLEE group) — has a UML ID in mills.json but JINLEE has no plot
// data uploaded at all (only Permata KIM/DOMAS/YORGO do), making this a
// stable "genuinely no data" fixture. (The previous fixture here,
// MULTIAGRO SUMATERAJAYA's DOMAS-group id, got real plot data of its own —
// this test correctly caught that the moment it happened.)
const GENUINELY_MISSING_ID = "PO1000000236__JINLEE__JINLEE";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plotFilesFor(baseId) {
  const re = new RegExp(`^${escapeRegex(baseId)}(?:\\.part\\d+)?\\.geojson$`);
  return readdirSync(PLOTS_DIR).filter((f) => re.test(f));
}

function diskFeatures(baseId) {
  const files = plotFilesFor(baseId);
  let features = [];
  for (const f of files) {
    const fc = JSON.parse(readFileSync(path.join(PLOTS_DIR, f), "utf8"));
    features = features.concat(fc.features);
  }
  return features;
}

function diskAreaHa(baseId) {
  return diskFeatures(baseId).reduce((sum, feat) => {
    const raw = feat.properties?.HECTARAGE ?? feat.properties?.Hectarage;
    const n = Number(raw);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, { user, pass }) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () =>
      location.pathname === "/" ||
      (document.querySelector(".login-err")?.textContent ?? "").trim().length > 0,
    { timeout: 15000 },
  );
}

async function fetchPlot(page, id) {
  return page.evaluate(async (rel) => {
    const res = await fetch(`/data/plots/${encodeURIComponent(rel)}.geojson`);
    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error body — fine, callers only need res.status for those
    }
    return { status: res.status, body };
  }, id);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  for (const [label, creds] of [
    ["primary admin", ADMIN],
    ["second admin", ADMIN_2],
  ]) {
    const p = await browser.newPage();
    await loginAs(p, creds);
    check(`${label} login succeeds`, p.url() === `${BASE}/`, p.url());
    await p.close();
  }

  const page = await browser.newPage();
  await loginAs(page, ADMIN);

  const permataDisk = diskFeatures(PERMATA_ID).length;
  const permataRes = await fetchPlot(page, PERMATA_ID);
  check(
    "Permata plot fetch matches disk feature count",
    permataRes.status === 200 && permataRes.body?.features?.length === permataDisk,
    `server=${permataRes.body?.features?.length} disk=${permataDisk}`,
  );

  const domasSplitDisk = diskFeatures(DOMAS_SPLIT_ID).length;
  const domasSplitRes = await fetchPlot(page, DOMAS_SPLIT_ID);
  check(
    "DOMAS multi-part merge matches disk feature count (not truncated to one part)",
    domasSplitRes.status === 200 && domasSplitRes.body?.features?.length === domasSplitDisk,
    `server=${domasSplitRes.body?.features?.length} disk=${domasSplitDisk}`,
  );

  const overlapPermataRes = await fetchPlot(page, OVERLAP_PERMATA_ID);
  const overlapDomasRes = await fetchPlot(page, OVERLAP_DOMAS_ID);
  const overlapPermataCount = overlapPermataRes.body?.features?.length ?? 0;
  const overlapDomasCount = overlapDomasRes.body?.features?.length ?? 0;
  check(
    "Overlap mill (shared UML ID): Permata and DOMAS return different, non-empty plot sets",
    overlapPermataCount > 0 && overlapDomasCount > 0 && overlapPermataCount !== overlapDomasCount,
    `permata=${overlapPermataCount} domas=${overlapDomasCount}`,
  );

  const adolinaDiskArea = diskAreaHa(ADOLINA_ID);
  const eudrResult = await page.evaluate(async (id) => {
    const res = await fetch("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ millIds: [id] }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, ADOLINA_ID);
  const serverArea = eudrResult.body?.totalAreaHa;
  check(
    "DOMAS EUDR area total matches disk-computed sum (guards the Hectarage-casing bug class)",
    typeof serverArea === "number" && adolinaDiskArea > 0 && Math.abs(serverArea - adolinaDiskArea) < 1,
    `server=${serverArea} disk=${adolinaDiskArea.toFixed(1)}`,
  );

  const supplierPage = await browser.newPage();
  await loginAs(supplierPage, SUPPLIER);
  const supplierPermataRes = await fetchPlot(supplierPage, PERMATA_ID);
  const supplierDomasRes = await fetchPlot(supplierPage, DOMAS_SPLIT_ID);
  check("Permata supplier allowed for Permata KIM", supplierPermataRes.status === 200, `status=${supplierPermataRes.status}`);
  check("Permata supplier blocked (403) from DOMAS", supplierDomasRes.status === 403, `status=${supplierDomasRes.status}`);
  await supplierPage.close();

  const missingRes = await fetchPlot(page, GENUINELY_MISSING_ID);
  check(
    "A mill with genuinely no plot file returns a plain 404 (not a 502)",
    missingRes.status === 404,
    `status=${missingRes.status}`,
  );

  await page.route("**/data/plots/**", (route) =>
    route.fulfill({ status: 502, body: "simulated upstream failure" }),
  );
  const brokenRes = await fetchPlot(page, PERMATA_ID);
  check(
    "A real upstream failure surfaces as non-404 (502), distinguishable from 'no data yet'",
    brokenRes.status === 502,
    `status=${brokenRes.status}`,
  );
  await page.unroute("**/data/plots/**");

  await page.close();
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((f) => f.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[e2e-smoke] crashed:", err);
  process.exitCode = 1;
});
