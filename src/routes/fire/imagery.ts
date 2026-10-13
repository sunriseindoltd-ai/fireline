import { createFileRoute } from "@tanstack/react-router";

// Sentinel scenes around an event (signed-in users only):
//   ?lat&lon&date            → S2/S1 pass days over the point (with cloud cover)
//   ?lat&lon&kind=s2|s1&day  → tile URL templates for that pass
export const Route = createFileRoute("/fire/imagery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        if (!(await readSession(request))) return new Response("Unauthorized", { status: 401 });
        const q = new URL(request.url).searchParams;
        const lat = Number(q.get("lat")),
          lon = Number(q.get("lon"));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 15 || lon < 90 || lon > 145) {
          return new Response("Bad request", { status: 400 });
        }
        const { fireScenes, fireSceneTiles } = await import("@/lib/fire.server");
        const kind = q.get("kind");
        const date = q.get("date") ?? "";
        const body =
          kind === "s2" || kind === "s1"
            ? await fireSceneTiles(kind, q.get("day") ?? "", lat, lon)
            : /^\d{4}-\d{2}-\d{2}$/.test(date)
              ? await fireScenes(lat, lon, date)
              : null;
        if (!body) return new Response("Not found", { status: 404 });
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "private, max-age=3600" },
        });
      },
    },
  },
});
