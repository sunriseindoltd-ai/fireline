import { BrandMark } from "@/components/brand-mark";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { gateLogin, getGateSession } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  loader: async () => {
    const session = await getGateSession();
    if (session.ok) throw redirect({ to: "/" });
    return session;
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await gateLogin({
      data: { username, password },
    });
    setPending(false);
    if (!res.ok) {
      setError(t.invalidCredentials);
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <main className="login-shell">
      <div className="lang" role="group" aria-label="Language">
        <button
          type="button"
          className={lang === "en" ? "on" : ""}
          onClick={() => setLang("en")}
        >
          {t.langEn}
        </button>
        <button
          type="button"
          className={lang === "id" ? "on" : ""}
          onClick={() => setLang("id")}
        >
          {t.langId}
        </button>
      </div>
      <form onSubmit={onSubmit} className="login-card">
        <div className="login-brand">
          <BrandMark size={32} />
          <span>{t.app}</span>
        </div>
        <h1>{t.signIn}</h1>
        <label>
          {t.id}
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          {t.password}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <p className="login-err" role="alert">
          {error}
        </p>
        <button type="submit" disabled={pending}>
          {pending ? t.signingIn : t.signIn}
        </button>
      </form>
    </main>
  );
}
