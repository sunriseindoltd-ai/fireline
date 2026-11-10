import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * The scheduler's call (Cloudflare Worker cron, every 30 min; scripts/push-cron-worker.js): refresh the hotspots and
 * notify subscribers of new cases. Not a user route: only `Authorization: Bearer <FIRE_CRON_SECRET>` gets in.
 */
function authorised(request: Request) {
  const secret = process.env.FIRE_CRON_SECRET;
  const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = Buffer.from(got),
    b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/fire/push/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
        const { runPush } = await import("@/lib/push.server");
        try {
          const r = await runPush();
          return new Response(JSON.stringify(r), { status: r.ok ? 200 : 503, headers: { "content-type": "application/json" } });
        } catch (e) {
          console.error("[push] run failed", e);
          return new Response(JSON.stringify({ ok: false, reason: String((e as Error).message ?? e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      },
    },
  },
});
