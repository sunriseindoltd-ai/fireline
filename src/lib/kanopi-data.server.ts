import { readFile } from "node:fs/promises";
import path from "node:path";
import { get as getBlob } from "@vercel/blob";
import { readGateSession, refineryScopeForRole } from "@/lib/gate";

// Plot files are excluded here and served from Vercel Blob instead (see
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

/**
 * Reads one plot file (`rel` like "plots/<id>.geojson" or
 * "plots/<id>.part2.geojson") from the private Vercel Blob store
 * (scripts/upload-plots-to-blob.mjs is what puts it there) when
 * BLOB_READ_WRITE_TOKEN is configured — production always has it once the
 * store is connected. Falls back to loadRel (bundled/local disk) so local
 * dev keeps working straight off private-data/plots/ without ever touching
 * Blob. A private blob's content must be read through the SDK's `get()` —
 * unlike a public blob, its URL is not a plain fetchable HTTP endpoint.
 */
async function loadPlotRel(rel: string): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return loadRel(rel);
  try {
    const result = await getBlob(rel, { access: "private", token });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return await new Response(result.stream).text();
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
 * directly) reaches this — see the check at its call site.
 */
async function loadPlotFeatureCollection(rel: string): Promise<string | null> {
  const baseText = await loadPlotRel(rel);
  if (baseText == null) return null;

  const withoutExt = rel.slice(0, -".geojson".length);
  const parts: unknown[] = [];
  for (let n = 2; ; n++) {
    const partText = await loadPlotRel(`${withoutExt}.part${n}.geojson`);
    if (partText == null) break;
    const partFc = JSON.parse(partText) as { features?: unknown[] };
    if (Array.isArray(partFc.features)) parts.push(...partFc.features);
  }
  if (parts.length === 0) return baseText;

  const merged = JSON.parse(baseText) as { features?: unknown[] };
  merged.features = [...(merged.features ?? []), ...parts];
  return JSON.stringify(merged);
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
  const body = isPlotFile ? await loadPlotFeatureCollection(rel) : await loadRel(rel);
  if (body == null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": mimeFor(rel),
      "cache-control": "private, no-store",
    },
  });
}
