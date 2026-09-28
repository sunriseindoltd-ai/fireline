import { useI18n } from "@/lib/i18n";

export function LangToggle({ className = "" }: { className?: string }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className={`lang ${className}`} role="group" aria-label="Language / Bahasa">
      <button type="button" className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>
        {t.langEn}
      </button>
      <button type="button" className={lang === "id" ? "on" : ""} aria-pressed={lang === "id"} onClick={() => setLang("id")}>
        {t.langId}
      </button>
    </div>
  );
}
