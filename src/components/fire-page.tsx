import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BrandMark, FireWord } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { KpiTile } from "@/components/kpi-tile";
import { FireMap, type Bounds } from "@/components/fire-map";
import { IncidentDetail, StatusChip, distLabel } from "@/components/fire-incident";
import { logout } from "@/lib/auth-actions";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { caseShapes, fromWire, PHONE_MQ, withShapes, type Case } from "@/lib/fire-ui";
import type { Polygon } from "@/lib/fire-geo";
import { ago, COLOR, colorOf, ESTIMATED_GROUPS, fmtDay, fmtWhen, windowFrom, isOpen, isRecent, levelOf, priorityOf, statusOf, wibDay, type FireResponse, type StatusKey } from "@/lib/fire-ui";
import { dayMinus, fireEvents } from "@/lib/fire-events";

type View = "inbox" | "map" | "history" | "events" | "summary";
const VIEWS: View[] = ["inbox", "map", "history", "events", "summary"];

const PAGE = 50;
const STEP = 40;

/** `#map/20261014_PLOT-1` ↔ { view, sel }: the browser Back button closes a detail. */
function readHash(): { view: View; sel: string | null } {
  if (typeof window === "undefined") return { view: "inbox", sel: null };
  const [v, sel] = window.location.hash.replace(/^#/, "").split("/");
  return {
    view: (VIEWS as string[]).includes(v) ? (v as View) : "inbox",
    sel: sel ? decodeURIComponent(sel) : null,
  };
}

export function FirePage({ role, spaceSwitch }: { role: string; spaceSwitch?: React.ReactNode }) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const f = fireCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const [data, setData] = useState<FireResponse | null>(null);
  const fromLabel = data ? windowFrom(data, lang) : "";
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [{ view, sel }, setNav] = useState<{ view: View; sel: string | null }>({
    view: "inbox",
    sel: null,
  });
  const [help, setHelp] = useState(false);
  // inbox
  const [flt, setFlt] = useState<"all" | "24" | "inside" | "unsent">("all");
  const [sort, setSort] = useState<"pri" | "new" | "frp">("pri");
  const [limit, setLimit] = useState(STEP);
  // shared filters
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  // history
  const [hStatus, setHStatus] = useState<"any" | StatusKey>("any");
  const [mill, setMill] = useState("");
  // Date range (WIB days) over the 4-week span; empty = whole span.
  const [hFrom, setHFrom] = useState("");
  const [hTo, setHTo] = useState("");
  const [archive, setArchive] = useState(false);
  // fire events
  const [evMin, setEvMin] = useState<2 | 3>(2);
  const [evLive, setEvLive] = useState(false);
  const [hSort, setHSort] = useState<{ k: "last" | "dist" | "frp"; desc: boolean }>({ k: "last", desc: true });
  const [page, setPage] = useState(0);
  // map
  const [openOnly, setOpenOnly] = useState(true);
  const [weeks, setWeeks] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const canAct = role !== "viewer";

  useEffect(() => {
    setNav(readHash());
    const onPop = () => setNav(readHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: View, id: string | null = null, replace = false) => {
    setNav((cur) => {
      if (cur.view !== next) mainRef.current?.scrollTo({ top: 0 });
      return { view: next, sel: id };
    });
    const hash = `#${next}${id ? `/${encodeURIComponent(id)}` : ""}`;
    if (window.location.hash !== hash) window.history[replace ? "replaceState" : "pushState"](null, "", hash);
  }, []);
  const closeDetail = () => go(view, null, true);

  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (data) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [data, nonce]);
  const load = (refresh: boolean) =>
    fetch("/fire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh }),
    }).then(async (r) => {
      // Session expired (12 h): back to sign-in rather than an error box.
      if (r.status === 401) {
        void navigate({ to: "/login" });
        throw new Error("401");
      }
      if (!r.ok) throw new Error(String(r.status));
      return fromWire(await r.json());
    });
  useEffect(() => {
    let alive = true;
    setError(false);
    load(false)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError(true);
      });
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
      setTimeout(() => setRefreshNote(null), 5000);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  const now = useMemo(() => (data ? Date.parse(data.generated) : Date.now()), [data]);
  const incidents = data?.incidents ?? [];
  // The same companies over the whole 4-week span (History, fire events, map "4 weeks").
  const history = data?.history ?? [];
  const todayWib = useMemo(() => wibDay(data?.generated ?? new Date().toISOString()), [data]);
  const oldestDay = useMemo(() => dayMinus(todayWib, (data?.span ?? 7) - 1), [todayWib, data]);
  const st = useCallback((i: Case) => statusOf(data?.verifications[i.id], i.archived ? undefined : i.last), [data]);
  const color = useCallback((i: Case) => colorOf(st(i), i.last, now), [st, now]);
  const byId = useMemo(() => new Map(incidents.map((i) => [i.id, i])), [incidents]);
  const histById = useMemo(() => new Map(history.map((i) => [i.id, i])), [history]);
  const prio = useMemo(() => new Map(incidents.map((i) => [i.id, priorityOf(i, statusOf(data?.verifications[i.id], i.last), now)])), [incidents, data, now]);
  const groups = useMemo(() => [...new Set(incidents.flatMap((i) => i.groups))].sort(), [incidents]);
  const mills = useMemo(() => [...new Set(incidents.filter((i) => !group || i.groups.includes(group)).flatMap((i) => i.mills))].sort(), [incidents, group]);
  const plotCount = useMemo(() => new Set(incidents.flatMap((i) => i.plots.map((cp) => cp.id))).size, [incidents]);
  const dq = useDeferredValue(q);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const match = useCallback(
    (i: Case) => {
      if (group && !i.groups.includes(group)) return false;
      const needle = dq.trim().toLowerCase();
      if (!needle) return true;
      const hay = `${i.name} ${i.mills.join(" ")} ${i.groups.join(" ")} ${i.aff.map((a) => `${a.id} ${a.plot?.village ?? ""} ${a.plot?.district ?? ""}`).join(" ")}`;
      return hay.toLowerCase().includes(needle);
    },
    [group, dq],
  );
  const openList = useMemo(() => incidents.filter((i) => isOpen(st(i))), [incidents, st]);
  // Only the list on screen is computed.
  const inboxRows = useMemo(() => {
    if (view !== "inbox") return [];
    const rows = openList.filter((i) => match(i) && (flt !== "24" || isRecent(i.last, now)) && (flt !== "inside" || i.d === 0) && (flt !== "unsent" || !data?.dispatch[i.id]));
    if (sort === "frp") return rows.slice().sort((a, b) => b.frp - a.frp);
    if (sort === "pri") return rows.slice().sort((a, b) => (prio.get(b.id) ?? 0) - (prio.get(a.id) ?? 0) || (a.last < b.last ? 1 : -1));
    return rows;
  }, [view, openList, match, flt, sort, now, prio, data]);
  // Reported incidents that fell out of the 4-week window, rebuilt from their snapshot.
  const archived = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.verifications)
      .filter(([id, v]) => v.s && !byId.has(id) && !histById.has(id))
      .filter(([, v]) => !!v.s?.name)
      .map(([id, v]) => ({ ...v.s!, id, events: 0, pts: [], ev: [], sats: [], conf: "n" as const, near: 0, archived: true, plot: { ...v.s!.plot, g: [] }, plots: [], aff: [] }) as Case)
      .sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [data, byId, histById]);
  const archivedById = useMemo(() => new Map(archived.map((a) => [a.id, a])), [archived]);
  const histBase = useMemo(
    () =>
      view !== "history"
        ? []
        : (archive ? [...history, ...archived] : history).filter((i) => match(i) && (!mill || i.mills.includes(mill)) && (hStatus === "any" || st(i) === hStatus)),
    [view, history, archived, archive, match, mill, hStatus, st],
  );
  // A case is in the range when it had hotspots on any day inside it.
  const inRange = useCallback((i: Case, from: string, to: string) => i.days.some((d) => (!from || d.day >= from) && (!to || d.day <= to)), []);
  const presets = useMemo(
    () =>
      (
        [
          [7, dayMinus(todayWib, 6)],
          [14, dayMinus(todayWib, 13)],
          [data?.span ?? 28, ""],
        ] as [number, string][]
      ).map(([days, from]) => ({ days, from, n: histBase.filter((i) => inRange(i, from, "")).length })),
    [histBase, todayWib, data, inRange],
  );
  const histRows = useMemo(() => {
    const rows = hFrom || hTo ? histBase.filter((i) => inRange(i, hFrom, hTo)) : histBase;
    const key = (i: Case) => (hSort.k === "dist" ? i.d : hSort.k === "frp" ? i.frp : Date.parse(i.last));
    return rows.slice().sort((a, b) => (hSort.desc ? key(b) - key(a) : key(a) - key(b)));
  }, [histBase, hFrom, hTo, hSort, inRange]);
  const mapRows = useMemo(
    () => (view !== "map" ? [] : (weeks ? history : incidents).filter((i) => (!openOnly || isOpen(st(i))) && (!group || i.groups.includes(group)))),
    [view, incidents, history, weeks, openOnly, group, st],
  );
  // Fire events: clusters burning on consecutive days, from the 4-week cases.
  const evRows = useMemo(() => {
    if (view !== "events") return [];
    return fireEvents(history.filter(match), evMin, todayWib).filter((e) => !evLive || e.ongoing);
  }, [view, history, match, evMin, todayWib, evLive]);
  const inView = useMemo(() => (bounds ? mapRows.filter((i) => i.lon >= bounds[0] && i.lon <= bounds[2] && i.lat >= bounds[1] && i.lat <= bounds[3]) : mapRows), [mapRows, bounds]);
  const [shapes, setShapes] = useState<Record<string, Record<string, Polygon[]>>>({});
  useEffect(() => {
    if (!sel || !(byId.has(sel) || histById.has(sel)) || shapes[sel]) return;
    let alive = true;
    caseShapes(sel)
      .then((g) => {
        if (alive) setShapes((m) => ({ ...m, [sel]: g }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sel, byId, histById, shapes]);
  // History and fire events open the 4-week case; the operational views the 7-day one.
  const selectedRaw = sel
    ? ((view === "history" || view === "events" || (view === "map" && weeks) ? histById.get(sel) ?? byId.get(sel) : byId.get(sel) ?? histById.get(sel)) ?? archivedById.get(sel) ?? null)
    : null;
  const selected = useMemo(() => (selectedRaw ? withShapes(selectedRaw, shapes[selectedRaw.id]) : null), [selectedRaw, shapes]);

  // Desktop: open the top incident straight away instead of an empty pane.
  useEffect(() => {
    if (view !== "inbox" || sel || !inboxRows.length) return;
    if (window.matchMedia(PHONE_MQ).matches) return;
    go("inbox", inboxRows[0].id, true);
  }, [view, sel, inboxRows, go]);
  // Keep the active card in sight.
  useEffect(() => {
    if (!sel) return;
    document.querySelector(".fl-list-pane .fl-card.on, .fl-mapview-panel .fl-card.on")?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // Keyboard: ↑/↓ or k/j move through the list, Esc closes a detail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || help) return;
      const wideInbox = view === "inbox" && !window.matchMedia(PHONE_MQ).matches;
      if (e.key === "Escape" && sel && !wideInbox) {
        e.preventDefault();
        go(view, null, true);
        return;
      }
      if (view !== "inbox") return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!step || !inboxRows.length) return;
      e.preventDefault();
      const at = sel ? inboxRows.findIndex((i) => i.id === sel) : -1;
      const next = inboxRows[Math.min(inboxRows.length - 1, Math.max(0, at + step))];
      if (inboxRows.indexOf(next) >= limit) setLimit((l) => l + STEP);
      go("inbox", next.id, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, sel, inboxRows, go, help, limit]);
  const detail = (i: Case, opts: { showMap?: boolean; onClose?: () => void } = {}) => (
    <IncidentDetail
      key={i.id}
      incident={i}
      status={data?.verifications[i.id]}
      dispatch={data?.dispatch[i.id]}
      onDispatched={(rec) => setData((d) => (d ? { ...d, dispatch: { ...d.dispatch, [i.id]: rec } } : d))}
      onReported={(e) =>
        setData((d) =>
          d
            ? {
                ...d,
                verifications: {
                  ...d.verifications,
                  [i.id]: {
                    status: e.status,
                    at: e.at,
                    by: e.by,
                    n: (d.verifications[i.id]?.n ?? 0) + 1,
                  },
                },
              }
            : d,
        )
      }
      now={now}
      millOpen={openList.filter((o) => o.id !== i.id && o.plot.mill === i.plot.mill && o.plot.uml === i.plot.uml).sort((a, b) => (prio.get(b.id) ?? 0) - (prio.get(a.id) ?? 0))}
      onDispatchedMany={(recs) => setData((d) => (d ? { ...d, dispatch: { ...d.dispatch, ...recs } } : d))}
      onOpen={(id) => go(view, id)}
      onClose={opts.onClose}
      showMap={opts.showMap ?? true}
      canAct={canAct}
    />
  );

  const card = (i: Case, active: boolean, onClick: () => void) => {
    const s = st(i);
    const lv = levelOf(prio.get(i.id) ?? 0);
    const villages = [...new Set(i.aff.map((a) => a.plot?.village || a.plot?.district).filter(Boolean))];
    return (
      <li key={i.id}>
        <button type="button" className={`fl-card ${active ? "on" : ""}`} aria-current={active || undefined} onClick={onClick}>
          <i className="fl-card-bar" style={{ background: colorOf(s, i.last, now) }} aria-hidden="true" />
          <span className="fl-card-top">
            <b>{i.name}</b>
            <span className="tabular-nums muted">{ago(i.last, now, lang)}</span>
          </span>
          <span className="fl-card-sub">
            {i.mills.slice(0, 2).join(", ") || "—"}
            {i.mills.length > 2 ? ` +${i.mills.length - 2}` : ""} · {villages.slice(0, 2).join(", ") || i.plot.province}
            {villages.length > 2 ? ` +${villages.length - 2}` : ""}
          </span>
          <span className="fl-card-tags">
            {lv !== "low" && isOpen(s) ? <span className={`fl-tag pri ${lv}`}>{lv === "high" ? f.priHigh : f.priMed}</span> : null}
            {s !== "new" ? <StatusChip s={s} /> : null}
            {s === "new" && data?.dispatch[i.id] ? (
              <span className="fl-tag sent">
                {fill(f.sent, {
                  ago: ago(data.dispatch[i.id].at, Date.now(), lang),
                })}
              </span>
            ) : null}
            {i.plots.length > 1 ? <span className="fl-tag">{fill(f.plotsN, { n: n(i.plots.length) })}</span> : null}
            <span className={i.d === 0 ? "fl-tag in" : "fl-tag"}>{distLabel(i.d, lang)}</span>
            <span className="fl-tag">{fill(f.dets, { n: n(i.n) })}</span>
            <span className="fl-tag">{fill(f.frp, { frp: Math.round(i.frp) })}</span>
            {i.days.length > 1 ? <span className="fl-tag rep">{fill(f.daysN, { n: i.days.length })}</span> : null}
          </span>
        </button>
      </li>
    );
  };
  const groupSelect = (
    <select
      className="fl-select"
      value={group}
      onChange={(e) => {
        setGroup(e.target.value);
        setMill("");
        setPage(0);
        setLimit(STEP);
      }}
      aria-label={f.groupAny}
    >
      <option value="">{f.groupAny}</option>
      {groups.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
  const search = (
    <input
      className="fl-search"
      type="search"
      value={q}
      onChange={(e) => {
        setQ(e.target.value);
        setPage(0);
        setLimit(STEP);
      }}
      placeholder={f.search}
      aria-label={f.search}
    />
  );
  const sortBtn = (k: "last" | "dist" | "frp", label: string) => (
    <button
      type="button"
      className={`fl-sort ${hSort.k === k ? "on" : ""}`}
      onClick={() => {
        setHSort((s) => (s.k === k ? { k, desc: !s.desc } : { k, desc: k !== "dist" }));
        setPage(0);
      }}
    >
      {label}
      <span aria-hidden="true">{hSort.k === k ? (hSort.desc ? " ↓" : " ↑") : " ↕"}</span>
    </button>
  );
  const countLabel = (v: number) => (v === 1 ? f.count1 : fill(f.count, { n: n(v) }));
  const navLabel: Record<View, string> = {
    inbox: f.navInbox,
    map: f.navMap,
    history: f.navHistory,
    events: f.navEvents,
    summary: f.navSummary,
  };

  const downloadCsv = () => {
    const head = ["case_id", "name", "kind", "last_detection_utc", "days_with_hotspots", "detections", "events", "max_frp_mw", "nearest_m", "plots", "plot_ids", "mills", "groups", "lat", "lon", "status", "reported_at", "reported_by"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = histRows.map((i) => {
      const v = data?.verifications[i.id];
      return [
        i.id, i.name, i.kind, i.last, i.days.map((d) => d.day).join(" "), i.n, i.events, i.frp, i.d, i.plots.length || (i.archived ? "" : 0),
        i.plots.map((cp) => cp.id).join(" "), i.mills.join("; "), i.groups.join("; "), i.lat, i.lon,
        st(i) === "new" ? "not_checked" : st(i), v?.at ?? "", v?.by ?? "",
      ]
        .map(esc)
        .join(",");
    });
    const blob = new Blob([`﻿${[head.join(","), ...lines].join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fireline-cases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadEventsCsv = () => {
    const head = ["event_id", "case_id", "name", "kind", "start_day_wib", "end_day_wib", "days_in_a_row", "ongoing", "hotspot_points", "peak_frp_mw", "lat", "lon", "nearest_m", "plots", "mills", "groups", "status"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = evRows.map((e) => {
      const c = histById.get(e.caseId);
      const sKey = c ? st(c) : "new";
      return [e.id, e.caseId, e.name, e.kind, e.start, e.end, e.days.length, e.ongoing ? "yes" : "no", e.pts, e.frp, e.lat, e.lon, e.d, e.plots, e.mills.join("; "), e.groups.join("; "), sKey === "new" ? "not_checked" : sKey].map(esc).join(",");
    });
    const blob = new Blob([`\ufeff${[head.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fireline-fire-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const header = (
    <header className="app-header fl-header">
      <span className="app-brand">
        <BrandMark size={22} />
        <span className="word">
          <FireWord />
        </span>
      </span>
      {spaceSwitch}
      <nav className="app-tabs fl-tabs" aria-label={f.product}>
        {VIEWS.map((k) => (
          <button key={k} type="button" className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => go(k)}>
            {navLabel[k]}
            {k === "inbox" && data ? <span className="fl-badge">{n(openList.length)}</span> : null}
          </button>
        ))}
      </nav>
      <div className="app-actions">
        {refreshNote ? (
          <span className="fl-asof fl-asof-note" role="status">
            {refreshNote}
          </span>
        ) : data ? (
          <span className={`fl-asof ${data.refreshFailed ? "warn" : ""}`}>{fill(f.asOf, { time: fmtWhen(data.generated, lang) })}</span>
        ) : null}
        <button type="button" className="btn-secondary small fl-refresh" onClick={() => void refresh()} disabled={refreshing || !data} title={f.refreshHint} aria-label={f.refresh}>
          <span className={refreshing ? "fire-spin" : ""} aria-hidden="true">
            ↻
          </span>
          <span className="fl-refresh-label">{refreshing ? f.refreshing : f.refresh}</span>
        </button>
        <button type="button" className="fl-help-btn" onClick={() => setHelp(true)} aria-label={f.help} title={f.help}>
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
  } else if (!data) {
    body = (
      <div className="fl-loading" aria-busy="true">
        <span className="spinner" aria-hidden="true" /> {f.loading}
        {slow ? <p className="fl-note">{f.loadingSlow}</p> : null}
      </div>
    );
  } else if (view === "inbox") {
    const shown = inboxRows.slice(0, limit);
    body = (
      <div className={`fl-inbox ${selected ? "has-sel" : ""}`}>
        <section className="fl-list-pane" aria-label={f.inboxTitle}>
          <div className="fl-pane-head">
            <h1>
              {f.inboxTitle} <span className="muted tabular-nums">{n(inboxRows.length)}</span>
            </h1>
            <p className="fl-note">{fill(f.inboxSub, { from: fromLabel })}</p>
            <div className="seg fl-seg" role="group" aria-label={f.inboxTitle}>
              {(
                [
                  ["all", f.fltAll],
                  ["24", f.flt24],
                  ["inside", f.fltInside],
                  ["unsent", f.fltUnsent],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={flt === k ? "on" : ""}
                  aria-pressed={flt === k}
                  onClick={() => {
                    setFlt(k);
                    setLimit(STEP);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="fl-tools">
              {groupSelect}
              <select className="fl-select" value={sort} onChange={(e) => setSort(e.target.value as "pri" | "new" | "frp")} aria-label={f.sortPri}>
                <option value="pri">{f.sortPri}</option>
                <option value="new">{f.sortNew}</option>
                <option value="frp">{f.sortFrp}</option>
              </select>
            </div>
            {search}
          </div>
          {inboxRows.length === 0 ? (
            <p className="fl-empty">{openList.length === 0 ? fill(f.inboxEmpty, { from: fromLabel }) : f.noMatch}</p>
          ) : (
            <ul className="fl-cards">{shown.map((i) => card(i, i.id === sel, () => go("inbox", i.id)))}</ul>
          )}
          <p className="fl-keys">{f.keys}</p>
          {inboxRows.length > shown.length ? (
            <button type="button" className="btn-secondary fl-more" onClick={() => setLimit((l) => l + STEP)}>
              {fill(f.showMore, {
                n: n(Math.min(STEP, inboxRows.length - shown.length)),
              })}
            </button>
          ) : null}
        </section>
        <section className="fl-detail-pane">
          {selected ? (
            <>
              <button type="button" className="btn-text fl-back" onClick={closeDetail}>
                {f.back}
              </button>
              {detail(selected)}
            </>
          ) : (
            <div className="fl-pick">
              <p>{f.pickOne}</p>
            </div>
          )}
        </section>
      </div>
    );
  } else if (view === "map") {
    const list = inView
      .slice()
      .sort((a, b) => (prio.get(b.id) ?? 0) - (prio.get(a.id) ?? 0) || (a.last < b.last ? 1 : -1))
      .slice(0, 100);
    body = (
      <div className={`fl-mapview ${selected ? "has-sel" : ""}`}>
        <div className="fl-mapview-map">
          <FireMap mode="overview" incidents={mapRows} colorOf={color} selected={selected} onSelect={(id) => go("map", id)} onView={setBounds} imagery weeks={weeks || data.days > 7} context={history} />
          <div className="fl-map-tools map-card">
            <label className="fl-check">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
              {f.mapOpenOnly}
            </label>
            <label className="fl-check">
              <input type="checkbox" checked={weeks} onChange={(e) => setWeeks(e.target.checked)} />
              {f.mapWeeks}
            </label>
            {groupSelect}
          </div>
        </div>
        <aside className="fl-mapview-panel">
          {selected ? (
            <>
              <button type="button" className="btn-text fl-back always" onClick={closeDetail}>
                {f.back}
              </button>
              {detail(selected, { showMap: false })}
            </>
          ) : (
            <>
              <p className="fl-panel-count">
                <b>{fill(f.mapInView, { n: n(inView.length) })}</b>
              </p>
              {inView.length > list.length ? <p className="fl-note">{f.mapZoom}</p> : null}
              <ul className="fl-cards">{list.map((i) => card(i, false, () => go("map", i.id)))}</ul>
            </>
          )}
        </aside>
      </div>
    );
  } else if (view === "history") {
    const pages = Math.max(1, Math.ceil(histRows.length / PAGE));
    const pageNow = Math.min(page, pages - 1);
    const shown = histRows.slice(pageNow * PAGE, (pageNow + 1) * PAGE);
    body = (
      <div className="page fl-page">
        <header className="fl-page-head">
          <h1>{f.histTitle}</h1>
          <p className="fl-note">{fill(f.histSub, { days: data.span })}</p>
        </header>
        <section className="chart-card fl-hist">
          <div className="fl-tools wrap">
            <select
              className="fl-select"
              value={hStatus}
              onChange={(e) => {
                setHStatus(e.target.value as "any" | StatusKey);
                setPage(0);
              }}
              aria-label={f.statusAny}
            >
              <option value="any">{f.statusAny}</option>
              <option value="new">{f.stNew}</option>
              <option value="active">{f.stActive}</option>
              <option value="extinguished">{f.stOut}</option>
              <option value="false_alarm">{f.stFalse}</option>
            </select>
            {groupSelect}
            <select
              className="fl-select"
              value={mill}
              onChange={(e) => {
                setMill(e.target.value);
                setPage(0);
              }}
              aria-label={f.millAny}
            >
              <option value="">{f.millAny}</option>
              {mills.map((m) => (
                <option key={m} value={m}>
                  {m || "—"}
                </option>
              ))}
            </select>
            {search}
            {archived.length ? (
              <label className="fl-check">
                <input
                  type="checkbox"
                  checked={archive}
                  onChange={(e) => {
                    setArchive(e.target.checked);
                    setPage(0);
                  }}
                />
                {fill(f.archiveToggle, { n: n(archived.length) })}
              </label>
            ) : null}
            <span className="fl-grow" />
            <span className="muted tabular-nums">{countLabel(histRows.length)}</span>
            <button type="button" className="btn-secondary small" onClick={downloadCsv} disabled={!histRows.length}>
              {f.csv}
            </button>
          </div>
          <div className="fl-hist-range">
            <div className="fl-daychips" role="group" aria-label={f.dayAny}>
              {presets.map((pr) => {
                const on = hFrom === pr.from && hTo === "";
                return (
                  <button
                    key={pr.days}
                    type="button"
                    className={on ? "on" : ""}
                    aria-pressed={on}
                    onClick={() => {
                      setHFrom(pr.from);
                      setHTo("");
                      setPage(0);
                    }}
                  >
                    {pr.days === 7 ? f.preset7 : pr.days === 14 ? f.preset14 : f.preset28} <span className="tabular-nums">{n(pr.n)}</span>
                  </button>
                );
              })}
            </div>
            <label className="fl-range">
              {f.histFrom}
              <input
                type="date"
                className="fl-select"
                min={oldestDay}
                max={hTo || todayWib}
                value={hFrom}
                onChange={(e) => {
                  setHFrom(e.target.value);
                  setPage(0);
                }}
                aria-label={f.histFrom}
              />
            </label>
            <label className="fl-range">
              {f.histTo}
              <input
                type="date"
                className="fl-select"
                min={hFrom || oldestDay}
                max={todayWib}
                value={hTo}
                onChange={(e) => {
                  setHTo(e.target.value);
                  setPage(0);
                }}
                aria-label={f.histTo}
              />
            </label>
          </div>
          {histRows.length === 0 ? (
            <p className="fl-empty">{f.noMatch}</p>
          ) : (
            <>
              {phone ? null : (
                <div className="table-scroll">
                  <table className="data-table fl-table">
                    <thead>
                      <tr>
                        <th aria-sort={hSort.k === "last" ? (hSort.desc ? "descending" : "ascending") : undefined}>{sortBtn("last", f.colWhen)}</th>
                        <th>{f.colCompany}</th>
                        <th>{f.colMill}</th>
                        <th>{f.colWhere}</th>
                        <th className="num" aria-sort={hSort.k === "dist" ? (hSort.desc ? "descending" : "ascending") : undefined}>
                          {sortBtn("dist", f.colDist)}
                        </th>
                        <th aria-sort={hSort.k === "frp" ? (hSort.desc ? "descending" : "ascending") : undefined}>{sortBtn("frp", f.colSignal)}</th>
                        <th>{f.colStatus}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((i) => {
                        const v = data.verifications[i.id];
                        return (
                          <tr
                            key={i.id}
                            tabIndex={0}
                            className={i.id === sel ? "on" : ""}
                            onClick={() => go("history", i.id)}
                            onKeyDown={(e) => e.key === "Enter" && go("history", i.id)}
                          >
                            <td>
                              <i className="fl-dot" style={{ background: color(i) }} aria-hidden="true" />
                              <span className="tabular-nums">{fmtWhen(i.last, lang)}</span>
                            </td>
                            <td>
                              <b>{i.name}</b>
                              <small>
                                {i.groups.join(", ")}
                                {i.groups.some((g) => ESTIMATED_GROUPS.has(g)) ? ` · ${f.estimated}` : ""}
                              </small>
                            </td>
                            <td>
                              {i.mills.slice(0, 2).join(", ") || "—"}
                              {i.mills.length > 2 ? <small>{fill(f.moreN, { n: i.mills.length - 2 })}</small> : null}
                            </td>
                            <td>
                              {i.plot.village || "—"}
                              <small>{i.plots.length > 1 ? fill(f.plotsN, { n: n(i.plots.length) }) : [i.plot.district, i.plot.province].filter(Boolean).join(", ")}</small>
                            </td>
                            <td className="num tabular-nums">{i.d === 0 ? f.inside : `${n(i.d)} m`}</td>
                            <td>
                              <span className="tabular-nums">{fill(f.dets, { n: n(i.n) })}</span>
                              <small>
                                {fill(f.frp, { frp: Math.round(i.frp) })}
                                {i.days.length > 1 ? ` · ${fill(f.daysN, { n: i.days.length })}` : ""}
                              </small>
                            </td>
                            <td>
                              <StatusChip s={st(i)} />
                              {v ? (
                                <small>
                                  {fmtWhen(v.at, lang)} · {v.by}
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {phone ? <ul className="fl-cards fl-hist-cards">{shown.map((i) => card(i, i.id === sel, () => go("history", i.id)))}</ul> : null}
              {histRows.length > PAGE ? (
                <div className="table-pager">
                  <span className="tabular-nums">
                    {n(pageNow * PAGE + 1)}–{n(Math.min(histRows.length, (pageNow + 1) * PAGE))} / {n(histRows.length)}
                  </span>
                  <div className="table-pager-nav">
                    <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)} aria-label="‹">
                      ‹
                    </button>
                    <span className="tabular-nums">
                      {pageNow + 1} / {pages}
                    </span>
                    <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)} aria-label="›">
                      ›
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
        {selected ? (
          <Drawer label={selected.plot.mill} onClose={closeDetail}>
            {detail(selected, { onClose: closeDetail })}
          </Drawer>
        ) : null}
      </div>
    );
  } else if (view === "events") {
    body = (
      <div className="page fl-page">
        <header className="fl-page-head">
          <h1>{f.evTitle}</h1>
          <p className="fl-note">{fill(f.evSub, { min: evMin, days: data.span })}</p>
        </header>
        <section className="chart-card fl-hist">
          <div className="fl-tools wrap">
            <div className="seg fl-seg" role="group" aria-label={f.evMin}>
              {([2, 3] as const).map((m) => (
                <button key={m} type="button" className={evMin === m ? "on" : ""} aria-pressed={evMin === m} onClick={() => setEvMin(m)}>
                  {m === 2 ? f.evMin2 : f.evMin3}
                </button>
              ))}
            </div>
            {groupSelect}
            {search}
            <label className="fl-check">
              <input type="checkbox" checked={evLive} onChange={(e) => setEvLive(e.target.checked)} />
              {f.evLive}
            </label>
            <span className="fl-grow" />
            <span className="muted tabular-nums">{evRows.length === 1 ? f.evCount1 : fill(f.evCount, { n: n(evRows.length) })}</span>
            <button type="button" className="btn-secondary small" onClick={downloadEventsCsv} disabled={!evRows.length}>
              {f.csv}
            </button>
          </div>
          {evRows.length === 0 ? (
            <p className="fl-empty">{f.evEmpty}</p>
          ) : phone ? (
            <ul className="fl-cards fl-ev-cards">
              {evRows.map((e) => {
                const c = histById.get(e.caseId);
                return (
                  <li key={e.id}>
                    <button type="button" className={`fl-card ${e.caseId === sel ? "on" : ""}`} onClick={() => go("events", e.caseId)}>
                      <i className="fl-card-bar" style={{ background: e.ongoing ? COLOR.new24 : COLOR.newWeek }} aria-hidden="true" />
                      <span className="fl-card-top">
                        <b>{e.name}</b>
                        <span className={`fl-ev-tag ${e.ongoing ? "live" : ""}`}>{e.ongoing ? f.evOngoing : fill(f.evEnded, { day: fmtDay(e.end, lang) })}</span>
                      </span>
                      <span className="fl-card-sub">
                        {fmtDay(e.start, lang)} – {fmtDay(e.end, lang)} · {e.mills.slice(0, 2).join(", ") || "—"}
                      </span>
                      <span className="fl-card-tags">
                        <span className="fl-tag rep">{fill(f.evDaysRow, { n: e.days.length })}</span>
                        <span className="fl-tag">{fill(f.evColPoints, {})}: {n(e.pts)}</span>
                        <span className="fl-tag">{fill(f.frp, { frp: Math.round(e.frp) })}</span>
                        {c ? <StatusChip s={st(c)} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="table-scroll">
              <table className="data-table fl-table fl-ev-table">
                <thead>
                  <tr>
                    <th>{f.evColPeriod}</th>
                    <th>{f.colCompany}</th>
                    <th>{f.colMill}</th>
                    <th className="num">{f.evColDays}</th>
                    <th className="num">{f.evColPoints}</th>
                    <th className="num">{f.evColPeak}</th>
                    <th>{f.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {evRows.map((e) => {
                    const c = histById.get(e.caseId);
                    return (
                      <tr key={e.id} tabIndex={0} className={e.caseId === sel ? "on" : ""} onClick={() => go("events", e.caseId)} onKeyDown={(k) => k.key === "Enter" && go("events", e.caseId)}>
                        <td>
                          <span className="tabular-nums">
                            {fmtDay(e.start, lang)} – {fmtDay(e.end, lang)}
                          </span>
                          <small>
                            <span className={`fl-ev-tag ${e.ongoing ? "live" : ""}`}>{e.ongoing ? f.evOngoing : fill(f.evEnded, { day: fmtDay(e.end, lang) })}</span>
                          </small>
                        </td>
                        <td>
                          <b>{e.name}</b>
                          <small>
                            {e.groups.join(", ")}
                            {e.groups.some((g) => ESTIMATED_GROUPS.has(g)) ? ` · ${f.estimated}` : ""}
                          </small>
                        </td>
                        <td>
                          {e.mills.slice(0, 2).join(", ") || "—"}
                          {e.mills.length > 2 ? ` ${fill(f.moreN, { n: e.mills.length - 2 })}` : ""}
                          <small>{[e.plot.village, e.plot.district, e.plot.province].filter(Boolean).join(", ") || "—"}</small>
                        </td>
                        <td className="num tabular-nums">{e.days.length}</td>
                        <td className="num tabular-nums">{n(e.pts)}</td>
                        <td className="num tabular-nums">{Math.round(e.frp)} MW</td>
                        <td>{c ? <StatusChip s={st(c)} /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {selected ? (
          <Drawer label={selected.plot.mill} onClose={closeDetail}>
            {detail(selected, { onClose: closeDetail })}
          </Drawer>
        ) : null}
      </div>
    );
  } else {
    body = (
      <Summary
        data={data}
        now={now}
        st={st}
        onGo={go}
        setGroup={setGroup}
        setMill={setMill}
        setHStatus={setHStatus}
        setPage={setPage}
        plotCount={plotCount}
        openCount={openList.length}
      />
    );
  }

  return (
    <div className={`app fire-app fl-app view-${view}`}>
      {header}
      {offline ? (
        <p className="fl-banner warn" role="status">
          {f.offline}
        </p>
      ) : data && (data.refreshFailed || Date.now() - Date.parse(data.generated) > 6 * 3600000) ? (
        <p className="fl-banner" role="status">
          {fill(data.refreshFailed ? f.staleFailed : f.stale, {
            ago: ago(data.generated, Date.now(), lang),
          })}{" "}
          <button type="button" className="linkish" onClick={() => void refresh()} disabled={refreshing}>
            {f.refresh}
          </button>
        </p>
      ) : null}
      <main ref={mainRef} className={`app-main fl-main ${data && (view === "map" || view === "inbox") ? "fill" : ""}`}>
        {body}
      </main>
      <nav className="fl-bottom" aria-label={f.product}>
        {VIEWS.map((k) => (
          <button key={k} type="button" className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => go(k)}>
            <NavIcon v={k} />
            <span>{navLabel[k]}</span>
            {k === "inbox" && data && openList.length ? <span className="fl-badge">{openList.length > 99 ? "99+" : openList.length}</span> : null}
          </button>
        ))}
      </nav>
      {help ? <HelpSheet onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function NavIcon({ v }: { v: View }) {
  const p = {
    inbox: "M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6z",
    map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
    history: "M4 6h16M4 12h16M4 18h10",
    events: "M12 3c.5 3.5 4 5 4 9a4 4 0 0 1-8 0c0-1.6.6-2.8 1.6-3.8.2 1.4.9 2.2 1.7 2.6C11 8.6 10.6 6 12 3z",
    summary: "M5 20V10M12 20V4M19 20v-7",
  }[v];
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}

/** Side sheet: focus moves to its close button once, and returns on close. */
function Drawer({ label, onClose, className = "", children }: { label: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const { lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(".fl-x")?.focus({ preventScroll: true });
    return () => back?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div className="fl-drawer" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="fl-drawer-scrim" aria-label={fireCopy[lang].close} onClick={onClose} tabIndex={-1} />
      <div ref={ref} className={`fl-drawer-panel ${className}`}>
        {children}
      </div>
    </div>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Drawer label={f.methodTitle} onClose={onClose} className="fl-help">
      <header className="fl-detail-head">
        <h2>{f.methodTitle}</h2>
        <button type="button" className="fl-x" aria-label={f.close} onClick={onClose}>
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
    </Drawer>
  );
}

function Summary({
  data,
  now,
  st,
  onGo,
  setGroup,
  setMill,
  setHStatus,
  setPage,
  plotCount,
  openCount,
}: {
  data: FireResponse;
  now: number;
  st: (i: Case) => StatusKey;
  onGo: (v: View, id?: string | null) => void;
  setGroup: (g: string) => void;
  setMill: (m: string) => void;
  setPage: (p: number) => void;
  setHStatus: (s: "any" | StatusKey) => void;
  plotCount: number;
  openCount: number;
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const fromLabel = windowFrom(data, lang);
  const inc = data.incidents;
  const k = useMemo(() => {
    let h24 = 0,
      fresh = 0,
      active = 0;
    for (const i of inc) {
      if (isRecent(i.last, now)) h24++;
      const s = st(i);
      if (s === "new") fresh++;
      if (s === "active") active++;
    }
    return {
      h24,
      fresh,
      active,
      companies: new Set(inc.filter((i) => i.kind === "company").map((i) => i.name.trim().toLowerCase())).size,
      sent: inc.filter((i) => data.dispatch[i.id]).length,
      reported: inc.filter((i) => st(i) !== "new").length,
      mills: new Set(inc.map((i) => `${i.plot.uml}|${i.plot.mill}`)).size,
    };
  }, [inc, now, st, data.dispatch]);
  const [allMills, setAllMills] = useState(false);
  const byMill = useMemo(() => {
    const m = new Map<string, { mill: string; group: string; uml: string; n: number; h24: number; open: number; sent: number; reported: number; active: number }>();
    for (const i of inc) {
      const key = `${i.plot.group}|${i.plot.uml}|${i.plot.mill}`;
      let r = m.get(key);
      if (!r) m.set(key, (r = { mill: i.plot.mill, group: i.plot.group, uml: i.plot.uml, n: 0, h24: 0, open: 0, sent: 0, reported: 0, active: 0 }));
      r.n++;
      if (isRecent(i.last, now)) r.h24++;
      const s = st(i);
      if (s === "new") r.open++;
      else r.reported++;
      if (s === "active") r.active++;
      if (data.dispatch[i.id]) r.sent++;
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.open - a.open);
  }, [inc, now, st, data.dispatch]);
  const millCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["mill", "uml_id", "group", "incidents", "last_24h", "not_checked", "sent_to_field", "reported", "reported_active"];
    const lines = byMill.map((m) => [m.mill, m.uml, m.group, m.n, m.h24, m.open, m.sent, m.reported, m.active].map(esc).join(","));
    const blob = new Blob([`\ufeff${[head.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fireline-mills-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const days = useMemo(() => {
    const m = new Map<string, Record<StatusKey, number>>();
    for (let d = data.days - 1; d >= 0; d--)
      m.set(wibDay(new Date(now - d * 86400000).toISOString()), {
        new: 0,
        active: 0,
        extinguished: 0,
        false_alarm: 0,
      });
    // A company counts on every day it had hotspots, coloured by its current status.
    for (const i of inc)
      for (const d of i.days) {
        const r = m.get(d.day);
        if (r) r[st(i)]++;
      }
    return [...m.entries()];
  }, [inc, now, st, data.days]);
  const max = Math.max(1, ...days.map(([, r]) => r.new + r.active + r.extinguished + r.false_alarm));
  const byGroup = useMemo(() => {
    const m = new Map<
      string,
      {
        g: string;
        n: number;
        h24: number;
        open: number;
        active: number;
        mills: Set<string>;
      }
    >();
    for (const i of inc) {
      let r = m.get(i.plot.group);
      if (!r)
        m.set(
          i.plot.group,
          (r = {
            g: i.plot.group,
            n: 0,
            h24: 0,
            open: 0,
            active: 0,
            mills: new Set(),
          }),
        );
      r.n++;
      if (isRecent(i.last, now)) r.h24++;
      const s = st(i);
      if (s === "new") r.open++;
      if (s === "active") r.active++;
      r.mills.add(i.plot.mill);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [inc, now, st]);
  // Latest alerts: the newest cases first.
  const recent = useMemo(() => inc.slice().sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 10), [inc]);
  const repeat = useMemo(
    () =>
      inc
        .filter((i) => i.days.length > 1)
        .sort((a, b) => b.days.length - a.days.length || (a.last < b.last ? 1 : -1))
        .slice(0, 8),
    [inc],
  );
  const toHistory = (opts: { group?: string; mill?: string; status?: "any" | StatusKey }) => {
    setGroup(opts.group ?? "");
    setMill(opts.mill ?? "");
    setPage(0);
    setHStatus(opts.status ?? "any");
    onGo("history");
  };
  const segColor: Record<StatusKey, string> = {
    new: COLOR.newOld,
    active: COLOR.active,
    extinguished: COLOR.extinguished,
    false_alarm: COLOR.false_alarm,
  };

  return (
    <div className="page fl-page">
      <header className="fl-page-head">
        <h1>{f.sumTitle}</h1>
        <p className="fl-note">{fill(f.sumSub, { days: data.days, from: fromLabel })}</p>
      </header>
      <div className="kpi-row fl-kpis">
        <KpiTile value={n(inc.length)} label={f.kpiInc} hint={f.kpiIncHint} onClick={() => toHistory({})} />
        <KpiTile value={n(k.h24)} label={f.kpi24} hint={f.kpi24Hint} tone={k.h24 ? "danger" : undefined} />
        <KpiTile value={n(k.fresh)} label={f.kpiOpen} hint={f.kpiOpenHint} onClick={openCount ? () => onGo("inbox") : undefined} action={openCount ? f.navInbox : undefined} />
        <KpiTile
          value={n(k.active)}
          label={f.kpiActive}
          hint={f.kpiActiveHint}
          tone={k.active ? "danger" : undefined}
          onClick={k.active ? () => toHistory({ status: "active" }) : undefined}
        />
        <KpiTile value={n(k.companies)} label={f.kpiCompanies} hint={f.kpiCompaniesHint} />
        <KpiTile value={n(k.mills)} label={f.kpiMills} hint={f.kpiMillsHint} />
        <KpiTile value={n(k.sent)} label={f.kpiSent} hint={f.kpiSentHint} />
        <KpiTile value={n(k.reported)} label={f.kpiReported} hint={f.kpiReportedHint} tone={k.reported ? "comply" : undefined} onClick={k.reported ? () => onGo("history") : undefined} />
      </div>

      <section className="chart-card">
        <h2 className="fl-h2">{f.recentTitle}</h2>
        <p className="fl-note">{f.recentNote}</p>
        <div className="table-scroll">
          <table className="data-table fl-table fl-recent">
            <thead>
              <tr>
                <th>{f.colWhen}</th>
                <th>{f.colCompany}</th>
                <th>{f.colMill}</th>
                <th>{f.colConfidence}</th>
                <th>{f.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((i) => {
                const s = st(i);
                return (
                  <tr key={i.id} tabIndex={0} onClick={() => onGo("history", i.id)} onKeyDown={(e) => e.key === "Enter" && onGo("history", i.id)}>
                    <td>
                      <i className="fl-dot" style={{ background: colorOf(s, i.last, now) }} aria-hidden="true" />
                      <span className="tabular-nums">{fmtWhen(i.last, lang)}</span>
                    </td>
                    <td>
                      <b>{i.name}</b>
                      <small>{i.groups.join(", ")}</small>
                    </td>
                    <td>
                      {i.mills.slice(0, 2).join(", ") || "—"}
                      <small>{[i.plot.village, i.plot.district].filter(Boolean).join(", ")}</small>
                    </td>
                    <td>{f.confLabels[{ l: 0, n: 1, h: 2 }[i.conf]]}</td>
                    <td>{s === "new" && data.dispatch[i.id] ? <span className="fl-tag sent">{f.stSent}</span> : <StatusChip s={s} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="fl-grid2">
        <section className="chart-card">
          <h2 className="fl-h2">{f.perDay}</h2>
          <div className="fl-days" role="img" aria-label={f.perDay}>
            {days.map(([d, r], k) => {
              const tot = r.new + r.active + r.extinguished + r.false_alarm;
              return (
                <div key={d} className="fl-day">
                  <span className="fl-day-n tabular-nums">{n(tot)}</span>
                  <span className="fl-day-bar" style={{ height: `${Math.max(2, (tot / max) * 100)}%` }}>
                    {(["false_alarm", "extinguished", "active", "new"] as const).map((s) =>
                      r[s] ? <i key={s} style={{ flexGrow: r[s], background: segColor[s] }} title={`${r[s]}`} /> : null,
                    )}
                  </span>
                  <span className="fl-day-d">{days.length <= 10 || (days.length - 1 - k) % 2 === 0 ? fmtDay(d, lang) : " "}</span>
                </div>
              );
            })}
          </div>
          <p className="fl-legend-inline">
            {(["new", "active", "extinguished", "false_alarm"] as const).map((s) => (
              <span key={s}>
                <i style={{ background: segColor[s] }} aria-hidden="true" />
                {
                  {
                    new: f.stNew,
                    active: f.stActive,
                    extinguished: f.stOut,
                    false_alarm: f.stFalse,
                  }[s]
                }
              </span>
            ))}
          </p>
          <p className="fl-note">{f.perDayNote}</p>
        </section>
        <section className="chart-card">
          <h2 className="fl-h2">{f.repeatCos}</h2>
          <p className="fl-note">{f.repeatNote}</p>
          {repeat.length === 0 ? (
            <p className="muted">{f.repeatNone}</p>
          ) : (
            <ul className="fl-rank">
              {repeat.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onGo("history", c.id)}>
                    <span>
                      <b>{c.name}</b>
                      <small>
                        {c.mills.slice(0, 2).join(", ")} · {fill(f.plotsN, { n: n(c.plots.length) })}
                      </small>
                    </span>
                    <span className="fl-rank-n tabular-nums">{fill(f.daysN, { n: c.days.length })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="chart-card">
        <h2 className="fl-h2">{f.byGroup}</h2>
        <div className="table-scroll">
          <table className="data-table fl-group-table">
            <thead>
              <tr>
                <th>{f.colGroup}</th>
                <th className="num">{f.colInc}</th>
                <th className="num">{f.col24}</th>
                <th className="num">{f.colOpen}</th>
                <th className="num">{f.colActive}</th>
                <th className="num">{f.colMills}</th>
              </tr>
            </thead>
            <tbody>
              {byGroup.map((r) => (
                <tr key={r.g} tabIndex={0} onClick={() => toHistory({ group: r.g })} onKeyDown={(e) => e.key === "Enter" && toHistory({ group: r.g })}>
                  <td>
                    <b>{r.g}</b>
                    {ESTIMATED_GROUPS.has(r.g) ? <small>{f.estimated}</small> : null}
                  </td>
                  <td className="num tabular-nums">{n(r.n)}</td>
                  <td className="num tabular-nums">{r.h24 ? <span className="fl-hot">{n(r.h24)}</span> : "0"}</td>
                  <td className="num tabular-nums">{n(r.open)}</td>
                  <td className="num tabular-nums">{r.active ? <span className="fl-hot">{n(r.active)}</span> : "0"}</td>
                  <td className="num tabular-nums">{n(r.mills.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="chart-card">
        <div className="fl-card-head">
          <h2 className="fl-h2">{f.byMill}</h2>
          <button type="button" className="btn-secondary small" onClick={millCsv}>
            {f.csv}
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table fl-group-table">
            <thead>
              <tr>
                <th>{f.colMill}</th>
                <th className="num">{f.colInc}</th>
                <th className="num">{f.col24}</th>
                <th className="num">{f.colOpen}</th>
                <th className="num">{f.colSent}</th>
                <th className="num">{f.colReported}</th>
                <th className="num">{f.colActive}</th>
              </tr>
            </thead>
            <tbody>
              {(allMills ? byMill : byMill.slice(0, 12)).map((m) => (
                <tr key={`${m.group}|${m.mill}`} tabIndex={0} onClick={() => toHistory({ group: m.group, mill: m.mill })} onKeyDown={(e) => e.key === "Enter" && toHistory({ group: m.group, mill: m.mill })}>
                  <td>
                    <b>{m.mill || "—"}</b>
                    <small>{m.group}</small>
                  </td>
                  <td className="num tabular-nums">{n(m.n)}</td>
                  <td className="num tabular-nums">{m.h24 ? <span className="fl-hot">{n(m.h24)}</span> : "0"}</td>
                  <td className="num tabular-nums">{n(m.open)}</td>
                  <td className="num tabular-nums">{n(m.sent)}</td>
                  <td className="num tabular-nums">{n(m.reported)}</td>
                  <td className="num tabular-nums">{m.active ? <span className="fl-hot">{n(m.active)}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {byMill.length > 12 ? (
          <button type="button" className="btn-text small fl-office-open" onClick={() => setAllMills((v) => !v)}>
            {allMills ? f.showLess : fill(f.showAllMills, { n: n(byMill.length) })}
          </button>
        ) : null}
      </section>
    </div>
  );
}
