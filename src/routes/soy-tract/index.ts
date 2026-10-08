import { createFileRoute } from "@tanstack/react-router";

/**
 * TRACT / TRACES-ready GeoJSON of one facility's compliant soybean fields
 * (scripts/prepare-adm-soy-supply.py → fields/tract/<id>.part<n>.geojson):
 * ?f=<facility id>&p=<part>. Soy tenant only; auditors and viewers may look
 * but not take files away.
 */
type TractIndex = { files: Record<string, { label: string; parts: [number, number, number][] }> };

export const Route = createFileRoute("/soy-tract/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const { isSoyTenant } = await import("@/lib/tenants");
        if (!isSoyTenant(session.tenant)) return new Response("Not found", { status: 404 });
        if (session.role === "auditor" || session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const url = new URL(request.url);
        const f = url.searchParams.get("f") ?? "";
        const p = Number(url.searchParams.get("p") ?? "1");
        const { loadSoySupply, soyDownload } = await import("@/lib/kanopi-data.server");
        const supply = await loadSoySupply<{ tract?: TractIndex }>(session.tenant);
        const entry = supply?.tract?.files[f];
        if (!entry || !/^[a-z]+\d+$/.test(f) || !entry.parts.some(([n]) => n === p)) return new Response("Not found", { status: 404 });
        const n = entry.parts.length;
        const name = `${entry.label}${n > 1 ? ` - part ${p} of ${n}` : ""}.geojson`.replace(/[^\w .,()&+-]/g, "_");
        return soyDownload(`fields/tract/${f}.part${p}.geojson`, name);
      },
    },
  },
});
