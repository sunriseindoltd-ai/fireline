import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { loadNonCompliant, type SoyFeature } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa, formatLarge } from "@/lib/format";
import { SOY_GROUPS, SOY_GROUP_COLORS, SOY_YEARS_COLORS, type SoyCopy } from "@/lib/soy-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  FIELD_COLOR,
  NC_COLOR,
  comboScope,
  comboTotals,
  inScope,
  pct,
  type Catchment,
  type ComboTotals,
  type SupplyData,
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
};

/** Level 1 and the three supplier types (level 2) — the tabs above the figures. */
const TIERS = ["all", "direct", "adm", "tp"] as const;
/** Rows of the true-scale table. */

function tierLabel(id: string, c: SoySupplyCopy) {
  return (
    {
      all: c.scopeAll,
      direct: c.scopeDirect,
      q40: c.scopeQ40,
      q80r: c.scopeQ80r,
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

/** The Quincy supply chain: catchments, fields, non-compliant fields at true scale. */
export function SoySupplyView({ data, c, sc, lang, scope, setScope, present, onOpenMap }: Common) {
  const catchments = useCatchments(data);
  const k = catchments.get(scope) ?? catchments.get("all")!;
  const countF = (n: number) => formatCount(n, lang);
  // Areas in acres (the client's unit); hectares as the secondary figure.
  const haF = (acres: number) => formatAcres(acres, lang);
  const acF = (acres: number) => formatHa(acres * AC_TO_HA, lang);
  const nck = k.nonCompliant;
  const share = pct(nck.acres, k.compliant.acres + nck.acres);
  // "All catchments" shows ADM's whole list, including the fields outside every catchment.
  const ncAll = data.nonCompliantAll;
  const ncForCard = scope === "all" ? ncAll : nck;
  const outside = ncAll.fields - (catchments.get("all")?.nonCompliant.fields ?? 0);
  // A statistics row opens the map on that scope (the whole chain for an empty list).
  const openIds = (ids: string[]) => {
    setScope(ids.length ? comboTarget(ids) : "all");
    onOpenMap();
  };
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
        <div className="summary-tools">
          <button type="button" className="btn-secondary" onClick={onOpenMap}>
            {c.openMap}
          </button>
        </div>
      </div>
      <ScopeTabs scope={scope} setScope={setScope} data={data} c={c} />

      <div className="kpi-row">
        <KpiTile value={countF(k.compliant.fields)} label={c.kpiFields} hint={c.kpiFieldsHint} />
        <KpiTile
          value={haF(k.compliant.acres)}
          label={c.kpiArea}
          hint={c.kpiAreaHint}
          sub={`${acF(k.compliant.acres)} · ${fill(c.ofAreaShare, { p: formatSharePct(100 - share, lang) })}`}
        />
        <KpiTile tone="danger" value={countF(nck.fields)} label={c.kpiNcFields} hint={c.kpiNcFieldsHint} />
        <KpiTile
          tone="danger"
          value={haF(nck.acres)}
          label={c.kpiNcArea}
          hint={c.kpiNcAreaHint}
          sub={fill(c.changed, { v: haF(nck.changeAcres) })}
        />
        <KpiTile
          tone="comply"
          value={formatSharePct(pct(k.compliant.acres, k.compliant.acres + nck.acres), lang)}
          label={c.kpiCompliantShare}
          hint={c.kpiNcShareHint}
          sub={fill(c.ncShareSub, { p: formatSharePct(share, lang) })}
        />
      </div>

      <ComboBuilder data={data} c={c} lang={lang} open={openIds} />
      <ComboTable data={data} c={c} lang={lang} open={openIds} />

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
          {present ? null : (
            <p className="chart-note">
              {fill(c.ncDual, { n: countF(ncAll.alsoCompliant) })} {fill(c.ncPointOnly, { n: countF(ncAll.pointOnly) })}
            </p>
          )}
        </section>

        <section className="chart-card">
          <h3>{c.ncWhyTitle}</h3>
          <p className="chart-note">{c.ncWhyIntro}</p>
          <h3 className="soy-subhead">{c.ncExtentTitle}</h3>
          <table className="data-table soy-table">
            <tbody>
              {(
                [
                  ["whole", c.ncExtentWhole],
                  ["most", c.ncExtentMost],
                  ["part", c.ncExtentPart],
                  ["unknown", c.unknown],
                ] as const
              )
                .filter(([key]) => (ncForCard.byExtent?.[key] ?? 0) > 0)
                .map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="num tabular-nums">{countF(ncForCard.byExtent?.[key] ?? 0)}</td>
                    <td className="num tabular-nums">{formatSharePct(pct(ncForCard.byExtent?.[key] ?? 0, ncForCard.fields), lang)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="chart-note">
            {fill(c.ncExtentNote, {
              changed: haF(ncForCard.changeAcres),
              total: haF(ncForCard.acres),
              p: formatSharePct(pct(ncForCard.changeAcres, ncForCard.acres), lang),
            })}
          </p>
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
                .filter(([key]) => (ncForCard.byUse?.[key] ?? 0) > 0)
                .map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="num tabular-nums">{countF(ncForCard.byUse?.[key] ?? 0)}</td>
                    <td className="num tabular-nums">{formatSharePct(pct(ncForCard.byUse?.[key] ?? 0, ncForCard.fields), lang)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="chart-note">{c.ncUseNote}</p>
        </section>
      </div>

      <FacilityTable data={data} catchments={catchments} c={c} lang={lang} scope={scope} setScope={setScope} />

      <CropCharts k={k} c={c} sc={sc} lang={lang} />
      {present ? null : <DataNotes c={c} />}
    </>
  );
}

type FacilityKind = "chain" | "plant" | "adm" | "tp";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ADM's ask: compliant vs non-compliant polygons for the whole Quincy supply
 * chain and per facility (the crushing plant and every elevator). */
function FacilityTable({
  data,
  catchments,
  c,
  lang,
  scope,
  setScope,
}: {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  lang: Lang;
  scope: string;
  setScope: (id: string) => void;
}) {
  const [kind, setKind] = useState<"all" | FacilityKind>("all");
  const [query, setQuery] = useState("");
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const plantPlace = [data.plant.city, data.plant.state].filter(Boolean).join(", ");
  const rows: { id: string; kind: FacilityKind; name: string; place: string; sub?: boolean }[] = [
    { id: "all", kind: "chain", name: c.scopeAll, place: plantPlace },
    { id: "direct", kind: "plant", name: `${data.plant.name} · ${c.scopeQ80}`, place: plantPlace },
    { id: "q40", kind: "plant", name: c.scopeQ40, place: plantPlace, sub: true },
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
    return { cf, nf, ca, na, pf: pct(nf, cf + nf), pa: pct(na, ca + na), defo: x.nonCompliant.changeAcres };
  };
  function download() {
    const head = ["facility_id", "type", "name", "place", "compliant_polygons", "noncompliant_polygons", "compliant_pct_of_polygons", "noncompliant_pct_of_polygons", "compliant_acres", "noncompliant_acres", "compliant_pct_of_acres", "noncompliant_pct_of_acres", "deforested_acres"]; // prettier-ignore
    const body = rows.map((r) => {
      const v = line(r.id);
      return [r.id, r.kind, r.name, r.place, v?.cf, v?.nf, v ? (100 - v.pf).toFixed(4) : null, v?.pf.toFixed(4), v?.ca.toFixed(1), v?.na.toFixed(1), v ? (100 - v.pa).toFixed(4) : null, v?.pa.toFixed(4), v?.defo.toFixed(1)]; // prettier-ignore
    });
    const text = [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "soytrace-quincy-compliance-by-facility.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="chart-card supply-wide">
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
          {(["all", "plant", "adm", "tp"] as const).map((v) => (
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
              <th className="num">{c.facDefo}</th>
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
                  <td className="num tabular-nums">{acF(v.defo)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chart-note">{c.facNote}</p>
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
        {onOpen ? <span className="soy-combo-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span> : null}
        {label}
        <span className="scale-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(p, 0.4)}%` }} />
        </span>
      </td>
      <td className="num tabular-nums">{formatCount(t.fields, lang)}</td>
      <td className="num tabular-nums">{formatAcres(t.acres, lang)}</td>
      <td className="num tabular-nums">{formatCount(t.ncFields, lang)}</td>
      <td className="num tabular-nums">{formatAcres(t.ncAcres, lang)}</td>
      <td className="num tabular-nums">{formatAcres(t.defo, lang)}</td>
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
        <th className="num">{c.colDefo}</th>
        <th className="num">{c.colCompliantShareA}</th>
        <th className="num">{c.colNcShareA}</th>
      </tr>
    </thead>
  );
}

/** What is inside one statistics row: its catchments one by one, and the
 * non-compliant fields in it (how much changed, 2025 land use, states). */
function ComboDetail({
  data,
  c,
  lang,
  ids,
  parts,
  onMap,
}: {
  data: SupplyData;
  c: SoySupplyCopy;
  lang: Lang;
  ids: string[];
  parts: [string, string[]][];
  onMap: () => void;
}) {
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
  const states = Object.entries(
    inside.reduce<Record<string, number>>((acc, f) => {
      const st = String(f.properties.s ?? "—");
      acc[st] = (acc[st] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const n = inside.length;
  const share = (v: number) => (n ? ` · ${formatSharePct(pct(v, n), lang)}` : "");
  return (
    <div className="soy-combo-detail">
      {parts.length > 1 ? (
        <div className="soy-combo-parts">
          <p className="eyebrow">{c.comboParts}</p>
          <div className="soy-table-wrap short">
            <table className="data-table soy-table">
              <tbody>
                {parts.map(([label, pids]) => {
                  const t = comboTotals(data, pids);
                  if (!t) return null;
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num tabular-nums">{formatCount(t.fields, lang)}</td>
                      <td className="num tabular-nums">{formatAcres(t.acres, lang)}</td>
                      <td className="num tabular-nums">{formatCount(t.ncFields, lang)}</td>
                      <td className="num tabular-nums comply">{formatSharePct(pct(t.acres, t.acres + t.ncAcres), lang)}</td>
                      <td className="num tabular-nums">{formatSharePct(pct(t.ncAcres, t.acres + t.ncAcres), lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="soy-combo-nc">
        <p className="eyebrow">
          {c.comboNcIn} · {formatCount(n, lang)}
        </p>
        {nc == null ? (
          <p className="chart-note">{c.comboLoadingNc}</p>
        ) : (
          <div className="soy-combo-nc-grid">
            <dl className="facts">
              {(
                [
                  [c.ncExtentWhole, count("ex", "whole")],
                  [c.ncExtentMost, count("ex", "most")],
                  [c.ncExtentPart, count("ex", "part")],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {formatCount(v, lang)}
                    {share(v)}
                  </dd>
                </div>
              ))}
            </dl>
            <dl className="facts">
              {(
                [
                  [c.ncUseCrop, count("u", "crop")],
                  [c.ncUsePasture, count("u", "pasture")],
                  [c.ncUseNonAg, count("u", "nonag")],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {formatCount(v, lang)}
                    {share(v)}
                  </dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="soy-combo-sub">{c.comboNcStates}</p>
              <p className="soy-combo-states">{states.map(([st, v]) => `${st} ${formatCount(v, lang)}`).join(" · ") || "—"}</p>
            </div>
          </div>
        )}
      </div>
      <div className="soy-combo-actions">
        {ids.includes("tp") || ids.includes("tpcore") ? <p className="chart-note">{c.comboTpMap}</p> : <span />}
        <button type="button" className="btn-primary" onClick={onMap}>
          {c.comboOpenMap} →
        </button>
      </div>
    </div>
  );
}

/** Map scope for a set of catchment ids; third parties open their list (too many fields to draw). */
function comboTarget(ids: string[]): string {
  if (ids.includes("tp") || ids.includes("tpcore")) {
    const rest = ids.filter((x) => x !== "tp" && x !== "tpcore");
    return rest.length ? "all" : ids.includes("tp") ? "tp" : "tpcore";
  }
  return comboScope(ids);
}

/** The user's ask: build any union — Quincy 0–40 / 0–80 NM, any ADM elevators,
 * third parties — compliant and non-compliant together, each field once. */
function ComboBuilder({ data, c, lang, open }: { data: SupplyData; c: SoySupplyCopy; lang: Lang; open: (ids: string[]) => void }) {
  const sites = data.admElevators.filter((e) => e.radiusM);
  const siteIds = sites.map((e) => e.id);
  const [quincy, setQuincy] = useState<"none" | "q40" | "q80">("q40");
  const [picked, setPicked] = useState<string[]>(siteIds);
  const [tp, setTp] = useState<"none" | "tp" | "tpcore">("none");
  const ids = [...(quincy === "none" ? [] : [quincy]), ...picked, ...(tp === "none" ? [] : [tp])];
  const [expanded, setExpanded] = useState(false);
  const parts: [string, string[]][] = [
    ...(quincy === "none" ? [] : [[quincy === "q40" ? c.comboQ40 : c.comboQ80, [quincy]] as [string, string[]]]),
    ...sites.filter((e) => picked.includes(e.id)).map((e) => [e.name, [e.id]] as [string, string[]]),
    ...(tp === "none" ? [] : [[tp === "tp" ? fill(c.comboTp, { n: data.thirdParty.length }) : c.scopeTp56, [tp]] as [string, string[]]]),
  ];
  const togglePick = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  return (
    <section className="chart-card supply-wide soy-combo soy-combo-builder">
      <h3>{c.comboBuild}</h3>
      <div className="soy-combo-build">
        <div className="soy-combo-line">
          <span>{c.comboQuincy}</span>
          <div className="seg" role="group" aria-label={c.comboQuincy}>
            {(["none", "q40", "q80"] as const).map((v) => (
              <button key={v} type="button" className={quincy === v ? "on" : ""} aria-pressed={quincy === v} onClick={() => setQuincy(v)}>
                {v === "none" ? c.comboNone : v === "q40" ? c.comboQ40 : c.comboQ80}
              </button>
            ))}
          </div>
        </div>
        <div className="soy-combo-line top">
          <span>
            {c.comboAdmPick} · {picked.length}/{sites.length}
          </span>
          <div className="soy-combo-sites">
            <div className="soy-combo-quick">
              <button type="button" className="btn-text" onClick={() => setPicked(siteIds)}>
                {c.comboAllSites}
              </button>
              <button type="button" className="btn-text" onClick={() => setPicked([])}>
                {c.comboNoSites}
              </button>
            </div>
            {sites.map((e) => (
              <label key={e.id} className="check-inline">
                <input type="checkbox" checked={picked.includes(e.id)} onChange={() => togglePick(e.id)} />
                {e.city ?? e.name}
                {e.state ? `, ${e.state}` : ""}
              </label>
            ))}
          </div>
        </div>
        <div className="soy-combo-line">
          <span>{c.comboTpPick}</span>
          <div className="seg" role="group" aria-label={c.comboTpPick}>
            {(["none", "tp", "tpcore"] as const).map((v) => (
              <button key={v} type="button" className={tp === v ? "on" : ""} aria-pressed={tp === v} onClick={() => setTp(v)}>
                {v === "none" ? c.comboNone : v === "tp" ? c.comboAllSites : c.comboTpCore}
              </button>
            ))}
          </div>
        </div>
      </div>
      {ids.length ? (
        <div className="soy-table-wrap">
          <table className="data-table soy-table scale-table">
            <ComboHead c={c} />
            <tbody>
              <ComboRow label={c.comboCustom} t={comboTotals(data, ids)} cls="custom" lang={lang} expanded={expanded} onOpen={() => setExpanded((v) => !v)} />
              {expanded ? (
                <tr className="soy-combo-detail-row">
                  <td colSpan={8}>
                    <ComboDetail data={data} c={c} lang={lang} ids={ids} parts={parts} onMap={() => open(ids)} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="chart-note">{c.comboPickSome}</p>
      )}
      <p className="chart-note">{c.comboOpen}</p>
    </section>
  );
}

/** The user's ask: statistics for Quincy 0–40 / 0–80 NM, all ADM elevators,
 * their combinations and third parties; a row opens it on the map. */
function ComboTable({ data, c, lang, open }: { data: SupplyData; c: SoySupplyCopy; lang: Lang; open: (ids: string[]) => void }) {
  const sites = data.admElevators.filter((e) => e.radiusM);
  const siteIds = sites.map((e) => e.id);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const siteParts = sites.map((e) => [e.name, [e.id]] as [string, string[]]);
  const tpParts = data.thirdParty.map((e) => [[e.company, [e.county, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "), [e.id]] as [string, string[]]);
  const admLabel = fill(c.comboAdm, { n: sites.length });
  const tpLabel = fill(c.comboTp, { n: data.thirdParty.length });
  const presets: [string, string, string[], [string, string[]][]][] = [
    ["q40", c.comboQ40, ["q40"], []],
    ["q80", c.comboQ80, ["q80"], []],
    ["adm", admLabel, siteIds, siteParts],
    ["q40adm", c.comboQ40Adm, ["q40", ...siteIds], [[c.comboQ40, ["q40"]], [admLabel, siteIds], ...siteParts]],
    ["q80adm", c.comboQ80Adm, ["q80", ...siteIds], [[c.comboQ80, ["q80"]], [admLabel, siteIds], ...siteParts]],
    ["tp", tpLabel, ["tp"], [[c.scopeTp56, ["tpcore"]], ...tpParts]],
    ["all", c.comboAll, ["q80", ...siteIds, "tp"], [[c.comboQ80, ["q80"]], [admLabel, siteIds], [tpLabel, ["tp"]]]],
  ];
  return (
    <section className="chart-card supply-wide soy-combo">
      <h3>{c.comboTitle}</h3>
      <p className="chart-note">
        {c.comboIntro} {c.comboOpen}
      </p>
      <div className="soy-table-wrap">
        <table className="data-table soy-table scale-table">
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
                  <tr className="soy-combo-detail-row">
                    <td colSpan={8}>
                      <ComboDetail data={data} c={c} lang={lang} ids={ids} parts={parts} onMap={() => open(key === "all" ? [] : ids)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chart-note scale-legend">
        <i style={{ background: FIELD_COLOR }} /> {c.scaleCompliant} <i style={{ background: NC_COLOR }} /> {c.scaleNonCompliant}
      </p>
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
