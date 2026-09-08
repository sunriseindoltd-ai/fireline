import { readFile } from "node:fs/promises";
import path from "node:path";
import { readGateSession, refineryScopeForRole } from "@/lib/gate";

const bundled = import.meta.glob("../../private-data/**/*.{json,geojson}", {
  query: "?raw",
  eager: false,
  import: "default",
}) as Record<string, () => Promise<string>>;

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

type MillLite = { umlId?: string; refinery?: string };

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
    const umlId = rel.slice("plots/".length).replace(/\.geojson$/i, "");
    const mills = await loadMills();
    const refinery = mills.find((m) => m.umlId === umlId)?.refinery;
    return !!refinery && scope.includes(refinery);
  }
  if (rel.startsWith("areas/")) {
    const slug = rel.slice("areas/".length).replace(/\.geojson$/i, "");
    return scope.some((refinery) => slugifyRefinery(refinery) === slug);
  }
  return false;
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

  const body = await loadRel(rel);
  if (body == null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": mimeFor(rel),
      "cache-control": "private, no-store",
    },
  });
}
