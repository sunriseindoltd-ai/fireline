import { createFileRoute } from "@tanstack/react-router";

// Verification photos (fire/photos/<event>/<ts>.jpg) — signed-in users only.
export const Route = createFileRoute("/fire/photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Cases and field reports: Earthline staff, and company accounts for their own company (viewers see FireLine Indonesia).
        if (session.role === "viewer") return new Response("Forbidden", { status: 403 });
        const name = new URL(request.url).searchParams.get("f") ?? "";
        const { caseAllowed } = await import("@/lib/fire-access.server");
        if (!(await caseAllowed(session, name.split("/")[0] ?? ""))) return new Response("Not found", { status: 404 });
        const { loadPhoto } = await import("@/lib/fire.server");
        const photo = await loadPhoto(name);
        if (!photo) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(photo.bytes), {
          headers: { "content-type": photo.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
        });
      },
    },
  },
});
