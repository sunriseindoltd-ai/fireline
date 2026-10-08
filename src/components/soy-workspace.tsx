import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BrandMark } from "@/components/brand-mark";
import { DataAssistant } from "@/components/data-assistant";
import { SoyReport } from "@/components/soy-report";
import type { SoyNational } from "@/components/soy-national";
import { soyReportCopy } from "@/lib/soy-report-copy";
import { PRODUCTS } from "@/lib/brand";
import { KpiTile } from "@/components/kpi-tile";
import { LangToggle } from "@/components/lang-toggle";
import {
  SoyMap,
  type SoyBuffers,
  type SoyElevator,
  type SoyFieldCollection,
  type SoyFlagged,
  type SoyPlant,
} from "@/components/soy-map";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { fill, formatCount, formatHa, formatLarge } from "@/lib/format";
import type { GateRole } from "@/lib/gate";
import { gateLogout, gateSwitchTenant } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";
import { SOY_GROUPS, SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyCopy } from "@/lib/soy-copy";
import { SoyDocsView, SoySupplyView } from "@/components/soy-supply";
import { scopeSummary } from "@/components/soy-side";
import { SoyMapView } from "@/components/soy-mapview";
import { SoyTour, markTourDone, tourPending } from "@/components/soy-tour";
import { idsFromScope, plantById, scopeForSel, type PlantBuffer, type SupplyData } from "@/lib/soy-supply";
import { soySupplyCopy } from "@/lib/soy-supply-copy";
import { usePersistentState } from "@/lib/use-persistent";
import { TENANTS, type Tenant } from "@/lib/tenants";

type SoyStats = {
  fields: number;
  ha: number;
  acres: number;
  fieldHa: { p10: number | null; median: number | null; p90: number | null; max: number | null };
  sizeBinsHa: { bounds: number[]; fields: number[] };
  cropHistoryHa: ({ year: number } & Record<(typeof SOY_GROUPS)[number], number>)[];
  soyYears: { years: number; fields: number }[];
  states: { state: string; name: string; fields: number; ha: number }[];
  topCounties: { county: string; state: string; fields: number; ha: number }[];
};
type SoyArea = {
  id: string;
  name: string;
  plants: string[];
  stats: SoyStats;
  flagged: number;
  elevators: number;
};
type SoyData = {
  source: string;
  bufferMiles: number;
  plants: SoyPlant[];
  areas: SoyArea[];
  overall: SoyStats;
  buffers: SoyBuffers;
  elevators: SoyElevator[];
  flagged: SoyFlagged[];
  cdlNames: Record<string, string>;
};

type FieldsState = {
  status: "idle" | "loading" | "error" | "ready";
  fc: SoyFieldCollection | null;
};

type SoyTab = "summary" | "map" | "corridor" | "docs" | "areas";
const TABS: SoyTab[] = ["summary", "map", "corridor", "docs", "areas"];
// Feedback 5 (P2-3): the earlier delivery (40-mile areas) is no tab of its own — it opens from Data & method.
const NAV_TABS: SoyTab[] = ["summary", "map", "corridor", "docs"];

/**
 * The ADM Soy workspace (tenant `adm-soy`), built like PalmTrace's: a header
 * with tabs, presentation mode and one catchment selection shared by every
 * tab (the Quincy supply chain from the client's ADM_SOY.gdb):
 *  - Summary: figures for the selected catchment, true-scale comparison,
 *    non-compliant fields, elevators, crop history (soy-supply.tsx);
 *  - Map & data: map + catchment list/detail, field table, field card and
 *    downloads — only the selected catchment's fields (soy-mapview.tsx);
 *  - Rail & river: soybean area near rail and the major river systems;
 *  - Data & method: sources and definitions;
 *  - 40-mile areas: the earlier view — ADM's crushing plants, their 40-mile
 *    sourcing areas and the 2025 soybean fields inside.
 * Data: /data/supply.json and /data/soy.json (bundled), fields and layers
 * from the soy R2 bucket (scripts/prepare-adm-soy-supply.py and
 * prepare-adm-soy.py).
 */
/** Crushing plants besides Quincy that ADM named for SoyTrace (feedback 6 Oct): Decatur West, Lincoln, Des Moines.
 * Shown as plain points only while supply.json has no catchments for them (all four since 7 Oct). */
const OTHER_PLANTS = ["decatur-west", "lincoln", "des-moines"];

export function SoyWorkspace({ role, tenant }: { role: GateRole; tenant: Tenant }) {
  const { t, lang } = useI18n();
  const sc = soyCopy[lang];
  const ssc = soySupplyCopy[lang];
  const [tabStored, setTab] = usePersistentState<SoyTab>("soytrace.tab", "summary");
  const tab: SoyTab = TABS.includes(tabStored) ? tabStored : "summary";
  const [scopeStored, setScope] = usePersistentState<string>("soytrace.scope2", "all");
  const canPresent = role === "admin" || role === "client";
  const [presentStored, setPresent] = usePersistentState("soytrace.present", false);
  const present = canPresent && presentStored;
  const [supply, setSupply] = useState<SupplyData | null>(null);
  const [supplyError, setSupplyError] = useState(false);
  const [national, setNational] = useState<SoyNational | null>(null);
  const supplyCatchments = useMemo(() => (supply ? new Map(supply.catchments.map((k) => [k.id, k])) : null), [supply]);
  // A scope remembered from an earlier data version may no longer exist.
  const scope = !supplyCatchments || supplyCatchments.has(scopeStored) || scopeStored.startsWith("combo:") ? scopeStored : "all";
  // The Summary's sidebar selection (ticked catchment ids, none = the whole chain). The map's scope
  // is derived from it; when the map changes the scope on its own, the ticks follow the scope.
  // "…2": the 7 Oct data renumbered the elevators, so selections stored before it are dropped.
  const [selStored, setSelStored] = usePersistentState<string[]>("soytrace.sel2", []);
  const [plantSel, setPlantSel] = usePersistentState<string>("soytrace.plant", "");
  // One buffer for the crushing plants, 0–40 or 0–80 NM (one row per plant everywhere, not one per ring).
  const [bufferStored, setBuffer] = usePersistentState<PlantBuffer>("soytrace.buffer", "80");
  const buffer: PlantBuffer = bufferStored === "40" ? "40" : "80";
  // Feedback 5 (P0-2): the map shows only "to review" fields when the Summary card asks for it.
  const [ncReview, setNcReview] = useState(false);
  const sel = useMemo(() => {
    if (!supply) return [];
    return scopeForSel(selStored, supply) === scope ? selStored : idsFromScope(scope, supply);
  }, [selStored, scope, supply]);
  const setSel = (ids: string[]) => {
    setSelStored(ids);
    if (supply) setScope(scopeForSel(ids, supply));
  };
  // Picking a plant ticks its catchment at the current buffer; "all plants" clears the ticks.
  const choosePlant = (id: string) => {
    setPlantSel(id);
    const p = id && supply ? plantById(supply, id) : undefined;
    setSel(p ? [`${p.key}${buffer}`] : []);
  };
  const navigate = useNavigate();
  const [data, setData] = useState<SoyData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldsState>({ status: "idle", fc: null });
  const cache = useRef(new Map<string, SoyFieldCollection>());
  const reqId = useRef(0);

  useEffect(() => {
    void fetchWithRetry("/data/soy.json")
      .then((res) =>
        res.ok ? (res.json() as Promise<SoyData>) : Promise.reject(new Error(String(res.status))),
      )
      .then(setData)
      .catch(() => setLoadError(true));
    void fetchWithRetry("/data/supply.json")
      .then((res) =>
        res.ok ? (res.json() as Promise<SupplyData>) : Promise.reject(new Error(String(res.status))),
      )
      .then(setSupply)
      .catch(() => setSupplyError(true));
    // All US soybean fields: a context block on the Summary tab, optional.
    void fetchWithRetry("/data/national.json")
      .then((res) => (res.ok ? (res.json() as Promise<SoyNational>) : null))
      .then(setNational)
      .catch(() => setNational(null));
  }, []);

  // The reading guide: once per sign-in (login clears the flag), on the map tab.
  const [tourOpen, setTourOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const tourChecked = useRef(false);
  useEffect(() => {
    if (tourChecked.current || !supply || !data) return;
    tourChecked.current = true;
    if (present || !tourPending()) return;
    setTab("summary");
    setTourOpen(true);
  }, [supply, data, present, setTab]);

  const loadFields = useCallback((plant: string | null) => {
    const id = ++reqId.current;
    if (!plant) return setFields({ status: "idle", fc: null });
    const hit = cache.current.get(plant);
    if (hit) return setFields({ status: "ready", fc: hit });
    setFields({ status: "loading", fc: null });
    void fetchWithRetry(`/data/fields/${encodeURIComponent(plant)}.geojson`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<SoyFieldCollection>)
          : Promise.reject(new Error(String(res.status))),
      )
      .then((fc) => {
        cache.current.set(plant, fc);
        if (reqId.current === id) setFields({ status: "ready", fc });
      })
      .catch(() => {
        if (reqId.current === id) setFields({ status: "error", fc: null });
      });
  }, []);

  function select(plant: string | null) {
    setSelected(plant);
    loadFields(plant);
  }

  async function logout() {
    await gateLogout();
    await navigate({ to: "/login" });
  }
  async function switchTenant(next: Tenant) {
    const res = await gateSwitchTenant({ data: { tenant: next } });
    if (res.ok) window.location.assign("/app/portfolio");
  }

  const tabLabel: Record<SoyTab, string> = {
    summary: ssc.tabSummary,
    map: ssc.tabMap,
    corridor: ssc.tabCorridor,
    docs: ssc.tabDocs,
    areas: ssc.tabAreas,
  };
  // The client's other crushing plants (soy.json), shown on the supply map until their catchments arrive.
  const otherPlants = useMemo(
    () =>
      (data?.plants ?? [])
        .filter((p) => OTHER_PLANTS.includes(p.id) && !supply?.plants?.some((x) => x.id === p.id))
        .map((p) => ({ id: p.id, name: `ADM ${p.name}`, address: p.address ?? null, lat: p.lat, lon: p.lon })),
    [data, supply],
  );
  // The printable report (soy-report.tsx) for the selected catchment; a portal, so it can live with the header.
  const canReport = role !== "auditor" && !!supply && !present;
  const report =
    reportOpen && supply ? (
      <SoyReport data={supply} scope={scope} lang={lang} c={ssc} sc={sc} onClose={() => setReportOpen(false)} />
    ) : null;
  const header = (
    <>
    {report}
    <header className="app-header">
      <span className="app-brand">
        <BrandMark size={22} product="soy" />
        <span className="word">{PRODUCTS.soy.name}</span>
      </span>
      <span className="app-sep" aria-hidden="true">
        /
      </span>
      <span className="soy-scope">{ssc.scopeHeader}</span>
      <nav className="app-tabs" aria-label={ssc.scopeHeader}>
        {NAV_TABS.map((k) => (
          <button
            key={k}
            type="button"
            className={tab === k || (k === "docs" && tab === "areas") ? "on" : ""}
            aria-current={tab === k ? "page" : undefined}
            onClick={() => setTab(k)}
          >
            {tabLabel[k]}
          </button>
        ))}
      </nav>
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
        {canReport ? (
          <button type="button" className="present-btn" title={soyReportCopy[lang].openHint} onClick={() => setReportOpen(true)}>
            {soyReportCopy[lang].open}
          </button>
        ) : null}
        {canPresent ? (
          <button
            type="button"
            className={`present-btn ${present ? "on" : ""}`}
            aria-pressed={present}
            onClick={() => setPresent(!presentStored)}
          >
            <span className="dot" aria-hidden="true" />
            {present ? t.presentOn : t.present}
          </button>
        ) : null}
        {present ? null : (
          <button
            type="button"
            className="tour-help"
            aria-label={ssc.tourReplay}
            title={ssc.tourReplay}
            onClick={() => setTourOpen(true)}
          >
            ?
          </button>
        )}
        {present ? null : <LangToggle />}
        <button type="button" className="btn-text" onClick={() => void logout()}>
          {t.signOut}
        </button>
      </div>
    </header>
    </>
  );
  const appClass = `app ${present ? "presenting" : ""}`;
  const tour = tourOpen ? (
    <SoyTour
      steps={ssc.tourSteps}
      labels={{ next: ssc.tourNext, back: ssc.tourBack, skip: ssc.tourSkip, done: ssc.tourDone, stepOf: ssc.tourStepOf }}
      onClose={() => {
        markTourDone();
        setTourOpen(false);
      }}
      onStep={(st) => {
        if (st.tab === "map" || st.tab === "summary") setTab(st.tab);
      }}
    />
  ) : null;

  if (tab !== "areas") {
    const ready = supply && data;
    return (
      <div className={appClass} data-product="soy">
        {header}
        {tour}
        <main className="app-main">
          {!ready ? (
            <div className="boot">
              <BrandMark size={32} product="soy" />
              <span>{supplyError || loadError ? ssc.loadError : t.loading}</span>
            </div>
          ) : tab === "map" || tab === "corridor" ? (
            <SoyMapView
              key={tab}
              mode={tab === "corridor" ? "corridor" : "supply"}
              data={supply}
              cdlNames={data.cdlNames}
              catchments={supplyCatchments!}
              c={ssc}
              lang={lang}
              scope={scope}
              setScope={setScope}
              canDownload={role !== "auditor"}
              showOwners={!present}
              otherPlants={otherPlants}
              buffer={buffer}
              setBuffer={setBuffer}
              ncReview={ncReview}
              setNcReview={setNcReview}
              sel={sel}
              setSel={setSel}
            />
          ) : (
            <div className={`page soy-page ${tab === "summary" ? "soy-page-wide" : ""}`}>
              {tab === "summary" ? (
                <SoySupplyView
                  data={supply}
                  cdlNames={data.cdlNames}
                  c={ssc}
                  sc={sc}
                  lang={lang}
                  scope={scope}
                  setScope={setScope}
                  present={present}
                  onOpenMap={() => setTab("map")}
                  national={national}
                  otherPlants={otherPlants}
                  sel={sel}
                  setSel={setSel}
                  plantSel={plantSel}
                  setPlantSel={choosePlant}
                  buffer={buffer}
                  setBuffer={setBuffer}
                  canDownload={role !== "auditor" && role !== "viewer"}
                  onOpenReview={() => {
                    setNcReview(true);
                    setTab("map");
                  }}
                />
              ) : (
                <SoyDocsView data={supply} c={ssc} lang={lang} present={present} onOpenArchive={() => setTab("areas")} />
              )}
            </div>
          )}
        </main>
        {ready && !present ? (
          <DataAssistant
            lang={lang}
            product="soy"
            scope={scope}
            scopeLabel={scopeSummary(sel, supply, ssc, lang)}
            onOpenRow={(id) => {
              setScope(id);
              setTab("map");
            }}
          />
        ) : null}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app" data-product="soy">
        {header}
        <main className="app-main">
          <div className="boot">
            <BrandMark size={32} product="soy" />
            <span>{loadError ? sc.loadError : t.loading}</span>
          </div>
        </main>
      </div>
    );
  }

  const area = selected ? (data.areas.find((a) => a.id === selected) ?? null) : null;
  const stats = area ? area.stats : data.overall;
  const areaPlants = area ? data.plants.filter((p) => p.area === area.id) : data.plants;
  const flaggedHere = area ? data.flagged.filter((f) => f.area === area.id) : data.flagged;
  const elevatorsHere = area ? data.elevators.filter((e) => e.area === area.id) : data.elevators;
  const byState = new Map<string, number>();
  for (const f of flaggedHere) byState.set(f.state ?? "—", (byState.get(f.state ?? "—") ?? 0) + 1);
  const flaggedByState = [...byState].sort((a, b) => b[1] - a[1]);
  const countF = (n: number) => formatCount(n, lang);
  const haF = (n: number) => formatHa(n, lang);
  const statesText = stats.states.map((s) => s.state).join(" · ");
  const bins = stats.sizeBinsHa;
  const sizeData = bins.fields.map((n, i) => ({
    label:
      i === 0
        ? `<${bins.bounds[0]}`
        : i === bins.bounds.length
          ? `≥${bins.bounds[i - 1]}`
          : `${bins.bounds[i - 1]}–${bins.bounds[i]}`,
    fields: n,
  }));

  return (
    <div className={appClass} data-product="soy">
      {header}
      <main className="app-main">
        <div className="page soy-page">
          <div className="summary-head">
            <div>
              <h1>{area ? area.name : sc.title}</h1>
              <p className="summary-sub">
                {area
                  ? areaPlants
                      .map((p) => (areaPlants.length > 1 ? p.name + ": " + p.address : p.address))
                      .join(" · ")
                  : fill(sc.intro, { miles: data.bufferMiles })}
              </p>
            </div>
          </div>

          {/* Feedback 4 (B1): an earlier delivery — say so on the tab itself, not only under Data & method. */}
          <div className="eudr-notice warn soy-old-banner" role="note">
            <p>
              <b>{sc.oldBannerTitle}</b> {sc.oldBannerBody}
            </p>
            <button type="button" className="btn-secondary" onClick={() => setTab("docs")}>
              {sc.oldBannerCta}
            </button>
          </div>

          <div className="soy-plant-seg seg" role="tablist" aria-label={sc.plantsLabel}>
            <button
              type="button"
              role="tab"
              aria-selected={!selected}
              className={!selected ? "on" : ""}
              onClick={() => select(null)}
            >
              {sc.allPlants}
            </button>
            {data.areas.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={selected === a.id}
                className={selected === a.id ? "on" : ""}
                onClick={() => select(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="kpi-row">
            <KpiTile value={countF(areaPlants.length)} label={sc.plantsKpi} hint={sc.plantsHint} />
            <KpiTile value={countF(stats.fields)} label={sc.fieldsKpi} hint={sc.fieldsHint} />
            <KpiTile
              value={haF(stats.ha)}
              label={sc.areaKpi}
              hint={sc.areaHint}
              sub={fill(sc.acres, { n: formatLarge(stats.acres, lang) })}
            />
            <KpiTile
              value={stats.fieldHa.median == null ? "—" : haF(stats.fieldHa.median)}
              label={sc.medianKpi}
              hint={sc.medianHint}
            />
            <KpiTile value={statesText || "—"} label={sc.statesKpi} hint={sc.statesHint} />
          </div>

          <section className="chart-card soy-map-card">
            <SoyMap
              plants={data.plants}
              buffers={data.buffers}
              elevators={data.elevators}
              flagged={data.flagged}
              selected={selected}
              fields={fields.fc}
              cdlNames={data.cdlNames}
              sc={sc}
              lang={lang}
              onSelectArea={(id) => select(id)}
            />
            {!selected ? <p className="soy-map-status">{sc.mapPickPlant}</p> : null}
            {fields.status === "loading" ? (
              <p className="soy-map-status">
                <span className="spinner" aria-hidden="true" />{" "}
                {fill(sc.mapLoading, { n: countF(stats.fields) })}
              </p>
            ) : null}
            {fields.status === "error" ? (
              <p className="soy-map-status error">
                {sc.mapError}{" "}
                <button type="button" className="btn-text" onClick={() => loadFields(selected)}>
                  {sc.retry}
                </button>
              </p>
            ) : null}
          </section>

          <div className="chart-grid soy-charts">
            <div className="chart-card">
              <h3>{sc.cropHistoryTitle}</h3>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={stats.cropHistoryHa} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={88}
                    tickFormatter={(v: number) => formatLarge(v, lang)}
                  />
                  <Tooltip
                    formatter={(v: number, k: string) => [
                      haF(v),
                      sc.groups[k as keyof typeof sc.groups] ?? k,
                    ]}
                  />
                  {SOY_GROUPS.map((g) => (
                    <Bar
                      key={g}
                      dataKey={g}
                      stackId="a"
                      fill={SOY_GROUP_COLORS[g]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <ul className="chart-legend">
                {SOY_GROUPS.map((g) => (
                  <li key={g}>
                    <i style={{ background: SOY_GROUP_COLORS[g] }} />
                    {sc.groups[g]}
                  </li>
                ))}
              </ul>
              <p className="chart-note">{sc.cropHistoryNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.soyYearsTitle}</h3>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={stats.soyYears} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis
                    dataKey="years"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(v: number) => fill(sc.yearsN, { n: v })}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={56}
                    tickFormatter={(v: number) => countF(v)}
                  />
                  <Tooltip
                    formatter={(v: number) => [countF(v), sc.colFields]}
                    labelFormatter={(v: number) => fill(sc.yearsN, { n: v })}
                  />
                  <Bar dataKey="fields" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {stats.soyYears.map((d) => (
                      <Cell
                        key={d.years}
                        fill={SOY_YEARS_COLORS[Math.min(7, Math.max(0, d.years - 1))]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="chart-note">{sc.soyYearsNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.sizeTitle}</h3>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={sizeData} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={56}
                    tickFormatter={(v: number) => countF(v)}
                  />
                  <Tooltip
                    formatter={(v: number) => [countF(v), sc.colFields]}
                    labelFormatter={(v: string) => `${v} ha`}
                  />
                  <Bar
                    dataKey="fields"
                    fill="#58a06e"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
              <p className="chart-note">{sc.sizeNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.countiesTitle}</h3>
              <table className="data-table soy-table">
                <thead>
                  <tr>
                    <th>{sc.colCounty}</th>
                    <th className="num">{sc.colFields}</th>
                    <th className="num">{sc.colArea}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topCounties.map((c) => (
                    <tr key={`${c.county}-${c.state}`}>
                      <td>
                        {c.county}, {c.state}
                      </td>
                      <td className="num tabular-nums">{countF(c.fields)}</td>
                      <td className="num tabular-nums">{haF(c.ha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.states.length > 1 ? (
                <>
                  <h3 className="soy-subhead">{sc.statesTitle}</h3>
                  <table className="data-table soy-table">
                    <tbody>
                      {stats.states.map((s) => (
                        <tr key={s.state}>
                          <td>{s.name}</td>
                          <td className="num tabular-nums">{countF(s.fields)}</td>
                          <td className="num tabular-nums">{haF(s.ha)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          </div>

          <div className="chart-grid soy-charts">
            <section className="chart-card">
              <h3>{sc.flaggedTitle}</h3>
              {flaggedHere.length ? (
                <>
                  <div className="kpi-row compact soy-mini-kpis">
                    <KpiTile value={countF(flaggedHere.length)} label={sc.flaggedKpi} />
                  </div>
                  <table className="data-table soy-table">
                    <tbody>
                      {flaggedByState.map(([st, n]) => (
                        <tr key={st}>
                          <td>{st}</td>
                          <td className="num tabular-nums">{countF(n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="chart-note">{sc.none}</p>
              )}
              <p className="chart-note">
                {fill(sc.flaggedNote, {
                  inside: countF(data.flagged.filter((f) => f.area).length),
                  n: countF(data.flagged.length),
                })}
              </p>
            </section>

            <section className="chart-card">
              <h3>{sc.elevatorsTitle}</h3>
              {elevatorsHere.length ? (
                <div className="soy-table-wrap">
                  <table className="data-table soy-table">
                    <thead>
                      <tr>
                        <th>{sc.colName}</th>
                        <th>{sc.colCity}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elevatorsHere.map((e, i) => (
                        <tr key={(e.name ?? "") + i}>
                          <td>
                            {e.name ?? "—"}
                            {e.locationMismatch ? (
                              <span className="soy-flag">{sc.checkCoords}</span>
                            ) : null}
                          </td>
                          <td>{[e.city, e.state].filter(Boolean).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="chart-note">{sc.none}</p>
              )}
              <p className="chart-note">
                <b>{sc.elevatorsRaw}</b>{" "}
                {fill(sc.elevatorsNote, {
                  bad: countF(data.elevators.filter((e) => e.locationMismatch).length),
                  n: countF(data.elevators.length),
                })}
              </p>
            </section>
          </div>

          {!area ? (
            <section className="chart-card soy-compare">
              <h3>{sc.compareTitle}</h3>
              <div className="soy-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{sc.colPlant}</th>
                      <th>{sc.colPlants}</th>
                      <th>{sc.colState}</th>
                      <th className="num">{sc.colFields}</th>
                      <th className="num">{sc.colArea}</th>
                      <th className="num">{sc.colMedian}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.areas.map((p) => (
                      <tr
                        key={p.id}
                        tabIndex={0}
                        onClick={() => select(p.id)}
                        onKeyDown={(e) => e.key === "Enter" && select(p.id)}
                      >
                        <td>{p.name}</td>
                        <td>{countF(p.plants.length)}</td>
                        <td>{p.stats.states.map((s) => s.state).join(" · ")}</td>
                        <td className="num tabular-nums">{countF(p.stats.fields)}</td>
                        <td className="num tabular-nums">{haF(p.stats.ha)}</td>
                        <td className="num tabular-nums">
                          {p.stats.fieldHa.median == null ? "—" : haF(p.stats.fieldHa.median)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chart-note">{sc.overlapNote}</p>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
