import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * "Notifications" button in the header (10 Nov 2026): fire alerts on this device, also while FireLine is closed
 * (server side: src/lib/push.server.ts). Admins and company accounts only — the server gives viewers no key, and then
 * the button is not shown. iPhone/iPad only allow web notifications for an app on the Home Screen, so there the
 * button first asks to install FireLine.
 */
const COPY = {
  en: {
    off: "Notifications",
    offHint: "Get a message on this device when a new fire is detected on or near your plots, even when FireLine is closed",
    on: "Notifications on",
    blocked: "Notifications blocked",
    blockedHint: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again.",
    iosTitle: "Notifications on iPhone",
    iosBody: "iPhone and iPad only send notifications to apps on the Home Screen. Install FireLine first (Share → Add to Home Screen), open it from its icon, then tap Notifications again.",
    test: "Send a test",
    testSent: "Test sent",
    testNone: "No device received it. Turn notifications off and on again.",
    turnOff: "Turn off on this device",
    failed: "Could not turn notifications on. Try again.",
    close: "Close",
    working: "…",
  },
  id: {
    off: "Notifikasi",
    offHint: "Terima pesan di perangkat ini saat kebakaran baru terdeteksi di atau dekat plot Anda, juga saat FireLine tertutup",
    on: "Notifikasi aktif",
    blocked: "Notifikasi diblokir",
    blockedHint: "Notifikasi untuk situs ini diblokir. Izinkan di pengaturan situs browser, lalu coba lagi.",
    iosTitle: "Notifikasi di iPhone",
    iosBody: "iPhone dan iPad hanya mengirim notifikasi ke aplikasi di Layar Utama. Pasang FireLine dulu (Bagikan → Tambahkan ke Layar Utama), buka dari ikonnya, lalu ketuk Notifikasi lagi.",
    test: "Kirim tes",
    testSent: "Tes terkirim",
    testNone: "Tidak ada perangkat yang menerima. Matikan lalu nyalakan lagi notifikasinya.",
    turnOff: "Matikan di perangkat ini",
    failed: "Gagal menyalakan notifikasi. Coba lagi.",
    close: "Tutup",
    working: "…",
  },
};

type State = "hidden" | "ios" | "blocked" | "off" | "on";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(b64: string) {
  const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle({ className = "btn-text fl-install" }: { className?: string }) {
  const { lang } = useI18n();
  const c = COPY[lang === "id" ? "id" : "en"];
  const [state, setState] = useState<State>("hidden");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "ios" | "blocked" | "menu">(null);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const refresh = useCallback(async (k: string | null) => {
    if (!k) return setState("hidden");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return setState(isIos() && !standalone() ? "ios" : "hidden");
    if (Notification.permission === "denied") return setState("blocked");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/fire/push/key", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { key: null }))
      .then((j: { key: string | null }) => {
        if (!live) return;
        setKey(j.key);
        void refresh(j.key);
      })
      .catch(() => live && setState("hidden"));
    return () => {
      live = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!panel) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanel(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [panel]);

  async function turnOn() {
    if (!key) return;
    setBusy(true);
    setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        if (perm === "denied") setPanel("blocked");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const r = await fetch("/fire/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sub: sub.toJSON(), lang: lang === "id" ? "id" : "en" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setState("on");
      setPanel("menu");
    } catch {
      setNote(c.failed);
      setPanel("menu");
      void refresh(key);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/fire/push/unsubscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/fire/push/test", { method: "POST", credentials: "same-origin" });
      const j = r.ok ? ((await r.json()) as { sent: number }) : { sent: 0 };
      setNote(j.sent > 0 ? c.testSent : c.testNone);
    } finally {
      setBusy(false);
    }
  }

  if (state === "hidden") return null;
  const label = state === "on" ? c.on : state === "blocked" ? c.blocked : c.off;
  const onClick = () => {
    if (state === "ios") return setPanel("ios");
    if (state === "blocked") return setPanel("blocked");
    if (state === "on") return setPanel(panel === "menu" ? null : "menu");
    void turnOn();
  };
  return (
    <span className="fl-push" ref={ref}>
      <button type="button" className={`${className} ${state === "on" ? "on" : ""}`} title={c.offHint} aria-expanded={!!panel} onClick={onClick} disabled={busy}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          {state === "on" ? <circle cx="18" cy="5" r="3" fill="currentColor" stroke="none" /> : null}
        </svg>
        {busy ? c.working : label}
      </button>
      {panel ? (
        <div className="fl-push-pop" role="dialog" aria-label={label}>
          {panel === "ios" ? (
            <>
              <b>{c.iosTitle}</b>
              <p>{c.iosBody}</p>
            </>
          ) : panel === "blocked" ? (
            <p>{c.blockedHint}</p>
          ) : (
            <>
              <p>{c.offHint}</p>
              {state === "on" ? (
                <div className="fl-push-acts">
                  <button type="button" className="btn-secondary" onClick={() => void test()} disabled={busy}>
                    {c.test}
                  </button>
                  <button type="button" className="btn-text" onClick={() => void turnOff()} disabled={busy}>
                    {c.turnOff}
                  </button>
                </div>
              ) : null}
              {note ? <p className="fl-push-note" role="status">{note}</p> : null}
            </>
          )}
          <button type="button" className="btn-text fl-push-close" onClick={() => setPanel(null)}>
            {c.close}
          </button>
        </div>
      ) : null}
    </span>
  );
}
