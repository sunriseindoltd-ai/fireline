import { createFileRoute } from "@tanstack/react-router";

// Turn fire notifications off for this device.
export const Route = createFileRoute("/fire/push/unsubscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const { sameOrigin } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let body: { endpoint?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (typeof body.endpoint !== "string") return new Response("Bad request", { status: 400 });
        const { removeSubscription } = await import("@/lib/push.server");
        await removeSubscription(session, body.endpoint);
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
