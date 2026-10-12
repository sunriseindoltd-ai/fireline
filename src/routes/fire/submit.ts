import { createFileRoute } from "@tanstack/react-router";

// Field verification submit (multipart). No login: the link carries a signed
// token (e/x/s) valid for 7 days. Photo ≤ 2 MB JPEG (the page downsizes
// before upload).
export const Route = createFileRoute("/fire/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { addVerification, findFireEvent, savePhoto, verifyLink, safeId } = await import("@/lib/fire.server");
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const str = (k: string) => String(form.get(k) ?? "").trim();
        const e = safeId(str("e")), x = str("x"), s = str("s");
        if (!e || !verifyLink(e, x, s)) return new Response("Link expired", { status: 403 });
        const status = str("status");
        if (!["active", "extinguished", "false_alarm"].includes(status)) return new Response("Bad request", { status: 400 });
        const by = str("by").slice(0, 80);
        const note = str("note").slice(0, 600);
        if (!by) return new Response("Name required", { status: 400 });
        if (!(await findFireEvent(e))) return new Response("Event not found", { status: 404 });
        const lat = Number(str("lat")), lon = Number(str("lon"));
        let photo: string | undefined;
        const file = form.get("photo");
        if (file instanceof File && file.size > 0) {
          if (file.size > 2_500_000) return new Response("Photo too large", { status: 413 });
          photo = await savePhoto(e, Buffer.from(await file.arrayBuffer()));
        }
        await addVerification(e, {
          at: new Date().toISOString(),
          status: status as "active" | "extinguished" | "false_alarm",
          note,
          by,
          ...(Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat, lon } : {}),
          ...(photo ? { photo } : {}),
        });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
