import { createFileRoute } from "@tanstack/react-router";

// Public: the contact form posts here (feedback 3, A-15). No session needed;
// a hidden honeypot field, a body size cap and a per-address rate limit keep
// the inbox usable.
const recent = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;

function limited(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > MAX_PER_WINDOW;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export const Route = createFileRoute("/contact-request/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const text = await request.text();
        if (text.length > 16_000) return json({ ok: false, error: "too-large" }, 413);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "bad-request" }, 400);
        }
        // Bots fill every field; people never see this one. Pretend it worked.
        if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });
        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";
        if (limited(ip)) return json({ ok: false, error: "rate-limited" }, 429);
        const { parseAccessRequest, saveAccessRequest } = await import("@/lib/access-requests.server");
        const parsed = parseAccessRequest(body);
        if (!parsed.ok) return json({ ok: false, error: "invalid", field: parsed.field }, 400);
        try {
          await saveAccessRequest(parsed.value);
        } catch (err) {
          console.error("[contact-request] save failed:", err);
          return json({ ok: false, error: "store" }, 502);
        }
        return json({ ok: true });
      },
    },
  },
});
