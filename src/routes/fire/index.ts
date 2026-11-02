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
        // Cases and field reports: Earthline staff, and company accounts for their own company (viewers see FireLine Indonesia).
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const { inScope } = await import("@/lib/auth");
        const { loadFireIncidents, loadVerificationIndex, loadDispatchIndex, sameOrigin, caseWindow } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let refresh = false;
        try {
          refresh = !!(await request.json())?.refresh;
        } catch {
          /* empty body */
        }
        try {
          const [loaded, allVer, allDispatch] = await Promise.all([loadFireIncidents({ refresh }), loadVerificationIndex(), loadDispatchIndex()]);
          const { data, meta } = loaded;
          const mine = (c: { name: string; kind: string }) => inScope(session, c);
          const incidents = loaded.incidents.filter(mine);
          const history = loaded.history.filter(mine);
          const ids = new Set([...incidents, ...history].map((c) => c.id));
          // archived reports (older than the window) keep a snapshot of their case: scoped by its company too
          const verifications = Object.fromEntries(Object.entries(allVer).filter(([id, v]) => ids.has(id) || (v.s ? mine(v.s) : false)));
          const dispatch = Object.fromEntries(Object.entries(allDispatch).filter(([id]) => ids.has(id)));
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
          if (session.role === "company") {
            // plot numbers of the company's own, no supply-chain group names (see plotLabels)
            const { plotLabels } = await import("@/lib/fire-access.server");
            const lab = plotLabels([...incidents, ...history]);
            const id = (x: string) => lab.get(x) ?? x;
            for (const c of [...list, ...hist]) {
              c.p = id(c.p);
              c.plots = c.plots.map((cp) => ({ ...cp, id: id(cp.id) }));
              c.groups = [];
            }
            for (const k of Object.keys(plots)) {
              const m = plots[k] as Record<string, unknown> | undefined;
              delete plots[k];
              if (m) plots[id(k)] = { ...m, id: id(k), group: "" };
            }
            // copies: the index entries are the server's cached objects
            for (const [k, v] of Object.entries(verifications)) if (v.s) verifications[k] = { ...v, s: { ...v.s, groups: [], plot: { ...v.s.plot, id: id(v.s.plot.id), group: "" } } };
          }
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
