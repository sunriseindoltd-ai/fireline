import { createFileRoute } from "@tanstack/react-router";

// Field verification submit (multipart). No login: the link carries a signed
// token (e/x/s) valid for 7 days. Photo ≤ 2 MB JPEG (the page downsizes
// before upload).
export const Route = createFileRoute("/fire/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { addVerification, findFireIncident, savePhoto, verifyLink, safeId, sameOrigin, photoType, snapshotOf } = await import("@/lib/fire.server");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const str = (k: string) => String(form.get(k) ?? "").trim();
        const e = safeId(str("e")),
          x = str("x"),
          s = str("s");
        if (!e || !verifyLink(e, x, s)) return new Response("Link expired", { status: 403 });
        const status = str("status");
        if (!["active", "extinguished", "false_alarm"].includes(status)) return new Response("Bad request", { status: 400 });
        const by = str("by").slice(0, 80);
        const note = str("note").slice(0, 600);
        if (!by) return new Response("Name required", { status: 400 });
        // Old links name an event: the report is filed on its incident.
        const incident = await findFireIncident(e);
        if (!incident) return new Response("Incident not found", { status: 404 });
        const id = incident.id;
        const lat = Number(str("lat")),
          lon = Number(str("lon"));
        // Up to 3 photos, each ≤ 2.5 MB and a real JPEG/PNG/WebP. Check all before storing any.
        const files = form
          .getAll("photo")
          .filter((x): x is File => x instanceof File && x.size > 0)
          .slice(0, 3);
        if (files.some((x) => x.size > 2_500_000)) return new Response("Photo too large", { status: 413 });
        const bufs = await Promise.all(files.map(async (x) => Buffer.from(await x.arrayBuffer())));
        if (bufs.some((b) => !photoType(b))) return new Response("Photo must be JPEG, PNG or WebP", { status: 415 });
        const photos: string[] = [];
        for (const b of bufs) {
          const name = await savePhoto(id, b);
          if (name) photos.push(name);
        }
        const photo = photos[0];
        await addVerification(
          id,
          {
            at: new Date().toISOString(),
            status: status as "active" | "extinguished" | "false_alarm",
            note,
            by,
            ...(Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat, lon } : {}),
            ...(photo ? { photo, photos } : {}),
          },
          snapshotOf(incident),
        );
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
