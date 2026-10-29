import type { CasePlot, DispatchIndex, FireIncident, PlotMeta, VerificationIndex } from "@/lib/fire.server";
import type { Polygon } from "@/lib/fire-geo";

/** A plot with its exact PalmTrace geometry. */
export type PlotShape = PlotMeta & { g: Polygon[] };
/** A company case as the page uses it: main plot and every affected plot with shapes. */
export type Case = Omit<FireIncident, "plot"> & { plot: PlotShape; aff: (CasePlot & { plot: PlotShape })[]; archived?: boolean };
import type { Lang } from "@/lib/copy";

export type FireResponse = {
  generated: string;
  /** Operational window in days (since 1 Oct, at least 7): inbox, map, summary. */
  days: number;
  /** First day of that window (absent from older servers). */
  from?: string;
  /** Days of data held (28): History and fire events. */
  span: number;
  incidents: Case[];
  /** The same companies over the whole span. */
  history: Case[];
  verifications: VerificationIndex;
  dispatch: DispatchIndex;
  refreshFailed?: boolean;
};
/** What /fire sends: each plot once, incidents point at it. */
type WireCase = Omit<FireIncident, "plot" | "ev"> & { p: string };
type Wire = Omit<FireResponse, "incidents" | "history" | "span"> & { span?: number; incidents: WireCase[]; history?: WireCase[]; plots: Record<string, PlotMeta> };
const NO_SHAPE: Polygon[] = [];
export function fromWire(w: Wire): FireResponse {
  const shape = (id: string): PlotShape => ({ ...w.plots[id], g: NO_SHAPE });
  const conv = (list: WireCase[]): Case[] => list.map(({ p, ...i }) => ({ ...i, ev: [], plot: shape(p), aff: i.plots.map((cp) => ({ ...cp, plot: shape(cp.id) })) }));
  return {
    ...w,
    span: w.span ?? w.days,
    dispatch: w.dispatch ?? {},
    incidents: conv(w.incidents),
    history: conv(w.history ?? w.incidents),
  };
}

/** Exact plot geometry of a case, fetched once when it is opened. */
const shapeCache = new Map<string, Promise<Record<string, Polygon[]>>>();
export function caseShapes(id: string): Promise<Record<string, Polygon[]>> {
  let p = shapeCache.get(id);
  if (!p) {
    p = fetch(`/fire/shapes?e=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    p.catch(() => shapeCache.delete(id));
    shapeCache.set(id, p);
  }
  return p;
}
/** The case with its plots' shapes filled in. */
export function withShapes(c: Case, shapes: Record<string, Polygon[]> | undefined): Case {
  if (!shapes) return c;
  return { ...c, plot: { ...c.plot, g: shapes[c.plot.id] ?? c.plot.g }, aff: c.aff.map((a) => ({ ...a, plot: { ...a.plot, g: shapes[a.id] ?? a.plot.g } })) };
}

/** Signed verification links, fetched once per incident. */
const linkCache = new Map<string, Promise<string>>();
export function verifyLinkFor(id: string): Promise<string> {
  let p = linkCache.get(id);
  if (!p) {
    p = fetch(`/fire/link?e=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((l: { e: string; x: string; s: string }) => `${window.location.origin}/fire/verify?e=${l.e}&x=${l.x}&s=${l.s}`);
    p.catch(() => linkCache.delete(id));
    linkCache.set(id, p);
  }
  return p;
}

/** Same breakpoint as the CSS: narrow screens, and short touch screens (phone in landscape). */
export const PHONE_MQ = "(max-width: 760px), (max-height: 500px) and (pointer: coarse)";

/** "new" = no field report yet; otherwise the latest report's status. */
export type StatusKey = "new" | "active" | "extinguished" | "false_alarm";
/** A report older than the case's last hotspot (by over an hour) no longer settles it: new activity = not checked. */
export const reopened = (v: VerificationIndex[string] | undefined, last?: string) => !!v && !!last && Date.parse(last) > Date.parse(v.at) + 3600000;
export const statusOf = (v: VerificationIndex[string] | undefined, last?: string): StatusKey => (!v || reopened(v, last) ? "new" : v.status);
/** Still needs someone: not checked, or last seen burning. */
export const isOpen = (s: StatusKey) => s === "new" || s === "active";

export const COLOR = {
  new24: "#e5322d",
  /** Not checked, 2–3 days old. */
  new3: "#f97316",
  /** Not checked, 4–7 days old (also the generic "not checked" tone). */
  newOld: "#f5b301",
  /** Not checked, over a week old (4-week views only): violet, so it never reads as "false alarm" grey. */
  newWeek: "#7c5cd6",
  active: "#8f1d1d",
  extinguished: "#2f8f5b",
  false_alarm: "#8a8f98",
} as const;
export const isRecent = (iso: string, now: number) => now - Date.parse(iso) <= 24 * 3600000;
/** Age class of the last hotspot: 0 = ≤24 h, 1 = 2–3 days, 2 = 4–7 days, 3 = older. */
export function ageOf(iso: string, now: number) {
  const h = (now - Date.parse(iso)) / 3600000;
  return h <= 24 ? 0 : h <= 72 ? 1 : h <= 168 ? 2 : 3;
}
const NEW_BY_AGE = [COLOR.new24, COLOR.new3, COLOR.newOld, COLOR.newWeek] as const;
export function colorOf(s: StatusKey, last: string, now: number) {
  return s === "new" ? NEW_BY_AGE[ageOf(last, now)] : COLOR[s];
}

/**
 * Triage score (0–100+): recent, inside the plot, strong, many detections,
 * burning on several days, or reported still active. ≥ 70 high, ≥ 45 medium.
 */
export function priorityOf(i: Pick<FireIncident, "last" | "d" | "frp" | "n" | "days" | "plots">, s: StatusKey, now: number) {
  const otherDays = i.days.length - 1;
  const h = (now - Date.parse(i.last)) / 3600000;
  let p = h <= 6 ? 40 : h <= 24 ? 30 : h <= 48 ? 15 : 0;
  p += i.d === 0 ? 20 : i.d <= 150 ? 10 : 0;
  p += i.frp >= 100 ? 20 : i.frp >= 30 ? 12 : i.frp >= 10 ? 6 : 0;
  p += i.n >= 5 ? 10 : i.n >= 2 ? 5 : 0;
  p += otherDays >= 2 ? 10 : otherDays === 1 ? 5 : 0;
  p += i.plots.length >= 5 ? 5 : 0;
  if (s === "active") p += 30;
  return p;
}
export type Level = "high" | "medium" | "low";
export const levelOf = (p: number): Level => (p >= 70 ? "high" : p >= 45 ? "medium" : "low");

/** Groups whose plots are a 20 km buffer estimate, not a verified supply base. */
export const ESTIMATED_GROUPS = new Set(["SJIM", "AGROJAYA"]);

const loc = (lang: Lang) => (lang === "id" ? "id-ID" : "en-GB");
// Intl formatters are costly to build; one per language and pattern.
const fmts = new Map<string, Intl.DateTimeFormat>();
function dtf(lang: Lang, key: string, opts: Intl.DateTimeFormatOptions) {
  const k = `${lang}|${key}`;
  let f = fmts.get(k);
  if (!f) fmts.set(k, (f = new Intl.DateTimeFormat(loc(lang), opts)));
  return f;
}
export const fmtWhen = (iso: string, lang: Lang) =>
  dtf(lang, "when", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const fmtDate = (iso: string, lang: Lang) => dtf(lang, "date", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
export const fmtTime = (iso: string, lang: Lang) => dtf(lang, "time", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** A WIB calendar day "2026-10-14" → "14 Oct". */
export const fmtDay = (day: string, lang: Lang) => dtf(lang, "day", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
/** First day of the case window, e.g. "1 Oct" (older servers send only `days`). */
export const windowFrom = (d: FireResponse, lang: Lang) =>
  fmtDay(d.from ?? new Date(Date.parse(d.generated) - (d.days - 1) * 86400000).toISOString().slice(0, 10), lang);
export const wibDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);

const rtfs: Partial<Record<Lang, Intl.RelativeTimeFormat>> = {};
/** "3 hours ago" / "3 jam yang lalu", relative to the data time. */
export function ago(iso: string, now: number, lang: Lang) {
  const rtf = (rtfs[lang] ??= new Intl.RelativeTimeFormat(lang === "id" ? "id" : "en", { numeric: "auto" }));
  const min = Math.round((Date.parse(iso) - now) / 60000);
  if (Math.abs(min) < 60) return rtf.format(Math.min(-1, min), "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 48) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}
