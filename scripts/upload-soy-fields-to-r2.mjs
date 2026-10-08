#!/usr/bin/env node
/**
 * Uploads the ADM Soy data files to the soy tenant's own R2 bucket (a
 * separate Cloudflare account from the palm clients' `kanopi-plots`), at the
 * same relative paths, where src/lib/kanopi-data.server.ts reads them:
 *
 *   fields/<area>.geojson (+ .partN)   per-area fields of the "Crushing plant
 *                                      areas" view (scripts/prepare-adm-soy.py)
 *   fields/units/<id>.geojson           Quincy supply-chain fields, one file per catchment
 *   fields/noncomply.geojson            non-compliant fields
 *   layers/*.geojson, layers/grid.json  rail, rivers, corridors, density grids (prepare-adm-soy-supply.py), roads
 *   layers/nlcd/<year>/<z>/<x>/<y>.png  NLCD land-cover tiles (prepare-soy-nlcd.py)
 *   layers/national/soy.pmtiles, layers/national-grid.geojson  all US soybean fields (prepare-soy-national-tiles.py)
 *   layers/states.geojson, layers/counties.geojson  boundaries (prepare-soy-boundaries.py)
 *
 * Files whose MD5 matches the object's ETag are skipped. Stale keys under
 * fields/ and layers/ (nothing local with that path) are deleted so nothing
 * leftover can be served — unless --keep-stale is given (use it while the
 * production build still reads the old paths, then run again without it).
 *
 * --v2: only the files rebuilt from ADM's 7 Oct 2026 data (the SOY_V2 set,
 * as in src/lib/kanopi-data.server.ts), under the v2/ prefix — a production
 * build on the earlier data keeps reading the unprefixed keys. Stale keys are
 * only ever looked for under v2/ then.
 *
 * Requires R2_ADM_SOY_ACCOUNT_ID / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _BUCKET.
 *
 * --only=<prefix>: just the files under that path (e.g. fields/tract/), stale
 * keys left alone — to send files a production build doesn't read yet.
 *
 * Usage: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs [--v2] [--keep-stale] [--only=<prefix>]
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const TENANT_DIR = path.join(ROOT, "private-data", "tenants", "adm-soy");
const PREFIXES = ["fields", "layers"];
const CONCURRENCY = 6;
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
const KEEP_STALE = process.argv.includes("--keep-stale") || !!ONLY;
const V2 = process.argv.includes("--v2");
// Mirrors SOY_V2 in src/lib/kanopi-data.server.ts.
const SOY_V2 = /^(fields\/units\/|fields\/tract\/|fields\/counties\/|fields\/noncomply\.geojson$|layers\/(rail|rivers|corridors|national-grid)\.geojson$|layers\/grid\.json$|layers\/national\/|layers\/nlcd\/)/;

const {
  R2_ADM_SOY_ACCOUNT_ID: account,
  R2_ADM_SOY_ACCESS_KEY_ID: keyId,
  R2_ADM_SOY_SECRET_ACCESS_KEY: secret,
  R2_ADM_SOY_BUCKET: bucket,
} = process.env;
if (!account || !keyId || !secret || !bucket) {
  console.error("[upload-soy-fields] R2_ADM_SOY_* env vars must be set — check .env.local.");
  process.exit(1);
}
const client = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: "s3", region: "auto" });
const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
const keyUrl = (key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function walk(dir, rel = "") {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...(await walk(path.join(dir, ent.name), r)));
    else if (ent.name.endsWith(".geojson") || ent.name === "grid.json" || ent.name.endsWith(".png") || ent.name.endsWith(".pmtiles")) out.push(r);
  }
  return out;
}

async function listRemote(prefix) {
  const out = new Map();
  let token = "";
  for (;;) {
    const q = new URLSearchParams({ "list-type": "2", prefix: `${prefix}/`, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const res = await client.fetch(`${base}?${q}`);
    if (!res.ok) throw new Error(`list ${prefix}/ failed: ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
      const etag = m[1].match(/<ETag>"?([^<"]+)"?<\/ETag>/)?.[1]?.replace(/&quot;/g, "");
      if (key) out.set(key, etag ?? "");
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!next) break;
    token = next[1];
  }
  return out;
}

let uploaded = 0;
let skipped = 0;
let bytes = 0;
for (const prefix of PREFIXES) {
  let files = (await walk(path.join(TENANT_DIR, prefix))).sort();
  if (files.length === 0) throw new Error(`no files in ${prefix}/ — run the prepare scripts first`);
  if (V2) files = files.filter((f) => SOY_V2.test(`${prefix}/${f}`));
  if (ONLY) files = files.filter((f) => `${prefix}/${f}`.startsWith(ONLY));
  if (ONLY && !files.length) continue;
  const kprefix = V2 ? `v2/${prefix}` : prefix;
  const remote = await listRemote(kprefix);
  const queue = [...files];
  async function worker() {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const key = `${kprefix}/${file}`;
      const body = await readFile(path.join(TENANT_DIR, prefix, file));
      const md5 = createHash("md5").update(body).digest("hex");
      if (remote.get(key) === md5) {
        skipped++;
        continue;
      }
      const res = await client.fetch(keyUrl(key), {
        method: "PUT",
        body,
        headers: { "content-type": key.endsWith(".geojson") ? "application/geo+json" : key.endsWith(".png") ? "image/png" : key.endsWith(".pmtiles") ? "application/octet-stream" : "application/json" },
      });
      if (!res.ok) throw new Error(`PUT ${key} failed: ${res.status} ${await res.text().catch(() => "")}`);
      uploaded++;
      bytes += body.byteLength;
      if (body.byteLength > 2 * 1048576 || uploaded % 50 === 0)
        console.log(`[upload-soy-fields] ${key} (${(body.byteLength / 1048576).toFixed(1)} MB) — ${uploaded} uploaded`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const local = new Set(files.map((f) => `${kprefix}/${f}`));
  const stale = [...remote.keys()].filter((k) => !local.has(k));
  if (KEEP_STALE) {
    if (stale.length) console.log(`[upload-soy-fields] kept ${stale.length} stale keys under ${kprefix}/ (--keep-stale)`);
    continue;
  }
  for (const key of stale) {
    const del = await client.fetch(keyUrl(key), { method: "DELETE" });
    console.log(`[upload-soy-fields] deleted stale ${key} (${del.status})`);
  }
}
console.log(
  `[upload-soy-fields] done — ${uploaded} uploaded (${(bytes / 1048576).toFixed(1)} MB), ${skipped} unchanged`,
);
