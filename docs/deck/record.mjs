// Records FireLine (local standalone app, 8097) as frame sequences for deck GIFs, with a drawn cursor.
// FIRELINE_PW=… node docs/deck/record.mjs <outDir> [scene,...]   → <outDir>/<scene>/fNNN.png + frames.json
// Never submits a field report.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8097";
const OUT = process.argv[2];
const only = process.argv.slice(3);
const want = (s) => !only.length || only.includes(s);

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div");
    c.id = "__cur";
    c.style.cssText = "position:fixed;left:-50px;top:-50px;width:26px;height:26px;pointer-events:none;z-index:2147483647;transform:translate(-3px,-2px)";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l14 9-6 1.5L16.5 20l-2.5 1-3.5-6.5L6 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "__ring";
    ring.style.cssText = "position:fixed;width:34px;height:34px;border-radius:50%;border:3px solid #e5322d;pointer-events:none;z-index:2147483646;opacity:0;transform:translate(-17px,-17px)";
    document.documentElement.appendChild(c);
    document.documentElement.appendChild(ring);
    window.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; }, true);
    window.addEventListener("mousedown", () => { ring.style.opacity = "1"; setTimeout(() => (ring.style.opacity = "0"), 450); }, true);
  };
  if (document.documentElement) mk(); else document.addEventListener("DOMContentLoaded", mk);
})();`;

class Rec {
  constructor(page, name) {
    this.page = page;
    this.dir = path.join(OUT, name);
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.n = 0;
    const vp = page.viewportSize();
    this.x = vp.width / 2;
    this.y = vp.height / 2;
  }
  async shot(ms) {
    const f = `f${String(this.n++).padStart(3, "0")}.png`;
    await this.page.screenshot({ path: path.join(this.dir, f) });
    this.frames.push([f, ms]);
  }
  async hold(ms) {
    await this.page.waitForTimeout(Math.min(ms, 400));
    await this.shot(ms);
  }
  async move(x, y, steps = 12, ms = 55) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await this.page.mouse.move(this.x + (x - this.x) * e, this.y + (y - this.y) * e);
      if (i % 2 === 0 || i === steps) await this.shot(ms);
    }
    this.x = x;
    this.y = y;
  }
  async click(x, y, after = 900) {
    await this.move(x, y);
    await this.page.mouse.down();
    await this.shot(140);
    await this.page.mouse.up();
    await this.page.waitForTimeout(Math.min(after, 600));
    await this.shot(after);
  }
  async clickEl(loc, after = 900, dx = 0.5, dy = 0.5) {
    await loc.first().scrollIntoViewIfNeeded().catch(() => null);
    const b = await loc.first().boundingBox();
    if (!b) throw new Error("no box for " + loc);
    await this.click(b.x + b.width * dx, b.y + b.height * dy, after);
  }
  async hover(loc, ms = 700) {
    const b = await loc.first().boundingBox();
    await this.move(b.x + b.width / 2, b.y + b.height / 2);
    await this.hold(ms);
  }
  async type(loc, text, perChar = 70) {
    await this.clickEl(loc, 250);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await this.shot(perChar);
    }
  }
  async wheel(dy, n = 1, ms = 350) {
    for (let i = 0; i < n; i++) {
      await this.page.mouse.wheel(0, dy);
      await this.page.waitForTimeout(300);
      await this.shot(ms);
    }
  }
  finish() {
    writeFileSync(path.join(this.dir, "frames.json"), JSON.stringify(this.frames));
    console.log(`${path.basename(this.dir)}: ${this.frames.length} frames`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(CURSOR);
await page.addInitScript(() => {
  localStorage.setItem("fireline.lang", "en");
});
const tab = (label) => page.locator(".app-tabs button", { hasText: new RegExp(`^${label}$`) }).first();

async function signIn(rec) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  if (!rec) {
    await page.fill('input[name="username"]', "earthlineadmin");
    await page.fill('input[name="password"]', process.env.FIRELINE_PW);
    await page.click('button[type="submit"]');
  } else {
    await rec.hold(1500);
    await rec.type(page.locator('input[name="username"]'), "earthlineadmin", 55);
    await rec.type(page.locator('input[name="password"]'), process.env.FIRELINE_PW, 55);
    await rec.clickEl(page.locator('button[type="submit"]'), 600);
  }
  await page.waitForSelector(".fire-kpis", { timeout: 120000 });
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------- 1 sign in → overview
if (want("login")) {
  await page.evaluate(() => localStorage.setItem("fireline.tab", "overview")).catch(() => null);
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.setItem("fireline.tab", "overview"));
  const r = new Rec(page, "login");
  await signIn(r);
  await r.hold(1800);
  await r.hover(page.locator(".fire-kpis .kpi").first(), 1400);
  await r.move(640, 560);
  await r.wheel(420, 1, 1600);
  await r.wheel(520, 1, 1600);
  await r.hover(page.locator(".fire-group-table tbody tr").first(), 1200);
  await r.wheel(-940, 1, 1000);
  r.finish();
} else {
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.setItem("fireline.tab", "overview"));
  await signIn(null);
}

// ---------------------------------------------------------------- 2 drill down: supply chain → events → filter
if (want("events")) {
  await tab("Overview").click();
  await page.waitForSelector(".fire-group-table", { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator(".fire-group-table").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const r = new Rec(page, "events");
  await r.hold(1200);
  await r.clickEl(page.locator(".fire-group-table tbody tr", { hasText: "BNS" }).first(), 1600);
  await r.hold(1400);
  await r.clickEl(page.locator(".fire-tools .seg button", { hasText: "Unverified" }), 1400);
  await r.clickEl(page.locator(".fire-tools .seg button", { hasText: /^All$/ }), 900);
  await r.type(page.locator(".fire-tools input[type=search]"), "Sumber Enim", 70);
  await r.hold(1600);
  await r.hover(page.locator(".fire-table tbody tr").first(), 900);
  await r.hover(page.locator(".fire-table .fire-actions a", { hasText: "WhatsApp" }).first(), 1400);
  r.finish();
}

// ---------------------------------------------------------------- 3 map + Sentinel imagery (QuickFire)
if (want("imagery")) {
  await tab("Events").click();
  await page.waitForSelector(".fire-table", { timeout: 30000 });
  await page.fill(".fire-tools input[type=search]", "Sumber Enim");
  await page.waitForTimeout(800);
  const r = new Rec(page, "imagery");
  await r.hold(900);
  await r.clickEl(page.locator(".fire-table tbody tr").first(), 2600, 0.3, 0.5);
  await page.waitForSelector(".fire-img-seg", { timeout: 60000 });
  await page.waitForTimeout(1500);
  await r.hold(1600);
  await r.clickEl(page.locator(".fire-img-seg").first().locator("button", { hasText: "Sentinel-2" }), 800);
  await page.waitForSelector(".fire-img-day select", { timeout: 30000 });
  await page.waitForTimeout(9000);
  await r.hold(2800);
  await r.clickEl(page.locator(".fire-img-seg").nth(1).locator("button", { hasText: "True colour" }), 800);
  await page.waitForTimeout(8000);
  await r.hold(2200);
  await r.clickEl(page.locator(".fire-img-seg").nth(1).locator("button", { hasText: "QuickFire" }), 800);
  await page.waitForTimeout(3000);
  await r.hold(1200);
  await r.clickEl(page.locator(".fire-img-jumps button", { hasText: "Last before" }), 600);
  await r.clickEl(page.locator('.fire-img-day button[aria-label="Older pass"]'), 600);
  await r.clickEl(page.locator('.fire-img-day button[aria-label="Older pass"]'), 600);
  await page.waitForTimeout(8000);
  await r.hold(2200);
  await r.clickEl(page.locator(".fire-img-seg").first().locator("button", { hasText: "Sentinel-1 radar" }), 800);
  await page.waitForTimeout(9000);
  await r.hold(2400);
  r.finish();
}

// ---------------------------------------------------------------- 4 field verification on a phone (form only, not sent)
if (want("verify")) {
  await tab("Events").click();
  await page.waitForSelector(".fire-table", { timeout: 30000 });
  await page.fill(".fire-tools input[type=search]", "Sumber Enim");
  await page.waitForTimeout(800);
  const href = await page.locator(".fire-table .fire-actions a", { hasText: "WhatsApp" }).first().getAttribute("href");
  const text = decodeURIComponent(href.replace("https://wa.me/?text=", ""));
  const link = text.match(/https?:\/\/\S+\/fire\/verify\?\S+/)[0];
  writeFileSync(path.join(OUT, "wa-text.txt"), text);
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
  const mp = await m.newPage();
  await mp.addInitScript(CURSOR);
  await mp.addInitScript(() => localStorage.setItem("fireline.lang", "en"));
  await mp.goto(link, { waitUntil: "networkidle" });
  await mp.waitForTimeout(1500);
  const r = new Rec(mp, "verify");
  await r.hold(2200);
  await r.wheel(330, 1, 900);
  await r.clickEl(mp.locator(".fv-status label", { hasText: "Active fire" }), 900);
  await r.type(mp.locator('.fv-form input[type="text"]'), "Andi (estate patrol)", 60);
  await r.type(mp.locator(".fv-form textarea"), "Fire on the peat edge, about 2 ha. Crew on site.", 40);
  await r.wheel(320, 1, 900);
  await r.hover(mp.locator(".fv-photo-btn"), 900);
  await r.hover(mp.locator(".fv-form button[type=submit]"), 1600);
  r.finish();
  await m.close();
}

// ---------------------------------------------------------------- 5 refresh + method
if (want("refresh")) {
  await tab("Overview").click();
  await page.waitForSelector(".fire-kpis", { timeout: 30000 });
  await page.evaluate(() => document.querySelector(".app-main")?.scrollTo({ top: 0 }));
  await page.waitForTimeout(1200);
  const r = new Rec(page, "refresh");
  await r.hold(1000);
  await r.hover(page.locator(".fire-asof"), 900);
  await r.clickEl(page.locator(".fire-refresh"), 400);
  for (let i = 0; i < 6; i++) await r.hold(500);
  await page.waitForFunction(() => !document.querySelector(".fire-refresh")?.hasAttribute("disabled"), null, { timeout: 300000 });
  await r.hold(2200);
  await r.clickEl(tab("Method"), 1600);
  await r.move(640, 500);
  await r.wheel(300, 1, 1600);
  r.finish();
}

await browser.close();
