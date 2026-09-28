import { createFileRoute } from "@tanstack/react-router";

/**
 * Which mills (by `id`) have plot-level analysis — just ids, no figures, so
 * the portfolio can label each group "plots ready / partial / master list
 * only" without computing a full EUDR summary per group. Scoped exactly
 * like /data/mills.json: a supplier/auditor only learns about its own mills.
 */
export const Route = createFileRoute("/coverage/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { dataScopeForSession, millInScope, readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const { loadMills } = await import("@/lib/kanopi-data.server");
        const { millIdsWithStats } = await import("@/lib/eudr-aggregates.server");
        const scope = dataScopeForSession(session);
        const [mills, withStats] = await Promise.all([
          loadMills(session.tenant),
          millIdsWithStats(session.tenant),
        ]);
        const millIds = mills
          .filter((m) => withStats.has(m.id) && (!scope || millInScope(m, scope)))
          .map((m) => m.id);
        return new Response(JSON.stringify({ millIds }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
