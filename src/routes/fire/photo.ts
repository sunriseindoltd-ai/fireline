import { createFileRoute } from "@tanstack/react-router";

// Verification photos (fire/photos/<event>/<ts>.jpg) — signed-in users only.
export const Route = createFileRoute("/fire/photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        const name = new URL(request.url).searchParams.get("f") ?? "";
        const { loadPhoto } = await import("@/lib/fire.server");
        const bytes = await loadPhoto(name);
        if (!bytes) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
      },
    },
  },
});
