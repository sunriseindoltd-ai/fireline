// Smoke test for FireLine. Never submits a field report.
// Production: FIRELINE_URL=https://fireline-swart.vercel.app FIRELINE_PW=… node scripts/smoke.mjs
// Local dev:  FIRELINE_URL=http://127.0.0.1:8097 FIRELINE_TOKEN=<dev session token> node scripts/smoke.mjs
//             (the token replaces the password steps; the dev server signs with its fallback secret)
import { chromium } from "playwright";

const BASE = process.env.FIRELINE_URL || "https://fireline-swart.vercel.app";
const PW = process.env.FIRELINE_PW;
const TOKEN = process.env.FIRELINE_TOKEN;
if (!PW && !TOKEN) throw new Error("set FIRELINE_PW (or FIRELINE_TOKEN for a local dev server)");
const host = new URL(BASE).hostname;
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
for (const [method, path] of [["GET", "/fire/link?e=x"], ["POST", "/fire/dispatch"], ["POST", "/fire/office-report"], ["GET", "/fire/reports?e=x"]]) {
  r = method === "GET" ? await page.request.get(`${BASE}${path}`) : await page.request.post(`${BASE}${path}`, { data: { e: "x" } });
  check(`${path.split("?")[0]} refuses without session`, r.status() === 401, String(r.status()));
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const t0 = Date.now();
if (PW) {
  await page.fill('input[name="username"]', "earthlineadmin");
  await page.fill('input[name="password"]', "wrong-password");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => (document.querySelector(".login-err")?.textContent ?? "").trim().length > 0, null, { timeout: 20000 });
  check("wrong password refused", true);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 60000 }), page.click('button[type="submit"]')]);
} else {
  check("login page renders", await page.locator('input[name="password"]').isVisible());
  await ctx.addCookies([{ name: "fireline_session", value: TOKEN, domain: host, path: "/" }]);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
}
await page.waitForSelector(".fl-card, .fl-empty, .eudr-notice", { timeout: 240000 });
const badge = await page.locator(".fl-tabs .fl-badge").textContent().catch(() => "");
check("dashboard loads (inbox)", (await page.locator(".fl-card, .fl-empty").count()) > 0, `${((Date.now() - t0) / 1000).toFixed(1)} s · to act on ${badge}`);
if (PW) {
  const cookie = (await ctx.cookies()).find((c) => c.name === "fireline_session");
  check("session cookie httpOnly + secure", !!cookie?.httpOnly && !!cookie?.secure);
}
for (const [i, sel, name] of [[1, ".fl-mapview canvas", "map"], [2, ".fl-table, .fl-empty", "history"], [3, ".fl-hist .fl-table, .fl-hist .fl-empty", "fire events"], [4, ".fl-kpis .kpi", "summary"]]) {
  await page.locator(".fl-tabs button").nth(i).click();
  check(`${name} view`, !!(await page.waitForSelector(sel, { timeout: 30000 }).catch(() => null)));
  if (name === "map") {
    // Map tools: full screen + ruler, area, coordinates, radius under the zoom buttons; scale bar; the ruler measures.
    await page.waitForSelector(".fl-mtools button", { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1200);
    check("map tools + scale bar", (await page.locator(".fl-mtools button").count()) === 5 && (await page.locator(".maplibregl-ctrl-scale").count()) === 1);
    await page.locator('.fl-mtools button[data-tool="ruler"]').click();
    const cb = await page.locator(".fl-mapview-map canvas").first().boundingBox();
    await page.mouse.click(cb.x + cb.width * 0.4, cb.y + cb.height * 0.5);
    await page.waitForTimeout(250);
    await page.mouse.click(cb.x + cb.width * 0.6, cb.y + cb.height * 0.5);
    await page.waitForTimeout(300);
    const total = (await page.locator(".fl-measure dd").first().textContent().catch(() => "")) ?? "";
    check("ruler measures a distance", /\d.*(km|m)$/.test(total), total);
    check("no incident selected while measuring", (await page.locator(".fl-mapview.has-sel").count()) === 0);
    await page.keyboard.press("Escape");
    await page.locator('.fl-mtools button[data-tool="clear"]').click().catch(() => null);
  }
}

const wire = await (await page.request.post(`${BASE}/fire`, { data: {} })).json();
const data = { ...wire, incidents: wire.incidents.map((i) => ({ ...i, plot: wire.plots[i.p] })) };
const ev = data.incidents.find((e) => e.plot.mill) ?? data.incidents[0];
check("cases within 500 m, with mill names", data.incidents.every((e) => e.plot.mill && e.d <= 500), `${data.incidents.length} cases`);
check("one case per company", new Set(data.incidents.map((e) => e.name.toUpperCase())).size === data.incidents.length);
const sc = await page.request.get(`${BASE}/fire/imagery?lat=${ev.lat}&lon=${ev.lon}&date=${ev.day}`);
const scenes = sc.ok() ? await sc.json() : null;
check("Sentinel passes listed", !!scenes && scenes.s2.length > 0, scenes ? `S2 ${scenes.s2.length} · S1 ${scenes.s1.length}` : String(sc.status()));

const l = await (await page.request.get(`${BASE}/fire/link?e=${encodeURIComponent(ev.id)}`)).json();
const link = `${BASE}/fire/verify?e=${l.e}&x=${l.x}&s=${l.s}`;
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await m.newPage();
await mp.goto(link, { waitUntil: "networkidle" });
const mill = await mp.locator(".fv-card dd b").first().textContent().catch(() => null);
check("verification page opens without login", !!mill, mill ?? "");
check("verification page has route links", /maps\/dir/.test((await mp.locator(".fv-route-btns a").first().getAttribute("href").catch(() => "")) ?? ""));
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
