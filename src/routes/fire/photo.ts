import { createFileRoute } from "@tanstack/react-router";

// Verification photos (fire/photos/<event>/<ts>.jpg) — signed-in users only.
export const Route = createFileRoute("/fire/photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const name = new URL(request.url).searchParams.get("f") ?? "";
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
