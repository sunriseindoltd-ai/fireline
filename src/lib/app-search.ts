/** Search params shared by /app/$group and /app/$group/data. */
export type GroupSearch = { refinery?: string; mill?: string; plots?: "noncomply" };

export function validateGroupSearch(search: Record<string, unknown>): GroupSearch {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    refinery: str(search.refinery),
    mill: str(search.mill),
    // Deep link from the summary's non-compliance list: open this mill's
    // plot table already filtered to non-compliant plots.
    plots: search.plots === "noncomply" ? "noncomply" : undefined,
  };
}
