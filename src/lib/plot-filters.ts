import type { Fc } from "@/lib/ledger";

/**
 * The set of plot attributes that can be filtered — the same categories the
 * map's "color by" legend already groups plots into, plus `location` (only
 * ever set from the plot table's column filter, not a map color mode). One
 * shared model so a filter set from the map legend (chain-map.tsx) and one
 * set from a table column header (workspace.tsx) narrow the same plots.
 */
export type PlotFilterKey = "trace" | "comply" | "risk" | "mitigation" | "type" | "location";

/** `null` = no filter on this dimension (every value passes); a `Set` lists
 * the values that pass, including an empty Set (nothing passes). */
export type PlotFilters = Record<PlotFilterKey, Set<string> | null>;

export const EMPTY_PLOT_FILTERS: PlotFilters = {
  trace: null,
  comply: null,
  risk: null,
  mitigation: null,
  type: null,
  location: null,
};

// The plot-feature property each dimension reads from — the same `_trace`/
// `_comply`/`_risk`/`_mitigation`/`_location` derived properties
// decoratePlots() (ledger-geo.ts) stamps onto every plot, plus the one raw
// source field (`TYPE`) already used as-is by chain-map.tsx's own color
// expression.
const PLOT_FILTER_PROPS: Record<PlotFilterKey, string> = {
  trace: "_trace",
  comply: "_comply",
  risk: "_risk",
  mitigation: "_mitigation",
  type: "TYPE",
  location: "_location",
};

export function plotFilterProperty(key: PlotFilterKey): string {
  return PLOT_FILTER_PROPS[key];
}

export function plotFilterValue(props: Record<string, unknown> | null | undefined, key: PlotFilterKey): string {
  return String(props?.[PLOT_FILTER_PROPS[key]] ?? "");
}

export function plotPassesFilters(
  props: Record<string, unknown> | null | undefined,
  filters: PlotFilters,
): boolean {
  for (const key of Object.keys(filters) as PlotFilterKey[]) {
    const set = filters[key];
    if (!set) continue;
    if (!set.has(plotFilterValue(props, key))) return false;
  }
  return true;
}

export function isPlotFilterActive(filters: PlotFilters): boolean {
  return (Object.values(filters) as (Set<string> | null)[]).some((s) => s !== null);
}

export function activePlotFilterCount(filters: PlotFilters): number {
  return (Object.values(filters) as (Set<string> | null)[]).filter((s) => s !== null).length;
}

/**
 * Toggles one value's inclusion within one filter dimension's Set,
 * materializing `null` ("no filter") into an explicit full Set first if
 * needed. Collapses back to `null` once every value in `universe` ends up
 * included again, so re-enabling everything returns to the exact unfiltered
 * state rather than lingering as an explicit-but-complete Set.
 */
export function toggleSetValue(
  selected: Set<string> | null,
  value: string,
  universe: string[],
): Set<string> | null {
  const current = selected ?? new Set(universe);
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  const isFullUniverse = universe.length > 0 && universe.every((v) => next.has(v));
  return isFullUniverse ? null : next;
}

export function toggleFilterValue(
  filters: PlotFilters,
  key: PlotFilterKey,
  value: string,
  universe: string[],
): PlotFilters {
  return { ...filters, [key]: toggleSetValue(filters[key], value, universe) };
}

/** Distinct values of one dimension actually present across `fc`'s
 * features, with counts — feeds a column filter's checkbox list. */
export function distinctFilterOptions(
  fc: Fc | null,
  key: PlotFilterKey,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of fc?.features ?? []) {
    const v = plotFilterValue(f.properties, key);
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** MapLibre filter expression equivalent to `plotPassesFilters`, so the map
 * layers hide exactly the same plots the table filters out. */
export function plotFilterExpression(filters: PlotFilters): unknown {
  const clauses: unknown[] = ["all"];
  for (const key of Object.keys(filters) as PlotFilterKey[]) {
    const set = filters[key];
    if (!set) continue;
    clauses.push(["in", ["get", PLOT_FILTER_PROPS[key]], ["literal", [...set]]]);
  }
  return clauses;
}
