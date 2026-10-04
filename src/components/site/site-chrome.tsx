import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { brandCopy } from "@/lib/brand-copy";
import { PRODUCTS, UMBRELLA, brandName, type ProductId } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { EARTHLINE } from "@/lib/site-copy";

/**
 * Public navigation — small, light and quiet: mark + the brand on the left,
 * a few plain text links, then language, "Sign in" as text and the one
 * primary action (request early access). The brand and links follow the page:
 * Earthline Trace on the umbrella page, PalmTrace / SoyTrace on theirs
 * (brand.ts) — methodology (/method, /soy/method), About and Contact stay in
 * the product the visitor came from. The workspace is invitation-only.
 */
function SiteHeader({ signedIn, product }: { signedIn: boolean; product?: ProductId }) {
  const { s, lang } = useI18n();
  const b = brandCopy[lang];
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const name = brandName(product);
  const home = product ? PRODUCTS[product].path : "/";
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        {s.skipToContent}
      </a>
      <div className="site-header-inner">
        <Link to={home} className="site-brand" aria-label={`${name} — Home`}>
          <BrandMark size={22} product={product} />
          <span>{name}</span>
        </Link>
        <nav id="site-nav" className={`site-nav ${open ? "open" : ""}`} aria-label="Primary">
          {product === "palm" ? (
            <>
              <Link to="/palm" hash="product" onClick={close}>
                {s.navProduct}
              </Link>
              <Link to="/palm" hash="how" onClick={close}>
                {s.navHow}
              </Link>
              <Link to="/method" activeProps={{ className: "active" }} onClick={close}>
                {s.navMethod}
              </Link>
            </>
          ) : product === "soy" ? (
            <>
              <Link to="/soy" hash="features" onClick={close}>
                {b.navSoyWhat}
              </Link>
              <Link to="/soy" hash="how" onClick={close}>
                {s.navHow}
              </Link>
              <Link to="/soy/method" activeProps={{ className: "active" }} onClick={close}>
                {s.navMethod}
              </Link>
            </>
          ) : (
            <Link to="/" hash="products" onClick={close}>
              {b.navProducts}
            </Link>
          )}
          <Link to="/about" search={product ? { product } : {}} activeProps={{ className: "active" }} onClick={close}>
            {s.navAbout}
          </Link>
          <Link
            to="/contact"
            search={product ? { product } : {}}
            activeProps={{ className: "active" }}
            onClick={close}
          >
            {s.navContact}
          </Link>
          {product ? (
            <Link to="/" className="site-nav-umbrella" onClick={close}>
              {UMBRELLA.name}
            </Link>
          ) : null}
        </nav>
        <div className="site-actions">
          <LangToggle />
          {signedIn ? (
            <Link to="/app/portfolio" className="btn-dark sm">
              {s.openWorkspace}
            </Link>
          ) : (
            <>
              <Link to="/login" search={product ? { product } : {}} className="site-signin">
                {s.signIn}
              </Link>
              <Link
                to="/contact"
                search={{ early: true, ...(product ? { product } : {}) }}
                className="btn-dark sm"
              >
                {s.requestAccessShort}
              </Link>
            </>
          )}
          <button
            type="button"
            className="site-menu-btn"
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              ) : (
                <path d="M4 8h16M4 16h16" strokeLinecap="round" />
              )}
            </svg>
            <span className="sr-only">{s.menuToggle}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function SiteFooter({ product }: { product?: ProductId }) {
  const { s, lang } = useI18n();
  const b = brandCopy[lang];
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <span className="site-brand">
              <BrandMark size={20} />
              <span>{UMBRELLA.name}</span>
            </span>
            <p>{b.footerTagline}</p>
          </div>
          <nav aria-label={b.footerProducts}>
            <h3>{b.footerProducts}</h3>
            {(Object.values(PRODUCTS) as (typeof PRODUCTS)[ProductId][]).map((p) => (
              <Link key={p.id} to={p.path}>
                {p.name}
              </Link>
            ))}
            {product === "palm" ? <Link to="/method">{s.navMethod}</Link> : null}
            {product === "soy" ? <Link to="/soy/method">{s.navMethod}</Link> : null}
            <Link to="/login" search={product ? { product } : {}}>
              {s.signIn}
            </Link>
          </nav>
          <nav aria-label={s.footerCompany}>
            <h3>{s.footerCompany}</h3>
            <Link to="/about" search={product ? { product } : {}}>
              {s.navAbout}
            </Link>
            <Link to="/contact" search={product ? { product } : {}}>
              {s.navContact}
            </Link>
            <a href={EARTHLINE.site} rel="noopener">
              earthline.info
            </a>
          </nav>
          <address>
            <h3>{EARTHLINE.legal}</h3>
            <span>{EARTHLINE.address}</span>
            <a href={EARTHLINE.phoneHref}>{EARTHLINE.phone}</a>
            <a href={`mailto:${EARTHLINE.email}`}>{EARTHLINE.email}</a>
          </address>
        </div>
        <p className="site-footer-legal">
          {s.footerFirm} · © {new Date().getFullYear()} {EARTHLINE.legal}. {s.footerRights}{" "}
          {s.footerImagery}
        </p>
      </div>
    </footer>
  );
}

export function SiteLayout({
  children,
  signedIn = false,
  product,
}: {
  children: ReactNode;
  signedIn?: boolean;
  /** The product whose pages these are; omitted on the umbrella page. */
  product?: ProductId;
}) {
  return (
    <div className="site" data-product={product}>
      <SiteHeader signedIn={signedIn} product={product} />
      <main id="main">{children}</main>
      <SiteFooter product={product} />
    </div>
  );
}
