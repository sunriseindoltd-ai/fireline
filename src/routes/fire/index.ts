import { createFileRoute } from "@tanstack/react-router";
import { gzipSync } from "node:zlib";

// FireLine: hotspot incidents (one per plot per WIB day) on Company / Scheme
// Smallholder plots within 500 m, last 7 days. Signed-in users only.
// Wire format: each plot once (`plots`: description; geometry comes per case from /fire/shapes),
// cases point at their main plot with `p` and list all of theirs in `plots`;
// verification links are fetched per incident from /fire/link.
export const Route = createFileRoute("/fire/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const { loadFireIncidents, loadVerificationIndex, loadDispatchIndex, sameOrigin, caseWindow } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let refresh = false;
        try {
          refresh = !!(await request.json())?.refresh;
        } catch {
          /* empty body */
        }
        try {
          const [{ data, incidents, history, meta }, verifications, dispatch] = await Promise.all([loadFireIncidents({ refresh }), loadVerificationIndex(), loadDispatchIndex()]);
          const plots: Record<string, unknown> = {};
          const wire = (src: typeof incidents) =>
            src.map(({ plot, ev: _ev, ...rest }) => {
              void _ev;
              for (const cp of rest.plots) plots[cp.id] ??= meta[cp.id];
              return { ...rest, p: plot.id };
            });
          const list = wire(incidents);
          // History: the same companies over the whole span (4 weeks), for the History tab and fire events.
          const hist = wire(history);
          const win = caseWindow(data.generated);
          const body = JSON.stringify({ generated: data.generated, days: win.days, from: win.from, span: data.span ?? data.days, incidents: list, history: hist, plots, verifications, dispatch, refreshFailed: !!data.refreshFailed });
          const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=60", vary: "accept-encoding" };
          if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
            headers["content-encoding"] = "gzip";
            return new Response(new Uint8Array(gzipSync(body, { level: 6 })), { headers });
          }
          return new Response(body, { headers });
        } catch (e) {
          console.error("[fire] load failed", e);
          return new Response("Fire data unavailable", { status: 503 });
        }
      },
    },
  },
});
