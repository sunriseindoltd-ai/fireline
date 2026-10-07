import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { SoyPlants, SoyRelated, type SidePlant } from "@/components/soy-side";
import { SoyNationalView, type SoyNational } from "@/components/soy-national";
import { loadNonCompliant, type SoyFeature } from "@/components/soy-supply-map";
import type { OtherPlant } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa, formatLarge } from "@/lib/format";
import { SOY_GROUPS, SOY_GROUP_COLORS, SOY_YEARS_COLORS, type SoyCopy } from "@/lib/soy-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  FIELD_COLOR,
  NC_COLOR,
  comboTotals,
  idsFromScope,
  inScope,
  plantById,
  statsKey,
  unitName,
  stateName,
  pct,
  type Catchment,
  type ComboTotals,
  type Plant,
  type SupplyData,
  type SupplyNcStats,
} from "@/lib/soy-supply";

type Common = {
  data: SupplyData;
  cdlNames: Record<string, string>;
  c: SoySupplyCopy;
  sc: SoyCopy;
  lang: Lang;
  /** Catchment shared by every tab (the workspace holds it). */
  scope: string;
  setScope: (id: string) => void;
  present: boolean;
  onOpenMap: () => void;
  /** All US soybean fields (national.json), when loaded. */
  national?: SoyNational | null;
  /** Crushing plants announced without catchments yet (none since the 7 Oct data). */
  otherPlants?: OtherPlant[];
  /** The sidebar's selection (ticked catchment ids; none = the whole chain) and chosen plant ("" = all). */
  sel: string[];
  setSel: (ids: string[]) => void;
  plantSel: string;
  setPlantSel: (id: string) => void;
};

/** Rows of the true-scale table. */

function tierLabel(id: string, c: SoySupplyCopy) {
  return (
    {
      all: c.scopeAll,
      direct: c.scopeDirect,
      adm: c.scopeAdm,
      tp: c.scopeTp,
    } as Record<string, string>
  )[id];
}

export function catchmentLabel(id: string, data: SupplyData, c: SoySupplyCopy) {
  const t = tierLabel(id, c) ?? unitName(id, data, c);
  if (t) return t;
  const adm = data.admElevators.find((e) => e.id === id);
  if (adm) return adm.name;
  const tp = data.thirdParty.find((e) => e.id === id);
  if (tp) return [tp.company, [tp.county, tp.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return id;
}

/** The largest states, the rest folded into one "other states" row. */
function topStates(rows: { state: string; fields: number }[], n: number) {
  const sorted = [...rows].sort((a, b) => b.fields - a.fields);
  if (sorted.length <= n + 1) return sorted.map((r) => ({ ...r, n: 1 }));
  const rest = sorted.slice(n);
  return [
    ...sorted.slice(0, n).map((r) => ({ ...r, n: 1 })),
    { state: "other", fields: rest.reduce((s, r) => s + r.fields, 0), n: rest.length },
  ];
}

/** ADM's non-compliant fields, loaded when a combination needs them. */
function useNcFeatures(enabled: boolean) {
  const [nc, setNc] = useState<SoyFeature[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadNonCompliant()
      .then((fc) => live && setNc(fc.features))
      .catch(() => live && setNc([]));
    return () => {
      live = false;
    };
  }, [enabled]);
  return nc;
}

/** The non-compliant statistics of a combination, counted from the fields themselves. */
function ncForSelection(features: SoyFeature[], sel: string[], tpl: SupplyNcStats): SupplyNcStats {
  const inside = features.filter((f) => sel.some((id) => inScope(id, { flags: Number(f.properties.f), k: String(f.properties.k ?? "") })));
  const tally = (key: string, none: string) =>
    inside.reduce<Record<string, number>>((acc, f) => {
      const v = String(f.properties[key] ?? none);
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
  return {
    ...tpl,
    fields: inside.length,
    byYear: tpl.byYear.map(({ year }) => ({ year, fields: inside.filter((f) => Number(f.properties.y) === year).length })),
    byBefore: tally("b", "unknown"),
    byUse: tally("u", "unknown"),
    byState: Object.entries(tally("s", "—"))
      .map(([state, fields]) => ({ state, fields }))
      .sort((a, b) => b.fields - a.fields),
  };
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg className={`soy-combo-caret${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
          <BarChart
            // Acres, like every other area in SoyTrace (the stats are stored in ha).
            data={k.compliant.cropHistoryHa.map((r) => Object.fromEntries(Object.entries(r).map(([key, v]) => [key, key === "year" ? v : Number(v) / AC_TO_HA])))}
            margin={{ top: 8, left: 8, right: 8 }}>
            <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={88} tickFormatter={(v: number) => formatLarge(v, lang)} />
            <Tooltip formatter={(v: number, key: string) => [formatAcres(v, lang), sc.groups[key as keyof typeof sc.groups] ?? key]} />
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
                <td className="num tabular-nums">{formatAcres(r.acres, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Summary: the supply chain of the chosen plant(s), narrowed by the sidebar's ticks. */
export function SoySupplyView({ data, c, sc, lang, scope, setScope, present, onOpenMap, national, otherPlants = [], sel, setSel, plantSel, setPlantSel }: Common) {
  const catchments = useCatchments(data);
  const plants = useMemo<SidePlant[]>(
    () => [
      ...data.plants.map((p) => ({ id: p.id, name: p.city || p.name, hasData: true })),
      ...otherPlants.map((p) => ({ id: p.id, name: p.name.replace(/^ADM /, ""), hasData: false })),
    ],
    [data, otherPlants],
  );
  const pending = plants.find((p) => p.id === plantSel && !p.hasData);
  const plant = plantSel ? plantById(data, plantSel) : undefined;
  // Nothing ticked: the chosen plant's whole catchment, or the whole chain.
  const effSel = sel.length ? sel : plant ? [`${plant.key}80`] : [];
  // One catchment's own statistics, or null for a combination of several.
  const rawKey = statsKey(effSel, data);
  const key = rawKey && !catchments.has(rawKey) ? "all" : rawKey;
  const k = key ? catchments.get(key)! : null;
  const countF = (n: number) => formatCount(n, lang);
  // Areas in acres (the client's unit); hectares as the secondary figure.
  const haF = (acres: number) => formatAcres(acres, lang);
  const acF = (acres: number) => formatHa(acres * AC_TO_HA, lang);
  const tot: ComboTotals = k
    ? { fields: k.compliant.fields, acres: k.compliant.acres, ncFields: k.nonCompliant.fields, ncAcres: k.nonCompliant.acres, defo: 0 }
    : (comboTotals(data, effSel) ?? { fields: 0, acres: 0, ncFields: 0, ncAcres: 0, defo: 0 });
  const share = pct(tot.ncAcres, tot.acres + tot.ncAcres);
  // "All catchments" shows ADM's whole list, including the fields outside every catchment.
  const ncAll = data.nonCompliantAll;
  const ncFeatures = useNcFeatures(!k);
  const ncCombo = !k && ncFeatures ? ncForSelection(ncFeatures, effSel, ncAll) : null;
  const ncForCard = k ? (key === "all" ? ncAll : k.nonCompliant) : ncCombo;
  const outside = ncAll.fields - (catchments.get("all")?.nonCompliant.fields ?? 0);
  // A statistics row opens the map on that scope (the whole chain for an empty list).
  const openIds = (ids: string[]) => {
    setSel(ids);
    onOpenMap();
  };
  const beforeRows: [string, number][] = ncForCard
    ? [
        [c.ncBeforeTreed, ncForCard.byBefore.treed ?? 0],
        [c.ncBeforeNatural, ncForCard.byBefore.natural ?? 0],
        [c.ncBeforeCrop, ncForCard.byBefore.crop ?? 0],
        [c.unknown, ncForCard.byBefore.unknown ?? 0],
      ]
    : [];
  // What the figures are about, in words.
  const names = key ? [catchmentLabel(key, data, c)] : effSel.map((id) => catchmentLabel(id, data, c));
  const selLabel = names.length > 3 ? `${names.slice(0, 3).join(" + ")} ${fill(c.sideMore, { n: names.length - 3 })}` : names.join(" + ");

  return (
    <div className="soy-split">
      <SoyPlants c={c} plants={plants} plantSel={plantSel} setPlantSel={setPlantSel} />
      <div className="soy-head">
        <div className="summary-head">
          <div>
            <h1>{c.supplyTitle}</h1>
            <p className="summary-sub">{c.supplyIntro}</p>
          </div>
          <div className="summary-tools">
            <button type="button" className="btn-secondary" onClick={onOpenMap}>
              {c.openMap}
            </button>
          </div>
        </div>
        {pending ? null : (
          <p className="soy-showing">
            <span>{c.sideShowing}</span>
            <b>{selLabel}</b>
            {sel.length ? (
              <button type="button" className="btn-text" onClick={() => setSel([])}>
                × {c.sideClear}
              </button>
            ) : null}
          </p>
        )}
      </div>
      <SoyRelated data={data} c={c} lang={lang} plants={plants} plantSel={plantSel} sel={sel} setSel={setSel} catchments={catchments} />
      <div className="soy-body">
        {pending ? (
          <section className="chart-card supply-pending">
            <h3>{pending.name}</h3>
            <p>{c.plantPending}</p>
            <button type="button" className="btn-secondary" onClick={onOpenMap}>
              {c.openMap}
            </button>
          </section>
        ) : (
          <>
            <div className="kpi-row soy-supply-kpis">
              <KpiTile
                value={countF(tot.fields)}
                label={c.kpiFields}
                hint={c.kpiFieldsHint}
                sub={k?.compliant.doubleCropFields ? fill(c.kpiDoubleCrop, { n: countF(k.compliant.doubleCropFields), area: haF(k.compliant.doubleCropAcres ?? 0) }) : undefined}
              />
              <KpiTile value={haF(tot.acres)} label={c.kpiArea} hint={c.kpiAreaHint} sub={acF(tot.acres)} />
              <KpiTile tone="danger" value={countF(tot.ncFields)} label={c.kpiNcFields} hint={c.kpiNcFieldsHint} />
              <KpiTile tone="danger" value={haF(tot.ncAcres)} label={c.kpiNcArea} hint={c.kpiNcAreaHint} />
              <KpiTile
                tone="comply"
                value={formatSharePct(pct(tot.acres, tot.acres + tot.ncAcres), lang)}
                label={c.kpiCompliantShare}
                hint={c.kpiNcShareHint}
                sub={fill(c.ncShareSub, { p: formatSharePct(share, lang) })}
              />
            </div>

            <ComboTable data={data} c={c} lang={lang} open={openIds} plant={plant} />

            <div className="chart-grid soy-charts">
              {ncForCard ? (
                <>
                  <section className="chart-card">
                    <h3>{c.ncTitle}</h3>
                    <p className="chart-note">
                      {k
                        ? fill(c.ncIntro, { n: countF(ncAll.fields), states: countF(ncAll.byState.length), outside: countF(outside) })
                        : `${c.sideNcTitle} · ${countF(ncForCard.fields)}`}
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
                    {present || !k || (!ncAll.alsoCompliant && !ncAll.pointOnly) ? null : (
                      <p className="chart-note">
                        {ncAll.alsoCompliant ? fill(c.ncDual, { n: countF(ncAll.alsoCompliant) }) : null} {ncAll.pointOnly ? fill(c.ncPointOnly, { n: countF(ncAll.pointOnly) }) : null}
                      </p>
                    )}
                  </section>

                  <section className="chart-card soy-nc-use">
                    <h3>{c.ncWhyTitle}</h3>
                    <p className="chart-note">{c.ncWhyIntro}</p>
                    <h3 className="soy-subhead">{c.ncUseTitle}</h3>
                    <table className="data-table soy-table">
                      <tbody>
                        {(
                          [
                            ["crop", c.ncUseCrop],
                            ["pasture", c.ncUsePasture],
                            ["nonag", c.ncUseNonAg],
                            ["unknown", c.unknown],
                          ] as const
                        )
                          .filter(([ukey]) => (ncForCard.byUse?.[ukey] ?? 0) > 0)
                          .map(([ukey, label]) => (
                            <tr key={ukey}>
                              <td>{label}</td>
                              <td className="num tabular-nums">{countF(ncForCard.byUse?.[ukey] ?? 0)}</td>
                              <td className="num tabular-nums">{formatSharePct(pct(ncForCard.byUse?.[ukey] ?? 0, ncForCard.fields), lang)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <p className="chart-note">{c.ncUseNote}</p>
                    <h3 className="soy-subhead">{c.ncByState}</h3>
                    <table className="data-table soy-table">
                      <tbody>
                        {topStates(ncForCard.byState, 8).map((st) => (
                          <tr key={st.state}>
                            <td>{st.state === "other" ? fill(c.otherStates, { n: countF(st.n) }) : stateName(st.state)}</td>
                            <td className="num tabular-nums">{countF(st.fields)}</td>
                            <td className="num tabular-nums">{formatSharePct(pct(st.fields, ncForCard.fields), lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              ) : (
                <section className="chart-card">
                  <p className="chart-note">{c.comboLoadingNc}</p>
                </section>
              )}
            </div>

            <FacilityTable data={data} catchments={catchments} c={c} lang={lang} scope={key ?? "all"} setScope={(id) => setSel(idsFromScope(id, data))} plant={plant} />

            {national && key === "all" ? <SoyNationalView nat={national} data={data} c={c} lang={lang} /> : null}

            {k ? (
              <CropCharts k={k} c={c} sc={sc} lang={lang} />
            ) : (
              <section className="chart-card supply-wide">
                <p className="chart-note">{c.noChartsCombo}</p>
              </section>
            )}
            {present ? null : <DataNotes c={c} />}
          </>
        )}
      </div>
    </div>
  );
}

type FacilityKind = "chain" | "plant" | "adm" | "tp";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ADM's ask: compliant vs non-compliant polygons for the whole supply chain
 * and per facility (each crushing plant and every elevator). */
function FacilityTable({
  data,
  catchments,
  c,
  lang,
  scope,
  setScope,
  plant,
}: {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  lang: Lang;
  scope: string;
  setScope: (id: string) => void;
  /** One plant chosen: its rows only (elevators aren't tied to a plant). */
  plant?: Plant;
}) {
  const [kind, setKind] = useState<"all" | FacilityKind>("all");
  const [query, setQuery] = useState("");
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const place = (p: Plant) => [p.city, p.state].filter(Boolean).join(", ");
  const plantRows = (plant ? [plant] : data.plants).flatMap((p) => [
    { id: `${p.key}80`, kind: "plant" as const, name: `${p.name} · ${c.scopeQ80}`, place: place(p) },
    { id: `${p.key}40`, kind: "plant" as const, name: `${p.name} · ${c.scopeQ40}`, place: place(p), sub: true },
  ]);
  const rows: { id: string; kind: FacilityKind; name: string; place: string; sub?: boolean }[] = plant
    ? plantRows
    : [
        { id: "all", kind: "chain", name: c.scopeAll, place: fill(c.chainSub, { p: data.plants.length, a: data.admElevators.filter((e) => e.radiusM).length, t: data.thirdParty.length }) },
        ...plantRows,
        ...data.admElevators
          .filter((e) => e.radiusM)
          .map((e) => ({ id: e.id, kind: "adm" as const, name: e.name, place: [e.city, e.state].filter(Boolean).join(", ") })),
        ...data.thirdParty.map((t) => ({ id: t.id, kind: "tp" as const, name: t.company ?? t.id, place: [t.county, t.state].filter(Boolean).join(", ") })),
      ];
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (kind === "all" || r.kind === kind || r.kind === "chain") && (!q || r.kind === "chain" || `${r.name} ${r.place}`.toLowerCase().includes(q)));
  const kindLabel: Record<FacilityKind, string> = { chain: c.facChain, plant: c.kindPlant, adm: c.kindAdm, tp: c.kindTp };
  const line = (id: string) => {
    const x = catchments.get(id);
    if (!x) return null;
    const cf = x.compliant.fields;
    const nf = x.nonCompliant.fields;
    const ca = x.compliant.acres;
    const na = x.nonCompliant.acres;
    return { cf, nf, ca, na, pf: pct(nf, cf + nf), pa: pct(na, ca + na) };
  };
  function download() {
    const head = ["facility_id", "type", "name", "place", "compliant_polygons", "noncompliant_polygons", "compliant_pct_of_polygons", "noncompliant_pct_of_polygons", "compliant_acres", "noncompliant_acres", "compliant_pct_of_acres", "noncompliant_pct_of_acres"]; // prettier-ignore
    const body = rows.map((r) => {
      const v = line(r.id);
      return [r.id, r.kind, r.name, r.place, v?.cf, v?.nf, v ? (100 - v.pf).toFixed(4) : null, v?.pf.toFixed(4), v?.ca.toFixed(1), v?.na.toFixed(1), v ? (100 - v.pa).toFixed(4) : null, v?.pa.toFixed(4)]; // prettier-ignore
    });
    const text = [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = plant ? `soytrace-${plant.id}-compliance-by-facility.csv` : "soytrace-compliance-by-facility.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="chart-card supply-wide soy-fac">
      <div className="soy-fac-head">
        <div>
          <h3>{c.facTitle}</h3>
          <p className="chart-note">{c.facIntro}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={download}>
          {c.facDownload}
        </button>
      </div>
      <div className="supply-tp-tools">
        <div className="seg" role="group" aria-label={c.facTitle}>
          {(plant ? (["plant"] as const) : (["all", "plant", "adm", "tp"] as const)).map((v) => (
            <button key={v} type="button" className={kind === v ? "on" : ""} aria-pressed={kind === v} onClick={() => setKind(v)}>
              {v === "all" ? c.statusAll : kindLabel[v]}
            </button>
          ))}
        </div>
        <label className="search-field">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.tpSearch} aria-label={c.tpSearch} />
        </label>
      </div>
      <div className="soy-table-wrap tall">
        <table className="data-table soy-table soy-fac-table">
          <thead>
            <tr>
              <th>{c.facCol}</th>
              <th className="num">{c.facCompliantN}</th>
              <th className="num">{c.facNcN}</th>
              <th className="num">{c.facPctN}</th>
              <th className="num">{c.facCompliantA}</th>
              <th className="num">{c.facNcA}</th>
              <th className="num">{c.facPctA}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = line(r.id);
              if (!v) return null;
              return (
                <tr
                  key={r.id}
                  className={[scope === r.id ? "on" : "", r.kind === "chain" ? "total" : "", r.sub ? "sub" : ""].join(" ").trim()}
                  tabIndex={0}
                  onClick={() => setScope(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && setScope(r.id)}
                >
                  <td>
                    {r.name}
                    <span className="soy-cell-sub">
                      {kindLabel[r.kind]} · {r.place}
                    </span>
                  </td>
                  <td className="num tabular-nums">{countF(v.cf)}</td>
                  <td className="num tabular-nums">{countF(v.nf)}</td>
                  <td className="num tabular-nums">
                    <span className="comply">{formatSharePct(pct(v.cf, v.cf + v.nf), lang)}</span> / {formatSharePct(v.pf, lang)}
                  </td>
                  <td className="num tabular-nums">{acF(v.ca)}</td>
                  <td className="num tabular-nums">{acF(v.na)}</td>
                  <td className="num tabular-nums">
                    <span className="comply">{formatSharePct(pct(v.ca, v.ca + v.na), lang)}</span> / {formatSharePct(v.pa, lang)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ComboRowProps = { label: string; t: ComboTotals | null; cls?: string; onOpen?: () => void; expanded?: boolean; lang: Lang };

function ComboRow({ label, t, cls = "", onOpen, expanded, lang }: ComboRowProps) {
  if (!t) return null;
  const p = pct(t.ncAcres, t.acres + t.ncAcres);
  return (
    <tr
      className={`${cls} ${onOpen ? "clickable" : ""} ${expanded ? "open" : ""}`.trim()}
      tabIndex={onOpen ? 0 : undefined}
      aria-expanded={onOpen ? !!expanded : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onOpen && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <td>
        <span className="soy-combo-label">
          {onOpen ? <Chevron open={expanded} /> : null}
          {label}
        </span>
      </td>
      <td className="num tabular-nums">{formatCount(t.fields, lang)}</td>
      <td className="num tabular-nums">{formatAcres(t.acres, lang)}</td>
      <td className="num tabular-nums">{formatCount(t.ncFields, lang)}</td>
      <td className="num tabular-nums">{formatAcres(t.ncAcres, lang)}</td>
      <td className="num tabular-nums comply">{formatSharePct(pct(t.acres, t.acres + t.ncAcres), lang)}</td>
      <td className="num tabular-nums">{formatSharePct(p, lang)}</td>
    </tr>
  );
}

function ComboHead({ c }: { c: SoySupplyCopy }) {
  return (
    <thead>
      <tr>
        <th>{c.colCatchment}</th>
        <th className="num">{c.colCompliantN}</th>
        <th className="num">{c.colCompliantA}</th>
        <th className="num">{c.colNcN}</th>
        <th className="num">{c.colNcA}</th>
        <th className="num">{c.colCompliantShareA}</th>
        <th className="num">{c.colNcShareA}</th>
      </tr>
    </thead>
  );
}

/** Each catchment inside an opened statistics row, as rows of the same
 * table (same columns); long lists (third parties) show the first few. */
function ComboParts({ data, c, lang, parts }: { data: SupplyData; c: SoySupplyCopy; lang: Lang; parts: [string, string[]][] }) {
  const [all, setAll] = useState(false);
  if (parts.length < 2) return null;
  const LIMIT = 14;
  // A long list (third parties) goes largest first, so the cut keeps what matters.
  const ordered = parts.length > LIMIT ? [...parts].sort((a, b) => (comboTotals(data, b[1])?.acres ?? 0) - (comboTotals(data, a[1])?.acres ?? 0)) : parts;
  const shown = all ? ordered : ordered.slice(0, LIMIT);
  return (
    <>
      <tr className="soy-combo-part-head">
        <td colSpan={7}>{c.comboParts}</td>
      </tr>
      {shown.map(([label, pids]) => {
        const t = comboTotals(data, pids);
        if (!t) return null;
        const p = pct(t.ncAcres, t.acres + t.ncAcres);
        return (
          <tr key={label} className="soy-combo-part">
            <td>{label}</td>
            <td className="num tabular-nums">{formatCount(t.fields, lang)}</td>
            <td className="num tabular-nums">{formatAcres(t.acres, lang)}</td>
            <td className="num tabular-nums">{formatCount(t.ncFields, lang)}</td>
            <td className="num tabular-nums">{formatAcres(t.ncAcres, lang)}</td>
            <td className="num tabular-nums comply">{formatSharePct(100 - p, lang)}</td>
            <td className="num tabular-nums">{formatSharePct(p, lang)}</td>
          </tr>
        );
      })}
      {parts.length > LIMIT ? (
        <tr className="soy-combo-part soy-combo-more">
          <td colSpan={7}>
            <button type="button" className="btn-text" onClick={() => setAll((v) => !v)}>
              {all ? c.showFewer : fill(c.showAllN, { n: formatCount(parts.length, lang) })}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Below the per-catchment rows: the non-compliant fields in the row's scope
 * (2025 land use, states) and the way to the map. */
function ComboDetail({ c, lang, ids, onMap }: { c: SoySupplyCopy; lang: Lang; ids: string[]; onMap: () => void }) {
  const [nc, setNc] = useState<SoyFeature[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadNonCompliant()
      .then((fc) => live && setNc(fc.features))
      .catch(() => live && setNc([]));
    return () => {
      live = false;
    };
  }, []);
  const inside = (nc ?? []).filter((f) => ids.some((id) => inScope(id, { flags: Number(f.properties.f), k: String(f.properties.k ?? "") })));
  const count = (key: string, val: string) => inside.filter((f) => String(f.properties[key] ?? "unknown") === val).length;
  const states = topStates(
    Object.entries(
      inside.reduce<Record<string, number>>((acc, f) => {
        const st = String(f.properties.s ?? "—");
        acc[st] = (acc[st] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([state, fields]) => ({ state, fields })),
    6,
  );
  const n = inside.length;
  const shareOf = (v: number) => (n ? formatSharePct(pct(v, n), lang) : "—");
  const small = (title: string, rows: [string, number][]) => (
    <table className="data-table soy-table soy-combo-mini">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">{c.colFieldsShort}</th>
          <th className="num">{c.colShareShort}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, v]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num tabular-nums">{formatCount(v, lang)}</td>
            <td className="num tabular-nums">{shareOf(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="soy-combo-detail">
      <p className="soy-combo-detail-title">
        {c.comboNcIn} · {formatCount(n, lang)}
      </p>
      {nc == null ? (
        <p className="chart-note">{c.comboLoadingNc}</p>
      ) : n === 0 ? null : (
        <div className="soy-combo-nc-grid">
          {small(c.ncUseTitle, [
            [c.ncUseCrop, count("u", "crop")],
            [c.ncUsePasture, count("u", "pasture")],
            [c.ncUseNonAg, count("u", "nonag")],
          ])}
          {small(
            c.comboNcStates,
            states.map((x) => [x.state === "other" ? fill(c.otherStates, { n: formatCount(x.n, lang) }) : stateName(x.state), x.fields] as [string, number]),
          )}
        </div>
      )}
      <div className="soy-combo-actions">
        {ids.includes("tp") ? <p className="chart-note">{c.comboTpMap}</p> : <span />}
        <button type="button" className="btn-primary" onClick={onMap}>
          {c.comboOpenMap} →
        </button>
      </div>
    </div>
  );
}

/** The user's ask: statistics for the plants' 0–40 / 0–80 NM catchments, all
 * ADM elevators, their combinations and third parties; a row opens it on the
 * map. With one plant chosen: that plant's rings only. */
function ComboTable({ data, c, lang, open, plant }: { data: SupplyData; c: SoySupplyCopy; lang: Lang; open: (ids: string[]) => void; plant?: Plant }) {
  const sites = data.admElevators.filter((e) => e.radiusM);
  const siteIds = sites.map((e) => e.id);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const siteParts = sites.map((e) => [e.name, [e.id]] as [string, string[]]);
  const tpParts = data.thirdParty.map((e) => [[e.company, [e.county, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "), [e.id]] as [string, string[]]);
  const admLabel = fill(c.comboAdm, { n: sites.length });
  const tpLabel = fill(c.comboTp, { n: data.thirdParty.length });
  const p40 = data.plants.map((p) => `${p.key}40`);
  const p80 = data.plants.map((p) => `${p.key}80`);
  const parts40 = data.plants.map((p) => [unitName(`${p.key}40`, data, c)!, [`${p.key}40`]] as [string, string[]]);
  const parts80 = data.plants.map((p) => [unitName(`${p.key}80`, data, c)!, [`${p.key}80`]] as [string, string[]]);
  const plants40 = fill(c.comboPlants40, { n: data.plants.length });
  const plants80 = fill(c.comboPlants80, { n: data.plants.length });
  const presets: [string, string, string[], [string, string[]][]][] = plant
    ? [
        ["p40", unitName(`${plant.key}40`, data, c)!, [`${plant.key}40`], []],
        ["p80r", unitName(`${plant.key}80r`, data, c)!, [`${plant.key}80r`], []],
        ["p80", unitName(`${plant.key}80`, data, c)!, [`${plant.key}80`], []],
      ]
    : [
        ["p40", plants40, p40, parts40],
        ["p80", plants80, p80, parts80],
        ["adm", admLabel, siteIds, siteParts],
        ["p40adm", fill(c.comboPlusAdm, { a: plants40 }), [...p40, ...siteIds], [[plants40, p40], [admLabel, siteIds]]],
        ["p80adm", fill(c.comboPlusAdm, { a: plants80 }), [...p80, ...siteIds], [[plants80, p80], [admLabel, siteIds]]],
        ["tp", tpLabel, ["tp"], tpParts],
        ["all", c.comboAll, [...p80, ...siteIds, "tp"], [[plants80, p80], [admLabel, siteIds], [tpLabel, ["tp"]]]],
      ];
  return (
    <section className="chart-card supply-wide soy-combo">
      <h3>{c.comboTitle}</h3>
      <p className="chart-note">
        {c.comboIntro} {c.comboOpen}
      </p>
      <div className="soy-table-wrap">
        <table className="data-table soy-table soy-combo-table">
          <ComboHead c={c} />
          <tbody>
            {presets.map(([key, label, ids, parts]) => (
              <Fragment key={key}>
                <ComboRow
                  label={label}
                  t={comboTotals(data, ids)}
                  cls={key === "all" ? "total" : ""}
                  lang={lang}
                  expanded={openKey === key}
                  onOpen={() => setOpenKey(openKey === key ? null : key)}
                />
                {openKey === key ? (
                  <>
                    <ComboParts data={data} c={c} lang={lang} parts={parts} />
                    <tr className="soy-combo-detail-row">
                      <td colSpan={7}>
                        <ComboDetail c={c} lang={lang} ids={ids} onMap={() => open(key === "all" ? [] : ids)} />
                      </td>
                    </tr>
                  </>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
/** Data & method: where the figures come from and how they are built. */
export function SoyDocsView({ data, c, lang, present }: { data: SupplyData; c: SoySupplyCopy; lang: Lang; present: boolean }) {
  return (
    <>
      <div className="summary-head">
        <div>
          <h1>{c.docsTitle}</h1>
          <p className="summary-sub">{c.docsIntro}</p>
        </div>
      </div>
      <section className="chart-card supply-notes supply-wide">
        <h3>{c.docsSources}</h3>
        <ul>
          <li>{c.docsSource1}</li>
          <li>{c.docsSource2}</li>
          <li>{c.docsSource3}</li>
          <li>{c.docsSource4}</li>
          <li>{c.docsSource5}</li>
        </ul>
      </section>
      <section className="chart-card supply-notes supply-wide">
        <h3>{c.docsDefs}</h3>
        <ul>
          <li>{c.docsDef1}</li>
          <li>{c.docsDef2}</li>
          <li>{c.docsDef3}</li>
          <li>{fill(c.method1, { x: formatCount(data.network.railKm.X ?? 0, lang) })}</li>
          <li>{fill(c.method2, { km2: formatCount(data.network.riverSystemKm2, lang), n: data.network.riverSystems ?? 1 })}</li>
        </ul>
      </section>
      {present ? null : <DataNotes c={c} />}
    </>
  );
}
