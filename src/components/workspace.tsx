import { BrandMark } from "@/components/brand-mark";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { gateLogout } from "@/lib/gate-actions";
import type { GateRole } from "@/lib/gate";
import { useI18n } from "@/lib/i18n";
import {
  downloadGeojson,
  downloadMillsCsv,
  groupChains,
  type Fc,
  type MillRecord,
} from "@/lib/ledger";
import {
  decorateAreas,
  decoratePlots,
  filterAreas,
  millHaystack,
  millPointsFromMaster,
  MITIGATION_DESCRIPTIONS,
  type TraceFilter,
} from "@/lib/ledger-geo";
import { useLedger } from "@/lib/ledger-context";
import { ChainMap } from "@/components/chain-map";
import { NavTree } from "@/components/nav-tree";
import { PortfolioView } from "@/components/portfolio-view";
import { EudrSummaryView } from "@/components/eudr-summary";

// Matches scripts/prepare-areas.mjs's slugify exactly — that script names
// each prepared areas file after its Refinery/KCP this same way.
function refinerySlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function CsvIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function GeoJsonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

/** Fetches just this one mill's own plot geojson (independent of whatever's
 * currently selected/displayed on the map) so the per-row download works
 * regardless of selection state. */
async function downloadMillGeojson(m: MillRecord) {
  const features: Fc["features"] = [];
  if (m.lat != null && m.lon != null) {
    features.push({
      type: "Feature",
      properties: { _mill: m.millName, _id: m.id, _trace: m.traceability },
      geometry: { type: "Point", coordinates: [m.lon, m.lat] },
    });
  }
  if (m.umlId) {
    try {
      const res = await fetch(`/data/plots/${encodeURIComponent(m.umlId)}.geojson`);
      if (res.ok) {
        const fc = (await res.json()) as Fc;
        features.push(...fc.features);
      }
    } catch {
      // No plot data available for this mill — still download the point.
    }
  }
  downloadGeojson(`kanopi-${m.id}-geometry.geojson`, { type: "FeatureCollection", features });
}

export function Workspace({ role }: { role: GateRole }) {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const store = useLedger();
  const [query, setQuery] = useState("");
  const [traceFilter, setTraceFilter] = useState<TraceFilter>("all");
  const [selectedRefinery, setSelectedRefinery] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"summary" | "data">("summary");
  const [selectedMillId, setSelectedMillId] = useState<string | null>(null);
  // Collapsed to reclaim map height for a small screen or a long mill list —
  // otherwise the table's own max-height (42vh) permanently eats into the
  // map above it even when the user just wants to look at the map.
  const [dockOpen, setDockOpen] = useState(true);
  const [serverPlots, setServerPlots] = useState<Fc | null>(null);
  const [serverPlotsLoading, setServerPlotsLoading] = useState(false);
  // Set by clicking a row in the plot table (once a mill is selected) — a
  // fresh nonce each time so clicking the same plot twice still re-flies
  // the map to it (see ChainMap's focusPlot effect).
  const [focusPlot, setFocusPlot] = useState<{ index: number; nonce: number } | null>(null);
  const [plotQuery, setPlotQuery] = useState("");
  const [millSummaryOpen, setMillSummaryOpen] = useState(true);
  useEffect(() => {
    setFocusPlot(null);
    setPlotQuery("");
    setMillSummaryOpen(true);
  }, [selectedMillId]);

  const chains = useMemo(() => groupChains(store.mills), [store.mills]);
  // selectedChain === null is the Portfolio landing — an intentional state,
  // not "nothing picked yet" — so this must NOT fall back to chains[0].
  const chain = chains.find((c) => c.id === store.selectedChain) ?? null;

  function selectScope(chainId: string | null, refinery: string | null) {
    store.setSelectedChain(chainId);
    setSelectedRefinery(refinery);
    setSelectedMillId(null);
    setViewTab("summary");
  }

  const mills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (chain?.mills ?? []).filter((m) => {
      if (selectedRefinery && m.refinery !== selectedRefinery) return false;
      if (traceFilter !== "all" && m.traceability !== traceFilter) return false;
      if (q && !millHaystack(m).includes(q)) return false;
      return true;
    });
  }, [chain, selectedRefinery, traceFilter, query]);

  // Plot geometry is static, prepared offline (scripts/prepare-plots.mjs)
  // and served per-mill from /data/plots/<UML_ID>.geojson — too large to
  // load for a whole chain at once, so it's fetched lazily for just the
  // selected mill.
  const selectedMill = mills.find((m) => m.id === selectedMillId) ?? null;
  useEffect(() => {
    if (!selectedMill?.umlId) {
      setServerPlots(null);
      return;
    }
    let cancelled = false;
    setServerPlotsLoading(true);
    void fetch(`/data/plots/${encodeURIComponent(selectedMill.umlId)}.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((fc: Fc | null) => {
        if (!cancelled) setServerPlots(fc && fc.features.length ? fc : null);
      })
      .catch(() => {
        if (!cancelled) setServerPlots(null);
      })
      .finally(() => {
        if (!cancelled) setServerPlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMill?.umlId]);

  // Memoized so ChainMap's props keep a stable reference across unrelated
  // re-renders (e.g. typing in the mill search box) — otherwise its mount
  // effect (keyed on these Fc objects) sees a "changed" prop every render
  // and tears down/recreates the whole MapLibre map constantly.
  const viewPlots = useMemo(() => decoratePlots(serverPlots, mills), [serverPlots, mills]);

  const MAX_PLOT_ROWS = 500;
  // Carries each feature's index into `viewPlots.features` (the same array
  // reference ChainMap receives as `plots`) as the row identity, rather
  // than its `PlotID` — a plain index is simpler to key/target by and
  // needs no assumption about any property being unique.
  const matchingPlotRows = useMemo(() => {
    const q = plotQuery.trim().toLowerCase();
    const indexed = (viewPlots?.features ?? []).map((f, index) => ({ f, index }));
    if (!q) return indexed;
    return indexed.filter(({ f }) => {
      const id = String(f.properties?.PlotID ?? "").toLowerCase();
      const company = String(f.properties?.COMPANY ?? "").toLowerCase();
      return id.includes(q) || company.includes(q);
    });
  }, [viewPlots, plotQuery]);

  // Once a specific mill is selected, both the mill points and the areas
  // layer should scope down to that one mill only (matching how plots
  // already work) — otherwise every other mill's point/area stays visible
  // while exploring one mill's data, which reads as ambiguous/confusing.
  const scopedMills = useMemo(() => {
    if (!selectedMillId) return mills;
    const selected = mills.find((m) => m.id === selectedMillId);
    return selected ? [selected] : mills;
  }, [mills, selectedMillId]);

  const viewMillGeom = useMemo(() => millPointsFromMaster(scopedMills), [scopedMills]);

  // Traceability areas (village boundary / mill buffer radius), prepared
  // offline (scripts/prepare-areas.mjs) one file per Refinery/KCP — unlike
  // plots these aren't split per mill, so fetch once per distinct refinery
  // in the current chain and cache it; a refinery with no prepared file
  // just 404s and is quietly skipped rather than faked.
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
          collections.length
            ? { type: "FeatureCollection", features: collections.flatMap((c) => c.features) }
            : null,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chain]);

  const viewAreas = useMemo(
    () => decorateAreas(filterAreas(rawAreas, scopedMills, traceFilter)),
    [rawAreas, scopedMills, traceFilter],
  );

  // JRC forest-cover overlay (scripts/prepare-forest-cover.mjs) — a single
  // static file for the whole deployment, unlike plots/areas which are
  // scoped per mill/refinery, so it's fetched once and reused across every
  // chain/refinery/mill selection. A 404 (not yet prepared) just means no
  // forest layer, same "quietly skip" contract as the areas fetch above.
  const [forestCover, setForestCover] = useState<Fc | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/data/forest/forest-cover.geojson")
      .then((res) => (res.ok ? res.json() : null))
      .then((fc: Fc | null) => {
        if (!cancelled) setForestCover(fc && fc.features.length ? fc : null);
      })
      .catch(() => {
        if (!cancelled) setForestCover(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await gateLogout();
    await navigate({ to: "/login" });
  }

  if (!store.ready) {
    return <div className="boot">{t.loading}</div>;
  }

  return (
    <div className="frame">
      <header className="top">
        <div className="brand">
          <BrandMark size={28} />
          <div>
            <div className="word">{t.app}</div>
            <div className="org">{t.org}</div>
          </div>
        </div>
        <div className="top-actions">
          <div className="lang" role="group" aria-label="Language">
            <button
              type="button"
              className={lang === "en" ? "on" : ""}
              onClick={() => setLang("en")}
            >
              {t.langEn}
            </button>
            <button
              type="button"
              className={lang === "id" ? "on" : ""}
              onClick={() => setLang("id")}
            >
              {t.langId}
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sheet">
          <p className="kicker">{t.ledger}</p>
          <div className="stats">
            <div>
              <b className="tabular-nums">{chains.length}</b>
              <span>{t.chains}</span>
            </div>
            <div>
              <b className="tabular-nums">{store.mills.length}</b>
              <span>{t.mills}</span>
            </div>
            <div>
              <b className="tabular-nums">
                {new Set(store.mills.map((m) => m.refinery).filter(Boolean)).size}
              </b>
              <span>{t.refineries}</span>
            </div>
          </div>

          {store.mills.length === 0 ? (
            <div className="empty-copy">
              <h1>{t.emptyTitle}</h1>
              <p>{role === "admin" ? t.emptyBody : t.emptyBodyClient}</p>
            </div>
          ) : (
            <NavTree
              chains={chains}
              selectedChain={store.selectedChain}
              selectedRefinery={selectedRefinery}
              onSelect={selectScope}
              portfolioLabel={t.portfolio}
              supplyChainListLabel={t.supplyChainList}
              groupPlaceholderLabel={t.selectGroup}
              refineryPlaceholderLabel={t.selectRefinery}
              villageLabel={t.village}
              bufferLabel={t.buffer}
            />
          )}

          {selectedMill ? (
            <div className="sidebar-mill-summary">
              <button
                type="button"
                className="sidebar-mill-summary-header"
                aria-expanded={millSummaryOpen}
                onClick={() => setMillSummaryOpen((v) => !v)}
              >
                <span className="truncate">
                  {t.millSummaryTitle} — {selectedMill.millName}
                </span>
                <span
                  className={`nav-tree-chevron ${millSummaryOpen ? "open" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {millSummaryOpen ? (
                <div className="sidebar-mill-summary-body">
                  <EudrSummaryView
                    umlIds={selectedMill.umlId ? [selectedMill.umlId] : []}
                    emptyLabel={t.millSummaryEmpty}
                    loadingLabel={t.eudrLoading}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className={`stage ${chain && viewTab === "data" ? "" : "single-pane"}`}>
          <div className="stage-main">
            {store.mills.length > 0 && !chain ? (
              <PortfolioView
                chains={chains}
                onSelectChain={(id) => selectScope(id, null)}
                labels={{
                  groups: t.chains,
                  refineries: t.refineries,
                  mills: t.mills,
                  village: t.village,
                  buffer: t.buffer,
                }}
              />
            ) : (
              <>
                {chain ? (
                  <div className="stage-topbar">
                    <div className="breadcrumb">
                      <button type="button" onClick={() => selectScope(null, null)}>
                        {t.portfolio}
                      </button>
                      <span className="breadcrumb-sep">›</span>
                      {selectedRefinery ? (
                        <>
                          <button type="button" onClick={() => selectScope(chain.id, null)}>
                            {chain.name}
                          </button>
                          <span className="breadcrumb-sep">›</span>
                          <span className="breadcrumb-current">{selectedRefinery}</span>
                        </>
                      ) : (
                        <span className="breadcrumb-current">{chain.name}</span>
                      )}
                    </div>
                    <div className="view-tabs">
                      <button
                        type="button"
                        className={viewTab === "summary" ? "on" : ""}
                        onClick={() => setViewTab("summary")}
                      >
                        {t.summaryTab}
                      </button>
                      <button
                        type="button"
                        className={viewTab === "data" ? "on" : ""}
                        onClick={() => setViewTab("data")}
                      >
                        {t.dataTab}
                      </button>
                    </div>
                  </div>
                ) : null}
                {chain && viewTab === "summary" ? (
                  <EudrSummaryView
                    umlIds={mills.map((m) => m.umlId).filter(Boolean)}
                    emptyLabel={t.eudrEmpty}
                    loadingLabel={t.eudrLoading}
                  />
                ) : (
                  <div className="stage-map">
                    <ChainMap
                      millGeom={viewMillGeom}
                      areas={viewAreas}
                      plots={viewPlots}
                      forest={forestCover}
                      selectedMillId={selectedMillId}
                      onSelectMill={setSelectedMillId}
                      focusPlot={focusPlot}
                      labels={{
                        empty: t.mapEmpty,
                        legendVillage: t.legendVillage,
                        legendBuffer: t.legendBuffer,
                        legendPlots: t.legendPlots,
                        legendMills: t.legendMills,
                        legendAreas: t.legendAreas,
                        legendForest: t.legendForest,
                        millsByRefinery: t.millsByRefinery,
                        colorBy: t.colorBy,
                        traceability: t.trace,
                        compliance: t.eudrComplyKpi,
                        risk: t.riskLabel,
                        mitigation: t.mitigationLabel,
                        type: t.typeLabel,
                        layersTitle: t.layersTitle,
                        basemap: t.basemap,
                        comply: t.comply,
                        nonComply: t.nonComply,
                        nonComplyReason: t.nonComplyReason,
                        riskLow: t.riskLow,
                        riskMedium: t.riskMedium,
                        riskHigh: t.riskHigh,
                        uml: t.uml,
                        hectare: t.popupHectare,
                        findTitle: t.findTitle,
                        searchPlotPlaceholder: t.searchPlotPlaceholder,
                        searchPlotEmpty: t.searchPlotEmpty,
                        noMatches: t.noMatches,
                        plotId: t.plotId,
                        company: t.company,
                        goToCoordinate: t.goToCoordinate,
                        coordinatePlaceholder: t.coordinatePlaceholder,
                        go: t.go,
                        coordinateInvalid: t.coordinateInvalid,
                        noPlotAtCoordinate: t.noPlotAtCoordinate,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {chain && viewTab === "data" ? (
            <div className="dock">
              <div className="dock-handle">
                <button
                  type="button"
                  className="dock-handle-toggle"
                  aria-expanded={dockOpen}
                  onClick={() => setDockOpen((v) => !v)}
                >
                  <span
                    className={`nav-tree-chevron ${dockOpen ? "open" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {selectedMillId && selectedMill
                      ? `${selectedMill.millName} — ${matchingPlotRows.length.toLocaleString("id-ID")} ${t.plotsLabel}`
                      : `${mills.length} ${t.nMills}`}
                  </span>
                </button>
                {selectedMillId ? (
                  <button
                    type="button"
                    className="dock-back"
                    onClick={() => setSelectedMillId(null)}
                  >
                    ← {t.backToMills}
                  </button>
                ) : null}
              </div>
              {dockOpen ? (
                selectedMillId && selectedMill ? (
                  <>
                    <div className="table-tools">
                      <input
                        className="search"
                        type="search"
                        value={plotQuery}
                        onChange={(e) => setPlotQuery(e.target.value)}
                        placeholder={t.searchPlotPlaceholder}
                        aria-label={t.searchPlotPlaceholder}
                      />
                      {serverPlotsLoading ? <p className="notice">{t.loadingPlots}</p> : null}
                    </div>
                    <div className="table-wrap">
                      {matchingPlotRows.length === 0 ? (
                        <p className="table-empty">{t.noPlots}</p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>{t.plotId}</th>
                              <th>{t.company}</th>
                              <th>{t.popupHectare}</th>
                              <th>{t.eudrComplyKpi}</th>
                              <th>{t.riskLabel}</th>
                              <th>{t.mitigationLabel}</th>
                              <th>{t.typeLabel}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {matchingPlotRows.slice(0, MAX_PLOT_ROWS).map(({ f, index }) => {
                              const plotId = String(f.properties?.PlotID ?? "");
                              const comply = f.properties?._comply;
                              const risk = f.properties?._risk;
                              const mitigation = String(f.properties?._mitigation ?? "");
                              const hectarage = Number(f.properties?.HECTARAGE ?? 0);
                              return (
                                <tr
                                  key={index}
                                  className={focusPlot?.index === index ? "on" : ""}
                                  onClick={() => setFocusPlot({ index, nonce: Date.now() })}
                                >
                                  <td className="mono">{plotId || "—"}</td>
                                  <td
                                    className="truncate"
                                    title={String(f.properties?.COMPANY ?? "")}
                                  >
                                    {String(f.properties?.COMPANY ?? "").trim() || "—"}
                                  </td>
                                  <td className="tabular-nums">
                                    {hectarage
                                      ? `${hectarage.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ha`
                                      : "—"}
                                  </td>
                                  <td>
                                    <span
                                      className={`chip ${comply === "yes" ? "ok" : comply === "no" ? "bad" : ""}`}
                                    >
                                      {comply === "yes"
                                        ? t.comply
                                        : comply === "no"
                                          ? t.nonComply
                                          : "—"}
                                    </span>
                                  </td>
                                  <td>
                                    <span
                                      className={`chip ${
                                        risk === "low"
                                          ? "ok"
                                          : risk === "medium"
                                            ? "warn"
                                            : risk === "high"
                                              ? "bad"
                                              : ""
                                      }`}
                                    >
                                      {risk === "low"
                                        ? t.riskLow
                                        : risk === "medium"
                                          ? t.riskMedium
                                          : risk === "high"
                                            ? t.riskHigh
                                            : "—"}
                                    </span>
                                  </td>
                                  <td title={MITIGATION_DESCRIPTIONS[mitigation] ?? ""}>
                                    {mitigation || "—"}
                                  </td>
                                  <td className="truncate" title={String(f.properties?.TYPE ?? "")}>
                                    {String(f.properties?.TYPE ?? "") || "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {matchingPlotRows.length > MAX_PLOT_ROWS ? (
                        <p className="table-empty">
                          {t.plotsTruncated
                            .replace("{shown}", MAX_PLOT_ROWS.toLocaleString("id-ID"))
                            .replace("{total}", matchingPlotRows.length.toLocaleString("id-ID"))}
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dock-head">
                      <div>
                        {serverPlotsLoading ? <p className="notice">{t.loadingPlots}</p> : null}
                      </div>
                      <div className="dock-filters">
                        <div className="seg" role="group" aria-label={t.viewMode}>
                          {(["all", "village", "buffer"] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={traceFilter === k ? "on" : ""}
                              onClick={() => setTraceFilter(k)}
                            >
                              {k === "all" ? t.all : k === "village" ? t.village : t.buffer}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="table-tools">
                      <input
                        className="search"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t.searchMills}
                        aria-label={t.searchMills}
                      />
                    </div>
                    <div className="table-wrap">
                      {mills.length === 0 ? (
                        <p className="table-empty">{t.noMatch}</p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>{t.millTable}</th>
                              <th>{t.refinery}</th>
                              <th>{t.uml}</th>
                              <th>{t.trace}</th>
                              <th>{t.port}</th>
                              <th>{t.groupName}</th>
                              <th>{t.parentCompany}</th>
                              <th>{t.download}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mills.map((m) => (
                              <tr
                                key={m.id}
                                className={m.id === selectedMillId ? "on" : ""}
                                onClick={() =>
                                  setSelectedMillId((id) => (id === m.id ? null : m.id))
                                }
                              >
                                <td className="truncate" title={m.millName}>
                                  <b>{m.millName}</b>
                                </td>
                                <td className="truncate" title={m.refinery}>
                                  {m.refinery || "—"}
                                </td>
                                <td className="mono">{m.umlId || "—"}</td>
                                <td>
                                  <span
                                    className={`chip ${
                                      m.traceability === "village"
                                        ? "ok"
                                        : m.traceability === "buffer"
                                          ? "warn"
                                          : ""
                                    }`}
                                  >
                                    {
                                      // Show the source text as-is (e.g. "Buffer 10KM", or a
                                      // combined "Village Level+Buffer 10KM") rather than a
                                      // generic label — a fixed "Village"/"Buffer" would
                                      // silently hide the actual radius or a mixed value.
                                      m.traceabilityRaw ||
                                        (m.traceability === "village"
                                          ? t.village
                                          : m.traceability === "buffer"
                                            ? t.buffer
                                            : "—")
                                    }
                                  </span>
                                </td>
                                <td>{m.port || "—"}</td>
                                <td className="truncate" title={m.groupName}>
                                  {m.groupName || "—"}
                                </td>
                                <td className="truncate" title={m.parentCompany}>
                                  {m.parentCompany || "—"}
                                </td>
                                <td className="row-download">
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title={`${t.download} CSV`}
                                    aria-label={`${t.download} CSV`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      downloadMillsCsv(`kanopi-${m.id}-mill.csv`, [m]);
                                    }}
                                  >
                                    <CsvIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title={`${t.download} GeoJSON`}
                                    aria-label={`${t.download} GeoJSON`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void downloadMillGeojson(m);
                                    }}
                                  >
                                    <GeoJsonIcon />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
