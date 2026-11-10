import { createFileRoute } from "@tanstack/react-router";

// The VAPID public key the browser needs to subscribe (signed-in accounts that may get fire notifications).
export const Route = createFileRoute("/fire/push/key")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const { pushConfigured, vapidPublicKey } = await import("@/lib/push.server");
        const on = pushConfigured() && session.role !== "viewer";
        return new Response(JSON.stringify({ key: on ? vapidPublicKey() : null }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
