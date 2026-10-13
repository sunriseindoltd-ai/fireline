import { createFileRoute } from "@tanstack/react-router";

// Field reports for one event (signed-in users only).
export const Route = createFileRoute("/fire/reports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { loadVerifications, safeId } = await import("@/lib/fire.server");
        const entries = await loadVerifications(safeId(e));
        return new Response(JSON.stringify(entries), { headers: { "content-type": "application/json; charset=utf-8" } });
      },
    },
  },
});
