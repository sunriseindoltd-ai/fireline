import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import maplibregl from "maplibre-gl";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { KpiTile } from "@/components/kpi-tile";
import { basemapStyle } from "@/components/chain-map";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Tenant } from "@/lib/tenants";
import type { FireEvent, FireVerification, VerificationIndex } from "@/lib/fire.server";

type FireResponse = {
  generated: string;
  days: number;
  detections: number;
  events: FireEvent[];
  verifications: VerificationIndex;
  links: Record<string, { e: string; x: string; s: string }>;
};

const ATTRIB_M = 500;
const PAGE = 50;
const DAY = 86400000;
/** Groups whose plots are a 20 km buffer estimate, not a verified supply base. */
const ESTIMATED_GROUPS = new Set(["SJIM", "AGROJAYA"]);

type Seg = "all" | "today" | "unverified" | "verified";

function ageBucket(iso: string, now: number): 0 | 1 | 2 {
  const h = (now - Date.parse(iso)) / 3600000;
  return h <= 24 ? 0 : h <= 72 ? 1 : 2;
}
const AGE_COLOR = ["#e5322d", "#f59e0b", "#8a8f98"];

export function FirePage({ role, tenant }: { role: string; tenant: Tenant }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<FireResponse | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [seg, setSeg] = useState<Seg>("all");
  const [group, setGroup] = useState("");
  const [mill, setMill] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = useMemo(() => Date.now(), [data]);

  useEffect(() => {
    let alive = true;
    setError(false);
    fetch("/fire", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as FireResponse;
      })
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
  const statusLabel: Record<string, string> = { active: t.fireStatusActive, extinguished: t.fireStatusOut, false_alarm: t.fireStatusFalse };
  const statusTone: Record<string, string> = { active: "bad", extinguished: "ok", false_alarm: "" };
  const confLabel: Record<string, string> = { l: t.fireConfL, n: t.fireConfN, h: t.fireConfH };
  const n = (v: number) => formatCount(v, lang);

  const events = data?.events ?? [];
  const groups = useMemo(() => [...new Set(events.map((e) => e.plot.group))].sort(), [events]);
  const mills = useMemo(
    () => [...new Set(events.filter((e) => !group || e.plot.group === group).map((e) => e.plot.mill))].sort(),
    [events, group],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      const v = data?.verifications[e.id];
      if (seg === "today" && ageBucket(e.last, now) !== 0) return false;
      if (seg === "unverified" && v) return false;
      if (seg === "verified" && !v) return false;
      if (group && e.plot.group !== group) return false;
      if (mill && e.plot.mill !== mill) return false;
      if (needle && !`${e.plot.mill} ${e.plot.company} ${e.plot.id} ${e.plot.village} ${e.plot.district} ${e.plot.group}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [events, data, seg, group, mill, q, now]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageNow = Math.min(page, pages - 1);
  const shown = rows.slice(pageNow * PAGE, (pageNow + 1) * PAGE);

  const kpi = useMemo(() => {
    const today = events.filter((e) => ageBucket(e.last, now) === 0).length;
    const millSet = new Set(events.map((e) => `${e.plot.uml}|${e.plot.mill}`));
    const plotSet = new Set(events.map((e) => e.plot.id));
    const verified = events.filter((e) => data?.verifications[e.id]).length;
    return { today, millSet: millSet.size, plotSet: plotSet.size, verified };
  }, [events, data, now]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const verifyUrl = (e: FireEvent) => {
    const l = data?.links[e.id];
    return l ? `${origin}/fire/verify?e=${l.e}&x=${l.x}&s=${l.s}` : "";
  };
  const waUrl = (e: FireEvent) => {
    const text = fill(t.fireWaText, {
      date: fmtDate(e.last),
      time: fmtTime(e.last),
      mill: e.plot.mill || "—",
      company: e.plot.company || "—",
      plot: e.plot.id,
      type: e.plot.type,
      village: e.plot.village || "—",
      district: e.plot.district || "—",
      lat: e.lat,
      lon: e.lon,
      dist: e.d === 0 ? t.fireInside : fill(t.fireMetres, { d: e.d }),
      link: verifyUrl(e),
    });
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };
  const copyLink = async (e: FireEvent) => {
    try {
      await navigator.clipboard.writeText(verifyUrl(e));
      setCopied(e.id);
      setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1500);
    } catch {
      /* clipboard blocked: the link is still shown in the WhatsApp text */
    }
  };
  const downloadCsv = () => {
    const head = ["event_id", "latest_detection_utc", "latest_detection_wib", "date", "lat", "lon", "detections", "satellites", "frp_mw", "confidence", "distance_m", "plots_within_500m", "group", "mill", "uml_id", "company", "plot_type", "plot_id", "village", "district", "province", "plot_ha", "status", "verified_at", "verified_by"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((e) => {
      const v = data?.verifications[e.id];
      return [e.id, e.last, fmtWhen(e.last), e.date, e.lat, e.lon, e.n, e.sats.join(" "), e.frp, e.conf, e.d, e.near, e.plot.group, e.plot.mill, e.plot.uml, e.plot.company, e.plot.type, e.plot.id, e.plot.village, e.plot.district, e.plot.province, e.plot.ha, v?.status ?? "", v?.at ?? "", v?.by ?? ""].map(esc).join(",");
    });
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fireline-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const canAct = role !== "viewer";
  const selectedEvent = selected ? events.find((e) => e.id === selected) ?? null : null;

  return (
    <div className="app fire-app">
      <header className="app-header">
        <Link to="/app/portfolio" className="app-brand">
          <BrandMark size={22} />
          <span className="word">Earthline Trace</span>
        </Link>
        <div className="app-actions">
          <Link to="/app/portfolio" className="btn-text">
            ← {t.fireBack}
          </Link>
          <LangToggle />
        </div>
      </header>
      <main className="app-main">
        <div className="page fire-page">
          <header className="summary-head">
            <div>
              <p className="eyebrow">{t.fireEyebrow}</p>
              <h1>{t.fireTitle}</h1>
              <p className="chart-note fire-intro">{fill(t.fireIntro, { days: data?.days ?? 7 })}</p>
            </div>
          </header>

          {tenant !== "adm" ? (
            <p className="chart-note">{t.fireNotAvailable}</p>
          ) : error ? (
            <div className="eudr-notice danger" role="alert">
              <p>{t.fireError}</p>
              <button type="button" className="eudr-notice-action" onClick={() => setNonce((x) => x + 1)}>
                {t.retry}
              </button>
            </div>
          ) : !data ? (
            <div className="eudr-loading" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
            </div>
          ) : (
            <>
              <div className="kpi-row summary-kpis fire-kpis">
                <KpiTile value={n(kpi.today)} label={t.fireKpi24} hint={fill(t.fireKpi24Hint, { m: ATTRIB_M })} tone={kpi.today ? "danger" : undefined} />
                <KpiTile value={n(events.length)} label={fill(t.fireKpi7, { days: data.days })} hint={fill(t.fireKpi7Hint, { m: ATTRIB_M, days: data.days })} />
                <KpiTile value={n(kpi.millSet)} label={t.fireKpiMills} hint={t.fireKpiMillsHint} />
                <KpiTile value={n(kpi.plotSet)} label={t.fireKpiPlots} hint={t.fireKpiPlotsHint} />
                <KpiTile value={n(kpi.verified)} label={t.fireKpiVerified} hint={t.fireKpiVerifiedHint} tone={kpi.verified ? "comply" : undefined} />
              </div>
              <p className="chart-note fire-meta">
                {fill(t.fireDetections, { n: n(data.detections), m: n(events.length) })} {fill(t.fireUpdated, { time: fmtWhen(data.generated) + " WIB" })}
              </p>

              <section className="chart-card fire-map-card" aria-label={t.fireMapTitle}>
                <div className="chart-head">
                  <h2>{t.fireMapTitle}</h2>
                  <p className="chart-note">{t.fireMapHint}</p>
                </div>
                <div className="fire-map-wrap">
                  <FireMap events={rows} now={now} selected={selected} onSelect={setSelected} />
                  {selectedEvent ? (
                    <EventCard
                      event={selectedEvent}
                      status={data.verifications[selectedEvent.id]}
                      onClose={() => setSelected(null)}
                      fmtWhen={fmtWhen}
                      statusLabel={statusLabel}
                      statusTone={statusTone}
                      confLabel={confLabel}
                      waUrl={canAct ? waUrl(selectedEvent) : ""}
                      onCopy={canAct ? () => copyLink(selectedEvent) : undefined}
                      copied={copied === selectedEvent.id}
                    />
                  ) : null}
                </div>
              </section>

              <section className="chart-card fire-list" aria-label={t.fireListTitle}>
                <div className="chart-head">
                  <h2>
                    {t.fireListTitle} <span className="tabular-nums muted">{n(rows.length)}</span>
                  </h2>
                  <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!rows.length}>
                    {t.fireCsv}
                  </button>
                </div>
                <div className="table-tools fire-tools">
                  <div className="seg" role="group" aria-label={t.fireColStatus}>
                    {(
                      [
                        ["all", t.fireAll],
                        ["today", t.fireToday],
                        ["unverified", t.fireUnverified],
                        ["verified", t.fireVerifiedSeg],
                      ] as const
                    ).map(([k, label]) => (
                      <button key={k} type="button" className={seg === k ? "on" : ""} aria-pressed={seg === k} onClick={() => { setSeg(k); setPage(0); }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <select value={group} onChange={(e) => { setGroup(e.target.value); setMill(""); setPage(0); }} aria-label={t.fireGroupAny}>
                    <option value="">{t.fireGroupAny}</option>
                    {groups.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <select value={mill} onChange={(e) => { setMill(e.target.value); setPage(0); }} aria-label={t.fireMillAny}>
                    <option value="">{t.fireMillAny}</option>
                    {mills.map((m) => (
                      <option key={m} value={m}>{m || "—"}</option>
                    ))}
                  </select>
                  <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={t.fireSearch} aria-label={t.fireSearch} />
                </div>
                {rows.length === 0 ? (
                  <p className="chart-note">{t.fireEmpty}</p>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table fire-table">
                      <thead>
                        <tr>
                          <th>{t.fireColWhen}</th>
                          <th>{t.fireColMill}</th>
                          <th>{t.fireColPlot}</th>
                          <th>{t.fireColWhere}</th>
                          <th className="num">{t.fireColDist}</th>
                          <th>{t.fireColSignal}</th>
                          <th>{t.fireColStatus}</th>
                          {canAct ? <th /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((e) => {
                          const v = data.verifications[e.id];
                          const age = ageBucket(e.last, now);
                          return (
                            <tr key={e.id} className={selected === e.id ? "selected" : ""} onClick={() => setSelected(selected === e.id ? null : e.id)}>
                              <td>
                                <span className="fire-dot" style={{ background: AGE_COLOR[age] }} aria-hidden="true" />
                                <span className="tabular-nums">{fmtWhen(e.last)}</span>
                              </td>
                              <td>
                                <b>{e.plot.mill || "—"}</b>
                                <small>
                                  {e.plot.group}
                                  {ESTIMATED_GROUPS.has(e.plot.group) ? ` · ${t.fireEstimated}` : ""}
                                </small>
                              </td>
                              <td>
                                <b>{e.plot.company || "—"}</b>
                                <small>
                                  {e.plot.type} · {e.plot.id}
                                </small>
                              </td>
                              <td>
                                {e.plot.village || "—"}
                                <small>
                                  {e.plot.district}
                                  {e.plot.province ? `, ${e.plot.province}` : ""}
                                </small>
                              </td>
                              <td className="num tabular-nums">{e.d === 0 ? t.fireInside : fill(t.fireMetres, { d: n(e.d) })}</td>
                              <td>
                                <span className="tabular-nums">{fill(t.fireDetCount, { n: e.n })}</span>
                                <small>
                                  {fill(t.fireFrp, { frp: e.frp })} · {confLabel[e.conf]} · {e.sats.join(", ")}
                                </small>
                              </td>
                              <td>
                                <span className={`chip ${v ? statusTone[v.status] : "warn"}`}>{v ? statusLabel[v.status] : t.fireStatusNone}</span>
                                {v ? <small>{fmtWhen(v.at)} · {v.by}</small> : null}
                              </td>
                              {canAct ? (
                                <td className="fire-actions" onClick={(ev) => ev.stopPropagation()}>
                                  <a className="btn-secondary small" href={waUrl(e)} target="_blank" rel="noopener noreferrer">
                                    {t.fireWhatsApp}
                                  </a>
                                  <button type="button" className="btn-text small" onClick={() => void copyLink(e)}>
                                    {copied === e.id ? t.fireCopied : t.fireCopyLink}
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {rows.length > PAGE ? (
                  <div className="table-pager">
                    <span className="tabular-nums">
                      {n(pageNow * PAGE + 1)}–{n(Math.min(rows.length, (pageNow + 1) * PAGE))} / {n(rows.length)}
                    </span>
                    <div className="table-pager-nav">
                      <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)}>
                        ‹
                      </button>
                      <span className="tabular-nums">
                        {pageNow + 1} / {pages}
                      </span>
                      <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)}>
                        ›
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function EventCard({
  event: e,
  status,
  onClose,
  fmtWhen,
  statusLabel,
  statusTone,
  confLabel,
  waUrl,
  onCopy,
  copied,
}: {
  event: FireEvent;
  status?: VerificationIndex[string];
  onClose: () => void;
  fmtWhen: (iso: string) => string;
  statusLabel: Record<string, string>;
  statusTone: Record<string, string>;
  confLabel: Record<string, string>;
  waUrl: string;
  onCopy?: () => void;
  copied: boolean;
}) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<FireVerification[] | null>(null);
  useEffect(() => {
    setEntries(null);
    if (!status) return;
    let alive = true;
    fetch(`/fire/reports?e=${encodeURIComponent(e.id)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v: FireVerification[]) => alive && setEntries(v))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [e.id, status]);
  return (
    <aside className="fire-card">
      <button type="button" className="fire-card-close" aria-label={t.close} onClick={onClose}>
        ×
      </button>
      <p className="eyebrow">
        <span className={`chip ${status ? statusTone[status.status] : "warn"}`}>{status ? statusLabel[status.status] : t.fireStatusNone}</span>
      </p>
      <h3>{e.plot.mill || "—"}</h3>
      <p className="muted">
        {e.plot.group}
        {ESTIMATED_GROUPS.has(e.plot.group) ? ` · ${t.fireEstimated}` : ""}
      </p>
      <dl className="fire-facts">
        <dt>{t.fireEventPlot}</dt>
        <dd>
          <b>{e.plot.company || "—"}</b>
          <br />
          {e.plot.type} · {e.plot.id} · {formatCount(e.plot.ha, lang)} ha
          <br />
          {[e.plot.village, e.plot.district, e.plot.province].filter(Boolean).join(", ")}
        </dd>
        <dt>{t.fireColDist}</dt>
        <dd>
          {e.d === 0 ? t.fireInside : fill(t.fireMetres, { d: e.d })}
          {e.near > 1 ? ` · ${fill(t.fireEventNear, { n: e.near, m: ATTRIB_M })}` : ""}
        </dd>
        <dt>{t.fireEventFirst}</dt>
        <dd className="tabular-nums">
          {fmtWhen(e.first)} → {fmtWhen(e.last)} WIB
        </dd>
        <dt>{t.fireColSignal}</dt>
        <dd>
          {fill(t.fireDetCount, { n: e.n })} · {fill(t.fireFrp, { frp: e.frp })} · {confLabel[e.conf]}
          <br />
          {t.fireEventSats}: {e.sats.join(", ")}
        </dd>
        <dt>{t.fvHotspot}</dt>
        <dd className="tabular-nums">
          {e.lat}, {e.lon} ·{" "}
          <a href={`https://maps.google.com/?q=${e.lat},${e.lon}`} target="_blank" rel="noopener noreferrer">
            Google Maps
          </a>
        </dd>
      </dl>
      {waUrl ? (
        <div className="fire-card-actions">
          <a className="btn-primary small" href={waUrl} target="_blank" rel="noopener noreferrer">
            {t.fireWhatsApp}
          </a>
          <button type="button" className="btn-secondary small" onClick={onCopy}>
            {copied ? t.fireCopied : t.fireCopyLink}
          </button>
        </div>
      ) : null}
      <h4>{t.fireEventReports}</h4>
      {!status ? (
        <p className="muted">{t.fireEventNoReports}</p>
      ) : entries == null ? (
        <p className="muted">…</p>
      ) : (
        <ul className="fire-reports">
          {entries
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.at}>
                <span className={`chip ${statusTone[r.status]}`}>{statusLabel[r.status]}</span>
                <span className="tabular-nums muted">
                  {fmtWhen(r.at)} · {r.by}
                </span>
                {r.note ? <p>{r.note}</p> : null}
                {r.photo ? <img src={`/fire/photo?f=${encodeURIComponent(r.photo)}`} alt={t.fireEventPhoto} loading="lazy" /> : null}
                {r.lat != null ? (
                  <small className="tabular-nums">
                    {r.lat.toFixed(5)}, {r.lon?.toFixed(5)}
                  </small>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </aside>
  );
}

function FireMap({ events, now, selected, onSelect }: { events: FireEvent[]; now: number; selected: string | null; onSelect: (id: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle("esri"),
      center: [110, -2],
      zoom: 4.3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      map.addSource("plots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": "#ffffff", "fill-opacity": 0.18 } });
      map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.9 } });
      map.addLayer({
        id: "events-halo",
        type: "circle",
        source: "events",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 12, 14], "circle-color": ["get", "color"], "circle-opacity": 0.25 },
      });
      map.addLayer({
        id: "events",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "sel"], false], 7, 4.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["boolean", ["get", "sel"], false], 2.5, 1],
        },
      });
      map.on("click", "events", (ev) => {
        const f = ev.features?.[0];
        if (f) onSelectRef.current(String(f.properties?.id));
      });
      map.on("mouseenter", "events", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "events", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const fittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const ev = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
    const pl = map.getSource("plots") as maplibregl.GeoJSONSource | undefined;
    if (!ev || !pl) return;
    ev.setData({
      type: "FeatureCollection",
      // Oldest first so the newest (red) dots are drawn on top.
      features: events.slice().reverse().map((e) => ({
        type: "Feature",
        properties: { id: e.id, color: AGE_COLOR[ageBucket(e.last, now)], sel: e.id === selected },
        geometry: { type: "Point", coordinates: [e.lon, e.lat] },
      })),
    });
    const seen = new Set<string>();
    pl.setData({
      type: "FeatureCollection",
      features: events
        .filter((e) => (seen.has(e.plot.id) ? false : (seen.add(e.plot.id), true)))
        .map((e) => ({ type: "Feature", properties: { id: e.plot.id }, geometry: { type: "Polygon", coordinates: [e.plot.g[0]] } })),
    });
    if (!fittedRef.current && events.length) {
      fittedRef.current = true;
      const b = new maplibregl.LngLatBounds();
      events.forEach((e) => b.extend([e.lon, e.lat]));
      map.fitBounds(b, { padding: 40, maxZoom: 9, duration: 0 });
    }
  }, [events, now, selected, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selected) return;
    const e = events.find((x) => x.id === selected);
    if (e) map.flyTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  }, [selected, ready, events]);

  return <div ref={ref} className="fire-map" />;
}
