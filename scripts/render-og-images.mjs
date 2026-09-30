#!/usr/bin/env node
/**
 * Renders the link-preview images (og:image, 1200×630) for the public pages
 * — WhatsApp/LinkedIn/Slack unfurls (feedback 3, A-08) — from the site's own
 * stills and marks, into public/img/og/:
 *
 *   trace.jpg  Earthline Trace (/, about, contact): both product stills
 *   palm.jpg   PalmTrace (/palm, method): the Sentinel-2 plot still
 *   soy.jpg    SoyTrace (/soy): the soybean harvest photo
 *
 * English only — a preview can't follow the reader's language. Re-run when
 * a still or a mark changes: node scripts/render-og-images.mjs
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PUB = path.join(ROOT, "public");
const OUT = path.join(PUB, "img", "og");

const dataUrl = async (rel, type) =>
  `data:${type};base64,${(await readFile(path.join(PUB, rel))).toString("base64")}`;

const base = `
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .photo{position:absolute;inset:0;background-size:cover;background-position:center}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgb(0 0 0/0) 35%,rgb(0 0 0/.62) 100%)}
  .chip{display:inline-flex;align-items:center;gap:10px;padding:10px 18px 10px 12px;border-radius:999px;background:rgb(255 255 255/.94);font-weight:600;font-size:24px;letter-spacing:-.01em}
  .chip img{width:30px;height:30px}
  .text{position:absolute;left:56px;right:56px;bottom:52px;display:grid;gap:20px;justify-items:start}
  h1{color:#fff;font-size:56px;line-height:1.06;letter-spacing:-.035em;font-weight:700;max-width:18ch}
`;

async function pages() {
  const palmMark = await dataUrl("brand/palmtrace-mark.svg", "image/svg+xml");
  const soyMark = await dataUrl("brand/soytrace-mark.svg", "image/svg+xml");
  const field = await dataUrl("img/field-2020.jpg", "image/jpeg");
  const harvest = await dataUrl("img/soy/harvest-1920.jpg", "image/jpeg");
  const palmShot = await dataUrl("img/hero/palm-en.jpg", "image/jpeg");
  const soyShot = await dataUrl("img/hero/soy-en.jpg", "image/jpeg");
  const product = (bg, pos, mark, name, color, title) => `
    <div class="photo" style="background-image:url(${bg});background-position:${pos}"></div>
    <div class="shade"></div>
    <div class="text">
      <span class="chip" style="color:${color}"><img src="${mark}" alt="">${name}</span>
      <h1>${title}</h1>
    </div>`;
  return {
    palm: product(field, "center", palmMark, "PalmTrace by Earthline", "#237a48", "Every plot behind every mill."),
    soy: product(harvest, "center 70%", soyMark, "SoyTrace by Earthline", "#8a5a12", "Every soybean field around every crushing plant."),
    trace: `
      <div style="position:absolute;inset:0;background:#f5f5f7"></div>
      <div style="position:absolute;left:56px;top:54px;display:grid;gap:14px;justify-items:start">
        <span class="chip" style="color:#237a48;background:#fff;box-shadow:0 1px 3px rgb(0 0 0/.08)"><img src="${palmMark}" alt="">Earthline Trace</span>
        <h1 style="color:#1d1d1f;font-size:50px;max-width:22ch">Know the land behind every commodity.</h1>
      </div>
      <div style="position:absolute;left:56px;right:56px;bottom:0;height:300px;display:grid;grid-template-columns:1fr 1fr;gap:24px">
        ${[
          [palmShot, palmMark, "PalmTrace", "#237a48"],
          [soyShot, soyMark, "SoyTrace", "#8a5a12"],
        ]
          .map(
            ([shot, mark, name, color]) => `
          <div style="position:relative;border-radius:22px 22px 0 0;overflow:hidden;box-shadow:0 8px 30px rgb(0 0 0/.14);background:url(${shot}) top center/cover">
            <span class="chip" style="position:absolute;left:16px;bottom:18px;font-size:20px;color:${color}"><img src="${mark}" alt="" style="width:24px;height:24px">${name}</span>
          </div>`,
          )
          .join("")}
      </div>`,
  };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [name, body] of Object.entries(await pages())) {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">
       <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap" rel="stylesheet">
       <style>${base}</style></head><body>${body}</body></html>`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 84 });
    console.log(`[render-og-images] ${path.relative(ROOT, file)}`);
  }
} finally {
  await browser.close();
}
