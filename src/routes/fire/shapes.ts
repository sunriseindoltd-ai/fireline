import { createFileRoute } from "@tanstack/react-router";

// Exact PalmTrace geometry of one case's plots, fetched when the case is opened
// (the list itself carries none, so it stays small).
export const Route = createFileRoute("/fire/shapes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Cases and field reports: Earthline staff, and company accounts for their own company (viewers see FireLine Indonesia).
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { loadFireIncidents } = await import("@/lib/fire.server");
        const { data, incidents, history } = await loadFireIncidents();
        const c = history.find((i) => i.id === e) ?? incidents.find((i) => i.id === e);
        const { inScope } = await import("@/lib/auth");
        if (!c || !inScope(session, c)) return new Response("Not found", { status: 404 });
        let label = (x: string) => x;
        if (session.role === "company") {
          const { plotLabels } = await import("@/lib/fire-access.server");
          const lab = plotLabels([...incidents, ...history].filter((x) => inScope(session, x)));
          label = (x) => lab.get(x) ?? x;
        }
        const out = Object.fromEntries(c.plots.map((cp) => [label(cp.id), data.shapes[cp.id] ?? []]));
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" } });
      },
    },
  },
});
