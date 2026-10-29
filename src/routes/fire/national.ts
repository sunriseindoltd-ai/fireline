import { createFileRoute } from "@tanstack/react-router";
import { gzipSync } from "node:zlib";

// FireLine Indonesia: every VIIRS hotspot on Indonesian land, by day, province, kabupaten and named boundary
// (Earthline, RSPO, GFW 2014). Any signed-in account. Body: { refresh?: boolean, pts?: 7 | 28 } (map points for
// the last 7 days by default; 28 = the whole span, a few MB).
export const Route = createFileRoute("/fire/national")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        if (!(await readSession(request))) return new Response("Unauthorized", { status: 401 });
        const { sameOrigin } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let body: { refresh?: boolean; pts?: number } = {};
        try {
          body = (await request.json()) ?? {};
        } catch {
          /* empty body */
        }
        try {
          const { loadNationalData, nationalWire } = await import("@/lib/fire-national.server");
          const data = await loadNationalData({ refresh: !!body.refresh });
          const json = JSON.stringify(await nationalWire(data, body.pts === 28 ? 28 : 7));
          const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=60", vary: "accept-encoding" };
          if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
            headers["content-encoding"] = "gzip";
            return new Response(new Uint8Array(gzipSync(json, { level: 6 })), { headers });
          }
          return new Response(json, { headers });
        } catch (e) {
          console.error("[fire-national] load failed", e);
          return new Response("Fire data unavailable", { status: 503 });
        }
      },
    },
  },
});
