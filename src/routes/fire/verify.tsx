import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { getFireVerifyContext } from "@/lib/fire-actions";
import { useI18n } from "@/lib/i18n";
import { fill } from "@/lib/format";

type Search = { e: string; x: string; s: string };

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
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [posState, setPosState] = useState<"idle" | "busy" | "ok" | "no">("idle");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [fail, setFail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setBy(localStorage.getItem("fireline.by") ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const statusLabel: Record<string, string> = { active: t.fireStatusActive, extinguished: t.fireStatusOut, false_alarm: t.fireStatusFalse };

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
      if (blob) {
        setPhoto(blob);
        setPreview(c.toDataURL("image/jpeg", 0.6));
      }
    } catch {
      setPhoto(f);
      setPreview(url);
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
    if (photo) fd.set("photo", photo, "photo.jpg");
    try {
      const r = await fetch("/fire/submit", { method: "POST", body: fd });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
    } catch {
      setFail(true);
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
              <dt>{t.fireColMill}</dt>
              <dd>
                <b>{ctx.event.plot.mill || "—"}</b>
              </dd>
              <dt>{t.fireEventPlot}</dt>
              <dd>
                {ctx.event.plot.company || "—"}
                <br />
                {ctx.event.plot.type} · {ctx.event.plot.id}
                <br />
                {[ctx.event.plot.village, ctx.event.plot.district].filter(Boolean).join(", ")}
              </dd>
              <dt>{t.fvHotspot}</dt>
              <dd className="tabular-nums">
                {ctx.event.lat}, {ctx.event.lon}
                <br />
                {ctx.event.d === 0 ? t.fireInside : fill(t.fireMetres, { d: ctx.event.d })}
              </dd>
              <dt>{t.fvDetected}</dt>
              <dd className="tabular-nums">{fmtWhen(ctx.event.last)} WIB</dd>
            </dl>
            <a className="btn-primary block" href={`https://maps.google.com/?q=${ctx.event.lat},${ctx.event.lon}`} target="_blank" rel="noopener noreferrer">
              {t.fvOpenMaps}
            </a>
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
                  setPhoto(null);
                  setPreview(null);
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
                <label className="fv-photo-btn" style={{ marginTop: 6 }}>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={(e) => void onFile(e.target.files?.[0])} />
                  📷 {t.fvPhotoTake}
                </label>
                {preview ? <img className="fv-preview" src={preview} alt="" style={{ marginTop: 8 }} /> : null}
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
              {fail ? <p className="eudr-notice danger">{t.fvFail}</p> : null}
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
