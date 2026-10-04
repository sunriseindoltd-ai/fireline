import { readFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { dataScopeForSession, millInScope, readGateSession, type DataScope } from "@/lib/gate";
import { isSoyTenant, tenantPrefix, type Tenant } from "@/lib/tenants";

// Plot files are excluded here and served from Cloudflare R2 instead (see
// loadPlotRel below) — private-data/plots/ crossed ~1.3GB once DOMAS's plots
// joined Permata KIM's, and bundling that much data into the SSR function
// blew past Vercel's build-container memory (OOM, exit 137). Everything else
// (mills.json, areas/, forest/) is comparatively tiny and stays bundled.
const bundled = import.meta.glob(
  [
    "../../private-data/**/*.{json,geojson}",
    "!../../private-data/plots/**",
    "!../../private-data/tenants/*/plots/**",
    // The soy tenant's field files (~20 MB per area) and context line layers
    // (rail/rivers/roads, up to ~7 MB) live in its own R2 bucket.
    "!../../private-data/tenants/*/fields/**",
    "!../../private-data/tenants/*/layers/**",
  ],
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

type MillLite = { id: string; umlId?: string; group?: string; refinery?: string };

// mills.json is small (hundreds of rows) and only needed here to check a
// restricted role's scope, so it's just re-read+parsed per request rather
// than cached — this route already isn't on any hot path (see the 60s
// cache-control below).
export async function loadMills(tenant: Tenant): Promise<MillLite[]> {
  const text = await loadRel(`${tenantPrefix(tenant)}mills.json`);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** The soy tenant's supply.json (bundled, ~330 kB), parsed once per instance. */
const soySupplyCache = new Map<Tenant, Promise<unknown>>();
export async function loadSoySupply<T = unknown>(tenant: Tenant): Promise<T | null> {
  if (!soySupplyCache.has(tenant)) {
    soySupplyCache.set(
      tenant,
      loadRel(`${tenantPrefix(tenant)}supply.json`).then((text) => (text ? JSON.parse(text) : null)),
    );
  }
  return (await soySupplyCache.get(tenant)!) as T | null;
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
async function isAllowedForScope(rel: string, scope: DataScope, tenant: Tenant): Promise<boolean> {
  if (rel === "mills.json") return true;
  if (rel.startsWith("forest/")) return true; // a base layer, not mill-specific
  if (rel.startsWith("plots/")) {
    // Plot files are keyed by each mill's own `id` (umlId__group__refinery),
    // not the bare UML ID — the same physical mill can supply more than one
    // chain (different group/refinery, often a different traceability level
    // and a genuinely different plot set), so a bare UML ID can no longer
    // resolve to a single refinery to check scope against.
    const millId = rel.slice("plots/".length).replace(/(\.part\d+)?\.geojson$/i, "");
    const mill = (await loadMills(tenant)).find((m) => m.id === millId);
    return !!mill && millInScope(mill, scope);
  }
  if (rel.startsWith("areas/")) {
    // Area files are per refinery/KCP, so a group scope resolves to its
    // refineries through mills.json.
    const slug = rel.slice("areas/".length).replace(/\.geojson$/i, "");
    const mills = await loadMills(tenant);
    return mills.some(
      (m) => !!m.refinery && slugifyRefinery(m.refinery) === slug && millInScope(m, scope),
    );
  }
  return false;
}

type R2Store = { client: AwsClient; endpoint: string; bucket: string };

// Configured once at module load from `<prefix>_ACCOUNT_ID/_ACCESS_KEY_ID/
// _SECRET_ACCESS_KEY/_BUCKET`, set as env vars on the Vercel project
// (production/preview/development); local dev typically has none of them,
// which is what makes loadPlotRel fall back to disk below.
function r2FromEnv(prefix: string): R2Store | null {
  const accountId = process.env[`${prefix}_ACCOUNT_ID`];
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];
  const bucket = process.env[`${prefix}_BUCKET`];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey }),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
  };
}

// Palm tenants' plot files (bucket kanopi-plots).
const r2 = r2FromEnv("R2");
// The soy tenant's field files: a bucket on a separate Cloudflare account, so
// its data never shares storage (or credentials) with the palm clients'.
const r2Soy = r2FromEnv("R2_ADM_SOY");

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
async function loadPlotRel(rel: string, store: R2Store | null = r2, r2Rel: string = rel): Promise<PlotFetchResult> {
  if (!store) {
    const text = await loadRel(rel);
    return text == null ? { ok: false, reason: "not-found" } : { ok: true, text };
  }
  try {
    const key = r2Rel.split("/").map(encodeURIComponent).join("/");
    const res = await store.client.fetch(`${store.endpoint}/${store.bucket}/${key}`);
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
 * Large binary files (the SOP PDFs, ~7.6 MB) are past Vercel's function
 * response limit, so in production the caller — after its own session check —
 * redirects to a short-lived presigned R2 URL instead of proxying the bytes.
 * `null` when R2 isn't configured (local dev): read it off disk with
 * readPrivateFile instead.
 */
export async function presignPrivateGet(
  rel: string,
  opts: { expiresSec: number; contentType: string; disposition: string },
): Promise<string | null> {
  if (!r2) return null;
  const key = rel.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`${r2.endpoint}/${r2.bucket}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(opts.expiresSec));
  url.searchParams.set("response-content-type", opts.contentType);
  url.searchParams.set("response-content-disposition", opts.disposition);
  const signed = await r2.client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

export async function readPrivateFile(rel: string): Promise<Buffer | null> {
  try {
    const root = path.resolve(process.cwd(), "private-data");
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) return null;
    return await readFile(abs);
  } catch {
    return null;
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
async function loadPlotFeatureCollection(
  rel: string,
  store: R2Store | null = r2,
  r2Rel: string = rel,
): Promise<PlotFetchResult> {
  const base = await loadPlotRel(rel, store, r2Rel);
  if (!base.ok) return base;

  const withoutExt = rel.slice(0, -".geojson".length);
  const r2WithoutExt = r2Rel.slice(0, -".geojson".length);
  const parts: unknown[] = [];
  for (let n = 2; ; n++) {
    const part = await loadPlotRel(`${withoutExt}.part${n}.geojson`, store, `${r2WithoutExt}.part${n}.geojson`);
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
  // Callers always ask for tenant-relative paths; a literal `tenants/…` path
  // would read another client's files directly, so it is never served.
  if (!rel || rel.startsWith("tenants/")) return new Response("Not found", { status: 404 });

  const tenant = session.tenant;
  const scope = dataScopeForSession(session);
  if (scope && !(await isAllowedForScope(rel, scope, tenant))) {
    return new Response("Forbidden", { status: 403 });
  }
  // Where this tenant's copy lives. forest/ is one global base layer shared
  // by every tenant; everything else (roster, areas, plots, stats) is per
  // tenant — a tenant without its own copy of a file gets a 404, never ADM's.
  const stored = rel.startsWith("forest/") ? rel : `${tenantPrefix(tenant)}${rel}`;

  // `no-store`, not a short max-age: responses here can now depend on the
  // caller's role (mills.json is filtered per scope), and there's no
  // `Vary: Cookie` to key a cache on that — a max-age would let one role's
  // browser cache serve stale, wrongly-scoped data for up to that long
  // after signing in as a different role in the same browser.
  if (scope && rel === "mills.json") {
    const mills = await loadMills(tenant);
    const filtered = mills.filter((m) => millInScope(m, scope));
    return new Response(JSON.stringify(filtered), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  }

  // A soy sourcing area's fields (`fields/<area>.geojson`, + .partN) and the
  // soy context layers (`layers/<name>.geojson`, plus the density grids in
  // `layers/grid.json`), only for the soy tenant. On
  // disk under the tenant's folder; in R2 at the same relative path inside the
  // soy bucket (a bucket of its own, so no tenant prefix).
  if (rel.startsWith("fields/") || rel.startsWith("layers/")) {
    if (!isSoyTenant(tenant) || !(rel.endsWith(".geojson") || rel === "layers/grid.json") || /\.part\d+\.geojson$/i.test(rel)) {
      return new Response("Not found", { status: 404 });
    }
    // Supply-chain files (fields/units/*, fields/noncomply, layers/*) are
    // single objects; only the per-area field files of the older view come
    // in parts — skip the part probe (an extra R2 request) for the rest.
    const single = rel.startsWith("fields/units/") || rel === "fields/noncomply.geojson" || rel.startsWith("layers/");
    const result = single ? await loadPlotRel(stored, r2Soy, rel) : await loadPlotFeatureCollection(stored, r2Soy, rel);
    if (!result.ok) {
      return new Response("Upstream storage error", { status: result.reason === "not-found" ? 404 : 502 });
    }
    return new Response(result.text, {
      headers: { "content-type": mimeFor(rel), "cache-control": "private, no-store" },
    });
  }

  const isPlotFile =
    rel.startsWith("plots/") && rel.endsWith(".geojson") && !/\.part\d+\.geojson$/i.test(rel);

  if (isPlotFile) {
    const result = await loadPlotFeatureCollection(stored);
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

  const body = await loadRel(stored);
  if (body == null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": mimeFor(rel),
      "cache-control": "private, no-store",
    },
  });
}
