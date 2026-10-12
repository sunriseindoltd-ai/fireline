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
// read from KANOPI_SMOKE_<USER>_PASSWORD, else the local, gitignored
// artifacts/akun-supplier.csv that hash-gate-password.mjs's output went into.
function supplierPassword(user) {
  const envVar = `KANOPI_SMOKE_${user.toUpperCase()}_PASSWORD`;
  if (process.env[envVar]) return process.env[envVar];
  try {
    const csv = readFileSync(path.join(process.cwd(), "artifacts", "akun-supplier.csv"), "utf8");
    // Separator is ";" in the current file, "," in older ones.
    const row = csv.split(/\r?\n/).find((line) => line.split(/[;,]/)[0] === user);
    if (row) return row.split(/[;,]/)[1];
  } catch {}
  throw new Error(
    `No password for supplier account '${user}' — set ${envVar} or add artifacts/akun-supplier.csv`,
  );
}
const SUPPLIER = { user: "permata", pass: supplierPassword("permata") };
// Same rule for the BRC tenant's client logins (artifacts/akun-brc.csv).
function brcPassword(user) {
  const envVar = `KANOPI_SMOKE_${user.toUpperCase().replace(/-/g, "_")}_PASSWORD`;
  if (process.env[envVar]) return process.env[envVar];
  // url;role;username;password;tenant — saved with ";" (Excel, ID locale);
  // "," accepted too.
  const csv = readFileSync(path.join(process.cwd(), "artifacts", "akun-brc.csv"), "utf8");
  const cells = (line) => line.split(/[;,]/);
  const row = csv.split(/\r?\n/).find((line) => cells(line)[2] === user);
  if (!row) throw new Error(`No password for BRC account '${user}' — set ${envVar} or add artifacts/akun-brc.csv`);
  return cells(row)[3];
}
const BRC_CLIENT = { user: "brc-1", pass: brcPassword("brc-1") };
const BRC_PLOTS_DIR = path.join(process.cwd(), "private-data", "tenants", "brc", "plots");
const BRC_SPLIT_ID = "PO1000013517__BRC__PT. DOMAS SAWIT INTI PERDANA";
const BNS_SUPPLIER = { user: "bns", pass: supplierPassword("bns") };

const PERMATA_ID = "PO1000004173__Permata__Permata KIM";
// The mill an ADM reviewer saw fail ("couldn't load plots") while signed in
// as the BNS supplier on 2026-09-25.
const BNS_BUMI_ID = "PO1000011198__BNS__Banyuasin Nusantara Sejahtera";
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
      location.pathname.startsWith("/app") ||
      (document.querySelector(".login-err")?.textContent ?? "").trim().length > 0,
    { timeout: 15000 },
  );
  // Login clears the reading-guide flags; mark both guides seen so the tour
  // overlay doesn't sit on top of the clicks below.
  if (new URL(page.url()).pathname.startsWith("/app")) {
    await page.evaluate(() => {
      localStorage.setItem("palmtrace.tourDone", "1");
      localStorage.setItem("soytrace.tourDone", "1");
    });
    await page.reload({ waitUntil: "networkidle" });
  }
}

/** Admin client switch, in the header's account menu (a full page reload). */
async function switchClient(page, label) {
  await page.click(".acct-btn");
  const item = page.getByRole("menuitemradio", { name: label, exact: true });
  await Promise.all([page.waitForEvent("load"), item.click()]);
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
    check(`${label} login succeeds`, p.url() === `${BASE}/app/portfolio`, p.url());
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

  const bnsPage = await browser.newPage();
  await loginAs(bnsPage, BNS_SUPPLIER);
  const bnsBumiDisk = diskFeatures(BNS_BUMI_ID).length;
  const bnsBumiRes = await fetchPlot(bnsPage, BNS_BUMI_ID);
  check(
    "BNS supplier loads BUMI KHATULISTIWA MANDIRI's plots (matches disk)",
    bnsBumiRes.status === 200 && bnsBumiRes.body?.features?.length === bnsBumiDisk,
    `status=${bnsBumiRes.status} server=${bnsBumiRes.body?.features?.length} disk=${bnsBumiDisk}`,
  );
  const bnsSummary = await bnsPage.evaluate(async (id) => {
    const res = await fetch("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ millIds: [id] }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, BNS_BUMI_ID);
  check(
    "BNS supplier gets BUMI KHATULISTIWA MANDIRI's EUDR summary",
    bnsSummary.status === 200 && bnsSummary.body?.millsWithData === 1,
    `status=${bnsSummary.status} millsWithData=${bnsSummary.body?.millsWithData}`,
  );
  await bnsPage.close();

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

  // ---- Tenant isolation (ADM vs BRC) ----
  const getJson = (p, url, init) =>
    p.evaluate(async ([u, i]) => {
      const res = await fetch(u, i);
      return { status: res.status, body: await res.json().catch(() => null) };
    }, [url, init]);
  const summaryOf = (p, ids) =>
    getJson(p, "/eudr-summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ millIds: ids }) });

  const admMills = await getJson(page, "/data/mills.json");
  check("ADM roster contains no BRC mills", admMills.status === 200 && !admMills.body.some((m) => m.id.includes("__BRC__")));
  const admTenantPath = await getJson(page, "/data/tenants/brc/mills.json");
  check("A literal tenants/ path is never served (ADM admin)", admTenantPath.status === 404, `status=${admTenantPath.status}`);
  const admBrcPlot = await fetchPlot(page, BRC_SPLIT_ID);
  check("ADM session cannot read a BRC plot file", admBrcPlot.status === 404, `status=${admBrcPlot.status}`);

  const brcPage = await browser.newPage();
  await loginAs(brcPage, BRC_CLIENT);
  check("BRC client login succeeds", brcPage.url() === `${BASE}/app/portfolio`, brcPage.url());
  const brcMills = await getJson(brcPage, "/data/mills.json");
  check(
    "BRC roster is BRC-only (44 mills, no ADM ids)",
    brcMills.status === 200 && brcMills.body.length === 44 && brcMills.body.every((m) => m.id.includes("__BRC__")),
    `n=${brcMills.body?.length}`,
  );
  const brcSplitDisk = readdirSync(BRC_PLOTS_DIR)
    .filter((f) => new RegExp(`^${escapeRegex(BRC_SPLIT_ID)}(\\.part\\d+)?\\.geojson$`).test(f))
    .reduce((n, f) => n + JSON.parse(readFileSync(path.join(BRC_PLOTS_DIR, f), "utf8")).features.length, 0);
  const brcSplit = await fetchPlot(brcPage, BRC_SPLIT_ID);
  check(
    "BRC plot fetch (multi-part) matches its own disk files",
    brcSplit.status === 200 && brcSplit.body?.features?.length === brcSplitDisk,
    `server=${brcSplit.body?.features?.length} disk=${brcSplitDisk}`,
  );
  const brcAdmPlot = await fetchPlot(brcPage, DOMAS_SPLIT_ID);
  check("BRC session cannot read an ADM plot file", brcAdmPlot.status === 404, `status=${brcAdmPlot.status}`);
  const brcTenantPath = await getJson(brcPage, "/data/tenants/brc/mills.json");
  check("A literal tenants/ path is never served (BRC client)", brcTenantPath.status === 404, `status=${brcTenantPath.status}`);
  const brcAdmSummary = await summaryOf(brcPage, [ADOLINA_ID, PERMATA_ID]);
  check("BRC session gets no figures for ADM mill ids", brcAdmSummary.body?.millsWithData === 0, `millsWithData=${brcAdmSummary.body?.millsWithData}`);
  const brcCoverage = await getJson(brcPage, "/coverage");
  check(
    "BRC coverage lists BRC mills only",
    brcCoverage.status === 200 && brcCoverage.body.millIds.length > 0 && brcCoverage.body.millIds.every((id) => id.includes("__BRC__")),
    `n=${brcCoverage.body?.millIds?.length}`,
  );
  await brcPage.click(".acct-btn");
  check("BRC client sees no client switcher", (await brcPage.locator('.acct-menu [role="menuitemradio"]').count()) === 0);
  // Feedback 3: village flows follow the tenant; the access-request inbox is admin-only.
  const brcAdmFlows = await getJson(brcPage, "/village-flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ millIds: [ADOLINA_ID, PERMATA_ID] }),
  });
  check("BRC session gets no village flows for ADM mill ids", brcAdmFlows.body?.flows?.length === 0, `flows=${brcAdmFlows.body?.flows?.length}`);
  const brcInbox = await getJson(brcPage, "/access-requests");
  check("Client cannot read the access-request inbox", brcInbox.status === 403, `status=${brcInbox.status}`);
  await brcPage.close();

  const admFlows = await getJson(page, "/village-flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ millIds: [PERMATA_ID] }),
  });
  check("ADM village flows for a Permata mill", admFlows.status === 200 && admFlows.body?.flows?.length > 0, `flows=${admFlows.body?.flows?.length}`);
  const adminInbox = await getJson(page, "/access-requests");
  check("Admin can read the access-request inbox", adminInbox.status === 200 && Array.isArray(adminInbox.body?.requests), `status=${adminInbox.status}`);
  const badRequest = await getJson(page, "/contact-request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x", email: "not-an-email", organisation: "x", consent: true }),
  });
  check("Contact form rejects an invalid email (400)", badRequest.status === 400, `status=${badRequest.status}`);

  await page.goto(`${BASE}/app/portfolio`, { waitUntil: "networkidle" });
  await switchClient(page, "Bakrie Renewable Chemicals");
  await page.waitForLoadState("networkidle");
  const switched = await getJson(page, "/data/mills.json");
  check("Admin can switch to BRC", switched.body?.length === 44 && switched.body.every((m) => m.id.includes("__BRC__")), `n=${switched.body?.length}`);
  await switchClient(page, "ADM");
  await page.waitForLoadState("networkidle");
  const back = await getJson(page, "/data/mills.json");
  check("Admin can switch back to ADM", back.body?.length === admMills.body.length, `n=${back.body?.length}`);

  await page.close();
  // SoyTrace (9 Oct 2026 layout): the client lands on the Overview with one card per crushing
  // plant; a card opens that plant's page; the Map tab carries the mode switcher.
  try {
    const soyCsv = readFileSync(path.join(process.cwd(), "artifacts", "akun-adm-soy.csv"), "utf8");
    const soyRow = soyCsv.split(/\r?\n/).find((l) => l.includes(",adm-soy-1,"));
    const [, , soyUser, soyPass] = soyRow.split(",");
    const sp = await browser.newPage();
    await loginAs(sp, { user: soyUser, pass: soyPass });
    await sp.evaluate(() => {
      localStorage.setItem("soytrace.tab4", JSON.stringify("overview"));
      localStorage.setItem("soytrace.page", JSON.stringify("home"));
    });
    await sp.reload({ waitUntil: "networkidle" });
    await sp.waitForSelector(".soy-plant-card", { timeout: 60000 });
    const cards = await sp.$$eval(".soy-plant-card:not(.pending)", (c) => c.length);
    check("SoyTrace Overview lists the four crushing plants", cards === 4, `cards=${cards}`);
    const tabs = await sp.$$eval(".app-tabs button", (b) => b.map((x) => x.textContent.trim()));
    check("SoyTrace header has six tabs", tabs.length === 6, tabs.join(" · "));
    await sp.click(".soy-plant-card:has-text('Quincy')");
    await sp.waitForSelector(".soy-fac-page h1", { timeout: 30000 });
    const h1 = await sp.textContent(".soy-fac-page h1");
    check("A plant card opens the plant's page", /Quincy/.test(h1 ?? ""), h1 ?? "");
    await sp.click(".app-tabs button:nth-child(2)");
    await sp.waitForSelector(".soy-modes", { timeout: 60000 });
    const modes = await sp.$$eval(".soy-modes button", (b) => b.length);
    check("Map tab shows the four map modes", modes === 4, `modes=${modes}`);
    await sp.close();
  } catch (err) {
    check("SoyTrace Overview checks ran", false, String(err).slice(0, 160));
  }

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
