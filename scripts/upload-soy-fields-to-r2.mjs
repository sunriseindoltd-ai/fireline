#!/usr/bin/env node
/**
 * Uploads the ADM Soy data files built by scripts/prepare-adm-soy.py —
 * private-data/tenants/adm-soy/fields/*.geojson (each sourcing area's fields)
 * and layers/*.geojson (rail, rivers, roads) — to the soy tenant's own R2
 * bucket, on a separate Cloudflare account from the palm clients'
 * `kanopi-plots`, at the same relative paths, where
 * src/lib/kanopi-data.server.ts reads them for the soy workspace. Stale keys
 * under those prefixes (a file or part that no longer exists locally, e.g. the
 * old per-plant Decatur West/East files) are deleted so nothing leftover can
 * be served.
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
const TENANT_DIR = path.join(ROOT, "private-data", "tenants", "adm-soy");
const PREFIXES = ["fields", "layers"];

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
const client = new AwsClient({
  accessKeyId: keyId,
  secretAccessKey: secret,
  service: "s3",
  region: "auto",
});
const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
const keyUrl = (key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

let total = 0;
let count = 0;
for (const prefix of PREFIXES) {
  const dir = path.join(TENANT_DIR, prefix);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".geojson")).sort();
  if (files.length === 0)
    throw new Error(`no files in ${dir} — run scripts/prepare-adm-soy.py first`);
  for (const file of files) {
    const body = await readFile(path.join(dir, file));
    const t0 = Date.now();
    const res = await client.fetch(keyUrl(`${prefix}/${file}`), {
      method: "PUT",
      body,
      headers: { "content-type": "application/geo+json" },
    });
    if (!res.ok)
      throw new Error(
        `PUT ${prefix}/${file} failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    total += body.byteLength;
    count += 1;
    console.log(
      `[upload-soy-fields] ${prefix}/${file} (${(body.byteLength / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
  const list = await client.fetch(`${base}?list-type=2&prefix=${prefix}/&max-keys=1000`);
  const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const local = new Set(files.map((f) => `${prefix}/${f}`));
  for (const key of keys.filter((k) => !local.has(k))) {
    const del = await client.fetch(keyUrl(key), { method: "DELETE" });
    console.log(`[upload-soy-fields] deleted stale ${key} (${del.status})`);
  }
}
console.log(`[upload-soy-fields] done — ${count} file(s), ${(total / 1048576).toFixed(1)} MB`);
