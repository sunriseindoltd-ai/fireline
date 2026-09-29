#!/usr/bin/env node
/**
 * Uploads the supporting documents (private-data/docs/*.pdf, listed in
 * src/lib/documents.ts) to R2 under `docs/`, where src/routes/docs/$.ts
 * presigns them for signed-in sessions. Idempotent.
 *
 * Usage: node --env-file=.env.local scripts/upload-docs-to-r2.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const DIR = path.join(ROOT, "private-data", "docs");

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("[upload-docs-to-r2] R2_* env vars must be set — check .env.local.");
  process.exit(1);
}
const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY });
const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const files = (await readdir(DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));
for (const file of files) {
  const body = await readFile(path.join(DIR, file));
  const res = await client.fetch(`${endpoint}/${R2_BUCKET}/docs/${encodeURIComponent(file)}`, {
    method: "PUT",
    body,
    headers: { "content-type": "application/pdf" },
  });
  if (!res.ok) throw new Error(`PUT ${file} failed: ${res.status} ${await res.text().catch(() => "")}`);
  console.log(`[upload-docs-to-r2] docs/${file} (${(body.byteLength / 1048576).toFixed(1)} MB)`);
}
