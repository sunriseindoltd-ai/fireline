/**
 * Uploads private-data/fire/** to the fire bucket (R2_FIRE_* env, see
 * .env.fire.local) under the prefix `fire/`. Skips objects whose ETag (md5)
 * already matches. Usage:
 *   node --env-file=.env.fire.local scripts/upload-fire-to-r2.mjs [--only=cells/]
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "private-data", "fire");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const client = new AwsClient({ accessKeyId: env("R2_FIRE_ACCESS_KEY_ID"), secretAccessKey: env("R2_FIRE_SECRET_ACCESS_KEY") });
const base = `https://${env("R2_FIRE_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_FIRE_BUCKET")}`;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && !e.name.startsWith("_")) yield p;
  }
}
const existing = new Map();
let token = "";
do {
  const res = await client.fetch(`${base}?list-type=2&prefix=fire/&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`);
  const xml = await res.text();
  if (!res.ok) throw new Error(`list ${res.status}: ${xml.slice(0, 200)}`);
  for (const c of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([^<]+)<\/Key>/.exec(c[1])?.[1];
    const etag = /<ETag>(?:&quot;|")?([a-f0-9]+)(?:&quot;|")?<\/ETag>/.exec(c[1])?.[1];
    if (key && etag) existing.set(key, etag);
  }
  token = /<NextContinuationToken>([^<]+)/.exec(xml)?.[1] ?? "";
} while (token);
console.log(`bucket has ${existing.size} fire/ objects`);

const files = [];
for await (const f of walk(SRC)) {
  const rel = path.relative(SRC, f).split(path.sep).join("/");
  if (rel.startsWith(only)) files.push({ f, key: `fire/${rel}` });
}
let done = 0, skipped = 0, bytes = 0, failed = 0;
const t0 = Date.now();
async function put({ f, key }) {
  const body = await readFile(f);
  const md5 = createHash("md5").update(body).digest("hex");
  if (existing.get(key) === md5) { skipped++; return; }
  const ct = key.endsWith(".json") ? "application/json" : "application/octet-stream";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await client.fetch(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body, headers: { "content-type": ct } });
    if (res.ok) { done++; bytes += body.length; return; }
    if (attempt === 4) { failed++; console.error("FAILED", key, res.status); }
    else await new Promise((r) => setTimeout(r, 500 * attempt));
  }
}
const queue = files.slice();
await Promise.all(Array.from({ length: 16 }, async () => { while (queue.length) { await put(queue.shift()); if ((done + skipped) % 500 === 0) console.log(`${done + skipped}/${files.length} (${(bytes / 1e6).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s)`); } }));
console.log(JSON.stringify({ files: files.length, uploaded: done, skipped, failed, MB: +(bytes / 1e6).toFixed(1), seconds: +((Date.now() - t0) / 1000).toFixed(0) }));
