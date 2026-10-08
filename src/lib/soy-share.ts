/**
 * Shares in SoyTrace, in one place for the Summary, Ask the data and the
 * Report (Feedback 5, P0-4 / P1-5). Plain TypeScript without path aliases, so
 * `node --test` can import it directly (scripts/soy-share.test.mjs).
 */

export type ShareLang = "en" | "id";

/**
 * A percentage for display: at most two decimals (the user, 8 Oct 2026) —
 * 0.25%, 0.02%, 99.99%. A share too small for two decimals reads "< 0.01%"
 * and one just under 100% reads "> 99.99%", so neither looks like 0% or 100%.
 */
export function formatShare(p: number, lang: ShareLang): string {
  const loc = lang === "id" ? "id-ID" : "en-US";
  const two = (v: number) => v.toLocaleString(loc, { maximumFractionDigits: 2 });
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p >= 100) return "100%";
  if (p < 0.005) return `< ${two(0.01)}%`;
  if (p > 99.995) return `> ${two(99.99)}%`;
  return `${two(p)}%`;
}

/** part / whole × 100, 0 for an empty whole. */
export function sharePct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Items ranked by a share computed from the raw figures — never from rounded
 * text, which reordered ties and dropped AGP Buchanan, MO (0.14%) from the
 * top 10 — highest first unless `asc`; equal shares by name.
 */
export function rankByShare<T>(items: T[], share: (t: T) => number, name: (t: T) => string, asc = false): T[] {
  return [...items].sort((a, b) => {
    const d = share(b) - share(a);
    return (asc ? -d : d) || name(a).localeCompare(name(b));
  });
}
