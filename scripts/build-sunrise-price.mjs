#!/usr/bin/env node
/**
 * Copies the weekly "Sunrise Palm Oil Price" page (built in the Palm Oil
 * Forecast project) into the app, re-skinned to PalmTrace's tokens: Inter,
 * Apple greys, the muted green link colour, no teal/cream. The page's own
 * top bar is hidden — the workspace header and the tab's print button take
 * its place. Served only to SUNRISE-scoped sessions by src/routes/market/.
 *
 * Re-run whenever the source page is refreshed:
 *   node scripts/build-sunrise-price.mjs [path/to/sunrise-poi.html]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DEFAULT_SRC = path.resolve(ROOT, "..", "..", "Palm Oil Forecast", "Grok Assisted", "public", "sunrise-poi.html");
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SRC;
const OUT = path.join(ROOT, "src", "content", "sunrise-price.html");

const ROOT_VARS = `:root{
    --ink:#1d1d1f; --muted:#6e6e73; --faint:#86868b;
    --bg:#f5f5f7; --surface:#ffffff; --line:#d2d2d7; --line-2:#e8e8ed;
    --green:#3e5c4e; --green-deep:#2f4a3e; --green-tint:#eef3f0;
    --up:#2f6b4b; --down:#9e3f35; --amber:#7a5716; --amber-tint:#f7f0e2;
    --f:"Inter","SF Pro Text","Segoe UI",system-ui,sans-serif;
  }`;

const EXTRA_CSS = `
  .topbar{display:none!important}
  body{font-size:14.5px}
  .kpis,.snapg{border-radius:18px}
  .card,.ccard,.hcard{border-radius:18px}
  .cpo .fairc{background:var(--surface)}
  .fbrow .fl{background:linear-gradient(90deg,#d2a95b,#c9695e)}
  .hcard{background:#1d1d1f;color:#f5f5f7}
  footer{background:transparent}
`;

// Script-side colours (map ramps, sparklines, island dots).
const COLOR_MAP = {
  "#0E3B2A": "#3e5c4e",
  "#2E7A93": "#6e7f95",
  "#A07414": "#a8894a",
  "#6B4E9A": "#8a7a9e",
  "#8A3646": "#9e5a52",
  "#E3ECE7": "#eef3f0",
  "#B4D0C3": "#c9d9cf",
  "#79AE97": "#9dbba9",
  "#3A7860": "#6b8f7b",
  "#F3E7CE": "#f7f0e2",
  "#E9C98D": "#e8cfa0",
  "#DDA654": "#d2a95b",
  "#C9772F": "#ce8a66",
  "#A6301F": "#c9695e",
  "#ECEAE3": "#e8e8ed",
  "#9AA09B": "#86868b",
  "#E9E8E3": "#d2d2d7",
  "#C9A227": "#d2a95b",
  "#7BE0A6": "#9fd3b4",
  "#F0A08C": "#f0b3a8",
  "#6FA588": "#9dbba9",
  "#175E43": "#3e5c4e",
};

function replaceOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`source changed shape: ${label} not found`);
  return html.replace(pattern, replacement);
}

let html = await readFile(SRC, "utf8");
html = replaceOnce(html, /:root\{[\s\S]*?\n\s*\}/, ROOT_VARS, ":root block");
html = replaceOnce(
  html,
  /https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto[^"]*/,
  "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..700&display=swap",
  "font link",
);
html = replaceOnce(html, /<\/style>/, `${EXTRA_CSS}</style>`, "</style>");
html = html.replace(/<meta name="theme-color" content="[^"]*">/, '<meta name="theme-color" content="#f5f5f7">');
for (const [from, to] of Object.entries(COLOR_MAP)) {
  html = html.replace(new RegExp(from, "gi"), to);
}
html = html.replace(/<title>[^<]*<\/title>/, "<title>Palm Oil Price · PalmTrace</title>");

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, html);
const left = [...new Set(html.match(/#[0-9A-Fa-f]{6}\b/g) ?? [])].filter(
  (c) => !Object.values(COLOR_MAP).includes(c.toLowerCase()),
);
console.log(`[build-sunrise-price] ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB) from ${SRC}`);
if (left.length) console.log("[build-sunrise-price] colours left as-is:", left.join(" "));
