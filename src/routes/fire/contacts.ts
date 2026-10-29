import { createFileRoute } from "@tanstack/react-router";

// Sales-team attribution per company (group, land rights, estates, contacts), from
// private-data/fire/sales/contacts.json (R2 fire/sales/). Signed-in users only; never cached by proxies.
export const Route = createFileRoute("/fire/contacts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSession } = await import("@/lib/auth");
        const session = await readSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        // Supply-chain cases, field reports and contacts: Earthline staff only (viewers see FireLine Indonesia).
        if (session.role !== "admin") return new Response("Forbidden", { status: 403 });
        const { loadSalesContacts } = await import("@/lib/fire.server");
        const body = await loadSalesContacts();
        return new Response(body ? new Uint8Array(body) : "{}", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
      },
    },
  },
});
