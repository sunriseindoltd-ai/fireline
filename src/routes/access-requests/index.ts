import { createFileRoute } from "@tanstack/react-router";

// Admin only: the contact-form inbox (feedback 3, A-15). GET lists requests,
// POST { id, status } marks one contacted/closed.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });

async function admin(request: Request) {
  const { readGateSession } = await import("@/lib/gate");
  const session = await readGateSession(request);
  return session?.role === "admin" ? session : null;
}

export const Route = createFileRoute("/access-requests/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await admin(request))) return json({ error: "forbidden" }, 403);
        const { listAccessRequests } = await import("@/lib/access-requests.server");
        try {
          return json({ requests: await listAccessRequests() });
        } catch (err) {
          console.error("[access-requests] list failed:", err);
          return json({ error: "store" }, 502);
        }
      },
      POST: async ({ request }) => {
        if (!(await admin(request))) return json({ error: "forbidden" }, 403);
        const { STATUSES, setAccessRequestStatus } = await import("@/lib/access-requests.server");
        let body: { id?: unknown; status?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "bad-request" }, 400);
        }
        if (typeof body.id !== "string" || !(STATUSES as readonly unknown[]).includes(body.status)) {
          return json({ error: "bad-request" }, 400);
        }
        try {
          await setAccessRequestStatus(body.id, body.status as (typeof STATUSES)[number]);
        } catch (err) {
          console.error("[access-requests] update failed:", err);
          return json({ error: "store" }, 502);
        }
        return json({ ok: true });
      },
    },
  },
});
