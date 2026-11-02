import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { WhatsAppLogo } from "@/components/brand-icons";
import { useNavigate } from "@tanstack/react-router";
import { BrandMark, FireWord } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { SkinToggle } from "@/components/skin-toggle";
import { KCell } from "@/components/fire-kcell";
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
  ageClass,
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
  const [allProv, setAllProv] = useState(false);
  const [panel, setPanel] = useState<"latest" | "prov">(() => {
    try {
      return localStorage.getItem("fireline.natPanel") === "prov" ? "prov" : "latest";
    } catch {
      return "latest";
    }
  });
  const pickPanel = (v: "latest" | "prov") => {
    setPanel(v);
    try {
      localStorage.setItem("fireline.natPanel", v);
    } catch {}
  };
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
          <button key={k} type="button" data-k={k} className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => go(k)}>
            <span className="fl-tab-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={k === "overview" ? "M3 11l9-8 9 8M5 10v10h14V10" : "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"} />
              </svg>
            </span>
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
        <SkinToggle />
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
    const heroN = win === "24" ? h24 : winTot.n;
    const heroPrev = win === "24" ? data.total.p24 : winTot.prev;
    body = (
      <div className="page fl-page nat-page">
        <section className="flx-hero" aria-label={f.title}>
          <div className="flx-hero-map" aria-hidden="true">
            <NationalMap data={data} win={effWin} selOwner={null} compact fit={null} padLeft={0.36} />
          </div>
          <div className="flx-hero-shade" aria-hidden="true" />
          <div className="flx-hero-win">{winSeg}</div>
          <div className="flx-hero-text">
            <span className="flx-eyebrow">{fill(f.heroEyebrow, { win: winName })}</span>
            <h1>
              <span className="flx-hero-n tabular-nums">{n(heroN)}</span>
              <span className="flx-hero-unit">{f.heroUnit}</span>
            </h1>
            <p>
              {heroPrev !== null
                ? win === "24"
                  ? fill(f.kpiPrev24, { n: n(heroPrev), pct: changeTxt(heroN, heroPrev) })
                  : fill(f.kpiPrevWin, { days: win === "28" ? 28 : 7, n: n(heroPrev), pct: changeTxt(heroN, heroPrev) })
                : null}
              {topProv ? (
                <>
                  <br />
                  {fill(f.mapTitle, { prov: provLabel(topProv.i), n: n(topProv.n), m: n(fig.tot.n) })}
                </>
              ) : null}
            </p>
            <div className="flx-hero-cta">
              <button type="button" className="btn-primary flx-big" onClick={() => go("map")}>
                {f.mapOpen}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <a className="btn-secondary flx-big flx-glass" href={waLink(digestAlert(data, lang))} target="_blank" rel="noopener noreferrer" title={f.waNote}>
                <WhatsAppLogo /> {f.waDigest}
              </a>
            </div>
          </div>
          <span className="flx-hero-credit">{fill(f.heroAsOf, { time: fmtWhen(data.generated, lang) })}</span>
        </section>
        <header className="fl-page-head nat-head flx-hide">
          <div>
            <h1>{f.title}</h1>
            <p className="fl-note">{fill(f.sub, { days: data.days.length, time: fmtWhen(data.generated, lang) })}</p>
          </div>
          <div className="nat-head-tools">
            <a className="btn-primary small nat-wa" href={waLink(digestAlert(data, lang))} target="_blank" rel="noopener noreferrer" title={f.waNote}>
              <WhatsAppLogo /> {f.waDigest}
            </a>
            {winSeg}
          </div>
        </header>
        {/* the window total is the hero's figure; the strip carries what the hero does not */}
        <section className="fl-kgroup nat-kstrip" aria-label={f.title}>
          <div className="fl-kcells">
            <KCell
              value={h24}
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
            <KCell value={fig.owners.length} label={f.kpiCos} hint={f.kpiCosHint} sub={fill(f.kpiCosSub, { n: n(fig.elOwners) })} />
            <KCell value={pct(fig.inside, fig.tot.n)} label={f.kpiIn} hint={f.kpiInHint} sub={fill(f.kpiInSub, { n: n(fig.inside), m: n(fig.tot.n) })} />
            <KCell value={areaReady ? formatHa(fig.hit.ha, lang) : "…"} label={f.kpiArea} hint={f.kpiAreaHint} sub={areaReady ? fill(f.kpiAreaSub, { n: n(fig.hit.units.size) }) : f.loading28} />
          </div>
        </section>

        <FlxTiles data={data} rows={fig.owners} win={effWin} winName={winName} onPick={(o) => pickOwner(o)} />

        <div className="nat-grid flx-hide">
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

        {/* the trend gets the full width; latest detections and provinces share one panel with a switch (user, 2 Nov 2026) */}
        <Trend data={data} series={fig.series} />
        <section className="chart-card nat-switch">
          <div className="fl-card-head nat-switch-head">
            <div className="seg fl-seg" role="tablist" aria-label={f.panelLabel}>
              {(
                [
                  ["latest", f.latestTitle],
                  ["prov", f.provTitle],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={panel === key} className={panel === key ? "on" : ""} onClick={() => pickPanel(key)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="fl-note">{panel === "latest" ? fill(f.latestNote, { win: winName }) : fill(f.provNote, { win: winName })}</p>
          </div>
          {panel === "latest" ? (
            <Latest data={data} win={effWin} winName={winName} onPick={(o) => pickOwner(o)} bare />
          ) : (
            <>
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
                    {fig.provs.slice(0, allProv ? fig.provs.length : 8).map((r) => (
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
              {fig.provs.length > 8 ? (
                <button type="button" className="btn-text small fl-office-open" onClick={() => setAllProv((v) => !v)}>
                  {allProv ? f.provLess : fill(f.provAll, { n: n(fig.provs.length) })}
                </button>
              ) : null}
            </>
          )}
        </section>

        <span id="nat-companies" />
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
    <section className="chart-card fl-perday">
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
export function DayAxis({ days }: { days: string[] }) {
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
  const srcText = (src: number) =>
    SRC_KEYS.filter(([, b]) => src & b)
      .map(([k]) => f.src[k])
      .join(", ");
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
                </tr>
              </thead>
              <tbody>
                {list.slice(pg * PAGE, (pg + 1) * PAGE).map((r) => (
                  <tr key={r.i} tabIndex={0} onClick={() => onPick(r.i)} onKeyDown={(e) => e.key === "Enter" && onPick(r.i)}>
                    <td>
                      <b>{r.o.name}</b>
                      <small>{[r.o.group, srcText(r.o.src)].filter(Boolean).join(" · ")}</small>
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
                      <AttDot a={attentionOf(r.o)} />
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
        <WhatsAppLogo /> {f.wa}
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

/** "Needs attention" row of the x look: one card per company, a satellite snapshot of its newest hotspots. */
function FlxTiles({ data, rows, win, winName, onPick }: { data: NatData; rows: { o: NatData["owners"][number]; i: number; n: number }[]; win: Win; winName: string; onPick: (o: number) => void }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const top = rows.slice(0, 12);
  // Each company's points of the period: the newest one frames the snapshot, all of them are drawn on it.
  const shots = useMemo(() => {
    const want = new Map(top.map((r) => [r.i, r]));
    const pts = new Map<number, { x: number; y: number; a: number }[]>();
    const p = data.pts;
    const nDays = data.days.length;
    for (let i = 0; i < p.length; i += PT) {
      const u = p[i + 6];
      if (u < 0 || !ptIn(p, i, win, nDays)) continue;
      const o = data.units[u].o;
      if (!want.has(o)) continue;
      const l = pts.get(o) ?? [];
      l.push({ x: p[i] / 1e4, y: p[i + 1] / 1e4, a: p[i + 8] });
      pts.set(o, l);
    }
    const out = new Map<number, { src: string; dots: { left: string; top: string; c: string }[] }>();
    const W = 0.09, H = 0.05;
    for (const [o, l] of pts) {
      const c = l.reduce((b, q) => (q.a < b.a ? q : b));
      const [w, s, e, nn] = [c.x - W, c.y - H, c.x + W, c.y + H];
      const src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${nn.toFixed(4)}&bboxSR=4326&imageSR=4326&size=544,302&format=jpg&f=image`;
      const dots = l
        .filter((q) => q.x > w && q.x < e && q.y > s && q.y < nn)
        .slice(0, 400)
        .map((q) => ({ left: `${((q.x - w) / (e - w)) * 100}%`, top: `${((nn - q.y) / (nn - s)) * 100}%`, c: AGE_DOT[ageClass(q.a)] }));
      out.set(o, { src, dots });
    }
    return out;
  }, [data, win, top.map((r) => r.i).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!top.length) return null;
  return (
    <section className="flx-row-sec" aria-labelledby="flx-att">
      <div className="flx-row-head">
        <h2 id="flx-att">{f.tilesTitle}</h2>
        <span className="flx-row-note">{fill(f.tilesNote, { win: winName })}</span>
        <a className="flx-row-all" href="#nat-companies">
          {f.tilesAll} ›
        </a>
      </div>
      <div className="flx-row">
        {top.map((r) => {
          const shot = shots.get(r.i);
          return (
            <button key={r.i} type="button" className="flx-tile" onClick={() => onPick(r.i)} title={f.showOnMap}>
              <span className="flx-tile-img">
                {shot ? <img src={shot.src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                {shot?.dots.map((d, k) => <i key={k} style={{ left: d.left, top: d.top, background: d.c }} />)}
                <span className="flx-tile-badge">
                  <AttChip a={attentionOf(r.o)} />
                </span>
              </span>
              <span className="flx-tile-body">
                <b>{r.o.name}</b>
                <small>{[r.o.group, r.o.prov >= 0 ? (lang === "en" ? data.prov[r.o.prov].en : data.prov[r.o.prov].id) : ""].filter(Boolean).join(" · ")}</small>
                <span className="flx-tile-n">
                  <strong className="tabular-nums">{n(r.n)}</strong> {f.heroUnit}
                </span>
                {r.o.h24 ? <span className="flx-tile-24">{fill(f.tile24, { n: n(r.o.h24) })}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="fl-note flx-row-credit">{f.tilesCredit}</p>
    </section>
  );
}
const AGE_DOT = ["#e5322d", "#f97316", "#f5b301", "#7c5cd6"];


/** Attention in a table row: a dot and a word, so a long list is not a column of red pills. */
function AttDot({ a }: { a: Attention }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  return (
    <span className={`nat-attd ${a}`} title={f.attHint}>
      <i aria-hidden="true" />
      {f.att[a]}
    </span>
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
function Latest({ data, win, winName, onPick, bare = false }: { data: NatData; win: Win; winName: string; onPick: (o: number) => void; bare?: boolean }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const p = data.pts;
  const rows = useMemo(() => latestPts(data, win, 400).filter((i) => p[i + 6] >= 0 && data.units[p[i + 6]].o >= 0).slice(0, 10), [data, win, p]);
  const fmt = (min: number) =>
    new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.parse(data.generated) - min * 60000));
  if (!rows.length) return bare ? <p className="muted">{f.latestNone}</p> : null;
  const table = (
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
                    <AttDot a={attentionOf(o)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
  if (bare) return table;
  return (
    <section className="chart-card">
      <h2 className="fl-h2">{f.latestTitle}</h2>
      <p className="fl-note">{fill(f.latestNote, { win: winName })}</p>
      {table}
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
