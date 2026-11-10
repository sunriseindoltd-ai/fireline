import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { promptInstall, startPwa, useInstall } from "@/lib/pwa";

const COPY = {
  en: {
    install: "Install the app",
    hint: "Put FireLine on this device's home screen; it opens full screen, like an app",
    iosTitle: "Install FireLine on this iPhone",
    iosSteps: ["Tap the Share button at the bottom of Safari.", "Choose “Add to Home Screen”.", "Tap “Add”. FireLine now opens from its own icon."],
    close: "Close",
  },
  id: {
    install: "Pasang aplikasi",
    hint: "Pasang FireLine di layar utama perangkat ini; terbuka layar penuh, seperti aplikasi",
    iosTitle: "Pasang FireLine di iPhone ini",
    iosSteps: ["Ketuk tombol Bagikan di bawah Safari.", "Pilih “Tambahkan ke Layar Utama”.", "Ketuk “Tambah”. FireLine kini terbuka dari ikonnya sendiri."],
    close: "Tutup",
  },
};

/** Registers the service worker on every page (the field report page included) and keeps Chrome's install offer. */
export function PwaBoot() {
  useEffect(startPwa, []);
  return null;
}

/**
 * "Install the app" button: Chrome's install dialog where the browser offers one, the Add to Home Screen steps on
 * iPhone/iPad, nothing when FireLine already runs as the installed app or the browser cannot install it.
 */
export function InstallApp({ className = "btn-text fl-install" }: { className?: string }) {
  const { lang } = useI18n();
  const c = COPY[lang === "id" ? "id" : "en"];
  const state = useInstall();
  const [steps, setSteps] = useState(false);
  if (state === "none") return null;
  return (
    <>
      <button type="button" className={className} title={c.hint} onClick={() => (state === "offer" ? void promptInstall() : setSteps(true))}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        {c.install}
      </button>
      {steps ? (
        <div className="fl-install-sheet" role="dialog" aria-modal="true" aria-label={c.iosTitle} onClick={() => setSteps(false)}>
          <div className="fl-install-card" onClick={(e) => e.stopPropagation()}>
            <h2>{c.iosTitle}</h2>
            <ol>
              {c.iosSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <button type="button" className="btn-primary" onClick={() => setSteps(false)}>
              {c.close}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
