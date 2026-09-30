#!/usr/bin/env node
/**
 * Renders the /soy "In context" picture — a still of SoyTrace's rail & river
 * view: soybean fields shaded by distance to the nearest rail line or river,
 * with rail, the river system and elevator points — into
 * public/img/soy/context-map-{1600,900}.jpg. No UI, no labels, no names.
 *
 * Needs the dev server (with the supply-chain data prepared) and an ADM Soy
 * login: KANOPI_SOY_USER / KANOPI_SOY_PASSWORD, else artifacts/akun-adm-soy.csv.
 *
 * Usage: node scripts/capture-soy-context.mjs [baseUrl] [lon] [lat] [zoom]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const BASE = process.argv[2] || "http://127.0.0.1:8096";
const LON = Number(process.argv[3] ?? -91.33);
const LAT = Number(process.argv[4] ?? 39.93);
const ZOOM = Number(process.argv[5] ?? 10.6);

function account() {
  if (process.env.KANOPI_SOY_USER && process.env.KANOPI_SOY_PASSWORD) {
    return { user: process.env.KANOPI_SOY_USER, pass: process.env.KANOPI_SOY_PASSWORD };
  }
  const rows = readFileSync(path.join(ROOT, "artifacts", "akun-adm-soy.csv"), "utf8").split(/\r?\n/);
  const row = rows.find((l) => l.split(/[;,]/).includes("adm-soy-1"));
  if (!row) throw new Error("adm-soy-1 not in artifacts/akun-adm-soy.csv");
  const cols = row.split(/[;,]/);
  return { user: "adm-soy-1", pass: cols[cols.indexOf("adm-soy-1") + 1] };
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1067 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("kanopi.lang", "en");
    localStorage.setItem("soytrace.view", JSON.stringify("corridor"));
  });
  const page = await ctx.newPage();
  const { user, pass } = account();
  await page.goto(`${BASE}/login?product=soy`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app/, { timeout: 120000 });
  await page.waitForSelector(".supply-map .soy-map-canvas canvas", { timeout: 120000 });
  // The dev-only map hook is set once the style has loaded.
  await page.waitForFunction(() => !!document.querySelector(".supply-map .soy-map-canvas")?.__map, null, { timeout: 120000 });
  // The map alone, full window.
  await page.addStyleTag({
    content: `
      .app-header, .soy-views, .summary-head, .supply-scope, .supply-controls, .kpi-row, .chart-grid,
      .chart-card:not(.soy-map-card), .soy-map-tools, .soy-map-legend, .soy-map-status,
      .maplibregl-ctrl, .maplibregl-popup { display: none !important; }
      .soy-map-card { position: fixed !important; inset: 0 !important; margin: 0 !important; border-radius: 0 !important; z-index: 50; }
      .supply-map { height: 100vh !important; }`,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.evaluate(
    ([lon, lat, zoom]) => {
      const el = document.querySelector(".supply-map .soy-map-canvas");
      const map = el && el.__map;
      if (!map) throw new Error("no dev map hook");
      map.resize();
      // Removed, not hidden: the view's layer switches would show them again.
      // No names or the client's plant on the public site.
      for (const id of ["corridors", "plant-label", "adm-label", "tp-label", "plant", "rings", "adm-catch", "tp-catch"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      map.jumpTo({ center: [lon, lat], zoom });
    },
    [LON, LAT, ZOOM],
  );
  // Fields load by cell after the move; wait for them and the imagery.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector(".soy-map-status .spinner"), null, { timeout: 120000 });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = document.querySelector(".supply-map .soy-map-canvas").__map;
        if (map.loaded()) resolve(null);
        else map.once("idle", () => resolve(null));
      }),
  );
  await page.waitForTimeout(1200);
  const out = path.join(ROOT, "public", "img", "soy");
  const full = await page.screenshot({ type: "jpeg", quality: 82 });
  writeFileSync(path.join(out, "context-map-1600.jpg"), full);
  // 900 px copy, scaled in the page (no image library needed).
  const small = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = Math.round((img.height * 900) / img.width);
    const g = canvas.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  }, full.toString("base64"));
  writeFileSync(path.join(out, "context-map-900.jpg"), Buffer.from(small, "base64"));
  console.log("[capture-soy-context] public/img/soy/context-map-{1600,900}.jpg");
} finally {
  await browser.close();
}
