import { createFileRoute } from "@tanstack/react-router";

// FireLine: hotspot events on Company / Scheme Smallholder plots, last 7 days.
// Signed-in users only; the single admin account sees every supply chain.
export const Route = createFileRoute("/fire/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        if (!(await readSession(request))) return new Response("Unauthorized", { status: 401 });
        const { loadFireData, loadVerificationIndex, signVerifyLink } = await import("@/lib/fire.server");
        let refresh = false;
        try {
          refresh = !!(await request.json())?.refresh;
        } catch {
          /* empty body */
        }
        try {
          const [data, verifications] = await Promise.all([loadFireData({ refresh }), loadVerificationIndex()]);
          const links = Object.fromEntries(data.events.map((e) => [e.id, signVerifyLink(e.id)]));
          return new Response(
            JSON.stringify({ generated: data.generated, days: data.days, detections: data.detections, events: data.events, verifications, links, refreshFailed: !!data.refreshFailed }),
            { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=60" } },
          );
        } catch (e) {
          console.error("[fire] load failed", e);
          return new Response("Fire data unavailable", { status: 503 });
        }
      },
    },
  },
});
