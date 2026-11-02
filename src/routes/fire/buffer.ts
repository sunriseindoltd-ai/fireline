import { createFileRoute } from "@tanstack/react-router";

// The 500 m zone around one case's plots (the distance FireLine keeps hotspots at), as one outline: every plot
// buffered by 500 m and merged, so neighbouring plots share a single dashed line on the map (user, 2 Nov 2026,
// as on the GAPKI flyer). Computed once per case and plot set, kept in memory.
const cache = new Map<string, unknown>();

export const Route = createFileRoute("/fire/buffer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession, inScope } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const e = new URL(request.url).searchParams.get("e") ?? "";
        const { loadFireIncidents } = await import("@/lib/fire.server");
        const { data, incidents, history } = await loadFireIncidents();
        const c = history.find((i) => i.id === e) ?? incidents.find((i) => i.id === e);
        if (!c || !inScope(session, c)) return new Response("Not found", { status: 404 });
        const key = `${c.id}|${c.plots.map((p) => p.id).join(",")}`;
        let out = cache.get(key);
        if (!out) {
          const { buffer } = await import("@turf/buffer");
          const { union } = await import("@turf/union");
          const { featureCollection, multiPolygon } = await import("@turf/helpers");
          const zones = [];
          for (const cp of c.plots) {
            const g = data.shapes[cp.id];
            if (!g?.length) continue;
            const z = buffer(multiPolygon(g as unknown as GeoJSON.Position[][][]), 0.5, { units: "kilometers", steps: 6 });
            if (z) zones.push(z);
          }
          const merged = zones.length > 1 ? union(featureCollection(zones)) : (zones[0] ?? null);
          out = merged ? merged.geometry : null;
          if (cache.size > 500) cache.clear();
          cache.set(key, out);
        }
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=600" } });
      },
    },
  },
});
