import { useState, type FormEvent } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { getSession, login } from "@/lib/auth-actions";
import { fireCopy } from "@/lib/fire-copy";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  loader: async () => {
    const s = await getSession();
    if (s.ok) throw redirect({ to: "/" });
    return null;
  },
  head: () => ({ meta: [{ title: "Sign in · FireLine" }] }),
  component: LoginPage,
});

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {open ? null : <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const f = fireCopy[lang];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<"" | "invalid" | "locked">("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await login({ data: { username, password } });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <main className="login-shell">
      <figure className="login-visual">
        <img src="/img/fire-still.jpg" alt="" />
        <figcaption>{f.loginCaption}</figcaption>
      </figure>
      <div className="login-panel">
        <div className="login-top">
          <span className="login-home">
            <BrandMark size={24} />
            <span>FireLine</span>
          </span>
          <LangToggle />
        </div>
        <form onSubmit={onSubmit} className="login-card">
          <h1>{f.loginHeading}</h1>
          <p className="login-sub">{f.loginSub}</p>
          <label>
            {t.id}
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            {t.password}
            <span className="login-password">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="login-reveal" aria-label={show ? t.hidePassword : t.showPassword} aria-pressed={show} onClick={() => setShow((v) => !v)}>
                <EyeIcon open={!show} />
              </button>
            </span>
          </label>
          <p className="login-err" role="alert">
            {error === "invalid" ? t.invalidCredentials : error === "locked" ? f.loginLocked : ""}
          </p>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? t.signingIn : t.signIn}
          </button>
        </form>
      </div>
    </main>
  );
}
