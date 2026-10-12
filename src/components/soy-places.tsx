import { useEffect, useMemo, useState } from "react";
import { KpiTile } from "@/components/kpi-tile";
import { SoyNationalView, type SoyNational } from "@/components/soy-national";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount } from "@/lib/format";
import { csv, downloadBlob } from "@/lib/soy-downloads";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { FIELD_COLOR, pct, stateName, type SupplyData } from "@/lib/soy-supply";

/** places.json (scripts/prepare-soy-places.py): every US soybean field placed in a Census county subdivision. */
export type PlaceFigures = { cf: number; ca: number; cif: number; cia: number; nf: number; na: number; nif: number; nia: number };
export type PlaceSub = PlaceFigures & { n: string; t: string; bbox: [number, number, number, number] };
export type PlaceCounty = PlaceFigures & { n: string; full: string; bbox: [number, number, number, number]; subs: PlaceSub[] };
export type PlaceState = PlaceFigures & { s: string; n: string; bbox: [number, number, number, number]; counties: PlaceCounty[] };
export type SoyPlaces = { version: number; asOf: string; totals: PlaceFigures; states: PlaceState[] };

/** Where to open the map: a state, a county (its fields are drawn) or a subdivision (the county's fields, zoomed to it). */
export type PlaceTarget = { s: string; n?: string; sub?: string; bbox?: [number, number, number, number] };

type Level = "state" | "county" | "sub";
type Row = PlaceFigures & { key: string; name: string; type?: string; target: PlaceTarget; children?: number };

const PAGE = 60;

/**
 * The supply chain by place (10 Oct 2026, user: state → county → township
 * matters for the map, the tables and the figures alike): one drill-down
 * table, every row with its all-US figures, what the catchments cover, and
 * ADM's non-compliant fields, and a way onto the map.
 */
export function SoyPlacesPage({ places, national, data, c, nav, lang, canDownload, initial, onHome, onOpenMap }: {
  places: SoyPlaces | null;
  national: SoyNational | null;
  data: SupplyData;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  canDownload: boolean;
  /** A place clicked on the map: the table opens at its county (or state), the subdivision in the search box. */
  initial?: (PlaceTarget & { nonce: number }) | null;
  onHome: () => void;
  onOpenMap: (t: PlaceTarget) => void;
}) {
  const [st, setSt] = useState<string>("");
  const [co, setCo] = useState<string>("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [onlyChain, setOnlyChain] = useState(true);
  useEffect(() => {
    if (!initial) return;
    setSt(initial.s);
    setCo(initial.n ?? "");
    setQuery(initial.sub ?? "");
    setPage(0);
    if (initial.sub) setOnlyChain(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.nonce]);
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const pctF = (p: number) => formatSharePct(p, lang);
  const state = st ? places?.states.find((x) => x.s === st) : undefined;
  const county = state && co ? state.counties.find((x) => x.n === co) : undefined;
  const level: Level = county ? "sub" : state ? "county" : "state";
  const scope: PlaceFigures | undefined = county ?? state ?? places?.totals;

  const rows = useMemo<Row[]>(() => {
    if (!places) return [];
    let out: Row[];
    if (county) out = county.subs.map((x) => ({ ...x, key: x.n, name: x.n, type: x.t, target: { s: st, n: co, sub: x.n, bbox: x.bbox } }));
    else if (state) out = state.counties.map((x) => ({ ...x, key: x.n, name: x.full, target: { s: st, n: x.n, bbox: x.bbox }, children: x.subs.length }));
    else out = places.states.map((x) => ({ ...x, key: x.s, name: stateName(x.s), target: { s: x.s, bbox: x.bbox }, children: x.counties.length }));
    if (onlyChain) out = out.filter((r) => r.cif > 0 || r.nif > 0);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || (r.type ?? "").toLowerCase().includes(q));
    return out.sort((a, b) => b.cia - a.cia || b.ca - a.ca);
  }, [places, state, county, st, co, onlyChain, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageNow = Math.min(page, pages - 1);
  const go = (next: { st?: string; co?: string }) => {
    setSt(next.st ?? "");
    setCo(next.co ?? "");
    setQuery("");
    setPage(0);
  };
  const levelLabel: Record<Level, string> = { state: nav.plStates, county: nav.plCounties, sub: nav.plSubs };
  const crumbTitle = county ? county.full : state ? stateName(state.s) : nav.plTitle;
  function download() {
    const head = ["place", "type", "state", "county", "compliant_fields_all", "compliant_acres_all", "compliant_fields_in_chain", "compliant_acres_in_chain", "pct_acres_in_chain", "noncompliant_fields_list", "noncompliant_acres_list", "noncompliant_fields_in_chain", "noncompliant_acres_in_chain"]; // prettier-ignore
    const body = rows.map((r) => [r.name, r.type ?? (level === "state" ? "state" : "county"), st || r.key, co || (level === "county" ? r.key : ""), r.cf, r.ca.toFixed(1), r.cif, r.cia.toFixed(1), pct(r.cia, r.ca).toFixed(2), r.nf, r.na.toFixed(1), r.nif, r.nia.toFixed(1)]); // prettier-ignore
    downloadBlob(`soytrace-places-${[st, co].filter(Boolean).join("-").replace(/[^\w-]+/g, "-") || "states"}.csv`, csv([head, ...body]), "text/csv");
  }

  if (!places) {
    return (
      <div className="soy-fac-page">
        <nav className="soy-crumbs soy-page-crumbs">
          <button type="button" onClick={onHome}>{nav.crumbChain}</button>
        </nav>
        <p className="chart-note">{nav.plLoading}</p>
      </div>
    );
  }
  return (
    <div className="soy-fac-page soy-places">
      <nav className="soy-crumbs soy-page-crumbs" aria-label={c.crumbsLabel}>
        {state ? (
          <span>
            <button type="button" onClick={() => go({})}>{nav.plTitle}</button>
            <i aria-hidden="true">›</i>
          </span>
        ) : null}
        {county ? (
          <span>
            <button type="button" onClick={() => go({ st })}>{stateName(st)}</button>
            <i aria-hidden="true">›</i>
          </span>
        ) : null}
        {state ? <b aria-current="location">{crumbTitle}</b> : null}
      </nav>
      <div className="summary-head">
        <div>
          <p className="eyebrow">{state ? nav.plEyebrow : nav.plEyebrowTop}</p>
          <h1>{crumbTitle}</h1>
          <p className="summary-sub">{state ? fill(nav.plSub, { date: places.asOf }) : nav.plSubTop}</p>
        </div>
        <div className="summary-tools">
          <button type="button" className="btn-secondary" onClick={() => onOpenMap(county ? { s: st, n: co, bbox: county.bbox } : state ? { s: st, bbox: state.bbox } : { s: "" })} disabled={!state}>
            {nav.openMap}
          </button>
        </div>
      </div>

      {!state && national ? <SoyNationalView nat={national} data={data} c={c} nav={nav} lang={lang} /> : null}
      {scope && (state || !national) ? (
        <div className="kpi-row soy-kpis4">
          <KpiTile value={acF(scope.ca)} label={nav.plKpiAll} hint={nav.plKpiAllHint} sub={fill(nav.plFieldsN, { n: countF(scope.cf) })} />
          <KpiTile tone="comply" value={acF(scope.cia)} label={nav.plKpiChain} hint={nav.plKpiChainHint} sub={`${fill(nav.plFieldsN, { n: countF(scope.cif) })} · ${pctF(pct(scope.cia, scope.ca))} ${nav.plOfHere}`} />
          <KpiTile value={acF(Math.max(0, scope.ca - scope.cia))} label={nav.plKpiOutside} hint={nav.natOutsideHint} sub={pctF(pct(scope.ca - scope.cia, scope.ca))} />
          <KpiTile tone="danger" value={countF(scope.nif)} label={nav.plKpiNc} hint={nav.kpiInsideHint} sub={fill(nav.plNcSub, { n: countF(scope.nf) })} />
        </div>
      ) : null}

      <section className="chart-card supply-wide soy-nc-list soy-places-list">
        <div className="soy-fac-head">
          <div>
            <h3>
              {levelLabel[level]} <span className="soy-nc-count tabular-nums">{countF(rows.length)}</span>
            </h3>
            <p className="chart-note">{level === "sub" ? nav.plHintSub : nav.plHint}</p>
          </div>
          {canDownload ? (
            <button type="button" className="btn-secondary" disabled={!rows.length} onClick={download}>
              CSV
            </button>
          ) : null}
        </div>
        <div className="table-tools soy-nc-tools">
          <label className="search-field">
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={nav.plSearch} aria-label={nav.plSearch} />
          </label>
          <label className="soy-check">
            <input type="checkbox" checked={onlyChain} onChange={(e) => { setOnlyChain(e.target.checked); setPage(0); }} /> {nav.plOnlyChain}
          </label>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <p className="table-empty">{c.noMatches}</p>
          ) : (
            <table className="data-table soy-places-table">
              <thead>
                <tr>
                  <th>{levelLabel[level]}</th>
                  {level === "sub" ? <th>{nav.plType}</th> : null}
                  <th className="num">{nav.plColAll}</th>
                  <th className="num">{nav.plColChain}</th>
                  <th className="soy-pl-share">{nav.plColShare}</th>
                  <th className="num">{nav.plColNc}</th>
                  <th className="soy-nc-go" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(pageNow * PAGE, (pageNow + 1) * PAGE).map((r) => {
                  const share = pct(r.cia, r.ca);
                  const drill = level === "state" ? () => go({ st: r.key }) : level === "county" ? () => go({ st, co: r.key }) : null;
                  return (
                    <tr key={r.key} tabIndex={0} onClick={() => (drill ? drill() : onOpenMap(r.target))} onKeyDown={(e) => e.key === "Enter" && (drill ? drill() : onOpenMap(r.target))}>
                      <td>
                        <b>{r.name}</b>
                        {r.children != null ? <span className="soy-cell-sub">{fill(level === "state" ? nav.plCountiesN : nav.plSubsN, { n: countF(r.children) })}</span> : null}
                      </td>
                      {level === "sub" ? <td className="soy-pl-type">{r.type || "—"}</td> : null}
                      <td className="num tabular-nums">
                        {acF(r.ca)}
                        <span className="soy-cell-sub">{fill(nav.plFieldsN, { n: countF(r.cf) })}</span>
                      </td>
                      <td className="num tabular-nums">
                        {r.cia ? acF(r.cia) : "—"}
                        {r.cif ? <span className="soy-cell-sub">{fill(nav.plFieldsN, { n: countF(r.cif) })}</span> : null}
                      </td>
                      <td className="soy-pl-share">
                        <span className="soy-pl-bar" aria-hidden="true">
                          <i style={{ width: `${Math.min(100, share)}%`, background: FIELD_COLOR }} />
                        </span>
                        <span className="tabular-nums">{r.ca ? pctF(share) : "—"}</span>
                      </td>
                      <td className="num tabular-nums">
                        {r.nif ? <span className="chip bad">{countF(r.nif)}</span> : r.nf ? <span className="chip">{countF(r.nf)}</span> : "—"}
                      </td>
                      <td className="soy-nc-go">
                        {drill ? (
                          <>
                            <button type="button" className="btn-text" onClick={(e) => { e.stopPropagation(); onOpenMap(r.target); }}>
                              {nav.mapGo}
                            </button>{" "}
                            ›
                          </>
                        ) : (
                          <>{nav.mapGo} ›</>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > PAGE ? (
          <div className="table-pager">
            <span>{fill(c.rowsRange, { from: countF(pageNow * PAGE + 1), to: countF(Math.min(rows.length, (pageNow + 1) * PAGE)), total: countF(rows.length) })}</span>
            <div className="table-pager-nav">
              <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)}>
                ‹ {c.prev}
              </button>
              <span>{fill(c.pageOf, { page: pageNow + 1, total: pages })}</span>
              <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)}>
                {c.next} ›
              </button>
            </div>
          </div>
        ) : null}
        <p className="chart-note soy-places-note">{nav.plNote}</p>
      </section>
    </div>
  );
}
