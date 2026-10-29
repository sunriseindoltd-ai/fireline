import type { NationalWire } from "@/lib/fire-national.server";

/** FireLine Indonesia, client side: the /fire/national payload and the period arithmetic on it. */
export type NatData = NationalWire;
export type NatOwner = NationalWire["owners"][number];
/** Period: the last 24 hours (exact, from acquisition times), or the last 7 / 28 WIB days. */
export type Win = "24" | "7" | "28";
/** Values per map point (see NationalWire). */
export const PT = 10;

export function loadNational(body: { refresh?: boolean; pts?: 7 | 28 }): Promise<NatData> {
  return fetch("/fire/national", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    if (r.status === 401) throw new Error("401");
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
}

const sumLast = (d: number[], n: number) => d.slice(-n).reduce((a, b) => a + b, 0);
const sumPrev = (d: number[], n: number) => d.slice(-2 * n, -n).reduce((a, b) => a + b, 0);
export const winDays = (w: Win) => (w === "28" ? 28 : 7);

/** Hotspots of a per-day series (or an exact 24 h figure) in the period, and in the same span before it. */
export function inWin(x: { d: number[]; h24: number; p24: number }, w: Win): { n: number; prev: number | null } {
  if (w === "24") return { n: x.h24, prev: x.p24 };
  const n = winDays(w);
  return { n: sumLast(x.d, n), prev: x.d.length >= 2 * n ? sumPrev(x.d, n) : null };
}
/** Per-day series in the period (empty for 24 h, which has no day breakdown). */
export const daysIn = (d: number[], w: Win) => (w === "24" ? [] : d.slice(-winDays(w)));

export function totalSeries(t: NatData["total"]) {
  return t.l.map((l, i) => l + t.n[i] + t.h[i]);
}

/** Point i (index of its first value) is in the period. */
export function ptIn(p: number[], i: number, w: Win, nDays: number) {
  return w === "24" ? p[i + 8] <= 1440 : p[i + 2] >= nDays - winDays(w);
}
/** 0 = last 24 h, 1 = 2–3 days, 2 = 4–7 days, 3 = older (same classes as the supply-chain map). */
export const ageClass = (min: number) => (min <= 1440 ? 0 : min <= 4320 ? 1 : min <= 10080 ? 2 : 3);

export type Change = { pct: number | null; dir: "up" | "down" | "same" };
export function change(n: number, prev: number | null): Change | null {
  if (prev === null) return null;
  if (prev === 0) return { pct: null, dir: n > 0 ? "up" : "same" };
  const pct = Math.round(((n - prev) / prev) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? "up" : pct < 0 ? "down" : "same" };
}

export const SRC_KEYS = [
  ["el", 1],
  ["rspo", 2],
  ["gfw", 4],
] as const;

/**
 * Attention level of a company, written down so it follows the data (user, 27 Oct 2026: the mockups' "risk level"):
 * high = hotspots in the last 24 hours AND on 3+ of the last 7 days; medium = either one; low = neither.
 */
export type Attention = "high" | "medium" | "low";
export function attentionOf(o: NatOwner): Attention {
  const recent = o.h24 > 0;
  const repeat = o.d.slice(-7).filter((v) => v > 0).length >= 3;
  return recent && repeat ? "high" : recent || repeat ? "medium" : "low";
}

/** Boundaries (estates / concessions) with at least one hotspot in the period, for one owner or all: units and total area. */
export function unitsHit(data: NatData, w: Win, owner: number | null = null): { units: Map<number, number>; ha: number } {
  const p = data.pts;
  const units = new Map<number, number>();
  for (let i = 0; i < p.length; i += PT) {
    const u = p[i + 6];
    if (u < 0 || !ptIn(p, i, w, data.days.length)) continue;
    if (owner !== null && data.units[u].o !== owner) continue;
    units.set(u, (units.get(u) ?? 0) + p[i + 9]);
  }
  let ha = 0;
  for (const u of units.keys()) ha += data.units[u].ha;
  return { units, ha };
}

/** Indices (into pts) of the newest points in the period, newest first. */
export function latestPts(data: NatData, w: Win, n: number, owner: number | null = null): number[] {
  const p = data.pts;
  const out: number[] = [];
  for (let i = 0; i < p.length; i += PT) {
    if (!ptIn(p, i, w, data.days.length)) continue;
    if (owner !== null && (p[i + 6] < 0 || data.units[p[i + 6]].o !== owner)) continue;
    out.push(i);
  }
  return out.sort((a, b) => p[a + 8] - p[b + 8] || p[b + 4] - p[a + 4]).slice(0, n);
}

/** Where to send people for an owner: its newest point, the strongest among equals. */
export function ownerFocus(data: NatData, owner: number): number | null {
  return latestPts(data, "28", 1, owner)[0] ?? latestPts(data, "7", 1, owner)[0] ?? null;
}

/** wa.me link: WhatsApp opens with the message filled in; the sender picks the chat or group (no paid API). */
export const waLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const gmaps = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat.toFixed(5)},${lon.toFixed(5)}`;
