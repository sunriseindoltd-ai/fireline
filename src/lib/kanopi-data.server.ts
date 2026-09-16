import { readFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { readGateSession, refineryScopeForRole } from "@/lib/gate";

// Plot files are excluded here and served from Cloudflare R2 instead (see
// loadPlotRel below) — private-data/plots/ crossed ~1.3GB once DOMAS's plots
// joined Permata KIM's, and bundling that much data into the SSR function
// blew past Vercel's build-container memory (OOM, exit 137). Everything else
// (mills.json, areas/, forest/) is comparatively tiny and stays bundled.
const bundled = import.meta.glob(
  ["../../private-data/**/*.{json,geojson}", "!../../private-data/plots/**"],
  {
    query: "?raw",
    eager: false,
    import: "default",
  },
) as Record<string, () => Promise<string>>;

const bundleByRel = new Map<string, () => Promise<string>>();
for (const [key, loader] of Object.entries(bundled)) {
  const norm = key.replace(/\\/g, "/");
  const marker = "/private-data/";
  const idx = norm.lastIndexOf(marker);
  const rel = idx >= 0 ? norm.slice(idx + marker.length) : norm;
  bundleByRel.set(rel, loader);
}

function mimeFor(file: string) {
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".geojson")) return "application/geo+json; charset=utf-8";
  return "application/octet-stream";
}

function safeRel(pathname: string) {
  const rel = decodeURIComponent(pathname.replace(/^\/data\//, "")).replace(
    /^\/+/,
    "",
  );
  if (!rel || rel.includes("\0")) return null;
  const parts = rel.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return null;
  return rel;
}

async function loadRel(rel: string): Promise<string | null> {
  const loader = bundleByRel.get(rel);
  if (loader) return loader();
  try {
    const root = path.resolve(process.cwd(), "private-data");
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) return null;
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

type MillLite = { id: string; umlId?: string; refinery?: string };

// mills.json is small (hundreds of rows) and only needed here to check a
// restricted role's scope, so it's just re-read+parsed per request rather
// than cached — this route already isn't on any hot path (see the 60s
// cache-control below).
export async function loadMills(): Promise<MillLite[]> {
  const text = await loadRel("mills.json");
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Matches scripts/prepare-areas.mjs's slugify exactly — that script names
// each prepared areas file after its Refinery/KCP this same way.
function slugifyRefinery(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether a restricted role (supplier/auditor) may fetch `rel`. mills.json
 * itself is always "allowed" here — serveKanopiData filters its contents
 * down to the scope instead of blocking it outright. Anything that isn't
 * one of the recognized per-mill/per-refinery/global paths is denied by
 * default rather than served as-is, since a new private-data shape added
 * later shouldn't silently become world-readable to a scoped role.
 */
async function isAllowedForScope(rel: string, scope: readonly string[]): Promise<boolean> {
  if (rel === "mills.json") return true;
  if (rel.startsWith("forest/")) return true; // a base layer, not mill-specific
  if (rel.startsWith("plots/")) {
    // Plot files are keyed by each mill's own `id` (umlId__group__refinery),
    // not the bare UML ID — the same physical mill can supply more than one
    // chain (different group/refinery, often a different traceability level
    // and a genuinely different plot set), so a bare UML ID can no longer
    // resolve to a single refinery to check scope against.
    const millId = rel.slice("plots/".length).replace(/(\.part\d+)?\.geojson$/i, "");
    const mills = await loadMills();
    const refinery = mills.find((m) => m.id === millId)?.refinery;
    return !!refinery && scope.includes(refinery);
  }
  if (rel.startsWith("areas/")) {
    const slug = rel.slice("areas/".length).replace(/\.geojson$/i, "");
    return scope.some((refinery) => slugifyRefinery(refinery) === slug);
  }
  return false;
}

// Configured once at module load — R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/
// R2_SECRET_ACCESS_KEY/R2_BUCKET are set as env vars on the Vercel project
// (production/preview/development); local dev typically has none of them,
// which is what makes loadPlotRel fall back to disk below.
const r2 = (() => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey }),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
  };
})();

// Distinguishes "this mill genuinely has no plot file" (a normal state —
// most mills across most chains have no data uploaded yet) from "the fetch
// itself broke" (R2 unreachable, misconfigured credentials, a suspended
// store, …) — collapsing both into one `null` is exactly how the Vercel
// Blob outage went unnoticed for a while: the map/table just looked empty,
// identical to a mill that had never had data. serveKanopiData below turns
// "error" into a distinct HTTP status so the client (workspace.tsx) can
// show "couldn't load, try again" instead of a plain empty state.
type PlotFetchResult = { ok: true; text: string } | { ok: false; reason: "not-found" | "error" };

/**
 * Reads one plot file (`rel` like "plots/<id>.geojson" or
 * "plots/<id>.part2.geojson") from the private R2 bucket
 * (scripts/upload-plots-to-r2.mjs is what puts it there) when R2 env vars
 * are configured — production always has them once set on the Vercel
 * project. Falls back to loadRel (bundled/local disk) so local dev keeps
 * working straight off private-data/plots/ without ever touching R2 (a
 * missing local file is just treated as "not-found" — there's no separate
 * failure mode to distinguish when reading off disk). R2's S3-compatible
 * API needs a SigV4-signed request (aws4fetch's AwsClient), not a plain
 * fetch — the bucket has no public URL.
 */
async function loadPlotRel(rel: string): Promise<PlotFetchResult> {
  if (!r2) {
    const text = await loadRel(rel);
    return text == null ? { ok: false, reason: "not-found" } : { ok: true, text };
  }
  try {
    const key = rel.split("/").map(encodeURIComponent).join("/");
    const res = await r2.client.fetch(`${r2.endpoint}/${r2.bucket}/${key}`);
    if (res.ok) return { ok: true, text: await res.text() };
    if (res.status === 404) return { ok: false, reason: "not-found" };
    console.error(
      "[kanopi-data] R2 fetch failed for",
      rel,
      res.status,
      await res.text().catch(() => "(no body)"),
    );
    return { ok: false, reason: "error" };
  } catch (err) {
    console.error("[kanopi-data] R2 fetch threw for", rel, err);
    return { ok: false, reason: "error" };
  }
}

/**
 * A mill's plot file can arrive split into `<id>.geojson`, `<id>.part2.geojson`,
 * `<id>.part3.geojson`, … (scripts/prepare-plots.mjs keeps each part under the
 * per-mill upload size limit) — merged back into one FeatureCollection here so
 * every caller still deals with a single response per mill, same as before
 * splitting existed. Only `plots/<id>.geojson` (never `.partN.geojson`
 * directly) reaches this — see the check at its call site. A "not-found" on
 * `.part2` (etc.) just means the split sequence ended, not a failure; a real
 * "error" fetching a part is propagated rather than silently returning a
 * truncated merge.
 */
async function loadPlotFeatureCollection(rel: string): Promise<PlotFetchResult> {
  const base = await loadPlotRel(rel);
  if (!base.ok) return base;

  const withoutExt = rel.slice(0, -".geojson".length);
  const parts: unknown[] = [];
  for (let n = 2; ; n++) {
    const part = await loadPlotRel(`${withoutExt}.part${n}.geojson`);
    if (!part.ok) {
      if (part.reason === "error") return part;
      break;
    }
    const partFc = JSON.parse(part.text) as { features?: unknown[] };
    if (Array.isArray(partFc.features)) parts.push(...partFc.features);
  }
  if (parts.length === 0) return base;

  const merged = JSON.parse(base.text) as { features?: unknown[] };
  merged.features = [...(merged.features ?? []), ...parts];
  return { ok: true, text: JSON.stringify(merged) };
}

export async function serveKanopiData(request: Request): Promise<Response> {
  const session = await readGateSession(request);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rel = safeRel(new URL(request.url).pathname);
  if (!rel) return new Response("Not found", { status: 404 });

  const scope = refineryScopeForRole(session.role);
  if (scope && !(await isAllowedForScope(rel, scope))) {
    return new Response("Forbidden", { status: 403 });
  }

  // `no-store`, not a short max-age: responses here can now depend on the
  // caller's role (mills.json is filtered per scope), and there's no
  // `Vary: Cookie` to key a cache on that — a max-age would let one role's
  // browser cache serve stale, wrongly-scoped data for up to that long
  // after signing in as a different role in the same browser.
  if (scope && rel === "mills.json") {
    const mills = await loadMills();
    const filtered = mills.filter((m) => m.refinery && scope.includes(m.refinery));
    return new Response(JSON.stringify(filtered), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  }

  const isPlotFile =
    rel.startsWith("plots/") && rel.endsWith(".geojson") && !/\.part\d+\.geojson$/i.test(rel);

  if (isPlotFile) {
    const result = await loadPlotFeatureCollection(rel);
    if (!result.ok) {
      // 502: this mill's data exists but couldn't be retrieved right now
      // (vs. a plain 404 for "never uploaded") — see PlotFetchResult above.
      return new Response("Upstream storage error", {
        status: result.reason === "not-found" ? 404 : 502,
      });
    }
    return new Response(result.text, {
      headers: { "content-type": mimeFor(rel), "cache-control": "private, no-store" },
    });
  }

  const body = await loadRel(rel);
  if (body == null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": mimeFor(rel),
      "cache-control": "private, no-store",
    },
  });
}
