import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/eudr-summary/")({
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
        // A restricted role (supplier/auditor) could otherwise request an
        // aggregate over any mill id it can guess, regardless of its scope —
        // mills.json and the plot/area files are already scoped server-side
        // (kanopi-data.server.ts), so this aggregate needs the same check.
        const scope = dataScopeForSession(session);
        let scopedMillIds = millIds;
        if (scope) {
          const { loadMills } = await import("@/lib/kanopi-data.server");
          const mills = await loadMills(session.tenant);
          const allowed = new Set(
            mills.filter((m) => millInScope(m, scope)).map((m) => m.id),
          );
          scopedMillIds = millIds.filter((id) => allowed.has(id));
        }
        const { getEudrSummary } = await import("@/lib/eudr-aggregates.server");
        // Stats are per tenant, so an id from another client's roster simply
        // has no entry here and contributes nothing.
        const summary = await getEudrSummary(session.tenant, scopedMillIds);
        return new Response(JSON.stringify(summary), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
  },
});
