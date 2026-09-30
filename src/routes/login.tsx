import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PRODUCTS, brandName, isProductId, withBrand, type ProductId } from "@/lib/brand";
import { gateLogin, getGateSession } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";

/** `product` only themes the page (name, home link); every product shares
 * one account system, and the session decides which workspace opens. */
type LoginSearch = { next?: string; product?: ProductId };

/**
 * Only same-site workspace paths are honoured as a post-login destination —
 * anything else (an absolute URL, "//evil.example", a public page) falls back
 * to the portfolio, so `?next=` can't be used as an open redirect.
 */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/app") && !next.startsWith("//")) return next;
  return "/app/portfolio";
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
    product: isProductId(search.product) ? search.product : undefined,
  }),
  loaderDeps: ({ search }) => ({ next: search.next }),
  loader: async ({ deps }) => {
    const session = await getGateSession();
    if (session.ok) throw redirect({ href: safeNext(deps.next) });
    return session;
  },
  head: () => ({
    meta: [{ title: "Sign in · Earthline Trace" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {open ? null : <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { next, product } = Route.useSearch();
  const { t, s: site } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setFailed(false);
    const res = await gateLogin({ data: { username, password } });
    setPending(false);
    if (!res.ok) {
      // The typed password is kept: clearing it after a typo just makes
      // people retype everything (feedback 2, §4.7).
      setFailed(true);
      return;
    }
    await navigate({ href: safeNext(next) });
  }

  return (
    <main className="login-shell" data-product={product}>
      <figure className="login-visual">
        <img src="/img/field-2020.jpg" alt="" />
        {/* The photo and its caption are from a PalmTrace analysis. */}
        {product === "palm" ? <figcaption>{site.imageCaption}</figcaption> : null}
      </figure>
      <div className="login-panel">
        <div className="login-top">
          <Link to={product ? PRODUCTS[product].path : "/"} className="login-home">
            <BrandMark size={24} product={product} />
            <span>{brandName(product)}</span>
          </Link>
          <LangToggle />
        </div>
        <form onSubmit={onSubmit} className="login-card" noValidate={false}>
          <h1>{withBrand(t.loginHeading, product)}</h1>
          <p className="login-sub">{t.loginSub}</p>
          <label>
            {t.id}
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            {t.password}
            <span className="login-password">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="login-reveal"
                aria-label={showPassword ? t.hidePassword : t.showPassword}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                <EyeIcon open={!showPassword} />
              </button>
            </span>
          </label>
          <p className="login-err" role="alert">
            {failed ? t.invalidCredentials : ""}
          </p>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? t.signingIn : t.signIn}
          </button>
          <p className="login-foot">
            {t.noAccess} <Link to="/contact">{t.contactUs}</Link>
          </p>
        </form>
        <Link to="/" className="login-back">
          ← {t.backToSite}
        </Link>
      </div>
    </main>
  );
}
