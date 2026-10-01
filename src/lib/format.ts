import type { Lang } from "@/lib/copy";

/**
 * The one place every number on screen is formatted (feedback 2, U-04).
 * Rules locked with Earthline:
 *  - locale follows the language toggle — id-ID uses "." for thousands and
 *    "," for decimals, en-US the other way round;
 *  - never a "k" suffix glued onto an already-localized number ("6.283,1k ha"
 *    read as either 6.3 thousand or 6.3 million depending on the reader);
 *  - below 1,000,000 show the full number; from a million up, a written
 *    "juta"/"million" with two decimals.
 */
function locale(lang: Lang) {
  return lang === "id" ? "id-ID" : "en-US";
}

export function formatCount(n: number, lang: Lang): string {
  return Math.round(n).toLocaleString(locale(lang));
}

/** Full number up to a million, then "1,37 juta" / "1.37 million". */
export function formatLarge(n: number, lang: Lang): string {
  if (Math.abs(n) >= 1_000_000) {
    const v = (n / 1_000_000).toLocaleString(locale(lang), { maximumFractionDigits: 2 });
    return lang === "id" ? `${v} juta` : `${v} million`;
  }
  return formatCount(n, lang);
}

/** Hectares: one decimal below 10 ha (a single plot), whole numbers above. */
export function formatHa(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 10) {
    return `${n.toLocaleString(locale(lang), { maximumFractionDigits: 1 })} ha`;
  }
  return `${formatLarge(n, lang)} ha`;
}

/** Acres (SoyTrace's US data): one decimal below 10, whole numbers above. */
export function formatAcres(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return "—";
  const unit = lang === "id" ? "acre" : "acres";
  if (Math.abs(n) < 10) return `${n.toLocaleString(locale(lang), { maximumFractionDigits: 1 })} ${unit}`;
  return `${formatLarge(n, lang)} ${unit}`;
}

export function formatPct(part: number, whole: number, lang: Lang): string {
  if (whole <= 0) return "—";
  const pct = (part / whole) * 100;
  // One decimal only where rounding would otherwise hide a real difference
  // (99.6% is not 100%).
  const digits = pct > 99 && pct < 100 ? 1 : 0;
  return `${pct.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "{a} of {b}" style templates: replaces every {key} with its value. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
