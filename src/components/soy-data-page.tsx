import { KpiTile } from "@/components/kpi-tile";
import { FacilityTable, SoyDocsView, catchmentLabel } from "@/components/soy-supply";
import { TractPicker, tractRows } from "@/components/soy-tract";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount } from "@/lib/format";
import { csv, downloadBlob } from "@/lib/soy-downloads";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import type { SoySupplyCopy } from "@/lib/soy-supply-copy";
import { pct, type Catchment, type PlantBuffer, type SupplyData } from "@/lib/soy-supply";

/**
 * The Data tab (9–10 Oct 2026 layout): what the data is, all US soybeans
 * against the supply chain (what the client is sizing), then every download
 * in one place (TRACT facility by facility, tables, the report), and the
 * sources, definitions and changelog.
 */
export function SoyDataPage({ data, catchments, c, nav, lang, buffer, setBuffer, canDownload, present, dataDate, onReport, onOpenFacility }: {
  data: SupplyData;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  buffer: PlantBuffer;
  setBuffer: (b: PlantBuffer) => void;
  canDownload: boolean;
  present: boolean;
  dataDate: string;
  onReport: () => void;
  onOpenFacility: (id: string) => void;
}) {
  const countF = (n: number) => formatCount(n, lang);
  const all = catchments.get("all");
  const sites = data.admElevators.filter((e) => e.radiusM).length;
  const tract = tractRows(data);
  const tractFiles = tract.reduce((a, r) => a + r.parts.length, 0);
  const tractBytes = tract.reduce((a, r) => a + r.bytes, 0);
  const gb = (b: number) => `${(b / 1e9).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 2 })} GB`;
  const chainAcres = all?.compliant.acres ?? 0;
  function downloadCatchments() {
    const rows = [...catchments.values()].map((k) => [
      k.id,
      k.kind,
      catchmentLabel(k.id, data, c),
      k.compliant.fields,
      k.compliant.acres.toFixed(1),
      k.nonCompliant.fields,
      k.nonCompliant.acres.toFixed(1),
      pct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres).toFixed(2),
    ]);
    downloadBlob("soytrace-catchments.csv", csv([["catchment_id", "kind", "name", "compliant_fields", "compliant_acres", "noncompliant_fields", "noncompliant_acres", "noncompliant_share_pct"], ...rows]), "text/csv");
  }
  return (
    <div className="soy-data-page">
      <div className="page-head">
        <p className="eyebrow">{nav.dataEyebrow}</p>
        <h1>{nav.dlTitle}</h1>
        <p>{fill(nav.dlSub, { date: dataDate })}</p>
      </div>

      <div className="kpi-row soy-kpis4 soy-data-kpis">
        <KpiTile value={dataDate} label={nav.dataAsOf} sub={nav.dataAsOfSub} />
        <KpiTile tone="comply" value={countF(all?.compliant.fields ?? 0)} label={nav.kpiFields} sub={formatAcres(chainAcres, lang)} />
        <KpiTile value={`${data.plants.length} · ${sites} · ${data.thirdParty.length}`} label={nav.dataFacilities} sub={fill(nav.dataFacilitiesSub, { p: data.plants.length, a: sites, t: data.thirdParty.length })} />
        <KpiTile value={countF(catchments.size)} label={nav.dataCatchments} sub={data.tract ? fill(nav.dataTractFiles, { n: countF(tractFiles), size: gb(tractBytes) }) : undefined} />
      </div>

      {/* Downloads: TRACT leads; the tables and the report sit in one compact row. */}
      <div id="soy-downloads" className="soy-anchor" />
      <section className="chart-card supply-wide soy-dl-row">
        <div className="soy-fac-head">
          <div>
            <h3>{nav.dlAll}</h3>
            <p className="chart-note">{nav.dlIntro}</p>
          </div>
        </div>
        <div className="soy-dl-items">
          {canDownload && data.tract ? (
            <a className="soy-dl-item" href="#soy-tract">
              <b>{nav.cardTract}</b>
              <span>{fill(nav.dlTractShort, { n: countF(tractFiles), size: gb(tractBytes) })}</span>
              <em>{nav.cardTractPick} ↓</em>
            </a>
          ) : null}
          <a className="soy-dl-item" href="#soy-facilities">
            <b>{nav.cardFacilities}</b>
            <span>{nav.dlFacilitiesShort}</span>
            <em>{nav.showBelow} ↓</em>
          </a>
          {canDownload ? (
            <button type="button" className="soy-dl-item" onClick={downloadCatchments}>
              <b>{nav.cardCatchments}</b>
              <span>{fill(nav.dlCatchmentsShort, { n: countF(catchments.size) })}</span>
              <em>CSV</em>
            </button>
          ) : null}
          {!present ? (
            <button type="button" className="soy-dl-item" onClick={onReport}>
              <b>{nav.cardReport}</b>
              <span>{nav.cardReportBody}</span>
              <em>{nav.cardReportOpen}</em>
            </button>
          ) : null}
        </div>
      </section>

      {canDownload && data.tract ? (
        <>
          <div id="soy-tract" className="soy-anchor" />
          <section className="chart-card supply-wide soy-tract-section">
            <div className="soy-fac-head">
              <div>
                <h3>{c.tractTitle}</h3>
                <p className="chart-note">{nav.tractSectionIntro}</p>
              </div>
            </div>
            <TractPicker data={data} c={c} nav={nav} lang={lang} inline />
          </section>
        </>
      ) : null}

      <div id="soy-facilities" className="soy-anchor" />
      <FacilityTable data={data} catchments={catchments} c={c} lang={lang} scope="" setScope={(id) => id !== "all" && onOpenFacility(id)} buffer={buffer} setBuffer={setBuffer} />

    </div>
  );
}

/** The Method tab: sources, definitions, the changelog and the earlier delivery. */
export function SoyMethodPage({ data, c, nav, lang, present, dataDate, onOpenArchive }: {
  data: SupplyData;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  present: boolean;
  dataDate: string;
  onOpenArchive: () => void;
}) {
  return (
    <div className="soy-data-page">
      <div className="page-head">
        <p className="eyebrow">{nav.methodEyebrow}</p>
        <h1>{nav.tabMethod}</h1>
        <p>{fill(nav.methodSub, { date: dataDate })}</p>
      </div>
      <SoyDocsView data={data} c={c} lang={lang} present={present} onOpenArchive={onOpenArchive} headless />
    </div>
  );
}
