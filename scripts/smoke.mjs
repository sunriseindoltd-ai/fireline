// Production smoke test for FireLine. Never submits a field report.
// FIRELINE_URL=https://fireline-swart.vercel.app FIRELINE_PW=… node scripts/smoke.mjs
import { chromium } from "playwright";

const BASE = process.env.FIRELINE_URL || "https://fireline-swart.vercel.app";
const PW = process.env.FIRELINE_PW;
if (!PW) throw new Error("set FIRELINE_PW");
const results = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  · " + info : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let r = await page.request.get(`${BASE}/`, { maxRedirects: 0 });
check("signed out / redirects to /login", [302, 307].includes(r.status()) && /\/login/.test(r.headers().location ?? ""), String(r.status()));
r = await page.request.post(`${BASE}/fire`, { data: {} });
check("API refuses without session", r.status() === 401, String(r.status()));
r = await page.request.get(`${BASE}/fire/imagery?lat=-3.1&lon=104.4&date=2026-10-12`);
check("imagery refuses without session", r.status() === 401, String(r.status()));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.fill('input[name="username"]', "earthlineadmin");
await page.fill('input[name="password"]', "wrong-password");
await page.click('button[type="submit"]');
await page.waitForFunction(() => (document.querySelector(".login-err")?.textContent ?? "").trim().length > 0, null, { timeout: 20000 });
check("wrong password refused", true);
await page.fill('input[name="password"]', PW);
const t0 = Date.now();
await Promise.all([page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 60000 }), page.click('button[type="submit"]')]);
await page.waitForSelector(".fire-kpis, .eudr-notice", { timeout: 180000 });
const kpis = await page.$$eval(".fire-kpis .kpi b", (b) => b.map((x) => x.textContent));
check("dashboard loads", kpis.length === 5, `${((Date.now() - t0) / 1000).toFixed(1)} s · KPIs ${kpis.join(" / ")}`);
const cookie = (await ctx.cookies()).find((c) => c.name === "fireline_session");
check("session cookie httpOnly + secure", !!cookie?.httpOnly && !!cookie?.secure);

const data = await (await page.request.post(`${BASE}/fire`, { data: {} })).json();
const ev = data.events.find((e) => e.plot.mill) ?? data.events[0];
check("events have mill names", data.events.every((e) => e.plot.mill), `${data.events.length} events`);
const sc = await page.request.get(`${BASE}/fire/imagery?lat=${ev.lat}&lon=${ev.lon}&date=${ev.date}`);
const scenes = sc.ok() ? await sc.json() : null;
check("Sentinel passes listed", !!scenes && scenes.s2.length > 0, scenes ? `S2 ${scenes.s2.length} · S1 ${scenes.s1.length}` : String(sc.status()));

const l = data.links[ev.id];
const link = `${BASE}/fire/verify?e=${l.e}&x=${l.x}&s=${l.s}`;
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await m.newPage();
await mp.goto(link, { waitUntil: "networkidle" });
const mill = await mp.locator(".fv-card dd b").first().textContent().catch(() => null);
check("verification page opens without login", !!mill, mill ?? "");
check("verification page fits a phone", !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
await mp.goto(link.replace(/&s=[a-f0-9]+/, "&s=deadbeef"), { waitUntil: "networkidle" });
check("tampered link refused", /expired|kedaluwarsa/i.test((await mp.locator(".fv-card p").first().textContent()) ?? ""));

await page.locator(".app-actions button.btn-text").last().click();
await page.waitForURL((u) => new URL(u).pathname === "/login", { timeout: 20000 });
check("sign out returns to /login", true);
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
