#!/usr/bin/env node
/**
 * Uploads the ADM Soy data files to the soy tenant's own R2 bucket (a
 * separate Cloudflare account from the palm clients' `kanopi-plots`), at the
 * same relative paths, where src/lib/kanopi-data.server.ts reads them:
 *
 *   fields/<area>.geojson (+ .partN)   per-area fields of the "Crushing plant
 *                                      areas" view (scripts/prepare-adm-soy.py)
 *   fields/cells/<x>_<y>.geojson        Quincy supply-chain fields by 0.25° cell
 *   fields/noncomply.geojson            non-compliant fields
 *   layers/*.geojson                    rail, rivers, corridors (prepare-adm-soy-supply.py), roads
 *
 * Files whose MD5 matches the object's ETag are skipped. Stale keys under
 * fields/ and layers/ (nothing local with that path) are deleted so nothing
 * leftover can be served.
 *
 * Requires R2_ADM_SOY_ACCOUNT_ID / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _BUCKET.
 *
 * Usage: node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs
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
    else if (ent.name.endsWith(".geojson")) out.push(r);
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
  const files = (await walk(path.join(TENANT_DIR, prefix))).sort();
  if (files.length === 0) throw new Error(`no files in ${prefix}/ — run the prepare scripts first`);
  const remote = await listRemote(prefix);
  const queue = [...files];
  async function worker() {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const key = `${prefix}/${file}`;
      const body = await readFile(path.join(TENANT_DIR, prefix, file));
      const md5 = createHash("md5").update(body).digest("hex");
      if (remote.get(key) === md5) {
        skipped++;
        continue;
      }
      const res = await client.fetch(keyUrl(key), {
        method: "PUT",
        body,
        headers: { "content-type": "application/geo+json" },
      });
      if (!res.ok) throw new Error(`PUT ${key} failed: ${res.status} ${await res.text().catch(() => "")}`);
      uploaded++;
      bytes += body.byteLength;
      if (body.byteLength > 2 * 1048576 || uploaded % 50 === 0)
        console.log(`[upload-soy-fields] ${key} (${(body.byteLength / 1048576).toFixed(1)} MB) — ${uploaded} uploaded`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const local = new Set(files.map((f) => `${prefix}/${f}`));
  for (const key of [...remote.keys()].filter((k) => !local.has(k))) {
    const del = await client.fetch(keyUrl(key), { method: "DELETE" });
    console.log(`[upload-soy-fields] deleted stale ${key} (${del.status})`);
  }
}
console.log(
  `[upload-soy-fields] done — ${uploaded} uploaded (${(bytes / 1048576).toFixed(1)} MB), ${skipped} unchanged`,
);
