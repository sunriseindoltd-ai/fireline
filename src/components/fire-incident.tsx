import { useEffect, useMemo, useState } from "react";
import { FireMap } from "@/components/fire-map";
import { SalesCard } from "@/components/fire-sales";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { millPoint } from "@/lib/mill-points";
import { bearingDeg, compass8, distanceM, formatDistance, gmapsRoute, wazeRoute } from "@/lib/fire-route";
import { ago, colorOf, ESTIMATED_GROUPS, fmtDate, fmtDay, fmtTime, fmtWhen, reopened, statusOf, verifyLinkFor, type Case, type StatusKey } from "@/lib/fire-ui";
import type { DispatchIndex, FireVerification, VerificationIndex } from "@/lib/fire.server";
import type { Polygon } from "@/lib/fire-geo";

/** The last position the browser gave us, reused across incidents for 10 minutes. */
let lastPos: { lat: number; lon: number; acc: number; at: number } | null = null;

/** Hotspot dots by day: latest day first (red), then orange, then yellow. Same as the map. */
export const DAY_COLORS = ["#ff3b1f", "#ff9f1c", "#ffd166"];

/** FIRMS satellite codes → names. */
const SATS: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21" };

export function StatusChip({ s }: { s: StatusKey }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const label = { new: f.stNew, active: f.stActive, extinguished: f.stOut, false_alarm: f.stFalse }[s];
  return <span className={`chip fl-st ${s}`}>{label}</span>;
}

export function distLabel(d: number, lang: "en" | "id") {
  const f = fireCopy[lang];
  return d === 0 ? f.inside : fill(f.metres, { d: formatCount(d, lang) });
}

/** Area in ha from the geometry (outer minus holes), for plots without a Hectarage attribute. */
function areaHa(polys: Polygon[]) {
  const ring = (r: [number, number][]) => {
    const kx = 111320 * Math.cos((r[0][1] * Math.PI) / 180), ky = 110574;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * kx * (r[i][1] * ky) - r[i][0] * kx * (r[j][1] * ky);
    return Math.abs(a / 2);
  };
  return Math.round(polys.reduce((t, p) => t + ring(p[0]) - p.slice(1).reduce((h, r) => h + ring(r), 0), 0) / 100) / 100;
}

/** Villages of a case's plots, most affected first. */
export function villagesOf(i: Case) {
  return [...new Set(i.aff.map((a) => a.plot?.village || a.plot?.district).filter(Boolean))] as string[];
}

/** The WhatsApp alert text for a case. */
export function waMessage(i: Case, link: string, lang: "en" | "id") {
  const f = fireCopy[lang];
  const vs = villagesOf(i);
  return fill(f.waText, {
    date: fmtDate(i.last, lang),
    time: fmtTime(i.last, lang),
    mill: i.mills.join(", ") || "—",
    company: i.name,
    plots: fill(f.plotsN, { n: i.plots.length }),
    villages: vs.slice(0, 3).join(", ") + (vs.length > 3 ? ` ${fill(f.moreN, { n: vs.length - 3 })}` : ""),
    days: fill(f.daysN, { n: i.days.length }),
    lat: i.lat,
    lon: i.lon,
    dist: distLabel(i.d, lang),
    n: i.n,
    gmaps: gmapsRoute(i.lat, i.lon),
    waze: wazeRoute(i.lat, i.lon),
    link,
  });
}

/** One WhatsApp message for several incidents at one mill. */
export function waMillMessage(mill: string, list: Case[], links: string[], lang: "en" | "id") {
  const f = fireCopy[lang];
  const head = fill(f.waMillHead, { mill: mill || "—", n: list.length, date: fmtDate(list[0].last, lang) });
  const items = list.map((x, k) =>
    fill(f.waMillItem, {
      k: k + 1,
      company: x.name,
      plots: fill(f.plotsN, { n: x.plots.length }),
      village: villagesOf(x).slice(0, 2).join(", ") || "—",
      time: fmtTime(x.last, lang),
      lat: x.lat,
      lon: x.lon,
      dist: distLabel(x.d, lang),
      gmaps: gmapsRoute(x.lat, x.lon),
      link: links[k],
    }),
  );
  return [head, ...items].join("\n\n");
}

export function IncidentDetail({
  incident: i,
  status,
  dispatch,
  onDispatched,
  onReported,
  now,
  millOpen,
  onDispatchedMany,
  onOpen,
  onClose,
  showMap = true,
  canAct = true,
}: {
  incident: Case;
  status?: VerificationIndex[string];
  dispatch?: DispatchIndex[string];
  onDispatched: (rec: DispatchIndex[string]) => void;
  onReported: (entry: FireVerification) => void;
  now: number;
  /** Other open cases at the same mill, highest priority first. */
  millOpen: Case[];
  onDispatchedMany: (recs: DispatchIndex) => void;
  onOpen: (id: string) => void;
  onClose?: () => void;
  showMap?: boolean;
  canAct?: boolean;
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const s = statusOf(status, i.archived ? undefined : i.last);
  const archived = !!i.archived;
  const again = !archived && reopened(status, i.last);
  const [allPlots, setAllPlots] = useState(false);
  const plotRows = allPlots ? i.aff : i.aff.slice(0, 8);
  const ha = (v: number) => v.toLocaleString(lang === "id" ? "id-ID" : "en-GB", { maximumFractionDigits: 2 });
  const [entries, setEntries] = useState<FireVerification[] | null>(null);
  const [verifyUrl, setVerifyUrl] = useState("");
  useEffect(() => {
    setVerifyUrl("");
    if (!canAct) return;
    let alive = true;
    verifyLinkFor(i.id)
      .then((u) => {
        if (alive) setVerifyUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [i.id, canAct]);
  const [copied, setCopied] = useState<"link" | "xy" | null>(null);
  const [pos, setPos] = useState(lastPos && Date.now() - lastPos.at < 600000 ? lastPos : null);
  const [posState, setPosState] = useState<"idle" | "busy" | "fail">("idle");
  const mp = millPoint(i.plot.uml, i.plot.mill);
  const mill = useMemo(() => (mp ? { lat: mp[0], lon: mp[1], name: i.plot.mill } : null), [mp?.[0], mp?.[1], i.plot.mill]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = { lat: i.lat, lon: i.lon };

  useEffect(() => {
    setEntries(null);
    if (!status) return;
    let alive = true;
    fetch(`/fire/reports?e=${encodeURIComponent(i.id)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v: FireVerification[]) => {
        if (alive) setEntries(v);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [i.id, status?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const [office, setOffice] = useState<null | { status: "" | FireVerification["status"]; by: string; note: string; busy: boolean; fail: boolean }>(null);
  const logDispatch = (ch: "whatsapp" | "link") => {
    fetch("/fire/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ e: i.id, ch }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((recs: DispatchIndex | null) => {
        const rec = recs?.[i.id];
        if (rec) onDispatched(rec);
      })
      .catch(() => {});
  };
  const [bulk, setBulk] = useState<"idle" | "busy" | "fail">("idle");
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setViewer(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [viewer]);
  const MAX_BULK = 15;
  const sendMill = async () => {
    // Open the tab now (a tab opened after an await is blocked as a pop-up).
    const w = window.open("", "_blank");
    setBulk("busy");
    try {
      const list = [i, ...millOpen].slice(0, MAX_BULK);
      const links = await Promise.all(list.map((x) => verifyLinkFor(x.id)));
      const text = waMillMessage(i.plot.mill, list, links, lang);
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      if (w) w.location.href = url;
      else window.location.href = url;
      const ids = list.map((x) => x.id);
      const r = await fetch("/fire/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, ch: "whatsapp" }) });
      const recs = r.ok ? ((await r.json()) as DispatchIndex) : null;
      if (recs) onDispatchedMany(recs);
      setBulk("idle");
    } catch {
      w?.close();
      setBulk("fail");
    }
  };
  const saveOffice = async () => {
    if (!office?.status) return;
    setOffice({ ...office, busy: true, fail: false });
    try {
      const r = await fetch("/fire/office-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e: i.id, status: office.status, by: office.by, note: office.note }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const { entry } = (await r.json()) as { entry: FireVerification };
      setOffice(null);
      onReported(entry);
    } catch {
      setOffice((o) => (o ? { ...o, busy: false, fail: true } : o));
    }
  };
  const copy = async (what: "link" | "xy", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const locate = () => {
    if (!("geolocation" in navigator)) return setPosState("fail");
    setPosState("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        lastPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
        setPos(lastPos);
        setPosState("idle");
      },
      () => setPosState("fail"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };
  const line = (from: { lat: number; lon: number }) => {
    const deg = bearingDeg(from, target);
    return fill(f.distLine, { km: formatDistance(distanceM(from, target), lang), dir: f.dirs[compass8(deg)], deg });
  };
  const confLabel = { l: f.confL, n: f.confN, h: f.confH }[i.conf];
  const xy = `${i.lat}, ${i.lon}`;
  const copernicus = `https://browser.dataspace.copernicus.eu/?zoom=14&lat=${i.lat}&lng=${i.lon}&fromTime=${i.day}T00%3A00%3A00.000Z&toTime=${new Date().toISOString().slice(0, 10)}T23%3A59%3A59.999Z&datasetId=S2_L2A_CDAS`;

  return (
    <article className="fl-detail" aria-label={i.name}>
      <p className="fl-print-only fl-print-head">
        {f.product} · {f.printTitle} · <span className="mono">{i.id}</span> · {fill(f.printedAt, { time: fmtWhen(new Date().toISOString(), lang) })}
      </p>
      <header className="fl-detail-head">
        <div>
          <p className="fl-detail-meta">
            <StatusChip s={s} />
            <span className="tabular-nums">{ago(i.last, now, lang)}</span>
          </p>
          <h2>{i.name}</h2>
          <p className="muted">
            {f.dMills}: {i.mills.join(", ") || "—"} · {i.groups.join(", ")}
            {i.groups.some((g) => ESTIMATED_GROUPS.has(g)) ? ` · ${f.estimated}` : ""}
          </p>
        </div>
        <div className="fl-head-actions">
          <button type="button" className="btn-secondary small fl-print-btn" onClick={() => window.print()} title={f.printHint}>
            {f.print}
          </button>
          {onClose ? (
            <button type="button" className="fl-x" aria-label={f.close} onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      </header>

      <div className="fl-detail-grid">
        <div className="fl-detail-main">
          {archived ? <p className="fl-archived">{fill(f.archivedNote, { days: 28 })}</p> : null}
          {again && status ? (
            <p className="fl-archived">
              {fill(f.reopenedNote, { status: { active: f.stActive, extinguished: f.stOut, false_alarm: f.stFalse }[status.status], ago: ago(status.at, now, lang) })}
            </p>
          ) : null}
          {i.kind === "area" ? <p className="fl-note">{f.areaNote}</p> : null}
          {showMap && !archived ? (
            <div className="fl-detail-map">
              <FireMap mode="focus" incidents={[i]} selected={i} colorOf={() => colorOf(s, i.last, now)} imagery mill={mill} />
            </div>
          ) : null}
          <ul className="fl-facts-chips">
            {i.plots.length ? <li>{fill(f.plotsN, { n: n(i.plots.length) })}</li> : null}
            <li>{distLabel(i.d, lang)}</li>
            <li>{fill(f.dets, { n: n(i.n) })}</li>
            <li>{fill(f.frp, { frp: i.frp.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) })}</li>
          </ul>
          <div className="fl-quick">
            {canAct ? (
              <a className={`btn-primary fl-wa ${verifyUrl ? "" : "is-wait"}`} href={`https://wa.me/?text=${encodeURIComponent(waMessage(i, verifyUrl, lang))}`} target="_blank" rel="noopener noreferrer" onClick={() => logDispatch("whatsapp")}>
                WhatsApp
              </a>
            ) : null}
            <a className="btn-secondary" href={gmapsRoute(i.lat, i.lon)} target="_blank" rel="noopener noreferrer">
              {f.gmaps}
            </a>
            <a className="btn-secondary" href={wazeRoute(i.lat, i.lon)} target="_blank" rel="noopener noreferrer">
              {f.waze}
            </a>
          </div>
          <dl className="fl-facts">
            <dt>{f.dDist}</dt>
            <dd>
              {distLabel(i.d, lang)}
              {i.near > 1 ? ` · ${fill(f.dNear, { n: i.near })}` : ""}
            </dd>
            <dt>{f.dWhen}</dt>
            <dd className="tabular-nums">{fill(f.dWhenVal, { first: fmtWhen(i.first, lang), last: fmtWhen(i.last, lang) })}</dd>
            <dt>{f.dSignal}</dt>
            <dd>
              {fill(f.dSignalVal, { n: n(i.n), e: n(i.events), d: i.days.length, frp: i.frp.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }), conf: confLabel })}
            </dd>
            {i.sats.length ? (
              <>
                <dt>{f.dSats}</dt>
                <dd>{i.sats.map((x) => SATS[x] ?? x).join(", ")}</dd>
              </>
            ) : null}
            {i.days.length ? (
              <>
                <dt>{f.perDayHs}</dt>
                <dd className="fl-other-days">
                  {i.days.map((d, k) => (
                    <span key={d.day} className="fl-daypill">
                      <i className="fl-dot" style={{ background: DAY_COLORS[Math.min(DAY_COLORS.length - 1, i.days.length - 1 - k)] }} aria-hidden="true" />
                      {fmtDay(d.day, lang)} · {n(d.n)}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
          {i.aff.length ? (
            <section className="fl-box fl-plots">
              <h3>{fill(f.affTitle, { n: n(i.aff.length) })}</h3>
              <div className="table-scroll">
                <table className="data-table fl-plot-table">
                  <thead>
                    <tr>
                      <th>{f.dPlot}</th>
                      <th>{f.colWhere}</th>
                      <th className="num">ha</th>
                      <th className="num">{f.colDist}</th>
                      <th className="num">{f.colDets}</th>
                      <th>{f.colWhen}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plotRows.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span className="mono">{a.id}</span>
                          <small>{a.plot?.type}</small>
                        </td>
                        <td>
                          {a.plot?.village || "—"}
                          <small>{a.plot?.district}</small>
                        </td>
                        <td className="num tabular-nums">{a.plot?.ha ? ha(a.plot.ha) : a.plot?.g?.length ? ha(areaHa(a.plot.g)) : "—"}</td>
                        <td className="num tabular-nums">{a.d === 0 ? f.inside : `${n(a.d)} m`}</td>
                        <td className="num tabular-nums">{n(a.n)}</td>
                        <td className="tabular-nums">{fmtWhen(a.last, lang)}</td>
                        <td>
                          {a.plot?.g?.[0]?.[0]?.[0] ? (
                            <a className="btn-text small" href={gmapsRoute(a.plot.g[0][0][0][1], a.plot.g[0][0][0][0])} target="_blank" rel="noopener noreferrer">
                              {f.plotRoute} ↗
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {i.aff.length > 8 ? (
                <button type="button" className="btn-text small fl-office-open" onClick={() => setAllPlots((v) => !v)}>
                  {allPlots ? f.showLess : fill(f.showAllPlots, { n: n(i.aff.length) })}
                </button>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="fl-detail-side">
          {canAct && !archived ? (
            <section className="fl-box fl-dispatch">
              <h3>{f.dispatchTitle}</h3>
              <p className="fl-note">{f.dispatchNote}</p>
              {dispatch ? (
                <p className="fl-sent">
                  {fill(f.sentLine, {
                    when: fmtWhen(dispatch.at, lang),
                    by: dispatch.by,
                    ch: dispatch.ch === "link" ? f.chLink : f.chWa,
                    times: dispatch.n > 1 ? fill(f.sentTimes, { n: dispatch.n }) : "",
                  })}
                </p>
              ) : null}
              <a className={`btn-primary block fl-wa ${verifyUrl ? "" : "is-wait"}`} href={`https://wa.me/?text=${encodeURIComponent(waMessage(i, verifyUrl, lang))}`} target="_blank" rel="noopener noreferrer" onClick={() => logDispatch("whatsapp")}>
                {f.whatsapp}
              </a>
              <div className="fl-row">
                <button type="button" className="btn-secondary small" onClick={() => {
                    void copy("link", verifyUrl);
                    logDispatch("link");
                  }}
                  disabled={!verifyUrl}
                >
                  {copied === "link" ? f.copied : f.copyLink}
                </button>
                <a className="btn-text small" href={verifyUrl} target="_blank" rel="noopener noreferrer">
                  {f.openVerify} ↗
                </a>
              </div>
            </section>
          ) : null}

          <section className="fl-box">
            <h3>{f.routeTitle}</h3>
            <div className="fl-xy">
              <span className="muted">{f.coords}</span>
              <span className="mono tabular-nums">{xy}</span>
              <button type="button" className="btn-text small" onClick={() => void copy("xy", xy)}>
                {copied === "xy" ? f.copied : f.copyCoords}
              </button>
            </div>
            <div className="fl-route-btns">
              <a className="btn-secondary" href={gmapsRoute(i.lat, i.lon)} target="_blank" rel="noopener noreferrer">
                {f.gmaps} ↗
              </a>
              <a className="btn-secondary" href={wazeRoute(i.lat, i.lon)} target="_blank" rel="noopener noreferrer">
                {f.waze} ↗
              </a>
            </div>
            <dl className="fl-route">
              <dt>{f.fromMe}</dt>
              <dd>
                {pos ? (
                  <>
                    <span className="tabular-nums">{line(pos)}</span>
                    <a className="btn-text small" href={gmapsRoute(i.lat, i.lon, pos)} target="_blank" rel="noopener noreferrer">
                      {f.gmaps} ↗
                    </a>
                  </>
                ) : posState === "busy" ? (
                  <span className="muted">{f.locating}</span>
                ) : (
                  <>
                    <button type="button" className="btn-text small fl-locate" onClick={locate}>
                      {f.locate}
                    </button>
                    {posState === "fail" ? <small className="muted">{f.locFail}</small> : null}
                  </>
                )}
              </dd>
              <dt>
                {f.fromMill} {i.plot.mill ? <b>{i.plot.mill}</b> : null}
              </dt>
              <dd>
                {mill ? (
                  <>
                    <span className="tabular-nums">{line(mill)}</span>
                    <a className="btn-text small" href={gmapsRoute(i.lat, i.lon, mill)} target="_blank" rel="noopener noreferrer">
                      {f.millRoute} ↗
                    </a>
                  </>
                ) : (
                  <span className="muted">{f.noMill}</span>
                )}
              </dd>
            </dl>
            <p className="fl-note">{f.routeNote}</p>
            <p className="fl-print-only mono">{gmapsRoute(i.lat, i.lon)}</p>
          </section>
          {canAct ? <SalesCard name={i.name} /> : null}
          {canAct && !archived && millOpen.length ? (
            <section className="fl-box fl-mill">
              <h3>{fill(millOpen.length === 1 ? f.millOther1 : f.millOther, { n: millOpen.length })}</h3>
              <ul className="fl-mill-list">
                {millOpen.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => onOpen(o.id)}>
                      <span>{o.name}</span>
                      <small>
                        {fill(f.plotsN, { n: o.plots.length })} · {distLabel(o.d, lang)} · {ago(o.last, now, lang)}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {millOpen.length > 5 ? <p className="fl-note">{fill(f.millMore, { n: millOpen.length - 5 })}</p> : null}
              <button type="button" className="btn-secondary fl-mill-send" onClick={() => void sendMill()} disabled={bulk === "busy"}>
                {bulk === "busy" ? f.millSending : fill(f.millSend, { n: Math.min(MAX_BULK, millOpen.length + 1) })}
              </button>
              {millOpen.length + 1 > MAX_BULK ? <p className="fl-note">{fill(f.millCap, { n: MAX_BULK })}</p> : null}
              {bulk === "fail" ? <p className="fl-err">{f.officeFail}</p> : null}
            </section>
          ) : null}

          <section className="fl-box">
            <h3>{f.reportsTitle}</h3>
            {!status ? (
              <p className="muted">{f.noReports}</p>
            ) : entries == null ? (
              <p className="muted">…</p>
            ) : (
              <ul className="fl-reports">
                {entries
                  .slice()
                  .reverse()
                  .map((r) => (
                    <li key={r.at}>
                      <span className="fl-row">
                        <StatusChip s={r.status} />
                        {r.office ? <span className="fl-tag">{f.officeTag}</span> : null}
                      </span>
                      <span className="tabular-nums muted">
                        {fmtWhen(r.at, lang)} · {r.by}
                      </span>
                      {r.note ? <p>{r.note}</p> : null}
                      {(r.photos ?? (r.photo ? [r.photo] : [])).length ? (
                        <div className="fl-photos">
                          {(r.photos ?? [r.photo!]).map((ph, k) => (
                            <button key={ph} type="button" onClick={() => setViewer(`/fire/photo?f=${encodeURIComponent(ph)}`)} aria-label={fill(f.photoOpen, { n: k + 1 })}>
                              <img src={`/fire/photo?f=${encodeURIComponent(ph)}`} alt={`${f.photo} ${k + 1}`} loading="lazy" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {r.lat != null && r.lon != null ? (
                        <small className="tabular-nums">
                          {r.lat.toFixed(5)}, {r.lon.toFixed(5)} · {formatDistance(distanceM({ lat: r.lat, lon: r.lon }, target), lang)}
                        </small>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
            {!canAct ? null : office ? (
              <form
                className="fl-office"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveOffice();
                }}
              >
                <b>{f.officeTitle}</b>
                <div className="fl-office-st" role="radiogroup" aria-label={f.officeTitle}>
                  {(["active", "extinguished", "false_alarm"] as const).map((k) => (
                    <label key={k} className={office.status === k ? "on" : ""}>
                      <input type="radio" name={`st-${i.id}`} value={k} checked={office.status === k} onChange={() => setOffice({ ...office, status: k })} />
                      {{ active: f.stActive, extinguished: f.stOut, false_alarm: f.stFalse }[k]}
                    </label>
                  ))}
                </div>
                <input className="fl-search" value={office.by} onChange={(e) => setOffice({ ...office, by: e.target.value })} placeholder={f.officeBy} aria-label={f.officeBy} maxLength={60} />
                <textarea className="fl-search fl-textarea" value={office.note} onChange={(e) => setOffice({ ...office, note: e.target.value })} placeholder={f.officeNote} aria-label={f.officeNote} rows={2} maxLength={600} />
                {office.fail ? <p className="fl-err">{f.officeFail}</p> : null}
                <div className="fl-row">
                  <button type="submit" className="btn-primary small" disabled={!office.status || office.busy}>
                    {office.busy ? f.officeSaving : f.officeSave}
                  </button>
                  <button type="button" className="btn-text small" onClick={() => setOffice(null)}>
                    {f.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn-text small fl-office-open" onClick={() => setOffice({ status: "", by: "", note: "", busy: false, fail: false })}>
                + {f.officeOpen}
              </button>
            )}
          </section>
          <p className="fl-ext">
            <a href={copernicus} target="_blank" rel="noopener noreferrer">
              {f.copernicus} ↗
            </a>
          </p>
        </aside>
      </div>
      {viewer ? (
        <div className="fl-viewer" role="dialog" aria-modal="true" aria-label={f.photo} onClick={() => setViewer(null)}>
          <img src={viewer} alt={f.photo} />
          <button type="button" className="fl-x" aria-label={f.close} onClick={() => setViewer(null)} autoFocus>
            ×
          </button>
        </div>
      ) : null}
    </article>
  );
}
