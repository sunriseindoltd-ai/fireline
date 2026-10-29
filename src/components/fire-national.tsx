import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BrandMark, FireWord } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { KpiTile } from "@/components/kpi-tile";
import { NationalMap } from "@/components/fire-national-map";
import type { Bounds } from "@/components/fire-map";
import { logout } from "@/lib/auth-actions";
import { fill, formatCount, formatHa } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { nationalCopy } from "@/lib/fire-national-copy";
import { ago, fmtDay, fmtWhen } from "@/lib/fire-ui";
import {
  PT,
  SRC_KEYS,
  attentionOf,
  change,
  daysIn,
  inWin,
  latestPts,
  loadNational,
  ownerFocus,
  ptIn,
  totalSeries,
  unitsHit,
  waLink,
  type Attention,
  type NatData,
  type NatOwner,
  type Win,
} from "@/lib/fire-national";
import { digestAlert, ownerAlert } from "@/lib/fire-national-wa";

type View = "overview" | "map";
const PAGE = 25;
const WIN_KEY = "fireline.natWin";

/** `#id` / `#id/map` ↔ view. */
function readHash(): View {
  if (typeof window === "undefined") return "overview";
  return window.location.hash.replace(/^#/, "") === "id/map" ? "map" : "overview";
}

/**
 * FireLine Indonesia: every hotspot on Indonesian land, who holds the land it fell on (Earthline, RSPO and
 * GFW 2014 boundaries), by province and by company. Every account sees this; Earthline staff also get the
 * supply-chain workspace through `spaceSwitch`.
 */
export function NationalPage({ spaceSwitch }: { spaceSwitch?: React.ReactNode }) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const f = nationalCopy[lang];
  const fc = fireCopy[lang];
  const n = useCallback((v: number) => formatCount(v, lang), [lang]);
  const [data, setData] = useState<NatData | null>(null);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [win, setWinState] = useState<Win>("7");
  const [loading28, setLoading28] = useState(false);
  const [selOwner, setSelOwner] = useState<number | null>(null);
  const [fit, setFit] = useState<{ bbox: Bounds; key: string } | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [help, setHelp] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setView(readHash());
    try {
      const w = localStorage.getItem(WIN_KEY);
      if (w === "24" || w === "7" || w === "28") setWinState(w);
    } catch {}
    const onPop = () => setView(readHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((v: View) => {
    setView(v);
    mainRef.current?.scrollTo({ top: 0 });
    const hash = v === "map" ? "#id/map" : "#id";
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, []);
  const setWin = (w: Win) => {
    setWinState(w);
    try {
      localStorage.setItem(WIN_KEY, w);
    } catch {}
  };

  const fetchData = useCallback(
    (body: { refresh?: boolean; pts?: 7 | 28 }) =>
      loadNational(body).catch((e) => {
        if (String(e?.message) === "401") void navigate({ to: "/login" });
        throw e;
      }),
    [navigate],
  );
  useEffect(() => {
    let alive = true;
    setError(false);
    const timer = setTimeout(() => alive && setSlow(true), 8000);
    fetchData({ pts: 7 })
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [nonce, fetchData]);
  // Four weeks of map points only when the 28-day period is chosen (a few MB).
  const has28 = !!data && data.ptsFrom <= data.days[0];
  useEffect(() => {
    if (win !== "28" || !data || has28 || loading28) return;
    setLoading28(true);
    fetchData({ pts: 28 })
      .then((d) => {
        if (d.generated !== data.generated) setSelOwner(null);
        setData(d);
      })
      .catch(() => setWin("7"))
      .finally(() => setLoading28(false));
  }, [win, data, has28, loading28, fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const prev = data?.generated;
      const next = await fetchData({ refresh: true, pts: win === "28" ? 28 : 7 });
      if (next.generated !== prev) setSelOwner(null);
      setData(next);
      setNote(next.refreshFailed ? fc.refreshFailed : next.generated === prev ? fc.refreshSame : fc.refreshNew);
      setTimeout(() => setNote(null), 5000);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  // ------------------------------------------------------------ figures for the period
  const effWin: Win = win === "28" && !has28 ? "7" : win;
  const areaReady = effWin === win;
  const winName = win === "24" ? f.winName24 : win === "7" ? f.winName7 : f.winName28;
  const fig = useMemo(() => {
    if (!data) return null;
    const series = totalSeries(data.total);
    const tot = inWin({ d: series, h24: data.total.h24, p24: data.total.p24 }, win);
    const inside = win === "24" ? data.total.in24 : daysIn(data.total.inO, win).reduce((a, b) => a + b, 0);
    const high = win === "24" ? data.total.c24[2] : daysIn(data.total.h, win).reduce((a, b) => a + b, 0);
    const owners = data.owners.map((o, i) => ({ o, i, ...inWin(o, win) })).filter((r) => r.n > 0);
    owners.sort((a, b) => b.n - a.n);
    const provs = data.prov
      .map((p, i) => ({ p, i, ...inWin(p, win), inside: win === "24" ? p.in24 : daysIn(p.inO, win).reduce((a, b) => a + b, 0) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n);
    // Area of the estates / concessions hit in the period (from the map points; 28 days once they are loaded).
    const hit = unitsHit(data, effWin);
    const ownerHa = new Map<number, number>();
    for (const u of hit.units.keys()) {
      const o = data.units[u].o;
      if (o >= 0) ownerHa.set(o, (ownerHa.get(o) ?? 0) + data.units[u].ha);
    }
    return { series, tot, inside, high, owners, provs, elOwners: owners.filter((r) => r.o.src & 1).length, hit, ownerHa };
  }, [data, win, effWin]);

  /** Bounds of the loaded points that pass `keep`. */
  const bboxOf = useCallback(
    (keep: (i: number) => boolean): Bounds | null => {
      if (!data) return null;
      const p = data.pts;
      let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
      for (let i = 0; i < p.length; i += PT) {
        if (!keep(i)) continue;
        const x = p[i] / 1e4, y = p[i + 1] / 1e4;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > nn) nn = y;
      }
      return Number.isFinite(w) ? [w, s, e, nn] : null;
    },
    [data],
  );
  const ownerOfPt = useCallback((i: number) => (data && data.pts[i + 6] >= 0 ? data.units[data.pts[i + 6]].o : -1), [data]);
  const pickOwner = useCallback(
    (o: number, toMap = true) => {
      if (!data) return;
      setSelOwner(o);
      const nDays = data.days.length;
      const b = bboxOf((i) => ownerOfPt(i) === o && ptIn(data.pts, i, effWin, nDays)) ?? bboxOf((i) => ownerOfPt(i) === o);
      if (b) setFit({ bbox: b, key: `o${o}-${Date.now()}` });
      if (toMap) go("map");
    },
    [data, bboxOf, ownerOfPt, effWin, go],
  );
  const pickProv = useCallback(
    (pi: number) => {
      if (!data) return;
      const b = bboxOf((i) => data.pts[i + 7] >= 0 && data.kab[data.pts[i + 7]].p === pi);
      if (b) setFit({ bbox: b, key: `p${pi}-${Date.now()}` });
      setSelOwner(null);
      go("map");
    },
    [data, bboxOf, go],
  );

  const provLabel = (i: number) => (!data || i < 0 ? "" : lang === "en" ? data.prov[i].en : data.prov[i].id);
  const pct = (x: number, y: number) => (y ? `${((x / y) * 100).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 })}%` : "—");
  const changeTxt = (now: number, prev: number | null) => {
    const c = change(now, prev);
    if (!c) return "";
    if (c.dir === "same") return f.same;
    return c.pct === null ? f.up : `${c.dir === "up" ? "▲" : "▼"} ${c.pct}%`;
  };

  // ------------------------------------------------------------------- header
  const header = (
    <header className="app-header fl-header">
      <span className="app-brand">
        <BrandMark size={22} />
        <span className="word">
          <FireWord />
        </span>
      </span>
      {spaceSwitch}
      <nav className="app-tabs fl-tabs" aria-label={f.spaceId}>
        {(["overview", "map"] as const).map((k) => (
          <button key={k} type="button" className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => go(k)}>
            {k === "overview" ? f.navOverview : f.navMap}
          </button>
        ))}
      </nav>
      <div className="app-actions">
        {note ? (
          <span className="fl-asof fl-asof-note" role="status">
            {note}
          </span>
        ) : data ? (
          <span className={`fl-asof ${data.refreshFailed ? "warn" : ""}`}>{fill(fc.asOf, { time: fmtWhen(data.generated, lang) })}</span>
        ) : null}
        <button type="button" className="btn-secondary small fl-refresh" onClick={() => void refresh()} disabled={refreshing || !data} title={fc.refreshHint} aria-label={fc.refresh}>
          <span className={refreshing ? "fire-spin" : ""} aria-hidden="true">
            ↻
          </span>
          <span className="fl-refresh-label">{refreshing ? fc.refreshing : fc.refresh}</span>
        </button>
        <button type="button" className="fl-help-btn" onClick={() => setHelp(true)} aria-label={f.methodTitle} title={f.methodTitle}>
          ?
        </button>
        <LangToggle />
        <button
          type="button"
          className="btn-text fl-signout"
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

  const winSeg = (
    <div className="seg fl-seg nat-win" role="group" aria-label={f.win}>
      {(
        [
          ["24", f.w24],
          ["7", f.w7],
          ["28", f.w28],
        ] as const
      ).map(([k, label]) => (
        <button key={k} type="button" className={win === k ? "on" : ""} aria-pressed={win === k} onClick={() => setWin(k)}>
          {label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <div className="page">
        <div className="eudr-notice danger" role="alert">
          <p>{f.error}</p>
          <button type="button" className="eudr-notice-action" onClick={() => setNonce((x) => x + 1)}>
            {t.retry}
          </button>
        </div>
      </div>
    );
  } else if (!data || !fig) {
    body = (
      <div className="fl-loading" aria-busy="true">
        <span className="spinner" aria-hidden="true" /> {f.loading}
        {slow ? <p className="fl-note">{f.loadingSlow}</p> : null}
      </div>
    );
  } else if (view === "overview") {
    const topProv = fig.provs[0];
    const h24 = data.total.h24;
    const winTot = win === "24" ? inWin({ d: fig.series, h24: 0, p24: 0 }, "7") : fig.tot;
    const winLabel = win === "24" ? f.winName7 : winName;
    body = (
      <div className="page fl-page nat-page">
        <header className="fl-page-head nat-head">
          <div>
            <h1>{f.title}</h1>
            <p className="fl-note">{fill(f.sub, { days: data.days.length, time: fmtWhen(data.generated, lang) })}</p>
          </div>
          <div className="nat-head-tools">
            <a className="btn-primary small nat-wa" href={waLink(digestAlert(data, lang))} target="_blank" rel="noopener noreferrer" title={f.waNote}>
              <WaIcon /> {f.waDigest}
            </a>
            {winSeg}
          </div>
        </header>
        <div className="kpi-row fl-kpis nat-kpis">
          <KpiTile
            value={n(h24)}
            label={f.kpi24}
            hint={f.kpi24Hint}
            tone={h24 ? "danger" : undefined}
            sub={
              <>
                {fill(f.kpiPrev24, { n: n(data.total.p24), pct: changeTxt(h24, data.total.p24) })}
                <br />
                {fill(f.kpiHigh, { n: n(data.total.c24[2]) })}
              </>
            }
          />
          <KpiTile
            value={n(winTot.n)}
            label={fill(f.kpiWin, { win: winLabel })}
            hint={f.kpiWinHint}
            sub={winTot.prev !== null ? fill(f.kpiPrevWin, { days: win === "28" ? 28 : 7, n: n(winTot.prev), pct: changeTxt(winTot.n, winTot.prev) }) : fill(f.kpiHigh, { n: n(fig.high) })}
          />
          <KpiTile value={n(fig.owners.length)} label={f.kpiCos} hint={f.kpiCosHint} sub={fill(f.kpiCosSub, { n: n(fig.elOwners) })} />
          <KpiTile value={pct(fig.inside, fig.tot.n)} label={f.kpiIn} hint={f.kpiInHint} sub={fill(f.kpiInSub, { n: n(fig.inside), m: n(fig.tot.n) })} />
          <KpiTile value={areaReady ? formatHa(fig.hit.ha, lang) : "…"} label={f.kpiArea} hint={f.kpiAreaHint} sub={areaReady ? fill(f.kpiAreaSub, { n: n(fig.hit.units.size) }) : f.loading28} />
        </div>

        <div className="nat-grid">
          <section className="chart-card nat-map-card">
            <div className="fl-card-head">
              <h2 className="fl-h2">{topProv ? fill(f.mapTitle, { prov: provLabel(topProv.i), n: n(topProv.n), m: n(fig.tot.n) }) : f.mapTitleNone}</h2>
              <button type="button" className="btn-secondary small" onClick={() => go("map")}>
                {f.mapOpen}
              </button>
            </div>
            <div className="nat-map-box">
              {loading28 ? <p className="nat-map-busy">{f.loading28}</p> : null}
              <NationalMap data={data} win={effWin} selOwner={null} compact fit={null} />
            </div>
          </section>
          <section className="chart-card">
            <h2 className="fl-h2">{f.topTitle}</h2>
            <p className="fl-note">{f.topNote}</p>
            {fig.owners.length === 0 ? (
              <p className="muted">{f.topNone}</p>
            ) : (
              <ul className="nat-bars">
                {fig.owners.slice(0, 10).map((r) => (
                  <li key={r.i}>
                    <button type="button" onClick={() => pickOwner(r.i)} title={f.showOnMap}>
                      <span className="nat-bar-label">
                        <b>{r.o.name}</b>
                        <small>
                          <AttChip a={attentionOf(r.o)} /> {[r.o.group, provLabel(r.o.prov)].filter(Boolean).join(" · ")}
                        </small>
                      </span>
                      <span className="nat-bar-track" aria-hidden="true">
                        <i style={{ width: `${Math.max(2, (r.n / fig.owners[0].n) * 100)}%` }} />
                      </span>
                      <span className="nat-bar-n tabular-nums">{n(r.n)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <Latest data={data} win={effWin} winName={winName} onPick={(o) => pickOwner(o)} />

        <div className="fl-grid2">
          <Trend data={data} series={fig.series} />
          <section className="chart-card">
            <h2 className="fl-h2">{f.provTitle}</h2>
            <div className="table-scroll">
              <table className="data-table fl-group-table nat-prov">
                <thead>
                  <tr>
                    <th>{f.colProv}</th>
                    <th className="num">{f.colHot}</th>
                    <th className="num">{f.colShare}</th>
                    <th className="num">{f.col24}</th>
                    <th className="num">{f.colIn}</th>
                  </tr>
                </thead>
                <tbody>
                  {fig.provs.slice(0, 12).map((r) => (
                    <tr key={r.i} tabIndex={0} onClick={() => pickProv(r.i)} onKeyDown={(e) => e.key === "Enter" && pickProv(r.i)}>
                      <td>
                        <b>{provLabel(r.i)}</b>
                      </td>
                      <td className="num tabular-nums">{n(r.n)}</td>
                      <td className="num tabular-nums">{pct(r.n, fig.tot.n)}</td>
                      <td className="num tabular-nums">
                        {r.p.h24 ? <span className="fl-hot">{n(r.p.h24)}</span> : "0"}
                        {r.p.h24 || r.p.p24 ? <small>{changeTxt(r.p.h24, r.p.p24)}</small> : null}
                      </td>
                      <td className="num tabular-nums">{pct(r.inside, r.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <Companies data={data} rows={fig.owners} win={win} winName={winName} ownerHa={areaReady ? fig.ownerHa : null} onPick={(o) => pickOwner(o)} />
        <p className="fl-note nat-foot">
          {fill(f.outsideNote, { n: n(data.outside) })}{" "}
          <button type="button" className="linkish" onClick={() => setHelp(true)}>
            {f.methodTitle}
          </button>
        </p>
      </div>
    );
  } else {
    body = (
      <MapView
        data={data}
        win={effWin}
        winSeg={winSeg}
        winName={winName}
        loading28={loading28}
        selOwner={selOwner}
        fit={fit}
        bounds={bounds}
        onView={setBounds}
        onPick={(o) => pickOwner(o, false)}
        onClear={() => setSelOwner(null)}
      />
    );
  }

  return (
    <div className={`app fire-app fl-app nat-app view-${view === "map" ? "map" : "summary"}`}>
      {header}
      {data && Date.now() - Date.parse(data.generated) > 6 * 3600000 ? (
        <p className="fl-banner" role="status">
          {fill(data.refreshFailed ? fc.staleFailed : fc.stale, { ago: ago(data.generated, Date.now(), lang) })}{" "}
          <button type="button" className="linkish" onClick={() => void refresh()} disabled={refreshing}>
            {fc.refresh}
          </button>
        </p>
      ) : null}
      <main ref={mainRef} className={`app-main fl-main ${data && view === "map" ? "fill" : ""}`}>
        {body}
      </main>
      <nav className="fl-bottom nat-bottom" aria-label={f.spaceId}>
        {(["overview", "map"] as const).map((k) => (
          <button key={k} type="button" className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => go(k)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={k === "overview" ? "M5 20V10M12 20V4M19 20v-7" : "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"} />
            </svg>
            <span>{k === "overview" ? f.navOverview : f.navMap}</span>
          </button>
        ))}
      </nav>
      {help ? <Method onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

// --------------------------------------------------------------------- trend

function Trend({ data, series }: { data: NatData; series: number[] }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const [by, setBy] = useState<"conf" | "loc">("conf");
  const max = Math.max(1, ...series);
  const peak = series.indexOf(Math.max(...series));
  const segs = (i: number): [string, number, string][] =>
    by === "conf"
      ? [
          ["#8a8f98", data.total.l[i], f.confLow],
          ["#f5b301", data.total.n[i], f.confNom],
          ["#e5322d", data.total.h[i], f.confHigh],
        ]
      : [
          ["#8a8f98", series[i] - data.total.inO[i], f.locOut],
          ["#e5322d", data.total.inO[i], f.locIn],
        ];
  const legend = by === "conf" ? segs(0).map(([c, , l]) => [c, l]) : segs(0).map(([c, , l]) => [c, l]);
  const last = series.length - 1;
  return (
    <section className="chart-card">
      <div className="fl-card-head">
        <h2 className="fl-h2">{fill(f.trendTitle, { day: fmtDay(data.days[peak], lang), n: n(series[peak]) })}</h2>
        <div className="seg fl-seg" role="group" aria-label={f.trendBy}>
          <button type="button" className={by === "conf" ? "on" : ""} aria-pressed={by === "conf"} onClick={() => setBy("conf")}>
            {f.trendConf}
          </button>
          <button type="button" className={by === "loc" ? "on" : ""} aria-pressed={by === "loc"} onClick={() => setBy("loc")}>
            {f.trendLoc}
          </button>
        </div>
      </div>
      <div className="fl-days nat-days" role="img" aria-label={f.trendTitle}>
        {series.map((tot, i) => (
          <div key={data.days[i]} className={`fl-day ${i === last ? "today" : ""}`} title={`${fmtDay(data.days[i], lang)}: ${n(tot)}`}>
            <span className="fl-day-bar" style={{ height: `${Math.max(1, (tot / max) * 100)}%` }}>
              {segs(i)
                .slice()
                .reverse()
                .map(([c, v]) => (v ? <i key={c} style={{ flexGrow: v, background: c }} /> : null))}
            </span>
          </div>
        ))}
      </div>
      <DayAxis days={data.days} />
      <p className="fl-legend-inline">
        {legend.map(([c, l]) => (
          <span key={l}>
            <i style={{ background: c }} aria-hidden="true" />
            {l}
          </span>
        ))}
      </p>
      <p className="fl-note">{f.trendNote}</p>
    </section>
  );
}

/** Dates under a 28-bar chart: first day, every week, and today. */
function DayAxis({ days }: { days: string[] }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const last = days.length - 1;
  return (
    <div className="nat-axis" aria-hidden="true">
      {days.map((d, i) =>
        (last - i) % 7 === 0 ? (
          <span key={d} style={{ left: `${((i + 0.5) / days.length) * 100}%` }} className={i === last ? "end" : ""}>
            {i === last ? f.today : fmtDay(d, lang)}
          </span>
        ) : null,
      )}
    </div>
  );
}

// ----------------------------------------------------------------- companies

type Row = { o: NatOwner; i: number; n: number; prev: number | null };

function SrcChips({ src }: { src: number }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  return (
    <span className="nat-src">
      {SRC_KEYS.filter(([, b]) => src & b).map(([k]) => (
        <span key={k} className={`fl-tag nat-src-${k}`} title={f.srcHint[k]}>
          {f.src[k]}
        </span>
      ))}
    </span>
  );
}

function Companies({ data, rows, win, winName, ownerHa, onPick }: { data: NatData; rows: Row[]; win: Win; winName: string; ownerHa: Map<number, number> | null; onPick: (o: number) => void }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [prov, setProv] = useState(-1);
  const [page, setPage] = useState(0);
  const provName = (i: number) => (i < 0 ? "" : lang === "en" ? data.prov[i].en : data.prov[i].id);
  const list = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return rows.filter((r) => (prov < 0 || r.o.prov === prov) && (!needle || `${r.o.name} ${r.o.group} ${provName(r.o.prov)} ${data.prov[r.o.prov]?.id ?? ""}`.toLowerCase().includes(needle)));
  }, [rows, dq, prov, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const provs = useMemo(() => [...new Set(rows.map((r) => r.o.prov).filter((p) => p >= 0))].sort((a, b) => provName(a).localeCompare(provName(b))), [rows, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const daysOf = (o: NatOwner) => daysIn(o.d, win).filter((v) => v > 0).length;
  const frpOf = (o: NatOwner) => Math.max(0, ...daysIn(o.frp, win));
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["company", "group", "province", "regency", "hotspots", "hotspots_previous_period", "last_24h", "days_with_hotspots", "strongest_frp_mw", "area_with_hotspots_ha", "attention", "boundary_sources", "period", "data_time_utc"];
    const lines = list.map((r) =>
      [
        r.o.name, r.o.group, provName(r.o.prov), r.o.kab >= 0 ? data.kab[r.o.kab].n : "", r.n, r.prev ?? "", r.o.h24,
        win === "24" ? "" : daysOf(r.o), win === "24" ? "" : Math.round(frpOf(r.o)), ownerHa ? Math.round(ownerHa.get(r.i) ?? 0) : "", attentionOf(r.o),
        SRC_KEYS.filter(([, b]) => r.o.src & b).map(([k]) => f.src[k]).join("; "), winName, data.generated,
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([`﻿${[head.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fireline-indonesia-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="chart-card">
      <div className="fl-card-head">
        <div>
          <h2 className="fl-h2">{f.cosTitle}</h2>
          <p className="fl-note">{fill(f.cosSub, { n: n(rows.length), win: winName })}</p>
        </div>
        <button type="button" className="btn-secondary small" onClick={csv} disabled={!list.length}>
          {f.csv}
        </button>
      </div>
      <div className="fl-tools wrap">
        <select
          className="fl-select"
          value={prov}
          onChange={(e) => {
            setProv(Number(e.target.value));
            setPage(0);
          }}
          aria-label={f.provAny}
        >
          <option value={-1}>{f.provAny}</option>
          {provs.map((p) => (
            <option key={p} value={p}>
              {provName(p)}
            </option>
          ))}
        </select>
        <input
          className="fl-search"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder={f.search}
          aria-label={f.search}
        />
      </div>
      {list.length === 0 ? (
        <p className="fl-empty">{f.noMatch}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table fl-table nat-cos">
              <thead>
                <tr>
                  <th>{f.colCompany}</th>
                  <th>{f.colWhere}</th>
                  <th className="num">{f.colHot}</th>
                  <th className="num">{f.col24}</th>
                  {win === "24" ? null : <th className="num">{f.colDays}</th>}
                  {win === "24" ? null : <th className="num">{f.colFrp}</th>}
                  <th className="num">{f.colArea}</th>
                  <th title={f.attHint}>{f.colAtt}</th>
                  <th>{f.colSrc}</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(pg * PAGE, (pg + 1) * PAGE).map((r) => (
                  <tr key={r.i} tabIndex={0} onClick={() => onPick(r.i)} onKeyDown={(e) => e.key === "Enter" && onPick(r.i)}>
                    <td>
                      <b>{r.o.name}</b>
                      {r.o.group ? <small>{r.o.group}</small> : null}
                    </td>
                    <td>
                      {r.o.kab >= 0 ? data.kab[r.o.kab].n : "—"}
                      <small>{provName(r.o.prov)}</small>
                    </td>
                    <td className="num tabular-nums">{n(r.n)}</td>
                    <td className="num tabular-nums">{r.o.h24 ? <span className="fl-hot">{n(r.o.h24)}</span> : "0"}</td>
                    {win === "24" ? null : <td className="num tabular-nums">{daysOf(r.o)}</td>}
                    {win === "24" ? null : <td className="num tabular-nums">{n(frpOf(r.o))}</td>}
                    <td className="num tabular-nums">{ownerHa ? n(ownerHa.get(r.i) ?? 0) : "…"}</td>
                    <td>
                      <AttChip a={attentionOf(r.o)} />
                    </td>
                    <td>
                      <SrcChips src={r.o.src} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > PAGE ? (
            <div className="table-pager">
              <span className="tabular-nums">
                {n(pg * PAGE + 1)}–{n(Math.min(list.length, (pg + 1) * PAGE))} / {n(list.length)}
              </span>
              <div className="table-pager-nav">
                <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="‹">
                  ‹
                </button>
                <span className="tabular-nums">
                  {pg + 1} / {pages}
                </span>
                <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="›">
                  ›
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- map tab

function MapView({
  data,
  win,
  winSeg,
  winName,
  loading28,
  selOwner,
  fit,
  bounds,
  onView,
  onPick,
  onClear,
}: {
  data: NatData;
  win: Win;
  winSeg: React.ReactNode;
  winName: string;
  loading28: boolean;
  selOwner: number | null;
  fit: { bbox: Bounds; key: string } | null;
  bounds: Bounds | null;
  onView: (b: Bounds) => void;
  onPick: (o: number) => void;
  onClear: () => void;
}) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const nDays = data.days.length;
  // Hotspots and companies inside the visible map.
  const inView = useMemo(() => {
    const p = data.pts;
    const by = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < p.length; i += PT) {
      if (!ptIn(p, i, win, nDays)) continue;
      const x = p[i] / 1e4, y = p[i + 1] / 1e4;
      if (bounds && (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3])) continue;
      total += p[i + 3];
      const u = p[i + 6];
      if (u >= 0 && data.units[u].o >= 0) by.set(data.units[u].o, (by.get(data.units[u].o) ?? 0) + p[i + 9]);
    }
    return { total, cos: [...by.entries()].sort((a, b) => b[1] - a[1]) };
  }, [data, win, nDays, bounds]);
  const sel = selOwner !== null ? data.owners[selOwner] : null;
  // Sentinel imagery around the selected company's newest hotspot.
  const imageryFor = useMemo(() => {
    if (selOwner === null) return null;
    const i = ownerFocus(data, selOwner);
    if (i === null) return null;
    return { id: `o${selOwner}-${data.generated}`, lat: data.pts[i + 1] / 1e4, lon: data.pts[i] / 1e4, day: data.days[data.pts[i + 2]] };
  }, [data, selOwner]);
  return (
    <div className={`fl-mapview nat-mapview ${sel ? "has-sel" : ""}`}>
      <div className="fl-mapview-map">
        <NationalMap data={data} win={win} selOwner={selOwner} onSelectOwner={onPick} onView={onView} fit={fit} imageryFor={imageryFor} labels={sel ? 0 : 8} />
        <div className="fl-map-tools map-card nat-map-win">
          {winSeg}
          {loading28 ? <span className="muted">{f.loading28}</span> : null}
        </div>
      </div>
      <aside className="fl-mapview-panel">
        {sel && selOwner !== null ? (
          <>
            <button type="button" className="btn-text fl-back always" onClick={onClear}>
              {f.back}
            </button>
            <OwnerDetail data={data} o={selOwner} win={win} winName={winName} />
          </>
        ) : (
          <>
            <p className="fl-panel-count">
              <b>{fill(f.inView, { n: n(inView.total) })}</b>
            </p>
            <h2 className="fl-h2">{f.inViewCos}</h2>
            {inView.cos.length === 0 ? (
              <p className="muted">{f.inViewNone}</p>
            ) : (
              <ul className="fl-rank nat-rank">
                {inView.cos.slice(0, 60).map(([o, v]) => (
                  <li key={o}>
                    <button type="button" onClick={() => onPick(o)}>
                      <span>
                        <b>{data.owners[o].name}</b>
                        <small>{[data.owners[o].group, data.owners[o].kab >= 0 ? data.kab[data.owners[o].kab].n : ""].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="fl-rank-n tabular-nums">{n(v)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {inView.cos.length > 60 ? <p className="fl-note">{f.zoomHint}</p> : null}
          </>
        )}
      </aside>
    </div>
  );
}

function OwnerDetail({ data, o, win, winName }: { data: NatData; o: number; win: Win; winName: string }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const ow = data.owners[o];
  const w = inWin(ow, win);
  const days28 = ow.d.filter((v) => v > 0).length;
  const frp = Math.max(0, ...(win === "24" ? ow.frp.slice(-2) : daysIn(ow.frp, win)));
  // Estates / units hit, from the loaded points of the period.
  const units = useMemo(() => {
    const m = new Map<string, number>();
    const p = data.pts;
    for (let i = 0; i < p.length; i += PT) {
      const u = p[i + 6];
      if (u < 0 || data.units[u].o !== o || !ptIn(p, i, win, data.days.length)) continue;
      const name = data.units[u].u;
      if (name) m.set(name, (m.get(name) ?? 0) + p[i + 9]);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data, o, win]);
  const max = Math.max(1, ...ow.d);
  const last = ow.d.length - 1;
  const hit = useMemo(() => unitsHit(data, win, o), [data, win, o]);
  const unitHa = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of hit.units.keys()) if (data.units[u].u) m.set(data.units[u].u, (m.get(data.units[u].u) ?? 0) + data.units[u].ha);
    return m;
  }, [data, hit]);
  return (
    <div className="fl-detail nat-owner">
      <header className="fl-detail-head">
        <h2>{ow.name}</h2>
        <p className="muted">
          {[ow.group, ow.kab >= 0 ? data.kab[ow.kab].n : "", ow.prov >= 0 ? (lang === "en" ? data.prov[ow.prov].en : data.prov[ow.prov].id) : ""].filter(Boolean).join(" · ")}
        </p>
        <span className="nat-owner-tags">
          <AttChip a={attentionOf(ow)} />
          <SrcChips src={ow.src} />
        </span>
      </header>
      <a className="btn-primary block nat-wa" href={waLink(ownerAlert(data, o, lang))} target="_blank" rel="noopener noreferrer">
        <WaIcon /> {f.wa}
      </a>
      <p className="fl-note nat-wa-note">{f.waNote}</p>
      <dl className="nat-owner-kpis">
        <div>
          <dt>{fill(f.coHot, { win: winName })}</dt>
          <dd className="tabular-nums">{n(w.n)}</dd>
        </div>
        <div>
          <dt>{f.co24}</dt>
          <dd className="tabular-nums">{ow.h24 ? <span className="fl-hot">{n(ow.h24)}</span> : "0"}</dd>
        </div>
        <div>
          <dt>{f.coDays}</dt>
          <dd className="tabular-nums">{days28} / 28</dd>
        </div>
        <div>
          <dt>{f.coFrp}</dt>
          <dd className="tabular-nums">{n(frp)} MW</dd>
        </div>
        <div className="wide">
          <dt>{f.coArea}</dt>
          <dd className="tabular-nums">{formatHa(hit.ha, lang)}</dd>
        </div>
      </dl>
      <h3 className="fl-h2">{f.coPerDay}</h3>
      <div className="fl-days nat-days small" role="img" aria-label={f.coPerDay}>
        {ow.d.map((v, i) => (
          <div key={data.days[i]} className={`fl-day ${i === last ? "today" : ""}`} title={`${fmtDay(data.days[i], lang)}: ${n(v)}`}>
            <span className="fl-day-bar" style={{ height: `${v ? Math.max(3, (v / max) * 100) : 0}%` }}>
              {v ? <i style={{ flexGrow: 1, background: "#e5322d" }} /> : null}
            </span>
          </div>
        ))}
      </div>
      <DayAxis days={data.days} />
      <h3 className="fl-h2">{f.coUnits}</h3>
      {units.length === 0 ? (
        <p className="muted">{f.coUnitsNone}</p>
      ) : (
        <ul className="fl-rank nat-units">
          {units.slice(0, 20).map(([u, v]) => (
            <li key={u}>
              <span className="nat-unit">
                <span>
                  {u}
                  {unitHa.get(u) ? <small> · {formatHa(unitHa.get(u)!, lang)}</small> : null}
                </span>
                <span className="fl-rank-n tabular-nums">{n(v)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="fl-note">{f.coNote}</p>
    </div>
  );
}

function WaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="nat-wa-ico">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}

function AttChip({ a }: { a: Attention }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  return (
    <span className={`fl-tag nat-att ${a}`} title={f.attHint}>
      {f.att[a]}
    </span>
  );
}

/** Newest hotspots inside a plantation boundary (the mockup's "recent detections"). */
function Latest({ data, win, winName, onPick }: { data: NatData; win: Win; winName: string; onPick: (o: number) => void }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const p = data.pts;
  const rows = useMemo(() => latestPts(data, win, 400).filter((i) => p[i + 6] >= 0 && data.units[p[i + 6]].o >= 0).slice(0, 10), [data, win, p]);
  const fmt = (min: number) =>
    new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.parse(data.generated) - min * 60000));
  if (!rows.length) return null;
  return (
    <section className="chart-card">
      <h2 className="fl-h2">{f.latestTitle}</h2>
      <p className="fl-note">{fill(f.latestNote, { win: winName })}</p>
      <div className="table-scroll">
        <table className="data-table fl-table nat-latest">
          <thead>
            <tr>
              <th>{f.colTime}</th>
              <th>{f.colCompany}</th>
              <th>{f.colEstate}</th>
              <th>{f.colWhere}</th>
              <th>{f.colConf}</th>
              <th className="num">FRP</th>
              <th title={f.attHint}>{f.colAtt}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const unit = data.units[p[i + 6]];
              const o = data.owners[unit.o];
              const kab = p[i + 7] >= 0 ? data.kab[p[i + 7]] : null;
              return (
                <tr key={i} tabIndex={0} onClick={() => onPick(unit.o)} onKeyDown={(e) => e.key === "Enter" && onPick(unit.o)}>
                  <td className="tabular-nums">{fmt(p[i + 8])}</td>
                  <td>
                    <b>{o.name}</b>
                    {o.group ? <small>{o.group}</small> : null}
                  </td>
                  <td>{unit.u || "—"}</td>
                  <td>
                    {kab ? kab.n : "—"}
                    <small>{kab ? (lang === "en" ? data.prov[kab.p].en : data.prov[kab.p].id) : ""}</small>
                  </td>
                  <td>
                    <span className={`fl-tag nat-conf c${p[i + 5]}`}>{f.conf[p[i + 5]]}</span>
                  </td>
                  <td className="num tabular-nums">{n(p[i + 4])} MW</td>
                  <td>
                    <AttChip a={attentionOf(o)} />
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

function Method({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const fc = fireCopy[lang];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(".fl-x")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="fl-drawer" role="dialog" aria-modal="true" aria-label={f.methodTitle}>
      <button type="button" className="fl-drawer-scrim" aria-label={fc.close} onClick={onClose} tabIndex={-1} />
      <div ref={ref} className="fl-drawer-panel fl-help">
        <header className="fl-detail-head">
          <h2>{f.methodTitle}</h2>
          <button type="button" className="fl-x" aria-label={fc.close} onClick={onClose}>
            ×
          </button>
        </header>
        <dl className="fl-method">
          {f.method.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
