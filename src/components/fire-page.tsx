import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { KpiTile } from "@/components/kpi-tile";
import { basemapStyle } from "@/lib/basemap";
import { logout } from "@/lib/auth-actions";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import type { FireEvent, FireScene, FireScenes, FireSceneTiles, FireVerification, VerificationIndex } from "@/lib/fire.server";

type FireResponse = {
  generated: string;
  days: number;
  detections: number;
  events: FireEvent[];
  verifications: VerificationIndex;
  links: Record<string, { e: string; x: string; s: string }>;
  refreshFailed?: boolean;
};

const ATTRIB_M = 500;
const PAGE = 50;
/** Groups whose plots are a 20 km buffer estimate, not a verified supply base. */
const ESTIMATED_GROUPS = new Set(["SJIM", "AGROJAYA"]);

type Seg = "all" | "today" | "unverified" | "verified";
type Tab = "overview" | "map" | "events" | "method";
type ImgSrc = "base" | "s2" | "s1";
type S2Style = "quickfire" | "swir" | "true";

function ageBucket(iso: string, now: number): 0 | 1 | 2 {
  const h = (now - Date.parse(iso)) / 3600000;
  return h <= 24 ? 0 : h <= 72 ? 1 : 2;
}
const AGE_COLOR = ["#e5322d", "#f59e0b", "#8a8f98"];
const wibDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);

function readTab(): Tab {
  try {
    const v = localStorage.getItem("fireline.tab");
    if (v === "overview" || v === "map" || v === "events" || v === "method") return v;
  } catch {
    /* ignore */
  }
  return "overview";
}

export function FirePage({ role }: { role: string }) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const f = fireCopy[lang];
  const [data, setData] = useState<FireResponse | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>("overview");
  const [seg, setSeg] = useState<Seg>("all");
  const [group, setGroup] = useState("");
  const [mill, setMill] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const now = useMemo(() => (data ? Date.parse(data.generated) : Date.now()), [data]);

  useEffect(() => setTabState(readTab()), []);
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem("fireline.tab", next);
    } catch {
      /* ignore */
    }
    mainRef.current?.scrollTo({ top: 0 });
  };

  const load = (refresh: boolean) =>
    fetch("/fire", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh }) }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as FireResponse;
    });

  useEffect(() => {
    let alive = true;
    setError(false);
    load(false)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const prev = data?.generated;
      const next = await load(true);
      setData(next);
      setError(false);
      setRefreshNote(next.refreshFailed ? f.refreshFailed : next.generated === prev ? f.refreshSame : f.refreshNew);
      setTimeout(() => setRefreshNote(null), 4000);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

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

  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = (data?.days ?? 7) - 1; i >= 0; i--) m.set(wibDay(new Date(now - i * 86400000).toISOString()), 0);
    for (const e of events) {
      const d = wibDay(e.last);
      if (m.has(d)) m.set(d, (m.get(d) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [events, now, data]);

  const byGroup = useMemo(() => {
    const m = new Map<string, { g: string; n: number; d: number; mills: Set<string>; open: number }>();
    for (const e of events) {
      let r = m.get(e.plot.group);
      if (!r) m.set(e.plot.group, (r = { g: e.plot.group, n: 0, d: 0, mills: new Set(), open: 0 }));
      r.n++;
      if (ageBucket(e.last, now) === 0) r.d++;
      r.mills.add(e.plot.mill);
      if (!data?.verifications[e.id]) r.open++;
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [events, now, data]);

  const topMills = useMemo(() => {
    const m = new Map<string, { mill: string; group: string; n: number; d: number }>();
    for (const e of events) {
      const k = `${e.plot.group}|${e.plot.mill}`;
      let r = m.get(k);
      if (!r) m.set(k, (r = { mill: e.plot.mill, group: e.plot.group, n: 0, d: 0 }));
      r.n++;
      if (ageBucket(e.last, now) === 0) r.d++;
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [events, now]);

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
      /* clipboard blocked */
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
  const goEvents = (opts: { group?: string; mill?: string; seg?: Seg } = {}) => {
    setGroup(opts.group ?? "");
    setMill(opts.mill ?? "");
    setSeg(opts.seg ?? "all");
    setQ("");
    setPage(0);
    setTab("events");
  };
  const openOnMap = (id: string) => {
    setSelected(id);
    setTab("map");
  };

  const segButtons = (
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
  );
  const groupSelect = (
    <select value={group} onChange={(e) => { setGroup(e.target.value); setMill(""); setPage(0); }} aria-label={t.fireGroupAny}>
      <option value="">{t.fireGroupAny}</option>
      {groups.map((g) => (
        <option key={g} value={g}>{g}</option>
      ))}
    </select>
  );
  const statusChip = (e: FireEvent) => {
    const v = data?.verifications[e.id];
    return <span className={`chip ${v ? statusTone[v.status] : "warn"}`}>{v ? statusLabel[v.status] : t.fireStatusNone}</span>;
  };

  const header = (
    <header className="app-header">
      <span className="app-brand">
        <BrandMark size={22} />
        <span className="word">
          {f.product} <span className="fire-beta">{f.beta}</span>
        </span>
      </span>
      <nav className="app-tabs" aria-label={f.product}>
        {(["overview", "map", "events", "method"] as const).map((k) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            {k === "overview" ? f.tabOverview : k === "map" ? f.tabMap : k === "events" ? f.tabEvents : f.tabMethod}
          </button>
        ))}
      </nav>
      <div className="app-actions">
        {refreshNote ? <span className="fire-asof fire-note" role="status">{refreshNote}</span> : data ? <span className="fire-asof">{fill(f.asOf, { time: fmtWhen(data.generated) })}</span> : null}
        <button type="button" className="btn-secondary small fire-refresh" onClick={() => void refresh()} disabled={refreshing || !data} title={f.refreshHint}>
          <span className={refreshing ? "fire-spin" : ""} aria-hidden="true">↻</span> {refreshing ? f.refreshing : f.refresh}
        </button>
        <LangToggle />
        <button
          type="button"
          className="btn-text"
          onClick={async () => {
            await logout();
            await navigate({ to: "/login" });
          }}
        >
          {t.signOut}
        </button>
      </div>
    </header>
  );

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <div className="page">
        <div className="eudr-notice danger" role="alert">
          <p>{t.fireError}</p>
          <button type="button" className="eudr-notice-action" onClick={() => setNonce((x) => x + 1)}>{t.retry}</button>
        </div>
      </div>
    );
  } else if (!data) {
    body = (
      <div className="page">
        <div className="eudr-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /></div>
      </div>
    );
  } else if (tab === "overview") {
    const maxDay = Math.max(1, ...perDay.map(([, v]) => v));
    body = (
      <div className="page fire-page">
        <header className="summary-head">
          <div>
            <p className="eyebrow">{fill(f.overviewEyebrow, { days: data.days })}</p>
            <h1>{f.overviewTitle}</h1>
            <p className="chart-note fire-intro">{fill(t.fireIntro, { days: data.days })}</p>
          </div>
        </header>
        <div className="kpi-row summary-kpis fire-kpis">
          <KpiTile value={n(kpi.today)} label={t.fireKpi24} hint={fill(t.fireKpi24Hint, { m: ATTRIB_M })} tone={kpi.today ? "danger" : undefined} onClick={() => goEvents({ seg: "today" })} action={f.seeAll.replace(/\s*›$/, "")} />
          <KpiTile value={n(events.length)} label={fill(t.fireKpi7, { days: data.days })} hint={fill(t.fireKpi7Hint, { m: ATTRIB_M, days: data.days })} onClick={() => goEvents()} action={f.seeAll.replace(/\s*›$/, "")} />
          <KpiTile value={n(kpi.millSet)} label={t.fireKpiMills} hint={t.fireKpiMillsHint} />
          <KpiTile value={n(kpi.plotSet)} label={t.fireKpiPlots} hint={t.fireKpiPlotsHint} />
          <KpiTile value={n(kpi.verified)} label={t.fireKpiVerified} hint={t.fireKpiVerifiedHint} tone={kpi.verified ? "comply" : undefined} onClick={kpi.verified ? () => goEvents({ seg: "verified" }) : undefined} action={kpi.verified ? f.seeAll.replace(/\s*›$/, "") : undefined} />
        </div>
        <p className="chart-note fire-meta">{fill(t.fireDetections, { n: n(data.detections), m: n(events.length) })}</p>

        <div className="fire-ov-grid">
          <section className="chart-card">
            <div className="chart-head"><h2>{f.perDay}</h2></div>
            <div className="fire-days" role="img" aria-label={f.perDay}>
              {perDay.map(([d, v]) => (
                <div key={d} className="fire-day">
                  <span className="fire-day-n tabular-nums">{n(v)}</span>
                  <span className="fire-day-bar" style={{ height: `${Math.max(2, (v / maxDay) * 100)}%` }} />
                  <span className="fire-day-d">{new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                </div>
              ))}
            </div>
            <p className="chart-note">{f.perDayNote}</p>
          </section>
          <section className="chart-card fire-mini-map">
            <div className="chart-head">
              <h2>{f.tabMap}</h2>
              <button type="button" className="btn-text small" onClick={() => setTab("map")}>{f.openMap}</button>
            </div>
            <FireMap events={events} now={now} selected={null} onSelect={(id) => id && openOnMap(id)} compact />
          </section>
        </div>

        <section className="chart-card">
          <div className="chart-head">
            <h2>{f.byGroup}</h2>
            <p className="chart-note">{f.byGroupNote}</p>
          </div>
          <div className="table-scroll">
            <table className="data-table fire-group-table">
              <thead>
                <tr>
                  <th>{f.colGroup}</th>
                  <th className="num">{f.colEvents7}</th>
                  <th className="num">{f.colEvents24}</th>
                  <th className="num">{f.colMills}</th>
                  <th className="num">{f.colOpen}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {byGroup.map((r) => (
                  <tr key={r.g} tabIndex={0} onClick={() => goEvents({ group: r.g })} onKeyDown={(e) => e.key === "Enter" && goEvents({ group: r.g })}>
                    <td>
                      <b>{r.g}</b>
                      {ESTIMATED_GROUPS.has(r.g) ? <small>{t.fireEstimated}</small> : null}
                    </td>
                    <td className="num tabular-nums">{n(r.n)}</td>
                    <td className="num tabular-nums">{r.d ? <span className="fire-hot">{n(r.d)}</span> : "0"}</td>
                    <td className="num tabular-nums">{n(r.mills.size)}</td>
                    <td className="num tabular-nums">{n(r.open)}</td>
                    <td className="num"><span className="btn-text small">{f.seeAll}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="fire-ov-grid">
          <section className="chart-card">
            <div className="chart-head"><h2>{f.topMills}</h2></div>
            <ul className="fire-rank">
              {topMills.map((m) => (
                <li key={`${m.group}|${m.mill}`}>
                  <button type="button" onClick={() => goEvents({ group: m.group, mill: m.mill })}>
                    <span>
                      <b>{m.mill || "—"}</b>
                      <small>{m.group}</small>
                    </span>
                    <span className="tabular-nums">
                      {n(m.n)}
                      {m.d ? <small className="fire-hot">+{n(m.d)} · 24 h</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="chart-card">
            <div className="chart-head">
              <h2>{f.latest}</h2>
              <button type="button" className="btn-text small" onClick={() => goEvents()}>{f.seeAll}</button>
            </div>
            <ul className="fire-rank">
              {events.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => openOnMap(e.id)}>
                    <span>
                      <span className="fire-dot" style={{ background: AGE_COLOR[ageBucket(e.last, now)] }} aria-hidden="true" />
                      <b>{e.plot.mill || "—"}</b>
                      <small>{e.plot.company} · {e.plot.village || e.plot.district}</small>
                    </span>
                    <span className="tabular-nums fire-rank-r">
                      {fmtWhen(e.last)}
                      {statusChip(e)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    );
  } else if (tab === "map") {
    body = (
      <div className="fire-mapview">
        <div className="fire-mapview-map">
          <FireMap events={rows} now={now} selected={selected} onSelect={setSelected} />
        </div>
        <aside className="fire-panel">
          {selectedEvent ? (
            <>
              <button type="button" className="btn-text small fire-panel-back" onClick={() => setSelected(null)}>{f.listBack}</button>
              <EventCard
                event={selectedEvent}
                status={data.verifications[selectedEvent.id]}
                onClose={() => setSelected(null)}
                fmtWhen={fmtWhen}
                statusLabel={statusLabel}
                statusTone={statusTone}
                confLabel={confLabel}
                waUrl={canAct ? waUrl(selectedEvent) : ""}
                onCopy={canAct ? () => void copyLink(selectedEvent) : undefined}
                copied={copied === selectedEvent.id}
                inline
              />
            </>
          ) : (
            <>
              <div className="fire-panel-tools">
                {segButtons}
                {groupSelect}
              </div>
              <p className="fire-panel-count">{fill(f.mapListTitle, { n: n(rows.length) })}</p>
              <ul className="fire-rank fire-panel-list">
                {rows.slice(0, 200).map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setSelected(e.id)}>
                      <span>
                        <span className="fire-dot" style={{ background: AGE_COLOR[ageBucket(e.last, now)] }} aria-hidden="true" />
                        <b>{e.plot.mill || "—"}</b>
                        <small>{e.plot.company} · {e.d === 0 ? t.fireInside : fill(t.fireMetres, { d: e.d })}</small>
                      </span>
                      <span className="tabular-nums fire-rank-r">
                        {fmtWhen(e.last)}
                        {statusChip(e)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    );
  } else if (tab === "events") {
    body = (
      <div className="page fire-page">
        <header className="summary-head">
          <div>
            <p className="eyebrow">{fill(f.overviewEyebrow, { days: data.days })}</p>
            <h1>{f.tabEvents}</h1>
          </div>
        </header>
        <section className="chart-card fire-list" aria-label={t.fireListTitle}>
          <div className="chart-head">
            <h2>
              {t.fireListTitle} <span className="tabular-nums muted">{n(rows.length)}</span>
            </h2>
            <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!rows.length}>{t.fireCsv}</button>
          </div>
          <div className="table-tools fire-tools">
            {segButtons}
            {groupSelect}
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const v = data.verifications[e.id];
                    return (
                      <tr key={e.id} tabIndex={0} onClick={() => openOnMap(e.id)} onKeyDown={(ev) => ev.key === "Enter" && openOnMap(e.id)}>
                        <td>
                          <span className="fire-dot" style={{ background: AGE_COLOR[ageBucket(e.last, now)] }} aria-hidden="true" />
                          <span className="tabular-nums">{fmtWhen(e.last)}</span>
                        </td>
                        <td>
                          <b>{e.plot.mill || "—"}</b>
                          <small>{e.plot.group}{ESTIMATED_GROUPS.has(e.plot.group) ? ` · ${t.fireEstimated}` : ""}</small>
                        </td>
                        <td>
                          <b>{e.plot.company || "—"}</b>
                          <small>{e.plot.type} · {e.plot.id}</small>
                        </td>
                        <td>
                          {e.plot.village || "—"}
                          <small>{e.plot.district}{e.plot.province ? `, ${e.plot.province}` : ""}</small>
                        </td>
                        <td className="num tabular-nums">{e.d === 0 ? t.fireInside : fill(t.fireMetres, { d: n(e.d) })}</td>
                        <td>
                          <span className="tabular-nums">{fill(t.fireDetCount, { n: e.n })}</span>
                          <small>{fill(t.fireFrp, { frp: e.frp })} · {confLabel[e.conf]} · {e.sats.join(", ")}</small>
                        </td>
                        <td>
                          {statusChip(e)}
                          {v ? <small>{fmtWhen(v.at)} · {v.by}</small> : null}
                        </td>
                        <td className="fire-actions" onClick={(ev) => ev.stopPropagation()}>
                          {canAct ? (
                            <>
                              <a className="btn-secondary small" href={waUrl(e)} target="_blank" rel="noopener noreferrer">{t.fireWhatsApp}</a>
                              <button type="button" className="btn-text small" onClick={() => void copyLink(e)}>{copied === e.id ? t.fireCopied : t.fireCopyLink}</button>
                            </>
                          ) : null}
                          <button type="button" className="btn-text small" onClick={() => openOnMap(e.id)}>{f.onMap}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > PAGE ? (
            <div className="table-pager">
              <span className="tabular-nums">{n(pageNow * PAGE + 1)}–{n(Math.min(rows.length, (pageNow + 1) * PAGE))} / {n(rows.length)}</span>
              <div className="table-pager-nav">
                <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)}>‹</button>
                <span className="tabular-nums">{pageNow + 1} / {pages}</span>
                <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)}>›</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    );
  } else {
    body = (
      <div className="page fire-page fire-method">
        <header className="summary-head">
          <div>
            <p className="eyebrow">{f.product}</p>
            <h1>{f.methodTitle}</h1>
          </div>
        </header>
        <section className="chart-card">
          <dl className="fire-method-list">
            {f.method.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="app fire-app">
      {header}
      <main ref={mainRef} className={`app-main ${tab === "map" && data ? "fire-main-map" : ""}`}>{body}</main>
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
  inline = false,
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
  inline?: boolean;
}) {
  const { t, lang } = useI18n();
  const f = fireCopy[lang];
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
  const copernicus = `https://browser.dataspace.copernicus.eu/?zoom=14&lat=${e.lat}&lng=${e.lon}&fromTime=${e.date}T00%3A00%3A00.000Z&toTime=${new Date().toISOString().slice(0, 10)}T23%3A59%3A59.999Z&datasetId=S2_L2A_CDAS`;
  return (
    <aside className={inline ? "fire-card inline" : "fire-card"}>
      {inline ? null : (
        <button type="button" className="fire-card-close" aria-label={t.close} onClick={onClose}>
          ×
        </button>
      )}
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
          {e.plot.type} · {e.plot.id}
          {e.plot.ha > 0 ? ` · ${e.plot.ha.toLocaleString(lang === "id" ? "id-ID" : "en-GB", { maximumFractionDigits: 2 })} ha` : ""}
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
      <p className="fire-card-link">
        <a href={copernicus} target="_blank" rel="noopener noreferrer">
          {f.copernicus} ↗
        </a>
      </p>
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

function FireMap({
  events,
  now,
  selected,
  onSelect,
  compact = false,
}: {
  events: FireEvent[];
  now: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  compact?: boolean;
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sel = selected ? events.find((e) => e.id === selected) ?? null : null;

  const [scenes, setScenes] = useState<FireScenes | null>(null);
  const [scenesState, setScenesState] = useState<"idle" | "loading" | "done">("idle");
  const [src, setSrc] = useState<ImgSrc>("base");
  const [s2Style, setS2Style] = useState<S2Style>("quickfire");
  const [s2Day, setS2Day] = useState<string | null>(null);
  const [s1Day, setS1Day] = useState<string | null>(null);
  const [tiles, setTiles] = useState<FireSceneTiles | null>(null);
  const [tilesState, setTilesState] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle("esri"),
      center: [110, -2],
      zoom: 4.3,
      attributionControl: { compact: true },
    });
    if (!compact) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      map.addSource("plots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
      map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": "#ffffff", "line-width": 1.4, "line-opacity": 0.95 } });
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
          "circle-radius": ["case", ["boolean", ["get", "sel"], false], 7, compact ? 3.5 : 4.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["boolean", ["get", "sel"], false], 2.5, 1],
        },
      });
      map.on("click", "events", (ev) => {
        const ft = ev.features?.[0];
        if (ft) onSelectRef.current(String(ft.properties?.id));
      });
      map.on("mouseenter", "events", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "events", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [compact]);

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
      features: events
        .slice()
        .reverse()
        .map((e) => ({
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
    if (!fittedRef.current && events.length && !selected) {
      fittedRef.current = true;
      const b = new maplibregl.LngLatBounds();
      events.forEach((e) => b.extend([e.lon, e.lat]));
      map.fitBounds(b, { padding: compact ? 16 : 40, maxZoom: 9, duration: 0 });
    }
  }, [events, now, selected, ready, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !sel) return;
    map.flyTo({ center: [sel.lon, sel.lat], zoom: Math.max(map.getZoom(), 13.5), duration: fittedRef.current ? 600 : 0 });
    fittedRef.current = true;
  }, [sel?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every Sentinel pass over the selected event (no cloud filter).
  useEffect(() => {
    setScenes(null);
    setTiles(null);
    setS2Day(null);
    setS1Day(null);
    if (compact || !sel) {
      setScenesState("idle");
      return;
    }
    let alive = true;
    setScenesState("loading");
    fetch(`/fire/imagery?lat=${sel.lat}&lon=${sel.lon}&date=${sel.date}`)
      .then((r) => (r.ok ? r.json() : { s2: [], s1: [] }))
      .then((v: FireScenes) => {
        if (!alive) return;
        setScenes(v);
        setScenesState("done");
        // Default: the first pass on or after the event day, else the newest before it.
        const pick = (list: FireScene[]) => {
          const after = list.filter((x) => x.day >= sel.date);
          return (after.length ? after[after.length - 1] : list[0])?.day ?? null;
        };
        setS2Day(pick(v.s2));
        setS1Day(pick(v.s1));
      })
      .catch(() => alive && (setScenes({ s2: [], s1: [] }), setScenesState("done")));
    return () => {
      alive = false;
    };
  }, [sel?.id, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeDay = src === "s2" ? s2Day : src === "s1" ? s1Day : null;
  useEffect(() => {
    setTiles(null);
    if (!sel || src === "base" || !activeDay) {
      setTilesState("idle");
      return;
    }
    let alive = true;
    setTilesState("loading");
    fetch(`/fire/imagery?lat=${sel.lat}&lon=${sel.lon}&kind=${src}&day=${activeDay}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: FireSceneTiles | null) => alive && (setTiles(v), setTilesState("done")))
      .catch(() => alive && (setTiles(null), setTilesState("done")));
    return () => {
      alive = false;
    };
  }, [sel?.id, src, activeDay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer("img")) map.removeLayer("img");
    if (map.getSource("img")) map.removeSource("img");
    const url = src === "s2" ? tiles?.[s2Style] : src === "s1" ? tiles?.sar : undefined;
    if (!url) return;
    map.addSource("img", { type: "raster", tiles: [url], tileSize: 256, minzoom: 8, maxzoom: 15, attribution: "Copernicus Sentinel data · Microsoft Planetary Computer" });
    map.addLayer({ id: "img", type: "raster", source: "img", minzoom: 8 }, "plots-fill");
  }, [tiles, src, s2Style, ready]);

  const fmtD = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const list = src === "s2" ? scenes?.s2 ?? [] : src === "s1" ? scenes?.s1 ?? [] : [];
  const setDay = src === "s2" ? setS2Day : setS1Day;
  const idx = activeDay ? list.findIndex((x) => x.day === activeDay) : -1;
  const tag = (d: string) => (!sel ? "" : d < sel.date ? f.imgBeforeTag : d === sel.date ? f.imgEventTag : f.imgAfterTag);
  const lastBefore = sel ? list.find((x) => x.day < sel.date)?.day : undefined;
  const firstAfter = sel ? [...list].reverse().find((x) => x.day >= sel.date)?.day : undefined;
  const note = src === "s1" ? f.imgS1Note : s2Style === "quickfire" ? f.imgQuickNote : s2Style === "true" ? f.imgTrueNote : f.imgS2Note;

  return (
    <div className={compact ? "fire-map compact" : "fire-map"}>
      <div ref={ref} className="fire-map-canvas" />
      {compact ? null : (
        <div className="fire-img map-card">
          <b>{f.imagery}</b>
          {!sel ? (
            <p>{f.imgPick}</p>
          ) : scenesState === "loading" ? (
            <p>{f.imgLoading}</p>
          ) : (
            <>
              <div className="seg fire-img-seg" role="group" aria-label={f.imagery}>
                {(["base", "s2", "s1"] as const).map((k) => (
                  <button key={k} type="button" className={src === k ? "on" : ""} aria-pressed={src === k} onClick={() => setSrc(k)}>
                    {k === "base" ? f.imgBase : k === "s2" ? f.imgS2 : f.imgS1}
                  </button>
                ))}
              </div>
              {src === "s2" ? (
                <div className="seg fire-img-seg" role="group" aria-label={f.imgStyle}>
                  {(["quickfire", "swir", "true"] as const).map((k) => (
                    <button key={k} type="button" className={s2Style === k ? "on" : ""} aria-pressed={s2Style === k} onClick={() => setS2Style(k)}>
                      {k === "quickfire" ? f.imgStyleQuick : k === "swir" ? f.imgStyleSwir : f.imgStyleTrue}
                    </button>
                  ))}
                </div>
              ) : null}
              {src !== "base" ? (
                list.length === 0 ? (
                  <p>{f.imgNone}</p>
                ) : (
                  <>
                    <div className="fire-img-day">
                      <button type="button" aria-label={f.imgOlder} title={f.imgOlder} disabled={idx < 0 || idx >= list.length - 1} onClick={() => setDay(list[idx + 1].day)}>
                        ‹
                      </button>
                      <select value={activeDay ?? ""} onChange={(e) => setDay(e.target.value)} aria-label={f.imgDay}>
                        {list.map((x) => (
                          <option key={x.day} value={x.day}>
                            {fmtD(x.day)} · {tag(x.day)}
                            {x.cloud != null ? ` · ${fill(f.imgCloud, { n: x.cloud })}` : ""}
                          </option>
                        ))}
                      </select>
                      <button type="button" aria-label={f.imgNewer} title={f.imgNewer} disabled={idx <= 0} onClick={() => setDay(list[idx - 1].day)}>
                        ›
                      </button>
                    </div>
                    <div className="fire-img-jumps">
                      <button type="button" className="btn-text small" disabled={!lastBefore || lastBefore === activeDay} onClick={() => lastBefore && setDay(lastBefore)}>
                        {f.imgLastBefore}
                      </button>
                      <button type="button" className="btn-text small" disabled={!firstAfter || firstAfter === activeDay} onClick={() => firstAfter && setDay(firstAfter)}>
                        {f.imgFirstAfter}
                      </button>
                    </div>
                    <p>
                      {tilesState === "loading" ? f.imgLoading : tilesState === "done" && !tiles ? f.imgNone : note}
                      {src === "s2" && s2Style === "quickfire" ? <span className="fire-img-credit">{f.imgQuickCredit}</span> : null}
                    </p>
                  </>
                )
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
