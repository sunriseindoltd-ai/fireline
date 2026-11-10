import { createFileRoute } from "@tanstack/react-router";

// Turn fire notifications on (POST) for this device; admins and company accounts only.
export const Route = createFileRoute("/fire/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const { sameOrigin } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        const { addSubscription, parseSubscription, pushConfigured } = await import("@/lib/push.server");
        if (!pushConfigured()) return new Response("Push not configured", { status: 503 });
        let body: { sub?: unknown; lang?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const sub = parseSubscription(body.sub);
        if (!sub) return new Response("Bad subscription", { status: 400 });
        await addSubscription(session, sub, body.lang === "id" ? "id" : "en");
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
