import { useSyncExternalStore } from "react";

/**
 * FireLine as an installable app (PWA, user 10 Nov 2026: no Play Store, installed from the browser).
 * Registers /sw.js once and keeps Chrome's install offer (`beforeinstallprompt`), which fires early, often before the
 * button that uses it is on screen. iPhone/iPad have no such offer: there the button explains Share → Add to Home Screen.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let offer: InstallEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Already running as the installed app (home-screen icon), not in a browser tab. */
function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let started = false;
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  installed = standalone();
  if ("serviceWorker" in navigator) {
    // after load, so it never competes with the first paint of the map
    const reg = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    installed = true;
    emit();
  });
}

export type InstallState = "offer" | "ios" | "none";
function snapshot(): InstallState {
  if (installed) return "none";
  if (offer) return "offer";
  return isIos() ? "ios" : "none";
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** "offer" = Chrome can install now, "ios" = show the Add to Home Screen steps, "none" = nothing to show. */
export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => "none");
}

/** Show Chrome's own install dialog (an offer can be used once; Chrome may make a new one later). */
export async function promptInstall() {
  if (!offer) return;
  const e = offer;
  offer = null;
  emit();
  await e.prompt();
  await e.userChoice;
}
