#!/usr/bin/env node
/**
 * Captures the SoyTrace screens for the /soy landing page's showcase
 * (<ProductShowcase dir="/img/soy/showcase"> in src/routes/soy.tsx) from a
 * running *dev* server, with every client-identifying detail replaced first —
 * same approach as scripts/capture-showcase.mjs for PalmTrace:
 *  - plant, sourcing-area, county, elevator and city names → sample labels,
 *    plant addresses → a sample line, and "ADM" dropped from every label;
 *  - every figure scaled by one fixed factor (ratios stay plausible, values
 *    are not real); years, percentages, seasons and distances are left alone;
 *  - long ID digit strings (field IDs) scrambled;
 *  - plant labels on the map hidden via the dev-only map hook.
 * A leak check fails the run if any real name survives.
 *
 * Needs the dev server (field/layer files read from disk is fine), e.g.
 *   R2_ADM_SOY_ACCOUNT_ID= … node scripts/with-app-env.mjs npx vite dev --port 8096
 * Usage: node scripts/capture-soy-showcase.mjs [baseUrl]
 *   Login: KANOPI_SOY_USER / KANOPI_SOY_PASSWORD, else adm-soy-1 from
 *   artifacts/akun-adm-soy.csv.
 * Writes public/img/soy/showcase/{areas,fields,stats,context}-{en,id}.jpg.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8095";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "img", "soy", "showcase");
fs.mkdirSync(OUT, { recursive: true });

function credentials() {
  if (process.env.KANOPI_SOY_USER && process.env.KANOPI_SOY_PASSWORD) {
    return { user: process.env.KANOPI_SOY_USER, pass: process.env.KANOPI_SOY_PASSWORD };
  }
  const csv = fs.readFileSync(path.join(ROOT, "artifacts", "akun-adm-soy.csv"), "utf8");
  const row = csv.split(/\r?\n/).find((l) => l.split(/[;,]/)[2] === "adm-soy-1");
  if (!row)
    throw new Error(
      "no adm-soy-1 row in artifacts/akun-adm-soy.csv — set KANOPI_SOY_USER/PASSWORD",
    );
  return { user: "adm-soy-1", pass: row.split(/[;,]/)[3] };
}

/** Runs inside the page: replaces names, scales numbers, hides map labels. */
async function sanitize(page, lang) {
  const leaks = await page.evaluate(async (lang) => {
    const soy = await (await fetch("/data/soy.json")).json();
    const L =
      lang === "id"
        ? {
            plant: "Pabrik",
            county: "County",
            elevator: "Elevator",
            city: "Kota",
            address: "Alamat contoh, Amerika Serikat",
          }
        : {
            plant: "Plant",
            county: "County",
            elevator: "Elevator",
            city: "City",
            address: "Sample address, United States",
          };
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const names = new Map();
    const setName = (k, v) => {
      if (k && typeof k === "string" && k.trim().length >= 3 && !names.has(k)) names.set(k, v);
    };
    soy.areas.forEach((a, i) => {
      setName(a.name, `${L.plant} ${letters[i]}`);
      soy.plants
        .filter((p) => p.area === a.id)
        .forEach((p, j, all) =>
          setName(
            p.name,
            all.length > 1 ? `${L.plant} ${letters[i]}${j + 1}` : `${L.plant} ${letters[i]}`,
          ),
        );
    });
    soy.plants.forEach((p) => {
      setName(p.address, L.address);
      // Street and town fragments, in case an address is shown in pieces.
      for (const part of String(p.address).split(",")) {
        if (!/United States|Estados Unidos/.test(part)) setName(part.trim(), "—");
      }
    });
    const counties = new Set();
    for (const st of [soy.overall, ...soy.areas.map((a) => a.stats)])
      st.topCounties.forEach((c) => counties.add(c.county));
    soy.flagged.forEach((f) => f.county && counties.add(f.county));
    soy.elevators.forEach((e) => e.county && counties.add(e.county));
    [...counties]
      .sort()
      .forEach((c, i) => setName(c, `${L.county} ${String(i + 1).padStart(2, "0")}`));
    soy.elevators.forEach((e, i) => {
      setName(e.name, `${L.elevator} ${String(i + 1).padStart(2, "0")}`);
      setName(e.city, `${L.city} ${i + 1}`);
      setName(e.address, L.address);
    });
    const keys = [...names.keys()].sort((a, b) => b.length - a.length);

    // "ADM" out of every label: "delivered by ADM", "(ADM list)", "daftar ADM", "each ADM crushing plant".
    const dropAdm = (t) =>
      t
        .replace(/\bas delivered by ADM\b/g, "as delivered")
        .replace(/\bsesuai kiriman ADM\b/g, "sesuai kiriman")
        .replace(/\(ADM list\)/g, "(client list)")
        .replace(/\(daftar ADM\)/g, "(daftar klien)")
        .replace(/\bADM list\b/g, "client list")
        .replace(/\bdaftar ADM\b/g, "daftar klien")
        .replace(/\bADM\s+/g, "")
        .replace(/\s+ADM\b/g, "");

    const thou = lang === "id" ? "." : ",";
    const dec = lang === "id" ? "," : ".";
    const F = 0.73;
    const fmt = (n, decimals) =>
      n.toLocaleString(lang === "id" ? "id-ID" : "en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numRe = new RegExp(
      String.raw`\u0001\d+\u0002|\d{7,}|\d{1,3}(?:${esc(thou)}\d{3})+(?:${esc(dec)}\d+)?|\d+(?:${esc(dec)}\d+)?`,
      "g",
    );
    function sanitizeText(text) {
      const reps = [];
      let out = dropAdm(text);
      for (const k of keys) {
        if (out.includes(k)) {
          reps.push(names.get(k));
          out = out.split(k).join(`\u0001${reps.length - 1}\u0002`);
        }
      }
      out = out.replace(numRe, (m, offset, whole) => {
        if (m.startsWith("\u0001")) return m;
        if (/^\d{7,}$/.test(m))
          return m.replace(/\d/g, (d, i) => String((Number(d) * 7 + i * 3 + 5) % 10));
        const after = whole.slice(offset + m.length);
        const before = whole.slice(0, offset);
        if (/^\s?%/.test(after)) return m; // percentages
        if (/^\s?-?(mi\b|mil\b|mile|miles|km\b|m\b)/.test(after)) return m; // distances, scale bar
        if (/^\s?(of|dari)\s+8/.test(after)) return m; // "4 of 8" seasons
        if (/[A-Za-z-]$/.test(before)) return m; // parts of codes
        if (/[–<≥]\s?$/.test(before) || /^\s?–/.test(after)) return m; // class bounds ("5–10", "≥100")
        const plain = Number(m.split(thou).join("").replace(dec, "."));
        const big = /^\s?(million|juta)\b/.test(after);
        if (!Number.isFinite(plain) || (plain < 10 && !big)) return m;
        if (plain >= 1990 && plain <= 2030 && !m.includes(thou) && !m.includes(dec)) return m; // years
        const decimals = m.includes(dec) ? m.split(dec)[1].length : 0;
        return fmt(plain * F, decimals);
      });
      // eslint-disable-next-line no-control-regex -- the U+0001/U+0002 placeholder markers are our own.
      return out.replace(/\u0001(\d+)\u0002/g, (_, i) => reps[Number(i)]);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const done = (window.__sanitized ??= new WeakMap());
    for (const n of nodes) {
      const v = n.nodeValue;
      if (!v || !v.trim() || done.get(n) === v) continue;
      const next = sanitizeText(v);
      if (next !== v) n.nodeValue = next;
      done.set(n, next);
    }
    document.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title"));
    const map = document.querySelector(".soy-map-canvas")?.__map;
    if (map?.getLayer?.("plants-label"))
      map.setLayoutProperty("plants-label", "visibility", "none");
    const text = document.body.innerText;
    const real = [...keys.filter((k) => k.length >= 4 && text.includes(k))];
    if (/\bADM\b/.test(text)) real.push("ADM");
    return real;
  }, lang);
  await page.waitForTimeout(500);
  if (leaks.length) {
    console.error("LEAKS on", page.url(), [...new Set(leaks)].slice(0, 20));
    process.exitCode = 1;
  }
}

const scrollTo = (page, selector, offset = 72) =>
  page.evaluate(
    ([sel, off]) => {
      const main = document.querySelector(".app-main");
      const el = document.querySelector(sel);
      if (main && el) main.scrollTop += el.getBoundingClientRect().top - off;
    },
    [selector, offset],
  );

const { user, pass } = credentials();
const browser = await chromium.launch();
for (const lang of ["en", "id"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    locale: lang === "id" ? "id-ID" : "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?product=soy`, { waitUntil: "networkidle" });
  await page.evaluate((lang) => localStorage.setItem("kanopi.lang", lang), lang);
  await page.reload({ waitUntil: "networkidle" });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".soy-plant-seg", { timeout: 120000 });
  await page.waitForFunction(() => !!document.querySelector(".soy-map-canvas")?.__map, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(2500);

  // 1 — every sourcing area
  await scrollTo(page, ".summary-head", 96);
  await page.waitForTimeout(800);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `areas-${lang}.jpg`), type: "jpeg", quality: 82 });

  // 2 — one area's fields, with a field popup open (tab picked before names change)
  await page.locator(".soy-plant-seg button").nth(2).click();
  await page.waitForFunction(() => !document.querySelector(".soy-map-status"), null, {
    timeout: 180000,
  });
  await scrollTo(page, ".soy-map-card", 64);
  await page.waitForTimeout(3500);
  // Click the middle of a real, reasonably large field a little right of the
  // plant (keeps the popup clear of the Layers and legend cards).
  const box = await page.locator(".soy-map-canvas").boundingBox();
  const targets = await page.evaluate(() => {
    const map = document.querySelector(".soy-map-canvas").__map;
    const c = map.getCanvas();
    const w = c.clientWidth,
      h = c.clientHeight;
    const feats = map.queryRenderedFeatures(
      [
        [w * 0.5, h * 0.25],
        [w * 0.75, h * 0.6],
      ],
      { layers: ["fields-fill"] },
    );
    const pts = [];
    for (const f of feats.filter((x) => x.properties.ha > 20).slice(0, 40)) {
      const ring =
        f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const [lng, lat] = ring.reduce(
        (a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length],
        [0, 0],
      );
      const px = map.project([lng, lat]);
      pts.push([px.x, px.y]);
    }
    return pts;
  });
  for (const [x, y] of targets) {
    await page.mouse.click(box.x + x, box.y + y);
    await page.waitForTimeout(600);
    if (await page.locator(".soy-pop").count()) break;
  }
  if (!(await page.locator(".soy-pop").count())) console.warn("no field popup opened on", lang);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `fields-${lang}.jpg`), type: "jpeg", quality: 82 });

  // 3 — rotation and statistics
  await page.keyboard.press("Escape");
  await scrollTo(page, ".soy-charts", 72);
  await page.waitForTimeout(1200);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `stats-${lang}.jpg`), type: "jpeg", quality: 82 });

  // 4 — in context: rail, rivers and roads on
  await scrollTo(page, ".soy-map-card", 64);
  await page.evaluate(() => document.querySelector(".maplibregl-popup-close-button")?.click());
  for (const input of await page.locator(".soy-layers input").all()) {
    if (!(await input.isChecked())) await input.check();
  }
  await page.waitForFunction(() => !document.querySelector(".soy-layers em"), null, {
    timeout: 120000,
  });
  await page.evaluate(() =>
    document.querySelector(".soy-map-canvas").__map.zoomOut({ duration: 0 }),
  );
  await page.waitForTimeout(4000);
  await sanitize(page, lang);
  await page.screenshot({ path: path.join(OUT, `context-${lang}.jpg`), type: "jpeg", quality: 82 });

  await ctx.close();
  console.log("captured", lang);
}
await browser.close();
