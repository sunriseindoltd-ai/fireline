import { inScope, type Session } from "@/lib/auth";
import { findFireIncident } from "@/lib/fire.server";

/** May this session read or act on this case? Staff: any; company accounts: their own company's cases; viewers: none. */
export async function caseAllowed(s: Session, id: string) {
  if (s.role === "admin") return true;
  if (s.role !== "company") return false;
  const c = await findFireIncident(id);
  return !!c && inScope(s, c);
}

/**
 * A company account sees its plots by its own numbers (Plot 01, 02 …, ordered by the PalmTrace id) and no supply-chain
 * group names: PalmTrace plot ids and groups belong to the supply chain, not to the company (user, 2 Nov 2026).
 * Same numbering wherever plots are sent (/fire/, /fire/shapes), and on the home page.
 */
export function plotLabels(cases: { plots: { id: string }[] }[]) {
  const ids = [...new Set(cases.flatMap((c) => c.plots.map((p) => p.id)))].sort();
  const w = Math.max(2, String(ids.length).length);
  return new Map(ids.map((id, i) => [id, `Plot ${String(i + 1).padStart(w, "0")}`]));
}
