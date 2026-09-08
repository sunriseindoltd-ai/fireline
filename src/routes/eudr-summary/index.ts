import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/eudr-summary/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readGateSession, refineryScopeForRole } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }
        let umlIds: unknown;
        try {
          ({ umlIds } = await request.json());
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!Array.isArray(umlIds) || !umlIds.every((v) => typeof v === "string")) {
          return new Response("Bad request", { status: 400 });
        }
        // A restricted role (supplier/auditor) could otherwise request an
        // aggregate over any UML ID it can guess, regardless of refinery —
        // mills.json and the plot/area files are already scoped server-side
        // (kanopi-data.server.ts), so this aggregate needs the same check.
        const scope = refineryScopeForRole(session.role);
        let scopedUmlIds = umlIds;
        if (scope) {
          const { loadMills } = await import("@/lib/kanopi-data.server");
          const mills = await loadMills();
          const allowed = new Set(
            mills.filter((m) => m.refinery && scope.includes(m.refinery)).map((m) => m.umlId),
          );
          scopedUmlIds = umlIds.filter((id) => allowed.has(id));
        }
        const { getEudrSummary } = await import("@/lib/eudr-aggregates.server");
        const summary = await getEudrSummary(scopedUmlIds);
        return new Response(JSON.stringify(summary), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
  },
});
