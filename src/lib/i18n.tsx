import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { copy, type Copy, type Lang } from "@/lib/copy";

const KEY = "kanopi.lang";

type Ctx = {
  lang: Lang;
  t: Copy;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<Ctx | null>(null);

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "id" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    setLangState(readLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<Ctx>(() => {
    const setLang = (next: Lang) => {
      setLangState(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
    };
    return { lang, t: copy[lang] as Copy, setLang };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside LanguageProvider");
  return ctx;
}
