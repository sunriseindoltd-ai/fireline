import { createFileRoute } from "@tanstack/react-router";

// Record that the office sent an incident to the field (WhatsApp or copied link).
export const Route = createFileRoute("/fire/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const { addDispatch, safeId, sameOrigin } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let body: { e?: unknown; ids?: unknown; ch?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const ids = (Array.isArray(body.ids) ? body.ids : [body.e]).map((x) => safeId(String(x ?? ""))).filter(Boolean);
        const ch = body.ch === "link" ? "link" : "whatsapp";
        if (!ids.length) return new Response("Bad request", { status: 400 });
        const recs = await addDispatch(ids, session.user, ch);
        return new Response(JSON.stringify(recs), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
