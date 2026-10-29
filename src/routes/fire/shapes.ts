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
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { loadFireIncidents } = await import("@/lib/fire.server");
        const { data, incidents, history } = await loadFireIncidents();
        const c = history.find((i) => i.id === e) ?? incidents.find((i) => i.id === e);
        if (!c) return new Response("Not found", { status: 404 });
        const out = Object.fromEntries(c.plots.map((cp) => [cp.id, data.shapes[cp.id] ?? []]));
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" } });
      },
    },
  },
});
