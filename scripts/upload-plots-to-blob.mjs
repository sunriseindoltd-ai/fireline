#!/usr/bin/env node
/**
 * Offline admin step: uploads every prepared plot file in
 * `private-data/plots/` to the private Vercel Blob store (`kanopi-plots`)
 * that `src/lib/kanopi-data.server.ts` reads from at runtime.
 *
 * Why plots specifically live in Blob and not the app bundle: this folder
 * crossed ~1.3GB once DOMAS's plots were added alongside Permata KIM's, and
 * bundling that much data into the SSR function via `import.meta.glob` blew
 * past Vercel's build-container memory and killed the build (OOM, exit 137).
 * Blob storage is fetched lazily per mill at request time instead.
 *
 * Idempotent — safe to re-run any time private-data/plots/ changes (a new
 * mill, refreshed data, a re-split file): `allowOverwrite` replaces existing
 * blobs at the same pathname rather than erroring or duplicating.
 *
 * Requires BLOB_READ_WRITE_TOKEN in the environment (set automatically once
 * the store is created and connected via `vercel blob create-store`; pull it
 * locally with `vercel env pull`).
 *
 * Usage: node scripts/upload-plots-to-blob.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      "[upload-plots-to-blob] BLOB_READ_WRITE_TOKEN is not set — run `vercel env pull` first.",
    );
    process.exit(1);
  }

  const plotsDir = path.join(ROOT, "private-data", "plots");
  const files = (await readdir(plotsDir)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  if (files.length === 0) {
    console.error("[upload-plots-to-blob] no plot files found in", plotsDir);
    process.exit(1);
  }

  let uploaded = 0;
  let totalBytes = 0;
  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const body = await readFile(path.join(plotsDir, file));
    await put(`plots/${file}`, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/geo+json",
      token,
    });
    uploaded += 1;
    totalBytes += body.byteLength;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[upload-plots-to-blob] (${i + 1}/${files.length}) ${file} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB) in ${secs}s`,
    );
  }

  console.log(
    `[upload-plots-to-blob] done — ${uploaded} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`,
  );
}

main().catch((err) => {
  console.error("[upload-plots-to-blob] failed:", err?.message || err);
  process.exit(1);
});
