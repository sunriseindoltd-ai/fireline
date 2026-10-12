import { createFileRoute } from "@tanstack/react-router";

// FireLine: hotspot events on Company / Scheme Smallholder plots, last 7 days,
// scoped to the session like /eudr-summary. Palm tenants only (the plot index
// is built from ADM's plots; BRC's copy of DOMAS is not indexed yet).
export const Route = createFileRoute("/fire/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { dataScopeForSession, millInScope, readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const { isSoyTenant } = await import("@/lib/tenants");
        if (isSoyTenant(session.tenant)) return new Response("Not found", { status: 404 });
        const { filterFireEvents, loadFireData, loadVerificationIndex, signVerifyLink } = await import("@/lib/fire.server");
        let allowed: { groups?: readonly string[]; umls?: readonly string[] } | null = null;
        const scope = dataScopeForSession(session);
        if (scope) {
          const { loadMills } = await import("@/lib/kanopi-data.server");
          const mills = await loadMills(session.tenant);
          allowed = {
            groups: scope.groups ?? [],
            umls: mills.filter((m) => millInScope(m, scope)).map((m) => m.umlId || m.id),
          };
        }
        if (session.tenant !== "adm") allowed = { groups: [], umls: [] };
        try {
          const [data, verifications] = await Promise.all([loadFireData(), loadVerificationIndex()]);
          const events = filterFireEvents(data.events, allowed);
          const links = Object.fromEntries(events.map((e) => [e.id, signVerifyLink(e.id)]));
          return new Response(
            JSON.stringify({ generated: data.generated, days: data.days, detections: data.detections, events, verifications, links }),
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
