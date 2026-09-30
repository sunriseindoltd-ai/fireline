import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { SoySupplyMap, type SupplyColorBy } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatCount, formatHa, formatLarge } from "@/lib/format";
import { SOY_GROUPS, SOY_GROUP_COLORS, SOY_YEARS_COLORS, type SoyCopy } from "@/lib/soy-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  BAND_COLORS,
  FIELD_COLOR,
  M_PER_MI,
  NC_COLOR,
  RIVER_COLOR,
  RAIL_COLOR,
  pct,
  type Band,
  type Basis,
  type Catchment,
  type SupplyData,
} from "@/lib/soy-supply";

type Common = {
  data: SupplyData;
  cdlNames: Record<string, string>;
  c: SoySupplyCopy;
  sc: SoyCopy;
  lang: Lang;
};

const TIERS = ["all", "q40", "q80", "adm", "tpcore", "tp"] as const;

function tierLabel(id: string, c: SoySupplyCopy) {
  return (
    {
      all: c.scopeAll,
      q40: c.scopeQ40,
      q80: c.scopeQ80,
      adm: c.scopeAdm,
      tpcore: c.scopeTp56,
      tp: c.scopeTp,
    } as Record<string, string>
  )[id];
}

function catchmentLabel(id: string, data: SupplyData, c: SoySupplyCopy) {
  const t = tierLabel(id, c);
  if (t) return t;
  const adm = data.admElevators.find((e) => e.id === id);
  if (adm) return adm.name;
  const tp = data.thirdParty.find((e) => e.id === id);
  if (tp) return [tp.company, [tp.county, tp.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return id;
}

function ScopeTabs({
  scope,
  setScope,
  data,
  c,
}: {
  scope: string;
  setScope: (id: string) => void;
  data: SupplyData;
  c: SoySupplyCopy;
}) {
  const single = !(TIERS as readonly string[]).includes(scope);
  return (
    <div className="supply-scope">
      <div className="seg soy-plant-seg" role="tablist" aria-label={c.scopeLabel}>
        {TIERS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={scope === id}
            className={scope === id ? "on" : ""}
            onClick={() => setScope(id)}
          >
            {tierLabel(id, c)}
          </button>
        ))}
      </div>
      {single ? (
        <p className="supply-selected">
          <span>{c.selectedElevator}:</span> <b>{catchmentLabel(scope, data, c)}</b>
          <button type="button" className="btn-text" onClick={() => setScope("all")}>
            × {c.backToAll}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function useCatchments(data: SupplyData) {
  return useMemo(() => new Map(data.catchments.map((k) => [k.id, k])), [data]);
}

function CropCharts({ k, c, sc, lang }: { k: Catchment; c: SoySupplyCopy; sc: SoyCopy; lang: Lang }) {
  const countF = (n: number) => formatCount(n, lang);
  return (
    <div className="chart-grid soy-charts">
      <div className="chart-card">
        <h3>{c.cropTitle}</h3>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={k.compliant.cropHistoryHa} margin={{ top: 8, left: 8, right: 8 }}>
            <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={88} tickFormatter={(v: number) => formatLarge(v, lang)} />
            <Tooltip formatter={(v: number, key: string) => [formatHa(v, lang), sc.groups[key as keyof typeof sc.groups] ?? key]} />
            {SOY_GROUPS.map((g) => (
              <Bar key={g} dataKey={g} stackId="a" fill={SOY_GROUP_COLORS[g]} isAnimationActive={false} />
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
        <p className="chart-note">{c.cropNote}</p>
      </div>
      <div className="chart-card">
        <h3>{c.yearsTitle}</h3>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={k.compliant.soyYears} margin={{ top: 8, left: 8, right: 8 }}>
            <XAxis dataKey="years" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v: number) => fill(c.yearsN, { n: v })} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v: number) => countF(v)} />
            <Tooltip formatter={(v: number) => [countF(v), c.colFields]} labelFormatter={(v: number) => fill(c.yearsN, { n: v })} />
            <Bar dataKey="fields" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {k.compliant.soyYears.map((d) => (
                <Cell key={d.years} fill={SOY_YEARS_COLORS[Math.min(7, Math.max(0, d.years - 1))]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="chart-note">{c.yearsNote}</p>
        <h3 className="soy-subhead">{c.countiesTitle}</h3>
        <table className="data-table soy-table">
          <thead>
            <tr>
              <th>{c.colCounty}</th>
              <th className="num">{c.colFields}</th>
              <th className="num">{c.colSoyArea}</th>
            </tr>
          </thead>
          <tbody>
            {k.compliant.topCounties.map((r) => (
              <tr key={`${r.county}-${r.state}`}>
                <td>
                  {r.county}, {r.state}
                </td>
                <td className="num tabular-nums">{countF(r.fields)}</td>
                <td className="num tabular-nums">{formatHa(r.acres * AC_TO_HA, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The Quincy supply chain: catchments, fields, non-compliant fields at true scale. */
export function SoySupplyView({ data, cdlNames, c, sc, lang }: Common) {
  const [scope, setScope] = useState<string>("all");
  const [colorBy, setColorBy] = useState<SupplyColorBy>("status");
  const [tpQuery, setTpQuery] = useState("");
  const [tpCore, setTpCore] = useState(false);
  const catchments = useCatchments(data);
  const k = catchments.get(scope) ?? catchments.get("all")!;
  const countF = (n: number) => formatCount(n, lang);
  const haF = (acres: number) => formatHa(acres * AC_TO_HA, lang);
  const acF = (acres: number) => fill(c.acres, { n: formatLarge(acres, lang) });
  const nck = k.nonCompliant;
  const share = pct(nck.acres, k.compliant.acres + nck.acres);
  // "All catchments" shows ADM's whole list, including the fields outside every catchment.
  const ncAll = data.nonCompliantAll;
  const ncForCard = scope === "all" ? ncAll : nck;
  const outside = ncAll.fields - (catchments.get("all")?.nonCompliant.fields ?? 0);
  const miles = (m: number, nautical: boolean) => (nautical ? `${Math.round(m / 1852)} NM` : `${Math.round(m / M_PER_MI)} mi`);
  const admRadius = data.admElevators.find((e) => e.radiusM)?.radiusM ?? 0;
  const tpRadius = data.thirdParty[0]?.radiusM ?? 0;
  const companies = new Set(data.thirdParty.map((t) => t.company)).size;
  const tpRows = data.thirdParty
    .filter((t) => (!tpCore || t.core) && [t.company, t.tract, t.county, t.state].join(" ").toLowerCase().includes(tpQuery.trim().toLowerCase()))
    .map((t) => ({ t, k: catchments.get(t.id) }))
    .sort((a, b) => (b.k?.compliant.acres ?? 0) - (a.k?.compliant.acres ?? 0));
  const beforeRows: [string, number][] = [
    [c.ncBeforeTreed, ncForCard.byBefore.treed ?? 0],
    [c.ncBeforeNatural, ncForCard.byBefore.natural ?? 0],
    [c.ncBeforeCrop, ncForCard.byBefore.crop ?? 0],
    [c.unknown, ncForCard.byBefore.unknown ?? 0],
  ];

  return (
    <>
      <div className="summary-head">
        <div>
          <h1>{c.supplyTitle}</h1>
          <p className="summary-sub">{c.supplyIntro}</p>
        </div>
      </div>
      <ScopeTabs scope={scope} setScope={setScope} data={data} c={c} />

      <div className="kpi-row">
        <KpiTile value={countF(k.compliant.fields)} label={c.kpiFields} hint={c.kpiFieldsHint} />
        <KpiTile value={haF(k.compliant.acres)} label={c.kpiArea} hint={c.kpiAreaHint} sub={acF(k.compliant.acres)} />
        <KpiTile tone="danger" value={countF(nck.fields)} label={c.kpiNcFields} hint={c.kpiNcFieldsHint} />
        <KpiTile
          tone="danger"
          value={haF(nck.acres)}
          label={c.kpiNcArea}
          hint={c.kpiNcAreaHint}
          sub={fill(c.changed, { v: haF(nck.changeAcres) })}
        />
        <KpiTile value={formatSharePct(share, lang)} label={c.kpiNcShare} hint={c.kpiNcShareHint} />
      </div>

      <section className="chart-card soy-map-card">
        <div className="supply-map-bar">
          <span>{c.colorBy}</span>
          <div className="seg" role="group" aria-label={c.colorBy}>
            {(["status", "years"] as const).map((v) => (
              <button key={v} type="button" className={colorBy === v ? "on" : ""} aria-pressed={colorBy === v} onClick={() => setColorBy(v)}>
                {v === "status" ? c.colorCatchment : c.colorYears}
              </button>
            ))}
          </div>
        </div>
        <SoySupplyMap
          data={data}
          mode="supply"
          selected={scope}
          onSelect={(id) => setScope(id ?? "all")}
          colorBy={colorBy}
          basis="either"
          band={10}
          cdlNames={cdlNames}
          catchments={catchments}
          c={c}
          lang={lang}
        />
      </section>

      <section className="chart-card supply-wide">
        <h3>{c.scaleTitle}</h3>
        <p className="chart-note">{c.scaleBody}</p>
        <div className="soy-table-wrap">
          <table className="data-table soy-table scale-table">
            <thead>
              <tr>
                <th>{c.colCatchment}</th>
                <th className="num">{c.colCompliantArea}</th>
                <th className="num">{c.colNcFields}</th>
                <th className="num">{c.colNcArea}</th>
                <th className="num">{c.colShare}</th>
              </tr>
            </thead>
            <tbody>
              {(["q40", "q80", "adm", "tpcore", "tp", "all"] as const).map((id) => {
                const x = catchments.get(id);
                if (!x) return null;
                const p = pct(x.nonCompliant.acres, x.compliant.acres + x.nonCompliant.acres);
                return (
                  <tr key={id} className={scope === id ? "on" : ""} tabIndex={0} onClick={() => setScope(id)} onKeyDown={(e) => e.key === "Enter" && setScope(id)}>
                    <td>
                      {tierLabel(id, c)}
                      <span className="scale-bar" aria-hidden="true">
                        <i style={{ width: `${Math.max(p, 0.4)}%` }} />
                      </span>
                    </td>
                    <td className="num tabular-nums">{haF(x.compliant.acres)}</td>
                    <td className="num tabular-nums">{countF(x.nonCompliant.fields)}</td>
                    <td className="num tabular-nums">{haF(x.nonCompliant.acres)}</td>
                    <td className="num tabular-nums">{formatSharePct(p, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="chart-note scale-legend">
          <i style={{ background: FIELD_COLOR }} /> {c.scaleCompliant} <i style={{ background: NC_COLOR }} /> {c.scaleNonCompliant}
        </p>
      </section>

      <div className="chart-grid soy-charts">
        <section className="chart-card">
          <h3>{c.ncTitle}</h3>
          <p className="chart-note">
            {fill(c.ncIntro, {
              n: countF(ncAll.fields),
              states: countF(ncAll.byState.length),
              outside: countF(outside),
            })}
          </p>
          <h3 className="soy-subhead">{c.ncByYear}</h3>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={ncForCard.byYear} margin={{ top: 8, left: 8, right: 8 }}>
              <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [countF(v), c.colFields]} />
              <Bar dataKey="fields" fill={NC_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="chart-note">{c.ncByYearNote}</p>
          <h3 className="soy-subhead">{c.ncBefore}</h3>
          <table className="data-table soy-table">
            <tbody>
              {beforeRows
                .filter(([, v]) => v > 0)
                .map(([label, v]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num tabular-nums">{countF(v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="chart-note">{c.ncBeforeNote}</p>
          <h3 className="soy-subhead">{c.ncByState}</h3>
          <div className="soy-table-wrap short">
            <table className="data-table soy-table">
              <tbody>
                {ncForCard.byState.map((s) => (
                  <tr key={s.state}>
                    <td>{s.state}</td>
                    <td className="num tabular-nums">{countF(s.fields)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="chart-note">
            {fill(c.ncDual, { n: countF(ncAll.alsoCompliant) })} {fill(c.ncPointOnly, { n: countF(ncAll.pointOnly) })}
          </p>
        </section>

        <section className="chart-card">
          <h3>{c.tpTitle}</h3>
          <div className="supply-tp-tools">
            <label className="search-field">
              <input type="search" value={tpQuery} onChange={(e) => setTpQuery(e.target.value)} placeholder={c.tpSearch} aria-label={c.tpSearch} />
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={tpCore} onChange={(e) => setTpCore(e.target.checked)} /> {c.tpCoreOnly}
            </label>
          </div>
          <div className="soy-table-wrap tall">
            <table className="data-table soy-table">
              <thead>
                <tr>
                  <th>{c.colCompany}</th>
                  <th>{c.colPlace}</th>
                  <th className="num">{c.colSoyArea}</th>
                  <th className="num">{c.colNcFields}</th>
                </tr>
              </thead>
              <tbody>
                {tpRows.map(({ t, k: x }) => (
                  <tr key={t.id} className={scope === t.id ? "on" : ""} tabIndex={0} onClick={() => setScope(t.id)} onKeyDown={(ev) => ev.key === "Enter" && setScope(t.id)}>
                    <td>
                      {t.company ?? "—"}
                      {t.core ? <span className="soy-tag">{c.core}</span> : null}
                    </td>
                    <td>{[t.county, t.state].filter(Boolean).join(", ")}</td>
                    <td className="num tabular-nums">{x ? haF(x.compliant.acres) : "—"}</td>
                    <td className="num tabular-nums">{x ? countF(x.nonCompliant.fields) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="chart-note">
            {fill(c.tpNote, { companies: countF(companies), miles: miles(tpRadius, false), km: Math.round(tpRadius / 1000) })}
          </p>
        </section>
      </div>

      <section className="chart-card supply-wide">
        <h3>{c.admTitle}</h3>
        <div className="soy-table-wrap">
          <table className="data-table soy-table">
            <thead>
              <tr>
                <th>{c.colName}</th>
                <th>{c.colRiver}</th>
                <th className="num">{c.colSoyArea}</th>
                <th className="num">{c.colNcFields}</th>
                <th className="num">{c.colNcArea}</th>
                <th className="num">{c.colShare}</th>
                <th className="num">{c.colRail}</th>
                <th className="num">{c.colRiverDist}</th>
              </tr>
            </thead>
            <tbody>
              {data.admElevators
                .filter((e) => e.radiusM)
                .map((e) => {
                  const x = catchments.get(e.id);
                  return (
                    <tr key={e.id} className={scope === e.id ? "on" : ""} tabIndex={0} onClick={() => setScope(e.id)} onKeyDown={(ev) => ev.key === "Enter" && setScope(e.id)}>
                      <td>
                        {e.name}
                        <span className="soy-cell-sub">{[e.city, e.state].filter(Boolean).join(", ")}</span>
                      </td>
                      <td>{e.river ?? "—"}</td>
                      <td className="num tabular-nums">{x ? haF(x.compliant.acres) : "—"}</td>
                      <td className="num tabular-nums">{x ? countF(x.nonCompliant.fields) : "—"}</td>
                      <td className="num tabular-nums">{x ? haF(x.nonCompliant.acres) : "—"}</td>
                      <td className="num tabular-nums">
                        {x ? formatSharePct(pct(x.nonCompliant.acres, x.compliant.acres + x.nonCompliant.acres), lang) : "—"}
                      </td>
                      <td className="num tabular-nums">{fill(c.milesShort, { n: e.railMi.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) })}</td>
                      <td className="num tabular-nums">{fill(c.milesShort, { n: e.riverMi.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) })}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="chart-note">
          {fill(c.admNote, { miles: miles(admRadius, true), km: Math.round(admRadius / 1000) })}
        </p>
      </section>

      <CropCharts k={k} c={c} sc={sc} lang={lang} />
      <DataNotes c={c} />
    </>
  );
}

function DataNotes({ c }: { c: SoySupplyCopy }) {
  return (
    <section className="chart-card supply-notes">
      <h3>{c.notesTitle}</h3>
      <ul>
        <li>{c.note1}</li>
        <li>{c.note2}</li>
        <li>{c.note3}</li>
      </ul>
    </section>
  );
}

/** Rail & river potential: compliant soybean area within reach of rail and the main river system. */
export function SoyCorridorView({ data, cdlNames, c, sc, lang }: Common) {
  const [scope, setScope] = useState<string>("all");
  const [band, setBand] = useState<Band>(10);
  const [basis, setBasis] = useState<Basis>("either");
  const catchments = useCatchments(data);
  const k = catchments.get(scope) ?? catchments.get("all")!;
  const countF = (n: number) => formatCount(n, lang);
  const haF = (acres: number) => formatHa(acres * AC_TO_HA, lang);
  const acF = (acres: number) => fill(c.acres, { n: formatLarge(acres, lang) });
  const cov = k.compliant.coverageAcres;
  const at = k.compliant.corridor[String(band)] ?? { rail: 0, river: 0, either: 0, both: 0 };
  const p = (v: number) => formatSharePct(pct(v, cov), lang);
  const chart = data.bandsMi.map((b) => {
    const x = k.compliant.corridor[String(b)]!;
    return {
      band: fill(c.bandLe, { n: b }),
      rail: x.rail * AC_TO_HA,
      river: x.river * AC_TO_HA,
      either: x.either * AC_TO_HA,
    };
  });
  const within1 = (xs: { railMi: number; riverMi: number }[]) => ({
    rail: xs.filter((x) => x.railMi <= 1).length,
    river: xs.filter((x) => x.riverMi <= 1).length,
  });
  const admNear = within1(data.admElevators);
  const tpNear = within1(data.thirdParty);
  const mi = (n: number) => fill(c.milesShort, { n: n.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) });
  const outsideFields = k.compliant.fields - k.compliant.coverageFields;
  const outsideAcres = k.compliant.acres - cov;
  const tableIds = ["q40", "q80", "adm", "tpcore", "tp", "all", ...data.admElevators.filter((e) => e.radiusM).map((e) => e.id)];

  return (
    <>
      <div className="summary-head">
        <div>
          <h1>{c.corrTitle}</h1>
          <p className="summary-sub">{c.corrIntro}</p>
        </div>
      </div>
      <ScopeTabs scope={scope} setScope={setScope} data={data} c={c} />
      <div className="supply-controls">
        <span>{c.bandLabel}</span>
        <div className="seg" role="group" aria-label={c.bandLabel}>
          {data.bandsMi.map((b) => (
            <button key={b} type="button" className={band === b ? "on" : ""} aria-pressed={band === b} onClick={() => setBand(b)}>
              {fill(c.bandLe, { n: b })}
            </button>
          ))}
        </div>
        <span>{c.basisLabel}</span>
        <div className="seg" role="group" aria-label={c.basisLabel}>
          {(["either", "rail", "river"] as const).map((b) => (
            <button key={b} type="button" className={basis === b ? "on" : ""} aria-pressed={basis === b} onClick={() => setBasis(b)}>
              {b === "rail" ? c.basisRail : b === "river" ? c.basisRiver : c.basisEither}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <KpiTile value={haF(cov)} label={c.kpiCoverage} hint={c.kpiCoverageHint} sub={acF(cov)} />
        <KpiTile value={haF(at.rail)} label={fill(c.kpiNearRail, { n: band })} sub={fill(c.ofCoverage, { p: p(at.rail) })} />
        <KpiTile value={haF(at.river)} label={fill(c.kpiNearRiver, { n: band })} sub={fill(c.ofCoverage, { p: p(at.river) })} />
        <KpiTile tone="comply" value={haF(at.either)} label={fill(c.kpiNearEither, { n: band })} sub={fill(c.ofCoverage, { p: p(at.either) })} />
        <KpiTile value={haF(at.both)} label={fill(c.kpiNearBoth, { n: band })} sub={fill(c.ofCoverage, { p: p(at.both) })} />
      </div>

      <section className="chart-card soy-map-card">
        <SoySupplyMap
          data={data}
          mode="corridor"
          selected={scope}
          onSelect={(id) => setScope(id ?? "all")}
          colorBy="status"
          basis={basis}
          band={band}
          cdlNames={cdlNames}
          catchments={catchments}
          c={c}
          lang={lang}
        />
      </section>

      <div className="chart-grid soy-charts">
        <section className="chart-card">
          <h3>{c.corrChartTitle}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chart} margin={{ top: 8, left: 8, right: 8 }}>
              <XAxis dataKey="band" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={88} tickFormatter={(v: number) => formatLarge(v, lang)} />
              <Tooltip formatter={(v: number, key: string) => [formatHa(v, lang), key === "rail" ? c.rail : key === "river" ? c.riverWord : c.either]} />
              <Legend formatter={(key: string) => (key === "rail" ? c.rail : key === "river" ? c.riverWord : c.either)} />
              <Bar dataKey="rail" fill={RAIL_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="river" fill={RIVER_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="either" fill={BAND_COLORS.b10} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="chart-note">{c.corrChartNote}</p>
          {outsideFields > 0 ? (
            <p className="chart-note">{fill(c.outsideCoverage, { n: countF(outsideFields), area: haF(outsideAcres) })}</p>
          ) : null}
        </section>

        <section className="chart-card">
          <h3>{c.facilitiesTitle}</h3>
          <p className="chart-note supply-body">
            {fill(c.facilitiesBody, {
              admRail: countF(admNear.rail),
              admRiver: countF(admNear.river),
              adm: countF(data.admElevators.length),
              tpRail: countF(tpNear.rail),
              tpRiver: countF(tpNear.river),
              plantRail: mi(data.plant.railMi),
              plantRiver: mi(data.plant.riverMi),
            })}
          </p>
          <div className="soy-table-wrap">
            <table className="data-table soy-table">
              <thead>
                <tr>
                  <th>{c.colName}</th>
                  <th className="num">{c.colRail}</th>
                  <th className="num">{c.colRiverDist}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data.plant.name}</td>
                  <td className="num tabular-nums">{mi(data.plant.railMi)}</td>
                  <td className="num tabular-nums">{mi(data.plant.riverMi)}</td>
                </tr>
                {data.admElevators.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td className="num tabular-nums">{mi(e.railMi)}</td>
                    <td className="num tabular-nums">{mi(e.riverMi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="chart-card">
        <h3>{c.corrTableTitle}</h3>
        <div className="soy-table-wrap">
          <table className="data-table soy-table">
            <thead>
              <tr>
                <th>{c.colCatchment}</th>
                <th className="num">{c.kpiCoverage}</th>
                <th className="num">{c.colRailPct}</th>
                <th className="num">{c.colRiverPct}</th>
                <th className="num">{c.colEitherPct}</th>
              </tr>
            </thead>
            <tbody>
              {tableIds.map((id) => {
                const x = catchments.get(id);
                if (!x) return null;
                const cv = x.compliant.coverageAcres;
                const b = x.compliant.corridor[String(band)]!;
                return (
                  <tr key={id} className={scope === id ? "on" : ""} tabIndex={0} onClick={() => setScope(id)} onKeyDown={(e) => e.key === "Enter" && setScope(id)}>
                    <td>{catchmentLabel(id, data, c)}</td>
                    <td className="num tabular-nums">{haF(cv)}</td>
                    <td className="num tabular-nums">{formatSharePct(pct(b.rail, cv), lang)}</td>
                    <td className="num tabular-nums">{formatSharePct(pct(b.river, cv), lang)}</td>
                    <td className="num tabular-nums">{formatSharePct(pct(b.either, cv), lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="chart-card supply-notes">
        <h3>{c.methodTitle}</h3>
        <ul>
          <li>{fill(c.method1, { x: formatCount(data.network.railKm.X ?? 0, lang) })}</li>
          <li>{fill(c.method2, { km2: formatCount(data.network.riverSystemKm2, lang), n: data.network.riverSystems ?? 1 })}</li>
        </ul>
      </section>
      <DataNotes c={c} />
    </>
  );
}
