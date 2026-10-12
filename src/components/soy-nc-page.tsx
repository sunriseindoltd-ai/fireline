import { useMemo, useState } from "react";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { catchmentLabel, topStates, useNcFeatures } from "@/components/soy-supply";
import type { SoyFeature } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount } from "@/lib/format";
import { downloadFieldsCsv, downloadFieldsGeo } from "@/lib/soy-downloads";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { NC_COLOR, NC_REVIEW, admSiteIds, inScope, pct, plantUnit, stateName, type Catchment, type PlantBuffer, type SupplyData, unitName } from "@/lib/soy-supply";

export type NcSet = "all" | "inside" | "outside" | "review";
export type NcFilter = { set: NcSet; scope: string; state: string };

const PAGE = 50;
const REVIEW = "cropped_pre_2021";
const BEFORE_COLORS: Record<string, string> = { treed: "#2f6f4e", natural: "#9a8f4a", crop: NC_REVIEW, unknown: "#b9b9bd" };

/**
 * ADM's non-compliant list as a review page (9 Oct 2026 layout, restyled 10
 * Oct after PalmTrace's group summary): figures as tiles that filter, three
 * chart cards on the "why", then the list with the same tools and table as
 * PalmTrace's plot table. The 268 inside the supply chain are what the rest
 * of the dashboard counts; the 805 outside are shown for completeness.
 */
export function SoyNcPage({ data, catchments, c, nav, lang, filter, setFilter, buffer, canDownload, onOpenOnMap }: {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  filter: NcFilter;
  setFilter: (f: NcFilter) => void;
  buffer: PlantBuffer;
  canDownload: boolean;
  /** Open the map on the field's catchment (its first one), or the whole chain. */
  onOpenOnMap: (scope: string, field: SoyFeature) => void;
}) {
  const nc = useNcFeatures(true);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const total = data.nonCompliantAll.fields;
  const insideN = catchments.get("all")?.nonCompliant.fields ?? 0;
  const reviewN = catchments.get("all")?.nonCompliant.byBefore.crop ?? 0;
  const kOf = (f: SoyFeature) => String(f.properties.k ?? "");
  const isReview = (f: SoyFeature) => f.properties.rf === REVIEW;
  const all = nc ?? [];
  const sets = useMemo(
    () => ({
      all,
      inside: all.filter((f) => kOf(f)),
      outside: all.filter((f) => !kOf(f)),
      review: all.filter((f) => kOf(f) && isReview(f)),
    }),
    [all],
  );
  const setAndReset = (f: NcFilter) => {
    setFilter(f);
    setPage(0);
  };
  // Scope choices: the plants at the current buffer, all ADM elevators, all third parties, and whatever
  // single catchment a facility page sent us (kept in the list while it is chosen).
  const scopeOpts = useMemo(() => {
    const out: [string, string][] = [["", nav.allCatchments]];
    for (const p of data.plants) out.push([`${p.key}${buffer}`, unitName(`${p.key}${buffer}`, data, c) ?? p.name]);
    out.push(["adm", c.scopeAdm], ["tp", c.scopeTp]);
    if (filter.scope && !out.some(([id]) => id === filter.scope)) out.push([filter.scope, catchmentLabel(filter.scope, data, c)]);
    return out;
  }, [data, c, nav, buffer, filter.scope]);
  const base = sets[filter.set];
  const rows = useMemo(() => {
    const scoped = filter.scope && filter.set !== "outside" ? base.filter((f) => inScope(filter.scope, { flags: Number(f.properties.f), k: kOf(f) })) : base;
    const byState = filter.state ? scoped.filter((f) => String(f.properties.s ?? "") === filter.state) : scoped;
    const q = query.trim().toLowerCase();
    const found = q ? byState.filter((f) => `${f.properties.id} ${f.properties.n ?? ""} ${f.properties.s ?? ""}`.toLowerCase().includes(q)) : byState;
    return [...found].sort((a, b) => Number(b.properties.a) - Number(a.properties.a));
  }, [base, filter, query]);
  const states = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of base) {
      const s = String(f.properties.s ?? "");
      if (s) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m].sort((a, b) => stateName(a[0]).localeCompare(stateName(b[0])));
  }, [base]);
  const byYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of rows) if (f.properties.y != null) m.set(Number(f.properties.y), (m.get(Number(f.properties.y)) ?? 0) + 1);
    return [...m].sort((a, b) => a[0] - b[0]).map(([year, fields]) => ({ year: String(year), fields }));
  }, [rows]);
  const beforeRows = useMemo(() => {
    const count = (key: string) => rows.filter((f) => String(f.properties.b ?? "unknown") === key).length;
    return (
      [
        ["treed", nav.beforeTreed],
        ["natural", nav.beforeNatural],
        ["crop", nav.beforeCrop],
        ["unknown", c.unknown],
      ] as const
    )
      .map(([key, label]) => ({ key, label, fields: count(key) }))
      .filter((r) => r.fields > 0);
  }, [rows, nav, c]);
  const stateRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of rows) {
      const s = String(f.properties.s ?? "—");
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return topStates([...m].map(([state, fields]) => ({ state, fields })), 8);
  }, [rows]);
  const beforeLabel = (f: SoyFeature) => (f.properties.b === "treed" ? c.ncBeforeTreed : f.properties.b === "natural" ? c.ncBeforeNatural : f.properties.b === "crop" ? c.ncBeforeCrop : c.unknown);
  // A field's catchments, read as "Quincy 0–80 NM · ADM Burlington"; the first two, the rest counted.
  const admSites = useMemo(() => new Set(admSiteIds(data)), [data]);
  const catchIds = (f: SoyFeature) => {
    const ids = new Set<string>();
    for (const x of kOf(f).split("|").filter(Boolean)) {
      const u = plantUnit(x);
      ids.add(u ? `${u.key}80` : x);
    }
    return [...ids];
  };
  const catchText = (f: SoyFeature) => catchIds(f).map((id) => catchmentLabel(id, data, c));
  const firstScope = (f: SoyFeature) => {
    const ids = kOf(f).split("|").filter(Boolean);
    const u = ids.map(plantUnit).find(Boolean);
    if (u) return `${u.key}80`;
    return ids.find((x) => admSites.has(x)) ?? ids.find((x) => /^tp\d+$/.test(x)) ?? "all";
  };
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageNow = Math.min(page, pages - 1);
  const dlRows = rows.map((f) => ({ f, nc: true }));
  const slug = ["noncompliant", filter.set, filter.scope, filter.state].filter(Boolean).join("-");
  const setLabel: Record<NcSet, string> = { all: nav.chipAll, inside: nav.chipInside, outside: nav.chipOutside, review: nav.chipReview };

  return (
    <div className="soy-nc-page">
      <div className="page-head">
        <p className="eyebrow">{nav.ncEyebrow}</p>
        <h1>{nav.ncTitle}</h1>
        <p>{fill(nav.ncSub, { total: countF(total), inside: countF(insideN) })}</p>
      </div>

      {/* The figures double as filters, like PalmTrace's "Non-compliant plots ›" tile. */}
      <div className="kpi-row soy-kpis4">
        <KpiTile value={countF(total)} label={nav.kpiOnList} hint={nav.kpiOnListHint} sub={fill(nav.kpiOnListSub, { n: countF(data.nonCompliantAll.byState.length) })} onClick={() => setAndReset({ ...filter, set: "all" })} action={nav.showList} />
        <KpiTile tone="danger" value={countF(insideN)} label={nav.kpiInside} hint={nav.kpiInsideHint} sub={formatAcres(catchments.get("all")?.nonCompliant.acres ?? 0, lang)} onClick={() => setAndReset({ ...filter, set: "inside" })} action={nav.showList} />
        <KpiTile value={countF(Math.max(0, total - insideN))} label={nav.kpiOutside} hint={nav.kpiOutsideHint} sub={nav.kpiOutsideSub} onClick={() => setAndReset({ ...filter, set: "outside", scope: "" })} action={nav.showList} />
        <KpiTile value={countF(reviewN)} label={nav.kpiReview} hint={c.kpiReviewHint} sub={nav.kpiReviewSub} onClick={() => setAndReset({ ...filter, set: "review" })} action={nav.showList} />
      </div>

      <div className="chart-grid soy-charts soy-nc-charts">
        <section className="chart-card">
          <h3>{nav.whyTitle}</h3>
          <p className="chart-note">{fill(nav.whyIntro, { n: countF(rows.length) })}</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byYear} margin={{ top: 18, left: 4, right: 4 }}>
              <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [countF(v), c.colFields]} />
              <Bar dataKey="fields" fill={NC_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="fields" position="top" fontSize={11} formatter={(v: number) => countF(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="chart-note">{c.ncByYearNote}</p>
        </section>
        <section className="chart-card">
          <h3>{nav.beforeTitle}</h3>
          <p className="chart-note">{nav.beforeIntro}</p>
          {/* Plain HTML bars: every label stays on one line whatever the bar's length. */}
          <ul className="soy-hbars">
            {beforeRows.map((r) => {
              const max = Math.max(...beforeRows.map((x) => x.fields), 1);
              return (
                <li key={r.key}>
                  <span className="soy-hbar-label">{r.label}</span>
                  <span className="soy-hbar-track">
                    <i style={{ width: `${Math.max(2, (r.fields / max) * 100)}%`, background: BEFORE_COLORS[r.key] ?? NC_COLOR }} />
                  </span>
                  <span className="soy-hbar-value tabular-nums">
                    {countF(r.fields)} · {formatSharePct(pct(r.fields, rows.length), lang)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="chart-note">{c.ncBeforeNote}</p>
        </section>
        <section className="chart-card">
          <h3>{nav.byStateTitle}</h3>
          <table className="data-table soy-table">
            <tbody>
              {stateRows.map((st) => (
                <tr key={st.state}>
                  <td>{st.state === "other" ? fill(c.otherStates, { n: countF(st.n) }) : stateName(st.state)}</td>
                  <td className="num tabular-nums">{countF(st.fields)}</td>
                  <td className="num tabular-nums">{formatSharePct(pct(st.fields, rows.length), lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="chart-card supply-wide soy-nc-list">
        <div className="soy-fac-head">
          <div>
            <h3>
              {nav.listTitle} · {setLabel[filter.set]} <span className="soy-nc-count tabular-nums">{countF(rows.length)}</span>
            </h3>
            <p className="chart-note">{nav.listHintNc}</p>
          </div>
          {canDownload ? (
            <div className="soy-fac-dl">
              <button type="button" className="btn-secondary" disabled={!dlRows.length} onClick={() => downloadFieldsCsv(dlRows, `soytrace-${slug}.csv`)}>
                CSV
              </button>
              <button type="button" className="btn-secondary" disabled={!dlRows.length} onClick={() => downloadFieldsGeo(dlRows, `soytrace-${slug}.geojson`)}>
                GeoJSON
              </button>
            </div>
          ) : null}
        </div>
        <div className="table-tools soy-nc-tools">
          <div className="seg" role="group" aria-label={nav.ncTitle}>
            {(["all", "inside", "outside", "review"] as const).map((s) => (
              <button key={s} type="button" className={filter.set === s ? "on" : ""} aria-pressed={filter.set === s} onClick={() => setAndReset({ ...filter, set: s, scope: s === "outside" ? "" : filter.scope })}>
                {setLabel[s]} <small className="tabular-nums">{countF(sets[s].length)}</small>
              </button>
            ))}
          </div>
          <label className="search-field">
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={nav.ncSearch} aria-label={nav.ncSearch} />
          </label>
          {filter.set !== "outside" ? (
            <select className="soy-select" aria-label={nav.colCatchments} value={filter.scope} onChange={(e) => setAndReset({ ...filter, scope: e.target.value })}>
              {scopeOpts.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
          <select className="soy-select" aria-label={nav.allStates} value={filter.state} onChange={(e) => setAndReset({ ...filter, state: e.target.value })}>
            <option value="">{nav.allStates}</option>
            {states.map(([s, n]) => (
              <option key={s} value={s}>
                {stateName(s)} · {countF(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          {nc == null ? (
            <p className="table-empty">{nav.ncLoading}</p>
          ) : rows.length === 0 ? (
            <p className="table-empty">{nav.ncEmpty}</p>
          ) : (
            <table className="data-table soy-nc-table">
              <thead>
                <tr>
                  <th>{nav.colField}</th>
                  <th>{nav.colLocation}</th>
                  <th className="num">{nav.colAcres}</th>
                  <th>{nav.colFirst}</th>
                  <th>{nav.colBefore}</th>
                  <th>{nav.colCatchments}</th>
                  <th className="soy-nc-go" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(pageNow * PAGE, (pageNow + 1) * PAGE).map((f) => {
                  const p = f.properties;
                  const names = catchText(f);
                  const open = () => onOpenOnMap(firstScope(f), f);
                  return (
                    <tr key={String(p.id)} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
                      <td className="mono truncate" title={String(p.id)}>
                        {String(p.id)}
                      </td>
                      <td className="truncate">{[p.n, p.s].filter(Boolean).join(", ") || "—"}</td>
                      <td className="num tabular-nums">{acF(Number(p.a))}</td>
                      <td className="tabular-nums">{String(p.y ?? "—")}</td>
                      <td>
                        <span className={`chip ${isReview(f) ? "warn" : p.b === "treed" || p.b === "natural" ? "bad" : ""}`}>{beforeLabel(f)}</span>
                      </td>
                      <td className="truncate soy-nc-catch" title={names.join(" · ")}>
                        {names.length ? (
                          <>
                            {names.slice(0, 2).join(" · ")}
                            {names.length > 2 ? <small> +{names.length - 2}</small> : null}
                          </>
                        ) : (
                          <span className="chip">{nav.outsideLabel}</span>
                        )}
                      </td>
                      <td className="soy-nc-go">{nav.mapGo} ›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > 0 ? (
          <div className="table-pager">
            <span>{fill(c.rowsRange, { from: countF(pageNow * PAGE + 1), to: countF(Math.min(rows.length, (pageNow + 1) * PAGE)), total: countF(rows.length) })}</span>
            {pages > 1 ? (
              <div className="table-pager-nav">
                <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)}>
                  ‹ {c.prev}
                </button>
                <span>{fill(c.pageOf, { page: pageNow + 1, total: pages })}</span>
                <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)}>
                  {c.next} ›
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
