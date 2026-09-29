#!/usr/bin/env node
/**
 * Uploads the ADM Soy field files (private-data/tenants/adm-soy/fields/*.geojson,
 * built by scripts/prepare-adm-soy.py) to the soy tenant's own R2 bucket — on a
 * separate Cloudflare account from the palm clients' `kanopi-plots` — under
 * `fields/`, where src/lib/kanopi-data.server.ts reads them for the soy
 * workspace. Stale keys (a plant file or part that no longer exists locally)
 * are deleted so a shrunk plant can't be served a leftover .partN.
 *
 * Requires R2_ADM_SOY_ACCOUNT_ID / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _BUCKET.
 *
 * Usage: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DIR = path.join(ROOT, "private-data", "tenants", "adm-soy", "fields");

const { R2_ADM_SOY_ACCOUNT_ID: account, R2_ADM_SOY_ACCESS_KEY_ID: keyId, R2_ADM_SOY_SECRET_ACCESS_KEY: secret, R2_ADM_SOY_BUCKET: bucket } =
  process.env;
if (!account || !keyId || !secret || !bucket) {
  console.error("[upload-soy-fields] R2_ADM_SOY_* env vars must be set — check .env.local.");
  process.exit(1);
}
const client = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: "s3", region: "auto" });
const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;

const files = (await readdir(DIR)).filter((f) => f.endsWith(".geojson")).sort();
if (files.length === 0) throw new Error(`no field files in ${DIR} — run scripts/prepare-adm-soy.py first`);
let total = 0;
for (const file of files) {
  const body = await readFile(path.join(DIR, file));
  const t0 = Date.now();
  const res = await client.fetch(`${base}/fields/${encodeURIComponent(file)}`, {
    method: "PUT",
    body,
    headers: { "content-type": "application/geo+json" },
  });
  if (!res.ok) throw new Error(`PUT ${file} failed: ${res.status} ${await res.text().catch(() => "")}`);
  total += body.byteLength;
  console.log(`[upload-soy-fields] fields/${file} (${(body.byteLength / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const list = await client.fetch(`${base}?list-type=2&prefix=fields/&max-keys=1000`);
const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
const local = new Set(files.map((f) => `fields/${f}`));
for (const key of keys.filter((k) => !local.has(k))) {
  const del = await client.fetch(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
  console.log(`[upload-soy-fields] deleted stale ${key} (${del.status})`);
}
console.log(`[upload-soy-fields] done — ${files.length} file(s), ${(total / 1048576).toFixed(1)} MB`);
