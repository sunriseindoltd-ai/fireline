import { createFileRoute } from "@tanstack/react-router";
import { PRICE_GROUP } from "@/lib/market";

/**
 * The weekly palm oil price page (scripts/build-sunrise-price.mjs), for
 * sessions that can see the SUNRISE chain: ADM's admins/clients and the
 * `sunrise` supplier login. Never another tenant, never other suppliers or
 * the auditor. Framed by the workspace's Palm Oil Price tab.
 */
export const Route = createFileRoute("/market/sunrise-price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { dataScopeForSession, readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const scope = dataScopeForSession(session);
        const allowed = session.tenant === "adm" && (scope === null || !!scope.groups?.includes(PRICE_GROUP));
        if (!allowed) return new Response("Not found", { status: 404 });
        const { default: html } = await import("@/content/sunrise-price.html?raw");
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
            "x-frame-options": "SAMEORIGIN",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
