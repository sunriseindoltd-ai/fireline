import { createFileRoute } from "@tanstack/react-router";

// Field reports for one event (signed-in users only).
export const Route = createFileRoute("/fire/reports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Cases and field reports: Earthline staff, and company accounts for their own company (viewers see FireLine Indonesia).
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { loadVerifications, safeId } = await import("@/lib/fire.server");
        const { caseAllowed } = await import("@/lib/fire-access.server");
        if (!(await caseAllowed(session, safeId(e)))) return new Response("Not found", { status: 404 });
        const entries = await loadVerifications(safeId(e));
        return new Response(JSON.stringify(entries), { headers: { "content-type": "application/json; charset=utf-8" } });
      },
    },
  },
});
