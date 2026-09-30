import { createFileRoute } from "@tanstack/react-router";

// Village → mill plot area for the group Summary's flow chart (feedback 3,
// A-06). Same session and scope rules as /eudr-summary.
export const Route = createFileRoute("/village-flows/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { dataScopeForSession, millInScope, readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }
        let millIds: unknown;
        try {
          ({ millIds } = await request.json());
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!Array.isArray(millIds) || !millIds.every((v) => typeof v === "string")) {
          return new Response("Bad request", { status: 400 });
        }
        const scope = dataScopeForSession(session);
        let scopedMillIds = millIds;
        if (scope) {
          const { loadMills } = await import("@/lib/kanopi-data.server");
          const mills = await loadMills(session.tenant);
          const allowed = new Set(mills.filter((m) => millInScope(m, scope)).map((m) => m.id));
          scopedMillIds = millIds.filter((id) => allowed.has(id));
        }
        const { getVillageFlows } = await import("@/lib/eudr-aggregates.server");
        const flows = await getVillageFlows(session.tenant, scopedMillIds);
        return new Response(JSON.stringify(flows), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
  },
});
