import { createFileRoute } from "@tanstack/react-router";

/**
 * Supporting documents (src/lib/documents.ts) for any signed-in session.
 * Only files listed there are served. `?download=1` asks for an attachment —
 * refused for auditors, who may view but not take files away.
 */
export const Route = createFileRoute("/docs/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const { SUPPORT_DOCS } = await import("@/lib/documents");
        const name = decodeURIComponent(url.pathname.replace(/^\/docs\//, ""));
        const doc = SUPPORT_DOCS.find((d) => d.file === name);
        if (!doc) return new Response("Not found", { status: 404 });

        const download = url.searchParams.get("download") === "1";
        if (download && session.role === "auditor") return new Response("Forbidden", { status: 403 });
        const disposition = `${download ? "attachment" : "inline"}; filename="${doc.file}"`;

        const { presignPrivateGet, readPrivateFile } = await import("@/lib/kanopi-data.server");
        const rel = `docs/${doc.file}`;
        const signed = await presignPrivateGet(rel, { expiresSec: 600, contentType: "application/pdf", disposition });
        if (signed) {
          return new Response(null, { status: 302, headers: { location: signed, "cache-control": "private, no-store" } });
        }
        const body = await readPrivateFile(rel);
        if (!body) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(body), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": disposition,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
