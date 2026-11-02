import { createFileRoute } from "@tanstack/react-router";

// Signed field-verification link for one incident (signed-in users only).
export const Route = createFileRoute("/fire/link")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Cases and field reports: Earthline staff, and company accounts for their own company (viewers see FireLine Indonesia).
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { signVerifyLink, safeId } = await import("@/lib/fire.server");
        if (!safeId(e)) return new Response("Bad request", { status: 400 });
        const { caseAllowed } = await import("@/lib/fire-access.server");
        if (!(await caseAllowed(session, safeId(e)))) return new Response("Not found", { status: 404 });
        return new Response(JSON.stringify(signVerifyLink(e)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
      },
    },
  },
});
