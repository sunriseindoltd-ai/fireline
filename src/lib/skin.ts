import { useEffect, useState } from "react";

/**
 * Theme of the dashboard (user, 29 Oct 2026: a console-launcher look, Xbox PC app as the reference; 2 Nov: a white
 * version replaces the old classic look). `flx` on <html> switches on styles-flx.css, `flx-light` its light token
 * set; the field page (/fire/verify) stays in the classic light look either way.
 */
export type Theme = "dark" | "light";
const STORE = "fireline.skin";
const EVT = "fireline-skin";

/** Inline script for <head>: sets the classes before the first paint (no flash). "classic" = an earlier light choice. */
export const SKIN_BOOT = `(function(){var c=document.documentElement.classList;c.add("flx");try{var s=localStorage.getItem("${STORE}");if(s==="light"||s==="classic")c.add("flx-light")}catch(e){}})()`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("flx-light") ? "light" : "dark";
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle("flx-light", t === "light");
  try {
    localStorage.setItem(STORE, t);
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

export function useTheme(): Theme {
  const [theme, set] = useState<Theme>("dark");
  useEffect(() => {
    const on = () => set(readTheme());
    on();
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return theme;
}
