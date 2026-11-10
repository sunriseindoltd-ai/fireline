import { createFileRoute } from "@tanstack/react-router";

// A test notification to every device of the signed-in user.
export const Route = createFileRoute("/fire/push/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const { sameOrigin } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        const { sendTest } = await import("@/lib/push.server");
        const sent = await sendTest(session);
        return new Response(JSON.stringify({ sent }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
