import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Context for the field verification page: the case, its plots and what was already reported. */
export const getFireVerifyContext = createServerFn({ method: "GET" })
  .validator(z.object({ e: z.string(), x: z.string(), s: z.string() }))
  .handler(async ({ data }) => {
    const { findFireIncident, loadFireIncidents, loadVerifications, verifyLink, safeId } = await import("@/lib/fire.server");
    const { millPoint } = await import("@/lib/mill-points");
    const e = safeId(data.e);
    if (!verifyLink(e, data.x, data.s)) return { ok: false as const, reason: "expired" as const };
    const incident = await findFireIncident(e);
    if (!incident) return { ok: false as const, reason: "missing" as const };
    const { plot } = incident;
    const loaded = await loadFireIncidents();
    // The field map draws the case's plots (nearest 20) with their exact geometry.
    const shapes = incident.plots.slice(0, 20).map((cp) => ({ ...loaded.meta[cp.id], g: loaded.data.shapes[cp.id] ?? [] }));
    const mill = millPoint(plot.uml, plot.mill);
    return {
      ok: true as const,
      incident: { ...incident, ev: [] as string[] },
      shapes,
      mill: mill ? { lat: mill[0], lon: mill[1] } : null,
      entries: await loadVerifications(incident.id),
    };
  });
