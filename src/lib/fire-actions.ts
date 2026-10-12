import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Context for the field verification page: the event and what was already reported. */
export const getFireVerifyContext = createServerFn({ method: "GET" })
  .validator(z.object({ e: z.string(), x: z.string(), s: z.string() }))
  .handler(async ({ data }) => {
    const { findFireEvent, loadVerifications, verifyLink, safeId } = await import("@/lib/fire.server");
    const e = safeId(data.e);
    if (!verifyLink(e, data.x, data.s)) return { ok: false as const, reason: "expired" as const };
    const event = await findFireEvent(e);
    if (!event) return { ok: false as const, reason: "missing" as const };
    const { g: _g, ...plot } = event.plot;
    void _g;
    return { ok: true as const, event: { ...event, plot }, entries: await loadVerifications(e) };
  });
