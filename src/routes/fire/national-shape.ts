import { createFileRoute } from "@tanstack/react-router";

// Boundaries of one company's estates on the Indonesia map and the 500 m zone around them (?ci=1,2,3 = index.json
// conc, as listed in the national wire's units). Signed-in users, like the rest of FireLine Indonesia.
export const Route = createFileRoute("/fire/national-shape")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        if (!(await readSession(request))) return new Response("Unauthorized", { status: 401 });
        const cis = (new URL(request.url).searchParams.get("ci") ?? "")
          .split(",")
          .map(Number)
          .filter((x) => Number.isInteger(x) && x >= 0);
        if (!cis.length) return new Response("Bad request", { status: 400 });
        const { concShapes } = await import("@/lib/fire-national.server");
        const out = await concShapes(cis);
        if (!out) return new Response("Not found", { status: 404 });
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=3600" } });
      },
    },
  },
});
