import { BrandMark } from "@/components/brand-mark";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { GroupSearch, PlotComplyFilter } from "@/lib/app-search";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { fill, formatCount, formatHa } from "@/lib/format";
import { gateLogout, gateSwitchTenant } from "@/lib/gate-actions";
import { TENANTS, type Tenant } from "@/lib/tenants";
import type { GateRole } from "@/lib/gate";
import { useI18n } from "@/lib/i18n";
import {
  downloadGeojson,
  downloadMillsCsv,
  groupChains,
  groupLabel,
  groupSlug,
  traceLabel,
  type Chain,
  type Fc,
  type MillRecord,
} from "@/lib/ledger";
import {
  decorateAreas,
  decoratePlots,
  filterAreas,
  hasCoords,
  locationText,
  millHaystack,
  millPointsFromMaster,
  mitigationText,
  type TraceFilter,
} from "@/lib/ledger-geo";
import {
  activePlotFilterCount,
  distinctFilterOptions,
  EMPTY_PLOT_FILTERS,
  plotPassesFilters,
  type PlotFilters,
} from "@/lib/plot-filters";
import { useLedger } from "@/lib/ledger-context";
import { usePersistentState } from "@/lib/use-persistent";
import { ChainMap } from "@/components/chain-map";
import { ColumnFilterMenu } from "@/components/column-filter";
import { LangToggle } from "@/components/lang-toggle";
import { PortfolioView, type ChainCoverage } from "@/components/portfolio-view";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { EudrSummaryView } from "@/components/eudr-summary";
import { DocumentsView, MonitoringView, PriceView } from "@/components/chain-extras";
import { monitoringFor } from "@/lib/monitoring";
import { PRICE_GROUP } from "@/lib/market";
import type { Copy } from "@/lib/copy";

function WarningTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 1 21h22L12 3z" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.51" />
    </svg>
  );
}

const PLOT_COL_KEYS = [
  "plotId",
  "company",
  "location",
  "hectare",
  "comply",
  "risk",
  "mitigation",
  "type",
] as const;
type PlotColKey = (typeof PLOT_COL_KEYS)[number];
const DEFAULT_PLOT_COL_WIDTHS: Record<PlotColKey, number> = {
  // Wide enough for a full minted ID (e.g. IDN111407-PO1000000706-2608-09985)
  // in the mono face; anything longer still ellipsizes rather than spilling
  // into the Company column.
  plotId: 260,
  company: 200,
  location: 200,
  hectare: 90,
  comply: 120,
  risk: 120,
  mitigation: 90,
  type: 170,
};
const MIN_COL_WIDTH = 50;
// Bumped to -v2 when plotId's default widened: the widths are written back on
// every mount, so every returning browser already had the old 190px stored.
const PLOT_COL_WIDTHS_KEY = "kanopi-plot-col-widths-v2";
const DRAWER_HEIGHT_KEY = "palmtrace-plot-drawer-height";

function loadStoredWidths(): Record<PlotColKey, number> {
  try {
    const raw = localStorage.getItem(PLOT_COL_WIDTHS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? { ...DEFAULT_PLOT_COL_WIDTHS, ...parsed } : DEFAULT_PLOT_COL_WIDTHS;
  } catch {
    return DEFAULT_PLOT_COL_WIDTHS;
  }
}

function loadStoredDrawerHeight(): number | null {
  try {
    const raw = localStorage.getItem(DRAWER_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * A drag grip for a table column's width or the plot drawer's height — a
 * plain pointer-events drag rather than a library. Pointer Events cover
 * mouse, touch and pen with one code path.
 */
function DragHandle({
  axis,
  className,
  onDrag,
}: {
  axis: "x" | "y";
  className: string;
  onDrag: (deltaPx: number) => void;
}) {
  return (
    <span
      className={className}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        let last = axis === "x" ? e.clientX : e.clientY;
        function onMove(ev: PointerEvent) {
          const pos = axis === "x" ? ev.clientX : ev.clientY;
          onDrag(pos - last);
          last = pos;
        }
        function onUp() {
          target.releasePointerCapture(e.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    />
  );
}

// Matches scripts/prepare-areas.mjs's slugify exactly — that script names
// each prepared areas file after its Refinery/KCP this same way.
function refinerySlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon({ collapse }: { collapse: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {collapse ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </svg>
  );
}

/** Fetches just this one mill's own plot geojson (independent of whatever's
 * currently selected/displayed on the map) so the download works regardless
 * of selection state. */
async function downloadMillGeojson(m: MillRecord) {
  const features: Fc["features"] = [];
  if (hasCoords(m)) {
    features.push({
      type: "Feature",
      properties: { _mill: m.millName, _id: m.id, _trace: m.traceability },
      geometry: { type: "Point", coordinates: [m.lon, m.lat] },
    });
  }
  if (m.umlId) {
    try {
      const res = await fetch(`/data/plots/${encodeURIComponent(m.id)}.geojson`);
      if (res.ok) {
        const fc = (await res.json()) as Fc;
        features.push(...fc.features);
      }
    } catch {
      // No plot data available for this mill — still download the point.
    }
  }
  downloadGeojson(`palmtrace-${m.id}-geometry.geojson`, { type: "FeatureCollection", features });
}

function typeLabel(raw: string, t: Copy): string {
  if (raw === "Independent Smallholder") return t.typeIndependent;
  if (raw === "Company") return t.typeCompany;
  if (raw === "Scheme Smallholder") return t.typeScheme;
  return raw;
}

type Tab = "summary" | "data" | "docs" | "monitoring" | "price";
const TAB_PATHS: readonly Exclude<Tab, "summary">[] = ["data", "docs", "monitoring", "price"];

function tabFromPath(pathname: string): Tab {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return (TAB_PATHS as readonly string[]).includes(last) ? (last as Tab) : "summary";
}

type View = {
  groupSlug: string | null;
  tab: Tab;
  refinery: string | null;
  mill: string | null;
  plots: PlotComplyFilter | null;
};

export function Workspace({ role, tenant }: { role: GateRole; tenant: Tenant }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false }) as { group?: string };
  const search = useSearch({ strict: false }) as GroupSearch;
  const store = useLedger();

  // Everything that identifies "what am I looking at" lives in the URL
  // (feedback 2, B-05) — /app/portfolio, /app/<group>, /app/<group>/data,
  // ?refinery=&mill= — so a link can be sent to a colleague, a refresh
  // lands on the same view, and the browser's Back button means something.
  const view: View = {
    groupSlug: params.group ?? null,
    tab: tabFromPath(location.pathname),
    refinery: search.refinery ?? null,
    mill: search.mill ?? null,
    plots: search.plots ?? null,
  };
  const selectedRefinery = view.refinery;
  const selectedMillId = view.mill;
  const viewTab = view.tab;

  function go(next: Partial<View>, opts: { replace?: boolean } = {}) {
    // The non-compliance filter only ever applies to the navigation that
    // asked for it, never to whatever the user does next.
    const v = { ...view, plots: null, ...next };
    const base = v.groupSlug ? `/app/${encodeURIComponent(v.groupSlug)}${v.tab === "summary" ? "" : `/${v.tab}`}` : "/app/portfolio";
    const qs = new URLSearchParams();
    if (v.groupSlug && v.refinery) qs.set("refinery", v.refinery);
    if (v.groupSlug && v.mill) qs.set("mill", v.mill);
    if (v.groupSlug && v.mill && v.plots) qs.set("plots", v.plots);
    const q = qs.toString();
    void navigate({ href: q ? `${base}?${q}` : base, replace: opts.replace });
  }

  const canPresent = role === "admin" || role === "client";
  // Auditors are outside the company: they may look, not take files away.
  const canDownload = role !== "auditor";
  const [presentStored, setPresent] = usePersistentState("palmtrace.present", false);
  const present = canPresent && presentStored;
  const [mapFocus, setMapFocus] = useState(false);
  const [query, setQuery] = useState("");
  const [traceFilter, setTraceFilter] = useState<TraceFilter>("all");
  const [plotDrawerOpen, setPlotDrawerOpen] = useState(false);
  const [plotColWidths, setPlotColWidths] = useState<Record<PlotColKey, number>>(loadStoredWidths);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(loadStoredDrawerHeight);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(PLOT_COL_WIDTHS_KEY, JSON.stringify(plotColWidths));
    } catch {
      // Private browsing — resizing still works for this session.
    }
  }, [plotColWidths]);
  useEffect(() => {
    if (drawerHeight == null) return;
    try {
      localStorage.setItem(DRAWER_HEIGHT_KEY, String(drawerHeight));
    } catch {
      // Same as above.
    }
  }, [drawerHeight]);
  function resizePlotCol(key: PlotColKey, deltaPx: number) {
    setPlotColWidths((w) => ({ ...w, [key]: Math.max(MIN_COL_WIDTH, w[key] + deltaPx) }));
  }
  const [serverPlots, setServerPlots] = useState<Fc | null>(null);
  const [serverPlotsLoading, setServerPlotsLoading] = useState(false);
  // Set only when the fetch itself failed — kept separate from serverPlots
  // being empty so the UI can tell "this mill genuinely has no data yet"
  // apart from "something broke while loading it" (the Vercel Blob outage
  // that silently zeroed out DOMAS's plots looked identical to empty).
  // "session" is the 401 case, which no amount of retrying fixes.
  const [serverPlotsError, setServerPlotsError] = useState<"" | "failed" | "session">("");
  const [plotRetryNonce, setPlotRetryNonce] = useState(0);
  // Set by clicking a row in the plot table — a fresh nonce each time so
  // clicking the same plot twice still re-flies the map to it.
  const [focusPlot, setFocusPlot] = useState<{ index: number; nonce: number } | null>(null);
  const [plotQuery, setPlotQuery] = useState("");
  // Shared with ChainMap's legend-as-filter buttons — either surface can
  // narrow which plots show on the map and in the plot table.
  const [plotFilters, setPlotFilters] = useState<PlotFilters>(EMPTY_PLOT_FILTERS);
  const [plotPage, setPlotPage] = useState(0);
  useEffect(() => {
    setFocusPlot(null);
    setPlotQuery("");
    setPlotFilters(EMPTY_PLOT_FILTERS);
    if (!selectedMillId) setPlotDrawerOpen(false);
  }, [selectedMillId]);
  useEffect(() => {
    setPlotPage(0);
  }, [plotQuery, plotFilters]);
  useEffect(() => {
    if (viewTab !== "data") setMapFocus(false);
  }, [view.groupSlug, viewTab]);

  // Which mills have plot-level analysis — ids only, drives the "plots
  // ready / partial / master only" pills, the per-mill badge and present
  // mode.
  const [coveredIds, setCoveredIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchWithRetry("/coverage")
      .then((res) => (res.ok ? (res.json() as Promise<{ millIds: string[] }>) : null))
      .then((body) => {
        if (!cancelled && body) setCoveredIds(new Set(body.millIds));
      })
      .catch(() => {
        /* the pills just stay hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allChains = useMemo(() => groupChains(store.mills), [store.mills]);
  const coverage = useMemo(() => {
    const map = new Map<string, ChainCoverage>();
    if (!coveredIds) return map;
    for (const c of allChains) {
      const covered = c.mills.filter((m) => coveredIds.has(m.id)).length;
      map.set(c.id, { covered, total: c.mills.length });
    }
    return map;
  }, [allChains, coveredIds]);
  // Present mode lists only groups that actually have plot analysis — an
  // empty chain opened in front of a client reads as "the product is broken".
  const chains = useMemo(
    () => (present && coveredIds ? allChains.filter((c) => (coverage.get(c.id)?.covered ?? 0) > 0) : allChains),
    [present, coveredIds, allChains, coverage],
  );
  const chain = allChains.find((c) => groupSlug(c.name) === view.groupSlug) ?? null;
  const hasPrice = (c: Chain | null) => tenant === "adm" && c?.name === PRICE_GROUP;
  // /price on any other chain (an old link, a group switch) shows the summary.
  const tab: Tab = viewTab === "price" && !hasPrice(chain) ? "summary" : viewTab;

  function selectScope(chainId: string | null) {
    const target = chainId ? allChains.find((c) => c.id === chainId) : null;
    const nextTab = !target ? "summary" : tab === "price" && !hasPrice(target) ? "summary" : tab;
    go({ groupSlug: target ? groupSlug(target.name) : null, refinery: null, mill: null, tab: nextTab });
  }

  // Mills in the current refinery/trace scope — the map always shows all of
  // them; the text search only narrows the list beside it.
  const scopeMills = useMemo(
    () =>
      (chain?.mills ?? []).filter(
        (m) => (!selectedRefinery || m.refinery === selectedRefinery) && (traceFilter === "all" || m.traceability === traceFilter),
      ),
    [chain, selectedRefinery, traceFilter],
  );
  const listMills = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? scopeMills.filter((m) => millHaystack(m).includes(q)) : scopeMills;
    // Mills with plot analysis first, then by name — the ones worth opening.
    return [...list].sort((a, b) => {
      const ca = coveredIds?.has(a.id) ? 0 : 1;
      const cb = coveredIds?.has(b.id) ? 0 : 1;
      return ca - cb || a.millName.localeCompare(b.millName);
    });
  }, [scopeMills, query, coveredIds]);

  // Plot geometry is prepared offline (scripts/prepare-plots.mjs) and served
  // per mill from /data/plots/<mill id>.geojson — keyed by each mill's own
  // `id` (umlId__group__refinery), since the same physical mill can supply
  // more than one chain with a different plot set. Too large for a whole
  // chain, so it's fetched lazily for just the selected mill.
  const selectedMill = (chain?.mills ?? []).find((m) => m.id === selectedMillId) ?? null;
  useEffect(() => {
    if (!selectedMill?.umlId) {
      setServerPlots(null);
      setServerPlotsError("");
      return;
    }
    let cancelled = false;
    setServerPlotsLoading(true);
    setServerPlotsError("");
    void fetchWithRetry(`/data/plots/${encodeURIComponent(selectedMill.id)}.geojson`)
      .then(async (res) => {
        if (res.ok) return { fc: (await res.json()) as Fc, failed: "" as const };
        // A plain 404 means this mill's plots were never uploaded — a real
        // state, not a bug. Anything else means the data exists but
        // couldn't be retrieved right now.
        if (res.status === 404) return { fc: null, failed: "" as const };
        return { fc: null, failed: res.status === 401 ? ("session" as const) : ("failed" as const) };
      })
      .then(({ fc, failed }) => {
        if (cancelled) return;
        setServerPlots(fc && fc.features.length ? fc : null);
        setServerPlotsError(failed);
      })
      .catch(() => {
        if (!cancelled) {
          setServerPlots(null);
          setServerPlotsError("failed");
        }
      })
      .finally(() => {
        if (!cancelled) setServerPlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMill?.umlId, selectedMill?.id, plotRetryNonce]);

  // ?plots=comply|noncomply (from the summary's compliance list): once this
  // mill's plots are in, narrow them accordingly and open the table.
  useEffect(() => {
    if (!view.plots || !serverPlots) return;
    setPlotFilters({ ...EMPTY_PLOT_FILTERS, comply: new Set([view.plots === "comply" ? "yes" : "no"]) });
    setPlotDrawerOpen(true);
  }, [view.plots, serverPlots]);

  // Memoized so ChainMap's props keep a stable reference across unrelated
  // re-renders — otherwise its mount effect sees a "changed" prop every
  // render and tears down/recreates the whole MapLibre map.
  const chainMills = chain?.mills;
  const viewPlots = useMemo(() => decoratePlots(serverPlots, chainMills ?? []), [serverPlots, chainMills]);

  const PLOT_PAGE_SIZE = 200;
  const matchingPlotRows = useMemo(() => {
    const q = plotQuery.trim().toLowerCase();
    const indexed = (viewPlots?.features ?? []).map((f, index) => ({ f, index }));
    return indexed.filter(({ f }) => {
      if (!plotPassesFilters(f.properties, plotFilters)) return false;
      if (!q) return true;
      const id = String(f.properties?.PlotID ?? "").toLowerCase();
      const company = String(f.properties?.COMPANY ?? "").toLowerCase();
      return id.includes(q) || company.includes(q);
    });
  }, [viewPlots, plotQuery, plotFilters]);

  const plotPageCount = Math.max(1, Math.ceil(matchingPlotRows.length / PLOT_PAGE_SIZE));
  const plotPageClamped = Math.min(plotPage, plotPageCount - 1);
  const pagedPlotRows = useMemo(
    () => matchingPlotRows.slice(plotPageClamped * PLOT_PAGE_SIZE, (plotPageClamped + 1) * PLOT_PAGE_SIZE),
    [matchingPlotRows, plotPageClamped],
  );

  // Once a mill is selected, mill points and areas scope down to that one
  // mill (matching how plots already work).
  const mapMills = useMemo(() => {
    if (!selectedMillId) return scopeMills;
    const selected = scopeMills.find((m) => m.id === selectedMillId);
    return selected ? [selected] : scopeMills;
  }, [scopeMills, selectedMillId]);

  const viewMillGeom = useMemo(() => millPointsFromMaster(mapMills), [mapMills]);

  // Traceability areas (village boundary / mill buffer radius), one file per
  // Refinery/KCP — fetched once per distinct refinery in the chain and
  // cached; a refinery with no prepared file just 404s and is skipped.
  const areasCacheRef = useRef(new Map<string, Fc | null>());
  const [rawAreas, setRawAreas] = useState<Fc | null>(null);
  useEffect(() => {
    const refineries = [...new Set((chain?.mills ?? []).map((m) => m.refinery).filter(Boolean))];
    if (refineries.length === 0) {
      setRawAreas(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const collections: Fc[] = [];
      for (const refinery of refineries) {
        const slug = refinerySlug(refinery);
        const cached = areasCacheRef.current.get(slug);
        if (cached !== undefined) {
          if (cached) collections.push(cached);
          continue;
        }
        try {
          const res = await fetch(`/data/areas/${slug}.geojson`);
          const fc = res.ok ? ((await res.json()) as Fc) : null;
          areasCacheRef.current.set(slug, fc);
          if (fc) collections.push(fc);
        } catch {
          areasCacheRef.current.set(slug, null);
        }
      }
      if (!cancelled) {
        setRawAreas(
          collections.length ? { type: "FeatureCollection", features: collections.flatMap((c) => c.features) } : null,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chain]);

  const viewAreas = useMemo(
    () => decorateAreas(filterAreas(rawAreas, mapMills, traceFilter)),
    [rawAreas, mapMills, traceFilter],
  );

  // JRC forest cover (~20 MB) — off by default and fetched only the first
  // time someone switches it on (feedback 2, Doc 2 §7).
  const [forestOn, setForestOn] = usePersistentState("palmtrace.layer.jrc", false);
  const [forestCover, setForestCover] = useState<Fc | null>(null);
  const [forestLoading, setForestLoading] = useState(false);
  const forestRequested = useRef(false);
  useEffect(() => {
    if (!forestOn || forestRequested.current) return;
    forestRequested.current = true;
    setForestLoading(true);
    void fetch("/data/forest/forest-cover.geojson")
      .then((res) => (res.ok ? res.json() : null))
      .then((fc: Fc | null) => setForestCover(fc && fc.features.length ? fc : null))
      .catch(() => {
        forestRequested.current = false;
      })
      .finally(() => setForestLoading(false));
  }, [forestOn]);

  async function logout() {
    await gateLogout();
    await navigate({ to: "/login" });
  }
  // Admins only. A full reload (not a client-side navigate) so the ledger,
  // plot caches and every in-memory figure of the previous client are dropped.
  async function switchTenant(next: Tenant) {
    const res = await gateSwitchTenant({ data: { tenant: next } });
    if (res.ok) window.location.assign("/app/portfolio");
  }
  const loginAgainHref = `/login?next=${encodeURIComponent(location.href)}`;

  if (!store.ready) {
    return (
      <div className="boot">
        <BrandMark size={32} />
        <span>{t.loading}</span>
      </div>
    );
  }

  const chainLabel = chain ? groupLabel(chain.name) : "";
  const refineryInScope = selectedRefinery && chain?.refineries.includes(selectedRefinery) ? selectedRefinery : null;
  const summaryMills = chain ? (refineryInScope ? chain.mills.filter((m) => m.refinery === refineryInScope) : chain.mills) : [];

  const refinerySelect =
    chain && chain.refineries.length > 1 ? (
      <select
        className="select"
        aria-label={t.refinery}
        value={refineryInScope ?? ""}
        onChange={(e) => go({ refinery: e.target.value || null, mill: null })}
      >
        <option value="">{t.selectRefinery}</option>
        {chain.refineries.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <div className={`app ${mapFocus ? "map-focus" : ""} ${present ? "presenting" : ""}`}>
      <header className="app-header">
        <Link to="/app/portfolio" className="app-brand" aria-label={`${t.app} — ${t.portfolio}`}>
          <BrandMark size={22} />
          <span className="word">{t.app}</span>
        </Link>
        <span className="app-sep" aria-hidden="true">
          /
        </span>
        <ScopeSwitcher chains={chains} coverage={coverage} currentId={chain?.id ?? null} onSelect={selectScope} />
        {chain ? (
          <nav className="app-tabs" aria-label={chainLabel}>
            {(
              [
                ["summary", t.summaryTab],
                ["data", t.dataTab],
                ["monitoring", t.monitoringTab],
                ["docs", t.docsTab],
                ...(hasPrice(chain) ? ([["price", t.priceTab]] as const) : []),
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? "on" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => go({ tab: key })}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="app-actions">
          {role === "admin" && !present ? (
            <label className="tenant-switch">
              <span>{t.clientLabel}</span>
              <select value={tenant} onChange={(e) => void switchTenant(e.target.value as Tenant)}>
                {TENANTS.map((tn) => (
                  <option key={tn.id} value={tn.id}>
                    {tn.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canPresent ? (
            <button
              type="button"
              className={`present-btn ${present ? "on" : ""}`}
              aria-pressed={present}
              title={t.presentHint}
              onClick={() => setPresent(!presentStored)}
            >
              <span className="dot" aria-hidden="true" />
              {present ? t.presentOn : t.present}
            </button>
          ) : null}
          {present ? null : <LangToggle />}
          <button type="button" className="btn-text" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <main className="app-main">
        {store.mills.length === 0 ? (
          <div className="page">
            <div className="empty-state">
              <h2>{t.emptyTitle}</h2>
              {role === "admin" ? <p>{t.emptyBody}</p> : null}
            </div>
          </div>
        ) : !chain ? (
          <PortfolioView
            chains={chains}
            coverage={coverage}
            coveredIds={coveredIds}
            onSelectChain={(id) => selectScope(id)}
            onSelectRefinery={(id, refinery) => {
              const target = allChains.find((c) => c.id === id);
              if (target) go({ groupSlug: groupSlug(target.name), refinery, mill: null, tab: "summary" });
            }}
          />
        ) : tab === "docs" ? (
          <DocumentsView canDownload={canDownload} />
        ) : tab === "monitoring" ? (
          <MonitoringView chainLabel={chainLabel} entry={monitoringFor(tenant, chain.name)} />
        ) : tab === "price" ? (
          <PriceView />
        ) : tab === "summary" ? (
          <div className="page">
            <header className="summary-head">
              <div>
                <p className="eyebrow">{t.supplyChainList}</p>
                <h1>
                  {chainLabel}
                  {refineryInScope ? <span className="summary-sub"> · {refineryInScope}</span> : null}
                </h1>
              </div>
              <div className="summary-tools">
                {refinerySelect}
                <button type="button" className="btn-secondary" onClick={() => go({ tab: "data" })}>
                  {t.eudrGoToMap}
                </button>
              </div>
            </header>
            <EudrSummaryView
              millIds={summaryMills.filter((m) => m.umlId).map((m) => m.id)}
              totalMills={summaryMills.length}
              millNames={new Map(summaryMills.map((m) => [m.id, m.millName]))}
              variant="chain"
              hideCoverageNotice={present}
              onOpenMap={() => go({ tab: "data" })}
              onOpenPlots={(millId, plots) => go({ tab: "data", mill: millId, plots })}
            />
          </div>
        ) : (
          <div className="mapview">
            <div className="mapview-map">
              <ChainMap
                millGeom={viewMillGeom}
                areas={viewAreas}
                plots={viewPlots}
                forest={forestCover}
                forestOn={forestOn}
                forestLoading={forestLoading}
                onForestOnChange={setForestOn}
                plotsLoading={serverPlotsLoading}
                selectedMillId={selectedMillId}
                onSelectMill={(id) => go({ mill: id })}
                focusPlot={focusPlot}
                plotFilters={plotFilters}
                onPlotFiltersChange={setPlotFilters}
                layoutKey={`${mapFocus}-${plotDrawerOpen}-${drawerHeight}-${lang}`}
              />
              <button
                type="button"
                className="map-focus-btn"
                aria-pressed={mapFocus}
                title={mapFocus ? t.collapseMap : t.expandMap}
                aria-label={mapFocus ? t.collapseMap : t.expandMap}
                onClick={() => setMapFocus((v) => !v)}
              >
                <ExpandIcon collapse={mapFocus} />
              </button>
              {serverPlotsLoading ? (
                <div className="map-loading-overlay">
                  <div className="map-loading-card">
                    <span className="spinner" aria-hidden="true" />
                    <p>{t.loadingPlots}</p>
                  </div>
                </div>
              ) : null}
              {serverPlotsError ? (
                <div className="map-error-banner" role="alert">
                  <WarningTriangleIcon />
                  <p>{serverPlotsError === "session" ? t.sessionExpired : t.plotsLoadError}</p>
                  {serverPlotsError === "session" ? (
                    <a href={loginAgainHref}>{t.signIn}</a>
                  ) : (
                    <button type="button" onClick={() => setPlotRetryNonce((n) => n + 1)}>
                      {t.retry}
                    </button>
                  )}
                </div>
              ) : null}
              {plotDrawerOpen && selectedMill ? (
                <div className="plot-drawer" ref={drawerRef} style={drawerHeight != null ? { height: drawerHeight } : undefined}>
                  <DragHandle
                    axis="y"
                    className="drawer-grip"
                    onDrag={(deltaPx) => {
                      const current = drawerHeight ?? drawerRef.current?.getBoundingClientRect().height ?? 0;
                      setDrawerHeight(Math.min(Math.max(current - deltaPx, 160), window.innerHeight * 0.8));
                    }}
                  />
                  <div className="drawer-head">
                    <h2>
                      {selectedMill.millName}
                      <span>
                        {formatCount(matchingPlotRows.length, lang)} {t.plotsLabel}
                      </span>
                    </h2>
                    <button type="button" className="btn-text" onClick={() => setPlotDrawerOpen(false)}>
                      {t.close}
                    </button>
                  </div>
                  <PlotTable
                    t={t}
                    lang={lang}
                    viewPlots={viewPlots}
                    matchingPlotRows={matchingPlotRows}
                    pagedPlotRows={pagedPlotRows}
                    plotQuery={plotQuery}
                    setPlotQuery={setPlotQuery}
                    plotFilters={plotFilters}
                    setPlotFilters={setPlotFilters}
                    serverPlotsLoading={serverPlotsLoading}
                    serverPlotsError={serverPlotsError}
                    plotColWidths={plotColWidths}
                    resizePlotCol={resizePlotCol}
                    focusPlot={focusPlot}
                    setFocusPlot={setFocusPlot}
                    page={plotPageClamped}
                    pageCount={plotPageCount}
                    pageSize={PLOT_PAGE_SIZE}
                    setPage={setPlotPage}
                  />
                </div>
              ) : null}
            </div>

            <aside className="side-panel" aria-label={selectedMill ? selectedMill.millName : t.nMills}>
              {selectedMill ? (
                <MillDetail
                  t={t}
                  lang={lang}
                  mill={selectedMill}
                  covered={coveredIds?.has(selectedMill.id) ?? false}
                  present={present}
                  canDownload={canDownload}
                  plotCount={viewPlots?.features.length ?? 0}
                  plotsLoading={serverPlotsLoading}
                  drawerOpen={plotDrawerOpen}
                  onToggleDrawer={() => setPlotDrawerOpen((v) => !v)}
                  onBack={() => go({ mill: null })}
                />
              ) : (
                <MillList
                  t={t}
                  lang={lang}
                  chain={chain}
                  mills={listMills}
                  scopeCount={scopeMills.length}
                  coveredIds={coveredIds}
                  refinerySelect={refinerySelect}
                  query={query}
                  setQuery={setQuery}
                  traceFilter={traceFilter}
                  setTraceFilter={setTraceFilter}
                  onSelect={(id) => go({ mill: id })}
                />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

/** Right-hand list of mills in the current scope — the map's companion, not
 * a separate table below it. */
function MillList({
  t,
  lang,
  chain,
  mills,
  scopeCount,
  coveredIds,
  refinerySelect,
  query,
  setQuery,
  traceFilter,
  setTraceFilter,
  onSelect,
}: {
  t: Copy;
  lang: "en" | "id";
  chain: Chain;
  mills: MillRecord[];
  scopeCount: number;
  coveredIds: Set<string> | null;
  refinerySelect: ReactNode;
  query: string;
  setQuery: (q: string) => void;
  traceFilter: TraceFilter;
  setTraceFilter: (f: TraceFilter) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <h2>{groupLabel(chain.name)}</h2>
          <span>
            {formatCount(scopeCount, lang)} {t.mills}
          </span>
        </div>
        {refinerySelect}
        <label className="search-field">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchMills}
            aria-label={t.searchMills}
          />
        </label>
        <div className="seg" role="group" aria-label={t.viewMode}>
          {(["all", "village", "buffer"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={traceFilter === k ? "on" : ""}
              aria-pressed={traceFilter === k}
              onClick={() => setTraceFilter(k)}
            >
              {k === "all" ? t.all : k === "village" ? t.village : t.buffer}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        {mills.length === 0 ? (
          <div className="panel-empty">
            <p>{query.trim() ? t.noMatchQuery.replace("{q}", query.trim()).replace("{chain}", groupLabel(chain.name)) : t.noMatch}</p>
            {query.trim() || traceFilter !== "all" ? (
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setQuery("");
                  setTraceFilter("all");
                }}
              >
                {t.clearFilters}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="mill-list">
            {mills.map((m) => {
              const trace = traceLabel(m, t);
              const hasPlots = coveredIds?.has(m.id) ?? false;
              return (
                <li key={m.id}>
                  <button type="button" className="mill-row" onClick={() => onSelect(m.id)} aria-label={t.locateMill.replace("{mill}", m.millName)}>
                    <span className="mill-row-main">
                      <b>{m.millName}</b>
                      <span>{[m.refinery, trace].filter(Boolean).join(" · ")}</span>
                    </span>
                    {coveredIds ? (
                      <span className={`dot-status ${hasPlots ? "on" : ""}`} title={hasPlots ? t.statusReady : t.statusMaster}>
                        <span className="sr-only">{hasPlots ? t.statusReady : t.statusMaster}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/** Right-hand detail for the selected mill: identity, its own EUDR figures,
 * downloads, and the way into its plot table. */
function MillDetail({
  t,
  lang,
  mill,
  covered,
  present,
  canDownload,
  plotCount,
  plotsLoading,
  drawerOpen,
  onToggleDrawer,
  onBack,
}: {
  t: Copy;
  lang: "en" | "id";
  mill: MillRecord;
  covered: boolean;
  present: boolean;
  canDownload: boolean;
  plotCount: number;
  plotsLoading: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onBack: () => void;
}) {
  const trace = traceLabel(mill, t);
  const facts: [string, string][] = [
    [t.coordinates, hasCoords(mill) ? `${mill.lat!.toFixed(5)}, ${mill.lon!.toFixed(5)}` : ""],
    [t.refinery, mill.refinery],
    [t.uml, mill.umlId],
    [t.node, mill.nodeId],
    [t.trace, trace],
    [t.port, mill.port],
    [t.groupName, mill.groupName],
    [t.parentCompany, mill.parentCompany],
  ];
  return (
    <>
      <div className="panel-head">
        <button type="button" className="back-link" onClick={onBack}>
          <ChevronLeft />
          {t.backToMills}
        </button>
        <div className="panel-title">
          <h2>{mill.millName}</h2>
          {covered ? <span className="status-pill ready">{t.statusReady}</span> : <span className="status-pill master">{t.statusMaster}</span>}
        </div>
      </div>
      <div className="panel-body">
        {!hasCoords(mill) ? <p className="panel-note">{t.noCoordinates}</p> : null}
        {mill.umlId ? (
          <EudrSummaryView millIds={[mill.id]} variant="mill" layout="compact" hideCoverageNotice={present} />
        ) : null}
        {plotCount > 0 || plotsLoading ? (
          <button type="button" className="btn-primary block" aria-expanded={drawerOpen} onClick={onToggleDrawer} disabled={plotsLoading}>
            {plotsLoading ? t.loadingPlots : `${drawerOpen ? t.close : t.openPlotTable} · ${formatCount(plotCount, lang)} ${t.plotsLabel}`}
          </button>
        ) : null}
        <dl className="facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={label === t.uml || label === t.node ? "mono" : ""} title={value ? undefined : t.notInSource}>
                {value || "—"}
              </dd>
            </div>
          ))}
        </dl>
        {canDownload ? (
          <div className="downloads">
            <p className="eyebrow">{t.download}</p>
            <button type="button" className="download-row" onClick={() => downloadMillsCsv(`palmtrace-${mill.id}-mill.csv`, [mill])}>
              <DownloadIcon />
              <span>
                <b>CSV</b>
                {t.downloadCsvHint}
              </span>
            </button>
            <button type="button" className="download-row" onClick={() => void downloadMillGeojson(mill)}>
              <DownloadIcon />
              <span>
                <b>GeoJSON</b>
                {t.downloadGeoHint}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

type PlotRow = { f: Fc["features"][number]; index: number };

function PlotTable({
  t,
  lang,
  viewPlots,
  matchingPlotRows,
  pagedPlotRows,
  plotQuery,
  setPlotQuery,
  plotFilters,
  setPlotFilters,
  serverPlotsLoading,
  serverPlotsError,
  plotColWidths,
  resizePlotCol,
  focusPlot,
  setFocusPlot,
  page,
  pageCount,
  pageSize,
  setPage,
}: {
  t: Copy;
  lang: "en" | "id";
  viewPlots: Fc | null;
  matchingPlotRows: PlotRow[];
  pagedPlotRows: PlotRow[];
  plotQuery: string;
  setPlotQuery: (q: string) => void;
  plotFilters: PlotFilters;
  setPlotFilters: (f: PlotFilters | ((f: PlotFilters) => PlotFilters)) => void;
  serverPlotsLoading: boolean;
  serverPlotsError: "" | "failed" | "session";
  plotColWidths: Record<PlotColKey, number>;
  resizePlotCol: (key: PlotColKey, deltaPx: number) => void;
  focusPlot: { index: number; nonce: number } | null;
  setFocusPlot: (f: { index: number; nonce: number }) => void;
  page: number;
  pageCount: number;
  pageSize: number;
  setPage: (fn: (p: number) => number) => void;
}) {
  const riskText = (v: string) => (v === "low" ? t.riskLow : v === "medium" ? t.riskMedium : v === "high" ? t.riskHigh : v);
  return (
    <>
      <div className="table-tools">
        <label className="search-field">
          <SearchIcon />
          <input
            type="search"
            value={plotQuery}
            onChange={(e) => setPlotQuery(e.target.value)}
            placeholder={t.searchPlotPlaceholder}
            aria-label={t.searchPlotPlaceholder}
          />
        </label>
        {activePlotFilterCount(plotFilters) > 0 ? (
          <div className="table-filter-summary">
            <span>{t.filtersActive.replace("{n}", String(activePlotFilterCount(plotFilters)))}</span>
            <button type="button" className="linkish" onClick={() => setPlotFilters(EMPTY_PLOT_FILTERS)}>
              {t.clearFilters}
            </button>
          </div>
        ) : null}
      </div>
      <div className="table-wrap">
        {matchingPlotRows.length === 0 ? (
          <p className="table-empty">
            {serverPlotsError === "session"
              ? t.sessionExpired
              : serverPlotsError
                ? t.plotsLoadError
                : serverPlotsLoading
                  ? t.loadingPlots
                  : t.noPlots}
          </p>
        ) : (
          <table className="data-table resizable-cols">
            <colgroup>
              {PLOT_COL_KEYS.map((k) => (
                <col key={k} style={{ width: plotColWidths[k] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>
                  {t.plotId}
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("plotId", d)} />
                </th>
                <th>
                  {t.company}
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("company", d)} />
                </th>
                <th>
                  <span className="th-cell">
                    {t.location}
                    <ColumnFilterMenu
                      label={t.location}
                      options={distinctFilterOptions(viewPlots, "location").map((o) => ({ value: o.value, label: o.value, count: o.count }))}
                      selected={plotFilters.location}
                      onChange={(next) => setPlotFilters((f) => ({ ...f, location: next }))}
                      clearLabel={t.clear}
                    />
                  </span>
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("location", d)} />
                </th>
                <th>
                  {t.popupHectare}
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("hectare", d)} />
                </th>
                <th>
                  <span className="th-cell">
                    {t.eudrComplyKpi}
                    <ColumnFilterMenu
                      label={t.eudrComplyKpi}
                      options={distinctFilterOptions(viewPlots, "comply").map((o) => ({
                        value: o.value,
                        label: o.value === "yes" ? t.comply : o.value === "no" ? t.nonComply : o.value,
                        count: o.count,
                      }))}
                      selected={plotFilters.comply}
                      onChange={(next) => setPlotFilters((f) => ({ ...f, comply: next }))}
                      clearLabel={t.clear}
                    />
                  </span>
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("comply", d)} />
                </th>
                <th>
                  <span className="th-cell">
                    {t.riskLabel}
                    <ColumnFilterMenu
                      label={t.riskLabel}
                      options={distinctFilterOptions(viewPlots, "risk").map((o) => ({ value: o.value, label: riskText(o.value), count: o.count }))}
                      selected={plotFilters.risk}
                      onChange={(next) => setPlotFilters((f) => ({ ...f, risk: next }))}
                      clearLabel={t.clear}
                    />
                  </span>
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("risk", d)} />
                </th>
                <th>
                  <span className="th-cell">
                    {t.mitigationLabel}
                    <ColumnFilterMenu
                      label={t.mitigationLabel}
                      options={distinctFilterOptions(viewPlots, "mitigation").map((o) => ({ value: o.value, label: o.value, count: o.count }))}
                      selected={plotFilters.mitigation}
                      onChange={(next) => setPlotFilters((f) => ({ ...f, mitigation: next }))}
                      clearLabel={t.clear}
                    />
                  </span>
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("mitigation", d)} />
                </th>
                <th>
                  <span className="th-cell">
                    {t.typeLabel}
                    <ColumnFilterMenu
                      label={t.typeLabel}
                      options={distinctFilterOptions(viewPlots, "type").map((o) => ({ value: o.value, label: typeLabel(o.value, t), count: o.count }))}
                      selected={plotFilters.type}
                      onChange={(next) => setPlotFilters((f) => ({ ...f, type: next }))}
                      clearLabel={t.clear}
                    />
                  </span>
                  <DragHandle axis="x" className="col-resize-handle" onDrag={(d) => resizePlotCol("type", d)} />
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedPlotRows.map(({ f, index }) => {
                const plotId = String(f.properties?.PlotID ?? "");
                const comply = f.properties?._comply;
                const risk = String(f.properties?._risk ?? "");
                const mitigation = String(f.properties?._mitigation ?? "");
                const hectarage = Number(f.properties?._hectarage ?? 0);
                const type = String(f.properties?.TYPE ?? "");
                return (
                  <tr key={index} className={focusPlot?.index === index ? "on" : ""} onClick={() => setFocusPlot({ index, nonce: Date.now() })}>
                    <td className="mono truncate" title={plotId}>
                      {plotId || "—"}
                    </td>
                    <td className="truncate" title={String(f.properties?.COMPANY ?? "")}>
                      {String(f.properties?.COMPANY ?? "").trim() || "—"}
                    </td>
                    <td className="truncate" title={locationText(f.properties)}>
                      {locationText(f.properties) || "—"}
                    </td>
                    <td className="tabular-nums">{hectarage ? formatHa(hectarage, lang) : "—"}</td>
                    <td>
                      <span className={`chip ${comply === "yes" ? "ok" : comply === "no" ? "bad" : ""}`}>
                        {comply === "yes" ? t.comply : comply === "no" ? t.nonComply : "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`chip ${risk === "low" ? "ok" : risk === "medium" ? "warn" : risk === "high" ? "bad" : ""}`}>
                        {risk ? riskText(risk) : "—"}
                      </span>
                    </td>
                    <td title={mitigationText(mitigation, lang) ?? ""}>{mitigation || "—"}</td>
                    <td className="truncate" title={typeLabel(type, t)}>
                      {typeLabel(type, t) || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {matchingPlotRows.length > 0 ? (
        <div className="table-pager">
          <span>
            {fill(t.rowsRange, {
              from: formatCount(page * pageSize + 1, lang),
              to: formatCount(Math.min(matchingPlotRows.length, (page + 1) * pageSize), lang),
              total: formatCount(matchingPlotRows.length, lang),
            })}
          </span>
          {pageCount > 1 ? (
            <div className="table-pager-nav">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                ‹ {t.prevPage}
              </button>
              <span>{fill(t.pageOf, { page: page + 1, total: pageCount })}</span>
              <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                {t.nextPage} ›
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
