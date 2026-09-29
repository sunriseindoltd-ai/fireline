import { useRef, useState } from "react";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { docHref, SUPPORT_DOCS, type SupportDoc } from "@/lib/documents";
import type { MonitoringEntry } from "@/lib/monitoring";
import { PRICE_PAGE_URL } from "@/lib/market";

const LANG_NAME = { en: "English", id: "Bahasa Indonesia" } as const;

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" strokeLinejoin="round" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function DocumentsView({ canDownload }: { canDownload: boolean }) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<SupportDoc>(() => SUPPORT_DOCS.find((d) => d.lang === lang) ?? SUPPORT_DOCS[0]);
  const mb = (bytes: number) =>
    `${new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }).format(bytes / 1048576)} MB`;

  return (
    <div className="page extras-page">
      <header className="summary-head">
        <div>
          <p className="eyebrow">{t.docsEyebrow}</p>
          <h1>{t.docsTitle}</h1>
        </div>
      </header>
      <p className="extras-intro">{t.docsIntro}</p>
      <div className="docs-layout">
        <ul className="doc-list">
          {SUPPORT_DOCS.map((d) => {
            const on = d.file === selected.file;
            return (
              <li key={d.file} className={`doc-card ${on ? "on" : ""}`}>
                <div className="doc-card-head">
                  <span className="doc-icon">
                    <DocIcon />
                  </span>
                  <span className="doc-id">
                    <b>{LANG_NAME[d.lang]}</b>
                    <span className="mono">
                      {d.code} · {d.version}
                    </span>
                  </span>
                </div>
                <h2>{d.title}</h2>
                <p>{d.subtitle}</p>
                <p className="doc-meta">
                  PDF · {fill(t.docsPages, { n: d.pages })} · {mb(d.bytes)}
                </p>
                <div className="doc-actions">
                  <button type="button" className="btn-secondary" aria-pressed={on} disabled={on} onClick={() => setSelected(d)}>
                    {on ? t.docsReading : t.docsRead}
                  </button>
                  {canDownload ? (
                    <a className="btn-secondary" href={docHref(d, true)}>
                      {t.docsDownload}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
          {canDownload ? null : <li className="doc-note">{t.docsViewOnly}</li>}
        </ul>
        <div className="doc-viewer">
          <div className="doc-viewer-bar">
            <span>
              {selected.code} · {LANG_NAME[selected.lang]}
            </span>
            <a className="linkish" href={docHref(selected)} target="_blank" rel="noopener">
              {t.docsOpenTab}
            </a>
          </div>
          <iframe key={selected.file} title={`${selected.code} — ${selected.title}`} src={`${docHref(selected)}#view=FitH`} />
        </div>
      </div>
    </div>
  );
}

export function MonitoringView({ chainLabel, entry }: { chainLabel: string; entry: MonitoringEntry }) {
  const { t } = useI18n();
  return (
    <div className="page extras-page">
      <header className="summary-head">
        <div>
          <p className="eyebrow">{t.monitoringEyebrow}</p>
          <h1>{chainLabel}</h1>
        </div>
      </header>
      <p className="extras-intro">{t.monitoringIntro}</p>
      <div className="monitoring-layout">
        <section className="extras-card monitoring-map" aria-label={t.monitoringMapTitle}>
          <div className="extras-card-head">
            <h2>{t.monitoringMapTitle}</h2>
            {entry.detections ? null : <span className="status-pill master">{t.monitoringComing}</span>}
          </div>
          <div className="monitoring-empty">
            <span className="empty-state-icon">
              <MapIcon />
            </span>
            <p>{fill(t.monitoringMapEmpty, { chain: chainLabel })}</p>
          </div>
        </section>
        <section className="extras-card" aria-label={t.monitoringReportsTitle}>
          <div className="extras-card-head">
            <h2>{t.monitoringReportsTitle}</h2>
          </div>
          {entry.reports.length === 0 ? (
            <p className="extras-muted">{fill(t.monitoringReportsEmpty, { chain: chainLabel })}</p>
          ) : (
            <ul className="report-list">
              {entry.reports.map((r) => (
                <li key={r.url}>
                  <span>
                    <b>{r.title}</b>
                    {r.period} · {r.publishedOn}
                  </span>
                  <a className="btn-secondary" href={r.url} target="_blank" rel="noopener noreferrer">
                    {t.monitoringOpenReport}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function PriceView() {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div className="price-page">
      <header className="price-head">
        <div>
          <p className="eyebrow">{t.priceEyebrow}</p>
          <p className="extras-intro">{t.priceIntro}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => frame.current?.contentWindow?.print()}>
          {t.pricePrint}
        </button>
      </header>
      <iframe ref={frame} className="price-frame" title={t.priceTab} src={PRICE_PAGE_URL} />
    </div>
  );
}
