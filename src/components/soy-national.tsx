import { useState } from "react";
import { KpiTile } from "@/components/kpi-tile";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa } from "@/lib/format";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { AC_TO_HA, FIELD_COLOR, pct, stateName, type SupplyData } from "@/lib/soy-supply";

/** national.json (scripts/prepare-soy-national-stats.py): every US field in soybeans in 2025. */
export type SoyNational = {
  source: string;
  fields: number;
  acres: number;
  counties: number;
  soyYears: { years: number; fields: number }[];
  states: { state: string; fields: number; acres: number; all8: number }[];
  topCounties: { state: string; county: string; fields: number; acres: number }[];
};

const TOP = 12;

/**
 * All US soybeans against the supply chain (Data tab, 10 Oct 2026: the
 * client is sizing the whole US crop, so this leads the tab): the national
 * total, what the catchments already cover, what lies outside them, and the
 * same split state by state. Catchment acres are the compliant fields of the
 * whole chain ("all"), as everywhere else.
 */
export function SoyNationalView({ nat, data, c, nav, lang }: { nat: SoyNational; data: SupplyData; c: SoySupplyCopy; nav: SoyNavCopy; lang: Lang }) {
  const all = data.catchments.find((k) => k.id === "all");
  const chainAcres = all?.compliant.acres ?? 0;
  const chainByState = new Map((all?.compliant.states ?? []).map((s) => [s.state, s.acres]));
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const pctF = (p: number) => formatSharePct(p, lang);
  const all8 = nat.soyYears.find((y) => y.years === 8)?.fields ?? 0;
  const outside = Math.max(0, nat.acres - chainAcres);
  const [allStates, setAllStates] = useState(false);
  const states = allStates ? nat.states : nat.states.slice(0, 25);
  const top = nat.states.slice(0, TOP);
  const maxAcres = top[0]?.acres ?? 1;

  return (
    <section className="chart-card supply-wide soy-national">
      <div className="soy-fac-head">
        <div>
          <p className="eyebrow">{nav.natEyebrow}</p>
          <h3>{c.natTitle}</h3>
          <p className="chart-note">{fill(c.natIntro, { states: countF(nat.states.length), counties: countF(nat.counties) })}</p>
        </div>
      </div>
      <div className="kpi-row soy-kpis4 soy-nat-kpis">
        <KpiTile value={acF(nat.acres)} label={c.natAcres} hint={c.natNote} sub={`${countF(nat.fields)} ${nav.natFieldsWord} · ${formatHa(nat.acres * AC_TO_HA, lang)}`} />
        <KpiTile tone="comply" value={acF(chainAcres)} label={nav.natInChain} hint={c.natShareHint} sub={fill(nav.natOfUs, { p: pctF(pct(chainAcres, nat.acres)) })} />
        <KpiTile value={acF(outside)} label={nav.natOutside} hint={nav.natOutsideHint} sub={fill(nav.natOfUs, { p: pctF(pct(outside, nat.acres)) })} />
        <KpiTile value={countF(nat.states.length)} label={nav.natStatesKpi} sub={fill(nav.natStatesSub, { c: countF(nat.counties), n: countF(all8), p: pctF(pct(all8, nat.fields)) })} />
      </div>

      <div className="soy-nat-chart">
        <div className="soy-ov-head">
          <h4>{fill(nav.natChartTitle, { n: TOP })}</h4>
          <p>
            <span className="soy-nat-key">
              <i style={{ background: FIELD_COLOR }} /> {nav.natInChain}
            </span>
            <span className="soy-nat-key">
              <i className="rest" /> {nav.natOutside}
            </span>
          </p>
        </div>
        <ul className="soy-hbars soy-nat-bars">
          {top.map((s) => {
            const inChain = chainByState.get(s.state) ?? 0;
            const w = (s.acres / maxAcres) * 100;
            const wIn = (inChain / maxAcres) * 100;
            return (
              <li key={s.state}>
                <span className="soy-hbar-label">{stateName(s.state)}</span>
                <span className="soy-hbar-track stacked">
                  <i className="rest" style={{ width: `${w}%` }} />
                  <i style={{ width: `${wIn}%`, background: FIELD_COLOR }} />
                </span>
                <span className="soy-hbar-value tabular-nums">
                  {acF(s.acres)} <small>· {inChain ? fill(nav.natInChainShort, { p: pctF(pct(inChain, s.acres)) }) : nav.natNone}</small>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <details className="soy-nat-more">
        <summary>{nav.natTables}</summary>
        <div className="chart-grid soy-charts">
          <div>
            <h3 className="soy-subhead">{c.natStates}</h3>
            <div className="soy-table-wrap">
              <table className="data-table soy-table">
                <thead>
                  <tr>
                    <th>{c.colState}</th>
                    <th className="num">{c.natColUs}</th>
                    <th className="num">{c.natColUsShare}</th>
                    <th className="num">{c.natColChain}</th>
                    <th className="num">{c.natColChainShare}</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => {
                    const inChain = chainByState.get(s.state) ?? 0;
                    return (
                      <tr key={s.state}>
                        <td>{stateName(s.state)}</td>
                        <td className="num tabular-nums">{acF(s.acres)}</td>
                        <td className="num tabular-nums">{pctF(pct(s.acres, nat.acres))}</td>
                        <td className="num tabular-nums">{inChain ? acF(inChain) : "—"}</td>
                        <td className="num tabular-nums">{inChain ? pctF(pct(inChain, s.acres)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nat.states.length > 25 ? (
              <button type="button" className="btn-text soy-more" onClick={() => setAllStates((v) => !v)}>
                {allStates ? c.showFewer : fill(c.showAllN, { n: countF(nat.states.length) })}
              </button>
            ) : null}
          </div>
          <div>
            <h3 className="soy-subhead">{c.natCounties}</h3>
            <div className="soy-table-wrap">
              <table className="data-table soy-table">
                <thead>
                  <tr>
                    <th>{c.colCounty}</th>
                    <th className="num">{c.colFields}</th>
                    <th className="num">{c.colSoyArea}</th>
                  </tr>
                </thead>
                <tbody>
                  {nat.topCounties.map((r) => (
                    <tr key={`${r.county}-${r.state}`}>
                      <td>
                        {r.county}, {r.state}
                      </td>
                      <td className="num tabular-nums">{countF(r.fields)}</td>
                      <td className="num tabular-nums">{acF(r.acres)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>
      <p className="chart-note">{c.natNote}</p>
    </section>
  );
}
