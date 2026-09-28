#!/usr/bin/env node
/**
 * Captures the product screens for the public landing page's showcase
 * (src/components/site/product-showcase.tsx) from a running *dev* server,
 * with every client-identifying detail replaced before the screenshot:
 *  - group, refinery, mill, company and port names → sample labels;
 *  - every figure scaled by one fixed factor (ratios stay plausible,
 *    values are not real); percentages and years are left alone;
 *  - long ID digit strings (UML, node, plot IDs) scrambled;
 *  - plot-table company and location cells replaced;
 *  - canvas-drawn mill labels hidden via the dev-only map hook.
 *
 * Usage (dev server on 8095, local admin fallback credentials):
 *   node scripts/capture-showcase.mjs [baseUrl]
 * Writes public/img/showcase/{portfolio,summary,map,plots}-{en,id}.jpg.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8095";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "img", "showcase");
fs.mkdirSync(OUT, { recursive: true });
const USER = process.env.KANOPI_ADMIN_USER || "earthline";
const PASS = process.env.KANOPI_ADMIN_PASSWORD || "r^M3C%KtGM69q!t";
const MILL = process.env.SHOWCASE_MILL || "PO1000004558__YORGO__YORGO ANUGERAH NUSANTARA";

/** Runs inside the page: replaces names, scales numbers, hides map labels. */
async function sanitize(page, lang) {
  const leaks = await page.evaluate(async (lang) => {
    const mills = await (await fetch("/data/mills.json")).json();
    const L = lang === "id"
      ? { group: "Grup", refinery: "Kilang", mill: "PKS", company: "PT Contoh", port: "Pelabuhan", village: "Desa Contoh, Kec. Contoh, Kab. Contoh" }
      : { group: "Group", refinery: "Refinery", mill: "Mill", company: "Sample Co.", port: "Port", village: "Sample Village, Sample District" };
    const names = new Map();
    const setName = (k, v) => {
      if (k && !names.has(k)) names.set(k, v);
    };
    const uniq = (xs) => [...new Set(xs.filter(Boolean))];
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    uniq(mills.map((m) => m.group)).forEach((g, i) => {
      setName(g, `${L.group} ${letters[i] ?? i}`);
      setName(g.toUpperCase(), `${L.group.toUpperCase()} ${letters[i] ?? i}`);
    });
    uniq(mills.map((m) => m.refinery)).forEach((r, i) => setName(r, `${L.refinery} ${String(i + 1).padStart(2, "0")}`));
    uniq(mills.map((m) => m.millName)).forEach((n, i) => setName(n, `${L.mill} ${String(i + 1).padStart(3, "0")}`));
    uniq([...mills.map((m) => m.parentCompany), ...mills.map((m) => m.groupName)]).forEach((c, i) =>
      setName(c, `${L.company} ${letters[i % 26]}${i >= 26 ? i : ""}`),
    );
    uniq(mills.map((m) => m.port)).forEach((p, i) => setName(p, `${L.port} ${i + 1}`));
    const keys = [...names.keys()].sort((a, b) => b.length - a.length);

    const thou = lang === "id" ? "." : ",";
    const dec = lang === "id" ? "," : ".";
    const F = 0.73;
    const fmt = (n, decimals) =>
      n.toLocaleString(lang === "id" ? "id-ID" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const MONTH = /^\s+(jan|feb|mar|apr|may|mei|jun|jul|aug|agu|sep|oct|okt|nov|dec|des)/i;
    // String.raw: in a plain template literal `\d` would silently become "d".
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numRe = new RegExp(
      String.raw`\u0001\d+\u0002|\d{7,}|\d{1,3}(?:${esc(thou)}\d{3})+(?:${esc(dec)}\d+)?|\d+(?:${esc(dec)}\d+)?`,
      "g",
    );
    /** Names → sample labels (protected), then figures scaled, IDs scrambled. */
    function sanitizeText(text) {
      const reps = [];
      let out = text;
      for (const k of keys) {
        if (k.length < 3) continue;
        for (const variant of [k, k.length > 26 ? k.slice(0, 25) + "…" : null]) {
          if (variant && out.includes(variant)) {
            reps.push(names.get(k));
            out = out.split(variant).join(`\u0001${reps.length - 1}\u0002`);
          }
        }
      }
      out = out.replace(numRe, (m, offset, whole) => {
        if (m.startsWith("\u0001")) return m;
        if (/^\d{7,}$/.test(m)) return m.replace(/\d/g, (d, i) => String((Number(d) * 7 + i * 3 + 5) % 10));
        const after = whole.slice(offset + m.length);
        const before = whole.slice(0, offset);
        if (/^\s?%/.test(after)) return m; // percentages
        if (/^\s?k?m\b/.test(after)) return m; // distances and resolutions (10 m, 20 km)
        if (MONTH.test(after)) return m; // dates
        if (/[A-Za-z-]$/.test(before)) return m; // parts of codes (PO…, IDN…, 2026-IDN-…)
        const plain = Number(m.split(thou).join("").replace(dec, "."));
        if (!Number.isFinite(plain) || plain < 10) return m;
        if (plain >= 1990 && plain <= 2030 && !m.includes(thou) && !m.includes(dec)) return m; // years
        const decimals = m.includes(dec) ? m.split(dec)[1].length : 0;
        return fmt(plain * F, decimals);
      });
      // eslint-disable-next-line no-control-regex -- the U+0001/U+0002 placeholder markers are our own.
      return out.replace(/\u0001(\d+)\u0002/g, (_, i) => reps[Number(i)]);
    }
    // Mill coordinates would pin the place down — blank them.
    document.querySelectorAll(".facts > div").forEach((row) => {
      const dt = row.querySelector("dt")?.textContent ?? "";
      if (/koordinat|coordinates/i.test(dt)) row.querySelector("dd").textContent = "—";
    });
    // Plot table: company (col 2) and location (col 3) cells.
    document.querySelectorAll(".plot-drawer tbody tr").forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds[1] && tds[1].textContent.trim() !== "—") tds[1].textContent = L.company;
      if (tds[2] && tds[2].textContent.trim() !== "—") tds[2].textContent = L.village;
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // Remember what each node was turned into, so a second pass on the same
    // page doesn't scale an already-scaled figure again.
    const done = (window.__sanitized ??= new WeakMap());
    for (const n of nodes) {
      const v = n.nodeValue;
      if (!v || !v.trim() || done.get(n) === v) continue;
      const next = sanitizeText(v);
      if (next !== v) n.nodeValue = next;
      done.set(n, next);
    }
    document.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title"));
    const map = window.__palmtraceMap;
    if (map && map.getLayer && map.getLayer("mills-label")) map.setLayoutProperty("mills-label", "visibility", "none");
    // Leak check: no real name or real UML/node ID may survive.
    const text = document.body.innerText;
    const ids = mills.flatMap((m) => [m.umlId, m.nodeId]).filter((x) => x && x.length >= 6);
    return [...keys.filter((k) => k.length >= 4 && text.includes(k)), ...ids.filter((x) => text.includes(x))];
  }, lang);
  await page.waitForTimeout(600);
  if (leaks.length) {
    console.error("LEAKS on", page.url(), [...new Set(leaks)].slice(0, 20));
    process.exitCode = 1;
  }
}

const browser = await chromium.launch();
for (const lang of ["en", "id"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: lang === "id" ? "id-ID" : "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=%2Fapp%2Fportfolio`, { waitUntil: "networkidle" });
  await page.evaluate((lang) => {
    localStorage.setItem("kanopi.lang", lang);
    localStorage.setItem("palmtrace.present", "true");
    localStorage.setItem("palmtrace.panel.layers", "true");
    localStorage.setItem("palmtrace.panel.find", "false");
  }, lang);
  await page.reload({ waitUntil: "networkidle" });
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app\/portfolio/);
  await page.waitForSelector(".sankey-card svg rect", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `portfolio-${lang}.jpg`), type: "jpeg", quality: 82 });

  await page.goto(`${BASE}/app/sjim`, { waitUntil: "networkidle" });
  await page.waitForSelector(".chart-card .recharts-surface", { timeout: 60000 });
  await page.waitForTimeout(1500);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `summary-${lang}.jpg`), type: "jpeg", quality: 82 });

  await page.goto(`${BASE}/app/yorgo/data?mill=${encodeURIComponent(MILL)}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".map-legend-item", { timeout: 60000 });
  await page.waitForSelector(".kpi-row.compact", { timeout: 60000 });
  await page.waitForTimeout(4000);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `map-${lang}.jpg`), type: "jpeg", quality: 82 });

  await page.locator(".side-panel .btn-primary").click();
  await page.waitForSelector(".plot-drawer .data-table tbody tr", { timeout: 30000 });
  await page.waitForTimeout(2500);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `plots-${lang}.jpg`), type: "jpeg", quality: 82 });
  await ctx.close();
  console.log("captured", lang);
}
await browser.close();
