import { createFileRoute } from "@tanstack/react-router";

// A result recorded by the office (e.g. field staff phoned it in). Same store
// as field reports, marked as from the office.
export const Route = createFileRoute("/fire/office-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const { addVerification, findFireIncident, safeId, sameOrigin, snapshotOf } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let body: { e?: unknown; status?: unknown; note?: unknown; by?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const status = String(body.status ?? "");
        if (!["active", "extinguished", "false_alarm"].includes(status)) return new Response("Bad request", { status: 400 });
        const incident = await findFireIncident(safeId(String(body.e ?? "")));
        if (!incident) return new Response("Incident not found", { status: 404 });
        const who = String(body.by ?? "").trim().slice(0, 60);
        const entry = {
          at: new Date().toISOString(),
          status: status as "active" | "extinguished" | "false_alarm",
          note: String(body.note ?? "").trim().slice(0, 600),
          by: who ? `${who} (${session.user})` : session.user,
          office: true,
        };
        await addVerification(incident.id, entry, snapshotOf(incident));
        return new Response(JSON.stringify({ ok: true, entry }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
