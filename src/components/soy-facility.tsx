import { useMemo, useState } from "react";
import { KpiTile } from "@/components/kpi-tile";
import { BufferSeg, SoyRelated, scopeSummary } from "@/components/soy-side";
import { ComboDetail, ComboHead, ComboRow, ComboTable, CropCharts, FacilityTable, catchmentLabel } from "@/components/soy-supply";
import { TractPicker } from "@/components/soy-tract";
import { SoySupplyMap, type OtherPlant, type ScopeFields, type SoyFeature } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount } from "@/lib/format";
import type { SoyCopy } from "@/lib/soy-copy";
import { downloadFieldsCsv, downloadFieldsGeo } from "@/lib/soy-downloads";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  comboTotals,
  scopeForSel,
  pct,
  placeOf,
  plantUnit,
  plantByKey,
  radiusLabel,
  statsKey,
  tpName,
  type Catchment,
  type PlantBuffer,
  type SupplyData,
} from "@/lib/soy-supply";

export type FacilityKind = "plant" | "adm" | "tp";

/** What a facility id stands for: a plant catchment (<key>40 / <key>80), an ADM elevator site or a third party. */
export function facilityOf(id: string, data: SupplyData) {
  const u = plantUnit(id);
  if (u) {
    const plant = plantByKey(data, u.key);
    return plant ? { kind: "plant" as const, plant, ring: u.ring } : null;
  }
  const adm = data.admElevators.find((e) => e.id === id && e.radiusM);
  if (adm) return { kind: "adm" as const, adm };
  const tp = data.thirdParty.find((e) => e.id === id);
  if (tp) return { kind: "tp" as const, tp };
  return null;
}

type Props = {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  sc: SoyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  /** The facility's catchment id (q80, adm3, tp17…). */
  id: string;
  buffer: PlantBuffer;
  setBuffer: (b: PlantBuffer) => void;
  cdlNames: Record<string, string>;
  otherPlants: OtherPlant[];
  canDownload: boolean;
  present: boolean;
  /** The combination picker's selection (shared with the map). */
  sel: string[];
  setSel: (ids: string[]) => void;
  onHome: () => void;
  onOpenList: (kind: "adm" | "tp") => void;
  onOpenFacility: (id: string) => void;
  onOpenMap: () => void;
  onOpenNc: (scope: string) => void;
  /** Open one field on the map (the scope stays this facility). */
  onOpenField: (id: string) => void;
  onReport: () => void;
};

/**
 * One facility's page (a crushing plant at 0–40 / 0–80 NM, an ADM elevator or
 * a third-party facility): its figures, its catchment on the map, the
 * non-compliant fields in it, crop history and counties, downloads for this
 * catchment, and the combination picker as an advanced tool at the end.
 */
export function SoyFacilityPage({ data, catchments, c, sc, nav, lang, id, buffer, setBuffer, cdlNames, otherPlants, canDownload, present, sel, setSel, onHome, onOpenList, onOpenFacility, onOpenMap, onOpenNc, onOpenField, onReport }: Props) {
  const fac = facilityOf(id, data);
  const k = catchments.get(id);
  const [scopeFields, setScopeFields] = useState<ScopeFields>({ fields: [], nc: [], complete: false, loading: true, scope: null });
  const [tractOpen, setTractOpen] = useState(false);
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const miF = (n: number | null | undefined) => (n == null ? null : Number(n).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }));
  const sidePlants = useMemo(() => data.plants.map((p) => ({ id: p.id, name: p.city ?? p.name, hasData: true })), [data]);
  if (!fac || !k) {
    return (
      <div className="soy-fac-page">
        <nav className="soy-crumbs soy-page-crumbs">
          <button type="button" onClick={onHome}>{nav.crumbChain}</button>
        </nav>
        <p className="chart-note">{c.noMatches}</p>
      </div>
    );
  }
  const mapScopeRef = (() => {
    const key = statsKey(sel, data);
    if (!sel.length || key === id) return id;
    const sc = scopeForSel(sel, data);
    return sc === "all" ? id : sc;
  })();
  const fields = scopeFields.scope === mapScopeRef ? scopeFields : { fields: [], nc: [], complete: false, loading: true, scope: mapScopeRef };
  const title = fac.kind === "plant" ? fac.plant.name : fac.kind === "adm" ? fac.adm.name : tpName(fac.tp, data);
  const kindLabel = fac.kind === "plant" ? nav.kindPlant : fac.kind === "adm" ? nav.kindAdm : nav.kindTp;
  const at = fac.kind === "plant" ? fac.plant : fac.kind === "adm" ? fac.adm : fac.tp;
  const radius = fac.kind === "plant" ? null : fac.kind === "adm" ? fac.adm.radiusM! : fac.tp.radiusM;
  const subParts = [kindLabel, placeOf(at), radius ? radiusLabel(radius, lang) : null, at.railMi != null ? fill(nav.toRail, { n: miF(at.railMi) ?? "—" }) : null, at.riverMi != null ? fill(nav.toRiver, { n: miF(at.riverMi) ?? "—" }) : null].filter(Boolean);
  const ca = k.compliant.acres;
  const na = k.nonCompliant.acres;
  const review = k.nonCompliant.byBefore.crop ?? 0;
  // Non-compliant fields of this catchment, largest first (loaded by the map).
  const ncRows = [...fields.nc].sort((a, b) => Number(b.properties.a) - Number(a.properties.a));
  const before = (f: SoyFeature) => (f.properties.b === "treed" ? c.ncBeforeTreed : f.properties.b === "natural" ? c.ncBeforeNatural : f.properties.b === "crop" ? c.ncBeforeCrop : c.unknown);
  const dlRows = [...fields.nc.map((f) => ({ f, nc: true })), ...fields.fields.map((f) => ({ f, nc: false }))];
  const slug = id.replace(/[^\w-]+/g, "-");
  // The combination picker: this facility plus whatever else is ticked; a true combination gets its own figures.
  const combo = sel.length > 1 || (sel.length === 1 && sel[0] !== id) ? comboTotals(data, sel) : null;
  const comboIsThis = statsKey(sel, data) === id;
  // What the map draws: this catchment alone, or the ticked combination (user, 10 Oct 2026: the map
  // must follow the ticks). All third parties together are too many fields: the map keeps this one.
  const comboScopeId = !sel.length || comboIsThis ? id : scopeForSel(sel, data);
  const mapScope = comboScopeId === "all" ? id : comboScopeId;
  const mapIsCombo = mapScope !== id;
  const dlName = mapIsCombo ? scopeSummary(sel, data, c, lang) : catchmentLabel(id, data, c);
  const dlSlug = mapIsCombo ? "combo-" + slug : slug;
  const crumbs: { label: string; onClick?: () => void }[] =
    fac.kind === "plant"
      ? [{ label: nav.crumbPlants }]
      : [{ label: fac.kind === "adm" ? nav.listAdmTitle : nav.listTpTitle, onClick: () => onOpenList(fac.kind as "adm" | "tp") }];

  return (
    <div className="soy-fac-page">
      <nav className="soy-crumbs soy-page-crumbs" aria-label={c.crumbsLabel}>
        <span>
          <button type="button" onClick={onHome}>{nav.crumbChain}</button>
          <i aria-hidden="true">›</i>
        </span>
        {crumbs.map((x) => (
          <span key={x.label}>
            {x.onClick ? <button type="button" onClick={x.onClick}>{x.label}</button> : <em>{x.label}</em>}
            <i aria-hidden="true">›</i>
          </span>
        ))}
        <b aria-current="location">{fac.kind === "plant" ? (fac.plant.city ?? fac.plant.name) : title}</b>
      </nav>
      <div className="summary-head">
        <div>
          <h1>{title}</h1>
          <p className="summary-sub">{subParts.join(" · ")}</p>
        </div>
        <div className="summary-tools">
          {fac.kind === "plant" ? (
            <BufferSeg
              value={fac.ring === "40" ? "40" : "80"}
              onChange={(b) => {
                setBuffer(b);
                onOpenFacility(`${fac.plant.key}${b}`);
              }}
              c={c}
              label={c.bufferLabel}
            />
          ) : null}
          <button type="button" className="btn-secondary" onClick={onOpenMap}>
            {nav.openMap}
          </button>
        </div>
      </div>

      <div className="kpi-row soy-kpis4">
        <KpiTile tone="comply" value={countF(k.compliant.fields)} label={nav.kpiFields} hint={c.kpiFieldsHint} sub={acF(ca)} />
        <KpiTile value={formatSharePct(pct(ca, ca + na), lang)} label={nav.kpiShare} hint={c.kpiNcShareHint} sub={fill(nav.kpiShareSub, { p: formatSharePct(pct(na, ca + na), lang), acres: acF(na) })} />
        <KpiTile tone="danger" value={countF(k.nonCompliant.fields)} label={nav.kpiNcHere} hint={c.kpiNcAreaHint} sub={nav.kpiNcHereSub} onClick={k.nonCompliant.fields ? () => onOpenNc(id) : undefined} action={k.nonCompliant.fields ? nav.review : undefined} />
        <KpiTile value={countF(review)} label={nav.kpiReview} hint={c.kpiReviewHint} sub={nav.kpiReviewHere} />
      </div>

        <details className="chart-card soy-fac-combine" open={mapIsCombo}>
          <summary>
            <span>{nav.combineTitle}</span>
            {mapIsCombo ? <b>{scopeSummary(sel, data, c, lang)}</b> : <b className="muted">{nav.combineNone}</b>}
          </summary>
          <p className="chart-note">{nav.combineHint} {nav.combineMapNote}</p>
          <SoyRelated data={data} c={c} lang={lang} plants={sidePlants} plantSel="" sel={sel} setSel={setSel} catchments={catchments} buffer={buffer} setBuffer={setBuffer} />
          {combo && mapIsCombo ? (
            <div className="soy-fac-combo-stats">
              <h4>{nav.combineStats}</h4>
              <div className="soy-table-wrap">
                <table className="data-table soy-table soy-combo-table">
                  <ComboHead c={c} />
                  <tbody>
                    {sel.map((m) => (
                      <ComboRow key={m} label={m === "tp" ? fill(c.comboTp, { n: data.thirdParty.length }) : catchmentLabel(m, data, c)} t={comboTotals(data, [m])} lang={lang} />
                    ))}
                    <ComboRow label={scopeSummary(sel, data, c, lang)} t={combo} cls="total" lang={lang} />
                  </tbody>
                </table>
              </div>
              <p className="chart-note">{c.comboIntro}</p>
              <ComboDetail c={c} lang={lang} ids={sel} onMap={onOpenMap} />
            </div>
          ) : null}
          <div className="soy-fac-dl">
            <button type="button" className="btn-primary" onClick={onOpenMap}>
              {nav.combineOpen} →
            </button>
            {mapIsCombo ? (
              <button type="button" className="btn-secondary" onClick={() => setSel([id])}>
                {nav.combineReset}
              </button>
            ) : null}
          </div>
        </details>

      <div className="soy-fac-two">
        <div className="chart-card soy-map-card soy-fac-map">
          <SoySupplyMap
            key={mapScope}
            data={data}
            mode="supply"
            compact
            selected={mapScope}
            onSelect={(next) => next && next !== id && next !== "all" && onOpenFacility(next)}
            colorBy="status"
            basis="either"
            band={10}
            cdlNames={cdlNames}
            catchments={catchments}
            c={c}
            lang={lang}
            otherPlants={otherPlants}
            onScopeFields={setScopeFields}
          />
          {fields.loading ? (
            <p className="soy-map-status">
              <span className="spinner" aria-hidden="true" /> {c.loadingFields}
            </p>
          ) : null}
        </div>
        <section className="chart-card soy-fac-nc">
          <div className="soy-fac-head">
            <h3>{nav.ncHere}</h3>
            {k.nonCompliant.fields ? (
              <button type="button" className="btn-secondary" onClick={() => onOpenNc(id)}>
                {fill(nav.allN, { n: countF(k.nonCompliant.fields) })} ›
              </button>
            ) : null}
          </div>
          {k.nonCompliant.fields === 0 ? (
            <p className="chart-note">{nav.ncNoneHere}</p>
          ) : fields.loading && !ncRows.length ? (
            <p className="chart-note">{nav.ncLoading}</p>
          ) : (
            <ul className="soy-ov-list soy-fac-nc-list">
              {ncRows.slice(0, 6).map((f) => (
                <li key={String(f.properties.id)}>
                  <button type="button" onClick={() => onOpenField(String(f.properties.id))}>
                    <span>
                      <b className="mono">{String(f.properties.id)}</b>
                      <small> · {acF(Number(f.properties.a))}</small>
                      <small className="soy-fac-nc-sub">{before(f)}</small>
                    </span>
                    <span className="soy-ov-right">
                      {fill(nav.ncRowSub, { place: [f.properties.n, f.properties.s].filter(Boolean).join(", ") || "—", y: String(f.properties.y ?? "—") })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CropCharts k={k} c={c} sc={sc} lang={lang} />

      <div className="soy-fac-one">
        {canDownload ? (
          <section className="chart-card">
            <h3>{fill(nav.downloads, { name: dlName })}</h3>
            <div className="soy-fac-dl">
              <button type="button" className="btn-secondary" disabled={!dlRows.length} onClick={() => downloadFieldsCsv(dlRows, `soytrace-${dlSlug}-fields.csv`)}>
                CSV{fields.complete ? ` · ${fill(c.fieldsN, { n: countF(dlRows.length) })}` : ""}
              </button>
              <button type="button" className="btn-secondary" disabled={!dlRows.length} onClick={() => downloadFieldsGeo(dlRows, `soytrace-${dlSlug}-fields.geojson`)}>
                GeoJSON
              </button>
              {data.tract?.files[id] ? (
                <button type="button" className="btn-secondary" onClick={() => setTractOpen(true)}>
                  {nav.dlTract}
                </button>
              ) : null}
              {!present ? (
                <button type="button" className="btn-secondary" onClick={onReport}>
                  {nav.dlReport}
                </button>
              ) : null}
            </div>
            <p className="chart-note">{nav.dlFields}</p>
          </section>
        ) : null}
      </div>

      {fac.kind === "plant" ? (
        <ComboTable data={data} c={c} lang={lang} open={(ids) => { setSel(ids); onOpenMap(); }} plant={fac.plant} buffer={buffer} setBuffer={setBuffer} />
      ) : null}

      {tractOpen ? <TractPicker data={data} c={c} nav={nav} lang={lang} initial={[id]} onClose={() => setTractOpen(false)} /> : null}
    </div>
  );
}

/** ADM elevators or third-party facilities as a table; a row opens that facility's page. */
export function SoyFacilityList({ data, catchments, c, nav, lang, kind, buffer, setBuffer, onHome, onOpenFacility }: {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  kind: "adm" | "tp";
  buffer: PlantBuffer;
  setBuffer: (b: PlantBuffer) => void;
  onHome: () => void;
  onOpenFacility: (id: string) => void;
}) {
  const k = catchments.get(kind);
  const n = kind === "adm" ? data.admElevators.filter((e) => e.radiusM).length : data.thirdParty.length;
  const countF = (x: number) => formatCount(x, lang);
  return (
    <div className="soy-fac-page">
      <nav className="soy-crumbs soy-page-crumbs" aria-label={c.crumbsLabel}>
        <span>
          <button type="button" onClick={onHome}>{nav.crumbChain}</button>
          <i aria-hidden="true">›</i>
        </span>
        <b aria-current="location">{kind === "adm" ? nav.listAdmTitle : nav.listTpTitle}</b>
      </nav>
      <div className="summary-head">
        <div>
          <h1>{kind === "adm" ? nav.listAdmTitle : nav.listTpTitle}</h1>
          <p className="summary-sub">
            {fill(nav.listSub, { n: countF(n), f: countF(k?.compliant.fields ?? 0), nc: countF(k?.nonCompliant.fields ?? 0) })} {nav.listHint}
          </p>
        </div>
      </div>
      <FacilityTable
        key={kind}
        data={data}
        catchments={catchments}
        c={c}
        lang={lang}
        scope=""
        setScope={(id) => (id === "all" ? onHome() : onOpenFacility(id))}
        buffer={buffer}
        setBuffer={setBuffer}
        initialKind={kind}
        hideChain
        tall={false}
      />
    </div>
  );
}
