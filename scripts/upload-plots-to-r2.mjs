#!/usr/bin/env node
/**
 * Offline admin step: uploads every prepared plot file in
 * `private-data/plots/` to the private Cloudflare R2 bucket that
 * `src/lib/kanopi-data.server.ts` reads from at runtime.
 *
 * Why plots specifically live in R2 and not the app bundle: this folder
 * crossed ~1.3GB once DOMAS's plots were added alongside Permata KIM's, and
 * bundling that much data into the SSR function via `import.meta.glob` blew
 * past Vercel's build-container memory and killed the build (OOM, exit 137).
 * R2 is fetched lazily per mill at request time instead (previously Vercel
 * Blob, migrated off after that store got suspended for exceeding the
 * Hobby plan's 1GB/month free storage allowance).
 *
 * Idempotent — safe to re-run any time private-data/plots/ changes (a new
 * mill, refreshed data, a re-split file): a PUT to the same key just
 * overwrites the existing object.
 *
 * Requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * in the environment (see .env.local).
 *
 * Usage: node scripts/upload-plots-to-r2.mjs [--tenant <id>] [filter]
 *   `filter` (optional) uploads only files whose name contains it, e.g.
 *   `__SUNRISE__` for one group's fresh ingest instead of the whole ~5GB.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error(
      "[upload-plots-to-r2] R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET must be set — check .env.local.",
    );
    process.exit(1);
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  // `--tenant brc` uploads another client's plots (private-data/tenants/<id>/
  // plots → R2 key tenants/<id>/plots/…); without it, ADM's as before.
  const args = process.argv.slice(2);
  const tIdx = args.indexOf("--tenant");
  const tenant = tIdx >= 0 ? args.splice(tIdx, 2)[1] : "adm";
  const prefix = tenant === "adm" ? "" : `tenants/${tenant}/`;
  const plotsDir = path.join(ROOT, "private-data", ...prefix.split("/").filter(Boolean), "plots");
  const only = args[0];
  const files = (await readdir(plotsDir)).filter(
    (f) => f.toLowerCase().endsWith(".geojson") && (!only || f.includes(only)),
  );
  if (files.length === 0) {
    console.error("[upload-plots-to-r2] no plot files found in", plotsDir);
    process.exit(1);
  }

  let uploaded = 0;
  let totalBytes = 0;
  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const body = await readFile(path.join(plotsDir, file));
    const key = `${prefix}plots/${file}`.split("/").map(encodeURIComponent).join("/");
    const res = await client.fetch(`${endpoint}/${bucket}/${key}`, {
      method: "PUT",
      body,
      headers: { "content-type": "application/geo+json" },
    });
    if (!res.ok) {
      throw new Error(`PUT ${file} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    uploaded += 1;
    totalBytes += body.byteLength;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[upload-plots-to-r2] (${i + 1}/${files.length}) ${file} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB) in ${secs}s`,
    );
  }

  console.log(
    `[upload-plots-to-r2] done — ${uploaded} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`,
  );
}

main().catch((err) => {
  console.error("[upload-plots-to-r2] failed:", err?.message || err);
  process.exit(1);
});
