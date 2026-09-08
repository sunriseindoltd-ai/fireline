import { chromium } from "playwright";

const BASE = "https://kanopi-ochre.vercel.app";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input:not([type])', "earthline");
  await page.fill('input[type="password"]', "r^M3C%KtGM69q!t");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  const mills = await page.evaluate(async () => (await fetch("/data/mills.json")).json());
  const kimMills = mills.filter((m) => m.refinery === "Permata KIM" && m.umlId);
  console.log("Permata KIM mills with umlId:", kimMills.length);
  const sample = kimMills.slice(0, 3).map((m) => m.umlId);
  console.log("sample umlIds:", sample);

  for (const umlId of sample) {
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`/data/plots/${encodeURIComponent(id)}.geojson`);
      const text = await r.text();
      return { status: r.status, len: text.length, sample: text.slice(0, 100) };
    }, umlId);
    console.log(`/data/plots/${umlId}.geojson ->`, JSON.stringify(res));
  }

  const summary = await page.evaluate(async (ids) => {
    const r = await fetch("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ umlIds: ids }),
    });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 500) };
  }, sample);
  console.log("/eudr-summary (3 KIM umlIds) ->", JSON.stringify(summary));

  const summaryAll = await page.evaluate(async (ids) => {
    const r = await fetch("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ umlIds: ids }),
    });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 300) };
  }, kimMills.map((m) => m.umlId));
  console.log("/eudr-summary (all 44 KIM umlIds) ->", JSON.stringify(summaryAll));

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
