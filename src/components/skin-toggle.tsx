import { useI18n } from "@/lib/i18n";
import { setTheme, useTheme } from "@/lib/skin";

const COPY = {
  en: { toLight: "Light look", toDark: "Dark look", hint: "Switch between the dark and the light look" },
  id: { toLight: "Tampilan terang", toDark: "Tampilan gelap", hint: "Ganti antara tampilan gelap dan terang" },
};

/** Dark / light switch for the dashboard. */
export function SkinToggle() {
  const { lang } = useI18n();
  const c = COPY[lang === "id" ? "id" : "en"];
  const theme = useTheme();
  return (
    <button type="button" className="btn-text fl-skin" title={c.hint} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? c.toLight : c.toDark}
    </button>
  );
}
