import { createFileRoute } from "@tanstack/react-router";
import { gzipSync } from "node:zlib";

// Context layers for the map (RSPO member concessions, Earthline plot coverage grid, KLHK burned
// areas, province outlines), built by scripts/prepare-fire-layers.py into private-data/fire/layers/ (R2 fire/layers/);
// mills-uml = Universal Mill List mills of Indonesia (scripts/prepare-fire-mills.py).
const NAMES = new Set(["rspo", "plots-grid", "burned-2026", "provinces", "mills-uml"]);
/** The plot coverage grid outlines the supply chain: Earthline staff only. */
const STAFF_ONLY = new Set(["plots-grid"]);

export const Route = createFileRoute("/fire/layer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const name = new URL(request.url).searchParams.get("name") ?? "";
        if (!NAMES.has(name)) return new Response("Not found", { status: 404 });
        if (STAFF_ONLY.has(name) && session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const { loadFireLayer } = await import("@/lib/fire.server");
        const body = await loadFireLayer(name);
        if (!body) return new Response("Not found", { status: 404 });
        const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=3600", vary: "accept-encoding" };
        if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
          headers["content-encoding"] = "gzip";
          return new Response(new Uint8Array(gzipSync(body, { level: 6 })), { headers });
        }
        return new Response(new Uint8Array(body), { headers });
      },
    },
  },
});
