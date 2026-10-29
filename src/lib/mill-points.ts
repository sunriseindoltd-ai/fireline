import points from "@/data/mill-points.json";

/** Mill coordinates (PalmTrace mills.json, see scripts/prepare-mill-points.mjs). */
const P = points as unknown as Record<string, [number, number]>;
const byUml = new Map<string, [number, number][]>();
const byName = new Map<string, [number, number][]>();
for (const [k, v] of Object.entries(P)) {
  const [uml, name] = k.split("|");
  byUml.set(uml, [...(byUml.get(uml) ?? []), v]);
  byName.set(name, [...(byName.get(name) ?? []), v]);
}

/** [lat, lon] of a plot's mill: exact UML + name, else a UML or name that is unique. */
export function millPoint(uml: string, mill: string): [number, number] | null {
  const name = (mill ?? "").trim().toUpperCase();
  const exact = P[`${(uml ?? "").trim()}|${name}`];
  if (exact) return exact;
  const u = byUml.get((uml ?? "").trim());
  if (u?.length === 1) return u[0];
  const n = byName.get(name);
  return n?.length === 1 ? n[0] : null;
}
