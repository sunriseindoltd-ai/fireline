import { createFileRoute } from "@tanstack/react-router";

// Per user per day, in memory (per serverless instance — a soft brake on
// the free model quota, not an exact meter).
const DAILY_LIMIT = 80;
const usage = new Map<string, { day: string; n: number }>();

export const Route = createFileRoute("/assistant/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { dataScopeForSession, readGateSession } = await import("@/lib/gate");
        const session = await readGateSession(request);
        if (!session) return new Response("Unauthorized", { status: 401 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!message) return new Response("Bad request", { status: 400 });

        const day = new Date().toISOString().slice(0, 10);
        const key = `${session.tenant}:${session.user}`;
        const u = usage.get(key);
        const n = u && u.day === day ? u.n : 0;
        if (n >= DAILY_LIMIT) return Response.json({ text: "", tables: [], model: null, error: "daily-limit" }, { status: 429 });
        usage.set(key, { day, n: n + 1 });

        const history = Array.isArray(body.history)
          ? (body.history as unknown[])
              .filter((h): h is { role: "user" | "assistant"; text: string } =>
                !!h && typeof h === "object" && ((h as { role?: unknown }).role === "user" || (h as { role?: unknown }).role === "assistant") && typeof (h as { text?: unknown }).text === "string",
              )
              .slice(-8)
          : [];
        const ctx = (body.context ?? {}) as { group?: unknown; millId?: unknown; scope?: unknown };
        const preset =
          body.preset && typeof body.preset === "object" && typeof (body.preset as { tool?: unknown }).tool === "string"
            ? { tool: (body.preset as { tool: string }).tool, args: ((body.preset as { args?: unknown }).args ?? {}) as Record<string, unknown> }
            : null;
        const { askAssistant } = await import("@/lib/assistant.server");
        const reply = await askAssistant({
          tenant: session.tenant,
          scope: dataScopeForSession(session),
          lang: body.lang === "en" ? "en" : "id",
          message,
          history,
          context: { group: typeof ctx.group === "string" ? ctx.group : null, millId: typeof ctx.millId === "string" ? ctx.millId : null, scope: typeof ctx.scope === "string" ? ctx.scope.slice(0, 200) : null },
          preset,
        });
        return Response.json(reply, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
