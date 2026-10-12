import { KpiTile } from "@/components/kpi-tile";
import { SoySupplyMap, type OtherPlant } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount } from "@/lib/format";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { pct, type Catchment, type PlantBuffer, type SoyAreas, type SupplyData } from "@/lib/soy-supply";

type Props = {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  areas: SoyAreas | null;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  buffer: PlantBuffer;
  cdlNames: Record<string, string>;
  otherPlants: OtherPlant[];
  /** The delivery date shown under the title. */
  dataDate: string;
  onOpenFacility: (id: string) => void;
  onOpenList: (kind: "adm" | "tp" | "places") => void;
  onOpenMap: () => void;
  onOpenNc: (set: "inside" | "outside" | "review") => void;
};

/**
 * SoyTrace's first page (9 Oct 2026 layout): the whole supply chain in four
 * figures, one card per crushing plant, the other suppliers as a short list,
 * ADM's non-compliant list in one box and a small map. Everything else is one
 * click deeper (a facility page, the map, the Non-compliant and Data tabs).
 */
export function SoyOverview({ data, catchments, areas, c, nav, lang, buffer, cdlNames, otherPlants, dataDate, onOpenFacility, onOpenList, onOpenMap, onOpenNc }: Props) {
  const all = catchments.get("all");
  const adm = catchments.get("adm");
  const tp = catchments.get("tp");
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const sites = data.admElevators.filter((e) => e.radiusM).length;
  const ncAll = data.nonCompliantAll.fields;
  const ncIn = all?.nonCompliant.fields ?? 0;
  const review = all?.nonCompliant.byBefore.crop ?? 0;
  const ca = all?.compliant.acres ?? 0;
  const na = all?.nonCompliant.acres ?? 0;
  const counties = areas ? areas.states.reduce((n, s) => n + s.counties.length, 0) : 0;
  const bufLabel = buffer === "40" ? c.scopeQ40 : c.scopeQ80;

  return (
    <div className="soy-ov">
      <div className="summary-head">
        <div>
          <p className="eyebrow">{nav.ovEyebrow}</p>
          <h1>{nav.ovTitle}</h1>
          <p className="summary-sub">{fill(nav.ovSub, { p: data.plants.length, a: sites, t: data.thirdParty.length, date: dataDate })}</p>
        </div>
        <div className="summary-tools">
          <button type="button" className="btn-secondary" onClick={onOpenMap}>
            {nav.openMap}
          </button>
        </div>
      </div>

      {/* Positive first (user, 8 Oct 2026): compliant, share, then non-compliant and the review note. */}
      <div className="kpi-row soy-kpis4">
        <KpiTile tone="comply" value={countF(all?.compliant.fields ?? 0)} label={nav.kpiFields} hint={c.kpiFieldsHint} sub={acF(ca)} />
        <KpiTile value={formatSharePct(pct(ca, ca + na), lang)} label={nav.kpiShare} hint={c.kpiNcShareHint} sub={fill(nav.kpiShareSub, { p: formatSharePct(pct(na, ca + na), lang), acres: acF(na) })} />
        <KpiTile tone="danger" value={countF(ncIn)} label={nav.kpiNcIn} hint={c.kpiNcAreaHint} sub={fill(nav.kpiNcInSub, { total: countF(ncAll) })} onClick={() => onOpenNc("inside")} action={nav.review} />
        <KpiTile value={countF(review)} label={nav.kpiReview} hint={c.kpiReviewHint} sub={nav.kpiReviewSub} onClick={() => onOpenNc("review")} action={nav.review} />
      </div>

      <section className="soy-ov-section">
        <div className="soy-ov-head">
          <h2>{nav.plantsTitle}</h2>
          <p>{fill(nav.plantsSub, { b: bufLabel })}</p>
        </div>
        <div className="soy-plant-cards">
          {data.plants.map((p) => {
            const id = `${p.key}${buffer}`;
            const k = catchments.get(id);
            const cf = k?.compliant.fields ?? 0;
            const pa = k?.compliant.acres ?? 0;
            const nf = k?.nonCompliant.fields ?? 0;
            const pna = k?.nonCompliant.acres ?? 0;
            return (
              <button key={p.id} type="button" className="soy-plant-card" onClick={() => onOpenFacility(id)}>
                <span className="soy-plant-top">
                  <b>{p.city ?? p.name}</b>
                  <span className={`soy-nc-pill${nf ? "" : " none"}`}>{nf ? fill(nav.ncN, { n: countF(nf) }) : nav.ncNone}</span>
                </span>
                <span className="soy-plant-loc">{[p.county, p.state].filter(Boolean).join(", ")}</span>
                <span className="soy-plant-row">
                  <span>{nav.compliantFields}</span>
                  <b className="tabular-nums">{countF(cf)}</b>
                </span>
                <span className="soy-plant-row">
                  <span>{nav.compliantArea}</span>
                  <b className="tabular-nums">{acF(pa)}</b>
                </span>
                <span className="soy-plant-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, pct(pa, pa + pna))}%` }} />
                </span>
              </button>
            );
          })}
          {otherPlants.map((p) => (
            <div key={p.id} className="soy-plant-card pending">
              <span className="soy-plant-top">
                <b>{p.name.replace(/^ADM /, "")}</b>
                <span className="soy-nc-pill none">{c.plantSoon}</span>
              </span>
              <span className="soy-plant-loc">{p.address ?? ""}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="soy-ov-two">
        <section className="chart-card soy-ov-others">
          <div className="soy-ov-head">
            <h2>{nav.othersTitle}</h2>
            <p>{nav.othersSub}</p>
          </div>
          <ul className="soy-ov-list">
            <li>
              <button type="button" onClick={() => onOpenList("adm")}>
                <span>
                  <b>{nav.admRow}</b> <small>· {fill(nav.sitesN, { n: countF(sites) })}</small>
                </span>
                <span className="soy-ov-right">
                  <span className="tabular-nums">{fill(nav.fieldsN, { n: countF(adm?.compliant.fields ?? 0) })}</span>
                  {adm?.nonCompliant.fields ? <i className="soy-nc-pill">{countF(adm.nonCompliant.fields)}</i> : null}
                  <span aria-hidden="true">›</span>
                </span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenList("tp")}>
                <span>
                  <b>{nav.tpRow}</b> <small>· {countF(data.thirdParty.length)}</small>
                </span>
                <span className="soy-ov-right">
                  <span className="tabular-nums">{fill(nav.fieldsN, { n: countF(tp?.compliant.fields ?? 0) })}</span>
                  {tp?.nonCompliant.fields ? <i className="soy-nc-pill">{countF(tp.nonCompliant.fields)}</i> : null}
                  <span aria-hidden="true">›</span>
                </span>
              </button>
            </li>
            {areas ? (
              <li>
                <button type="button" onClick={() => onOpenList("places")}>
                  <span>
                    <b>{nav.byArea}</b>
                  </span>
                  <span className="soy-ov-right">
                    <span className="tabular-nums">{fill(nav.byAreaSub, { s: countF(areas.states.length), c: countF(counties) })}</span>
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        </section>

        <section className="chart-card soy-ov-nc">
          <b className="soy-ov-nc-n tabular-nums">{countF(ncAll)}</b>
          <div>
            <h2>{nav.ncBoxTitle}</h2>
            <p className="soy-ov-nc-parts">
              <span>
                <b className="tabular-nums">{countF(ncIn)}</b> {nav.ncInside}
              </span>
              <span>
                <b className="tabular-nums">{countF(Math.max(0, ncAll - ncIn))}</b> {nav.ncOutside}
              </span>
              <span>
                <b className="tabular-nums">{countF(review)}</b> {nav.ncToReview}
              </span>
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => onOpenNc("inside")}>
            {nav.review} ›
          </button>
        </section>
      </div>

      <section className="soy-ov-section">
        <div className="soy-ov-head">
          <h2>{nav.mapTitle}</h2>
          <p>{nav.mapSub}</p>
        </div>
        <div className="chart-card soy-map-card soy-ov-map">
          <SoySupplyMap
            data={data}
            mode="supply"
            compact
            selected="all"
            onSelect={(id) => id && id !== "all" && onOpenFacility(id)}
            colorBy="status"
            basis="either"
            band={10}
            cdlNames={cdlNames}
            catchments={catchments}
            c={c}
            lang={lang}
            otherPlants={otherPlants}
          />
        </div>
      </section>
    </div>
  );
}
