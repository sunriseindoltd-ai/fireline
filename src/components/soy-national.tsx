import { KpiTile } from "@/components/kpi-tile";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa } from "@/lib/format";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { AC_TO_HA, pct, stateName, type SupplyData } from "@/lib/soy-supply";

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

/**
 * The supply chain against all US soybeans (Summary tab): the national total
 * and how much of each state's soybean area lies inside the supply chain's
 * catchments. Catchment acres are the compliant fields of the whole chain
 * ("all"), as everywhere else on the tab.
 */
export function SoyNationalView({ nat, data, c, lang }: { nat: SoyNational; data: SupplyData; c: SoySupplyCopy; lang: Lang }) {
  const all = data.catchments.find((k) => k.id === "all");
  const chainAcres = all?.compliant.acres ?? 0;
  const chainByState = new Map((all?.compliant.states ?? []).map((s) => [s.state, s.acres]));
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const pctF = (p: number) => formatSharePct(p, lang);
  const all8 = nat.soyYears.find((y) => y.years === 8)?.fields ?? 0;

  return (
    <section className="chart-card soy-national">
      <h3>{c.natTitle}</h3>
      <p className="chart-note">{fill(c.natIntro, { states: countF(nat.states.length), counties: countF(nat.counties) })}</p>
      <div className="kpi-row compact">
        <KpiTile value={countF(nat.fields)} label={c.natFields} sub={fill(c.natAll8, { n: countF(all8), p: pctF(pct(all8, nat.fields)) })} />
        <KpiTile value={acF(nat.acres)} label={c.natAcres} sub={formatHa(nat.acres * AC_TO_HA, lang)} />
        <KpiTile tone="comply" value={pctF(pct(chainAcres, nat.acres))} label={c.natShare} hint={c.natShareHint} sub={acF(chainAcres)} />
      </div>
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
                {nat.states.map((s) => {
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
      <p className="chart-note">{c.natNote}</p>
    </section>
  );
}
