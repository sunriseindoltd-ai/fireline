import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { getFireVerifyContext } from "@/lib/fire-actions";
import { useI18n } from "@/lib/i18n";
import { fill } from "@/lib/format";
import { fireCopy } from "@/lib/fire-copy";
import type { Case } from "@/lib/fire-ui";
import { bearingDeg, compass8, distanceM, formatDistance, gmapsRoute, wazeRoute } from "@/lib/fire-route";

type Search = { e: string; x: string; s: string };

const MAX_PHOTOS = 3;
const FireMap = lazy(() => import("@/components/fire-map").then((m) => ({ default: m.FireMap })));

/**
 * FireLine field verification — opened from the WhatsApp alert on a phone,
 * no login: the link carries a signed token valid for 7 days.
 */
export const Route = createFileRoute("/fire/verify")({
  // The router JSON-parses search values, so a numeric-looking token (x, or
  // an all-digit s) arrives as a number: stringify rather than type-check.
  validateSearch: (search: Record<string, unknown>): Search => ({
    e: search.e == null ? "" : String(search.e),
    x: search.x == null ? "" : String(search.x),
    s: search.s == null ? "" : String(search.s),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getFireVerifyContext({ data: deps }),
  head: () => ({ meta: [{ title: "Fire verification · FireLine" }, { name: "robots", content: "noindex" }] }),
  component: VerifyPage,
});

type Ctx = Awaited<ReturnType<typeof getFireVerifyContext>>;

function VerifyPage() {
  const ctx = Route.useLoaderData() as Ctx;
  const search = Route.useSearch();
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<"active" | "extinguished" | "false_alarm" | "">("");
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  // Up to MAX_PHOTOS photos: the blob sent, and a small data-URL preview (also the offline draft).
  const [photos, setPhotos] = useState<{ blob: Blob; preview: string }[]>([]);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [posState, setPosState] = useState<"idle" | "busy" | "ok" | "no">("idle");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [fail, setFail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const f = fireCopy[lang];
  const [live, setLive] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [liveState, setLiveState] = useState<"idle" | "busy" | "fail">("idle");
  const watchId = useRef<number | null>(null);
  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
  }, []);
  // Live distance and direction while the page is open (GPS, updates as you move).
  const watch = () => {
    if (!("geolocation" in navigator)) return setLiveState("fail");
    setLiveState("busy");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const v = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        setLive(v);
        setLiveState("idle");
        // The report's location comes along for free.
        setPos({ lat: v.lat, lon: v.lon });
        setPosState("ok");
      },
      () => setLiveState("fail"),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
  };

  const [draftNote, setDraftNote] = useState<"" | "saved" | "restored">("");
  const draftKey = `fireline.draft.${search.e}`;
  useEffect(() => {
    try {
      setBy(localStorage.getItem("fireline.by") ?? "");
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null") as { status?: typeof status; note?: string; photos?: string[]; pos?: { lat: number; lon: number } } | null;
      if (d) {
        if (d.status) setStatus(d.status);
        if (d.note) setNote(d.note);
        if (d.pos) {
          setPos(d.pos);
          setPosState("ok");
        }
        if (d.photos?.length) {
          void Promise.all(d.photos.map((u) => fetch(u).then((r) => r.blob()).then((blob) => ({ blob, preview: u })))).then(setPhotos);
        }
        setDraftNote("restored");
      }
    } catch {
      /* ignore */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const statusLabel: Record<string, string> = { active: t.fireStatusActive, extinguished: t.fireStatusOut, false_alarm: t.fireStatusFalse };
  const inc = ctx.ok ? ctx.incident : null!;
  // The case with its plots' shapes, as the map wants it.
  const caseView = useMemo<Case | null>(() => {
    if (!ctx.ok) return null;
    const byId = new Map(ctx.shapes.map((p) => [p.id, p]));
    return {
      ...ctx.incident,
      plot: { ...ctx.incident.plot, g: byId.get(ctx.incident.plot.id)?.g ?? [] },
      aff: ctx.incident.plots.filter((cp) => byId.has(cp.id)).map((cp) => ({ ...cp, plot: byId.get(cp.id)! })),
    };
  }, [ctx]);
  const villages = ctx.ok ? [...new Set(ctx.shapes.map((p) => p.village || p.district).filter(Boolean))] : [];

  const locate = () => {
    if (!("geolocation" in navigator)) return setPosState("no");
    setPosState("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setPosState("ok");
      },
      () => setPosState("no"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const [photoFail, setPhotoFail] = useState(false);
  const onFiles = async (list: FileList | null) => {
    setPhotoFail(false);
    for (const file of Array.from(list ?? []).slice(0, MAX_PHOTOS - photos.length)) await onFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };
  // Downsize on the phone so a 4–8 MB camera JPEG becomes ~300 kB.
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const max = 1600;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
      if (blob) setPhotos((ps) => [...ps, { blob, preview: c.toDataURL("image/jpeg", 0.6) }].slice(0, MAX_PHOTOS));
    } catch {
      // A format this browser can't decode (e.g. HEIC): the server would refuse it too.
      setPhotoFail(true);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (posState === "idle") locate();
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!status || !by.trim() || !ctx.ok) return;
    setSending(true);
    setFail(false);
    try {
      localStorage.setItem("fireline.by", by.trim());
    } catch {
      /* ignore */
    }
    const fd = new FormData();
    fd.set("e", search.e);
    fd.set("x", search.x);
    fd.set("s", search.s);
    fd.set("status", status);
    fd.set("by", by.trim());
    fd.set("note", note.trim());
    if (pos) {
      fd.set("lat", String(pos.lat));
      fd.set("lon", String(pos.lon));
    }
    photos.forEach((ph, k) => fd.append("photo", ph.blob, `photo${k + 1}.jpg`));
    try {
      const r = await fetch("/fire/submit", { method: "POST", body: fd });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
      setDraftNote("");
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    } catch {
      setFail(true);
      // Keep the report on the phone (no signal in the field is normal).
      try {
        let budget = 1_500_000;
        const keep = photos.map((ph) => ph.preview).filter((u) => (budget -= u.length) > 0);
        localStorage.setItem(draftKey, JSON.stringify({ status, note, pos, photos: keep }));
        setDraftNote("saved");
      } catch {
        /* storage full */
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fv-page" data-product="palm">
      <div className="fv-row" style={{ justifyContent: "space-between" }}>
        <span className="fv-brand">
          <BrandMark size={20} /> FireLine
        </span>
        <LangToggle />
      </div>
      <h1>{t.fvTitle}</h1>
      {!ctx.ok ? (
        <div className="fv-card">
          <p>{ctx.reason === "expired" ? t.fvExpired : t.fvMissing}</p>
        </div>
      ) : (
        <>
          <p>{t.fvIntro}</p>
          <div className="fv-card">
            <dl>
              <dt>{f.colCompany}</dt>
              <dd>
                <b>{inc.name}</b>
              </dd>
              <dt>{t.fireColMill}</dt>
              <dd>{inc.mills.join(", ") || "—"}</dd>
              <dt>{t.fireEventPlot}</dt>
              <dd>
                {fill(f.plotsN, { n: inc.plots.length })}
                {villages.length ? (
                  <>
                    <br />
                    {villages.slice(0, 4).join(", ")}
                    {villages.length > 4 ? ` ${fill(f.moreN, { n: villages.length - 4 })}` : ""}
                  </>
                ) : null}
              </dd>
              <dt>{t.fvHotspot}</dt>
              <dd className="tabular-nums">
                {inc.lat}, {inc.lon}
                <br />
                {inc.d === 0 ? f.inside : fill(f.metres, { d: inc.d })} · {fill(f.dets, { n: inc.n })} · {fill(f.daysN, { n: inc.days.length })}
              </dd>
              <dt>{t.fvDetected}</dt>
              <dd className="tabular-nums">{fmtWhen(inc.last)} WIB</dd>
            </dl>
          </div>

          <div className="fv-map">
            <Suspense fallback={null}>
              <FireMap
                mode="focus"
                incidents={caseView ? [caseView] : []}
                selected={caseView}
                colorOf={() => "#e5322d"}
                mill={ctx.mill ? { ...ctx.mill, name: inc.plot.mill } : null}
                me={live ?? (pos ? { lat: pos.lat, lon: pos.lon } : null)}
                tools={false}
              />
            </Suspense>
          </div>

          <div className="fv-card fv-route">
            <b>{f.routeTitle}</b>
            <div className="fv-route-btns">
              <a className="btn-primary" href={gmapsRoute(inc.lat, inc.lon)} target="_blank" rel="noopener noreferrer">
                {f.gmaps}
              </a>
              <a className="btn-secondary" href={wazeRoute(inc.lat, inc.lon)} target="_blank" rel="noopener noreferrer">
                {f.waze}
              </a>
            </div>
            {live ? (
              <div className="fv-live" aria-live="polite">
                <span className="fv-arrow" style={{ transform: `rotate(${bearingDeg(live, inc)}deg)` }} aria-hidden="true">
                  ↑
                </span>
                <div>
                  <b className="tabular-nums">{formatDistance(distanceM(live, inc), lang)}</b>
                  <span>
                    {f.dirs[compass8(bearingDeg(live, inc))]} ({bearingDeg(live, inc)}°) · {fill(f.fvAccuracy, { m: Math.round(live.acc) })}
                  </span>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-secondary" onClick={watch} disabled={liveState === "busy"}>
                {liveState === "busy" ? f.locating : f.fvStart}
              </button>
            )}
            {live && distanceM(live, inc) <= 150 ? <p className="fv-arrived">{f.fvArrived}</p> : null}
            {liveState === "fail" ? <p className="fv-muted">{f.locFail}</p> : null}
            {ctx.mill ? (
              <p className="fv-muted">
                {fill(f.fvFromMill, {
                  mill: inc.plot.mill,
                  km: formatDistance(distanceM(ctx.mill, inc), lang),
                  dir: f.dirs[compass8(bearingDeg(ctx.mill, inc))],
                })}{" "}
                ·{" "}
                <a href={gmapsRoute(inc.lat, inc.lon, ctx.mill)} target="_blank" rel="noopener noreferrer">
                  {f.millRoute}
                </a>
              </p>
            ) : null}
            <p className="fv-muted">{f.fvRouteNote}</p>
          </div>

          {done ? (
            <div className="fv-card fv-done">
              <p>
                <b>{t.fvDone}</b>
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDone(false);
                  setStatus("");
                  setNote("");
                  setPhotos([]);
                }}
              >
                {t.fvDoneAgain}
              </button>
            </div>
          ) : (
            <form className="fv-card fv-form" onSubmit={(e) => void submit(e)}>
              <div className="fv-status" role="radiogroup" aria-label={t.fvStatus}>
                <b>{t.fvStatus}</b>
                {(["active", "extinguished", "false_alarm"] as const).map((k) => (
                  <label key={k}>
                    <input type="radio" name="status" value={k} checked={status === k} onChange={() => setStatus(k)} required />
                    {statusLabel[k]}
                  </label>
                ))}
              </div>
              <label>
                {t.fvName}
                <input type="text" value={by} onChange={(e) => setBy(e.target.value)} required maxLength={80} autoComplete="name" />
              </label>
              <label>
                {t.fvNote}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={600} placeholder={t.fvNotePh} />
              </label>
              <div>
                <b>{t.fvPhoto}</b>
                {photos.length ? (
                  <div className="fv-photos">
                    {photos.map((ph, k) => (
                      <div key={k} className="fv-thumb">
                        <img src={ph.preview} alt={`${f.photo} ${k + 1}`} />
                        <button type="button" aria-label={fill(f.fvRemovePhoto, { n: k + 1 })} onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== k))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {photos.length < MAX_PHOTOS ? (
                  <label className="fv-photo-btn" style={{ marginTop: 6 }}>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => void onFiles(e.target.files)} />
                    📷 {photos.length ? fill(f.fvAddPhoto, { n: photos.length, max: MAX_PHOTOS }) : t.fvPhotoTake}
                  </label>
                ) : null}
                {photoFail ? <p className="fv-muted">{f.fvPhotoFail}</p> : null}
              </div>
              <div className="fv-row">
                <b>{t.fvLocation}:</b>
                {posState === "ok" && pos ? (
                  <span className="tabular-nums">
                    {t.fvLocationOk} · {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)}
                  </span>
                ) : posState === "no" ? (
                  <span>{t.fvLocationNo}</span>
                ) : (
                  <button type="button" className="btn-secondary" onClick={locate} disabled={posState === "busy"}>
                    {posState === "busy" ? "…" : t.fvLocationGet}
                  </button>
                )}
              </div>
              {fail ? <p className="eudr-notice danger">{draftNote === "saved" ? f.fvDraftSaved : t.fvFail}</p> : null}
              {draftNote === "restored" && !fail ? <p className="fv-muted">{f.fvDraftRestored}</p> : null}
              {pos && distanceM(pos, inc) > 1000 ? <p className="fv-far">{fill(f.fvFar, { km: formatDistance(distanceM(pos, inc), lang) })}</p> : null}
              <button type="submit" className="btn-primary block" disabled={sending || !status || !by.trim()}>
                {sending ? t.fvSending : t.fvSubmit}
              </button>
            </form>
          )}

          {ctx.entries.length ? (
            <div className="fv-card">
              <b>{t.fvPrevious}</b>
              <ul className="fv-prev">
                {ctx.entries
                  .slice()
                  .reverse()
                  .map((r) => (
                    <li key={r.at}>
                      <b>{statusLabel[r.status]}</b> · <span className="tabular-nums">{fmtWhen(r.at)}</span> · {r.by}
                      {r.note ? <div>{r.note}</div> : null}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
