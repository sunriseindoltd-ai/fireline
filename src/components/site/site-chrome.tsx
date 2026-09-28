import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { useI18n } from "@/lib/i18n";
import { EARTHLINE } from "@/lib/site-copy";

/**
 * Public navigation — small, light and quiet: mark + PalmTrace on the left,
 * a few plain text links, then language, "Sign in" as text and the one
 * primary action (request early access). The workspace is invitation-only.
 */
function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const { s } = useI18n();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        {s.skipToContent}
      </a>
      <div className="site-header-inner">
        <Link to="/" className="site-brand" aria-label="PalmTrace — Home">
          <BrandMark size={22} />
          <span>PalmTrace</span>
        </Link>
        <nav id="site-nav" className={`site-nav ${open ? "open" : ""}`} aria-label="Primary">
          <Link to="/" hash="product" onClick={close}>
            {s.navProduct}
          </Link>
          <Link to="/" hash="how" onClick={close}>
            {s.navHow}
          </Link>
          <Link to="/method" activeProps={{ className: "active" }} onClick={close}>
            {s.navMethod}
          </Link>
          <Link to="/about" activeProps={{ className: "active" }} onClick={close}>
            {s.navAbout}
          </Link>
          <Link to="/contact" activeProps={{ className: "active" }} onClick={close}>
            {s.navContact}
          </Link>
        </nav>
        <div className="site-actions">
          <LangToggle />
          {signedIn ? (
            <Link to="/app/portfolio" className="btn-dark sm">
              {s.openWorkspace}
            </Link>
          ) : (
            <>
              <Link to="/login" className="site-signin">
                {s.signIn}
              </Link>
              <Link to="/contact" search={{ early: true }} className="btn-dark sm">
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 8h16M4 16h16" strokeLinecap="round" />}
            </svg>
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  const { s } = useI18n();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <span className="site-brand">
              <BrandMark size={20} />
              <span>PalmTrace</span>
            </span>
            <p>{s.footerTagline}</p>
          </div>
          <nav aria-label={s.footerProduct}>
            <h3>{s.footerProduct}</h3>
            <Link to="/" hash="how">
              {s.navHow}
            </Link>
            <Link to="/method">{s.navMethod}</Link>
            <Link to="/login">{s.signIn}</Link>
          </nav>
          <nav aria-label={s.footerCompany}>
            <h3>{s.footerCompany}</h3>
            <Link to="/about">{s.navAbout}</Link>
            <Link to="/contact">{s.navContact}</Link>
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
          {s.footerFirm} · © {new Date().getFullYear()} {EARTHLINE.legal}. {s.footerRights} {s.footerImagery}
        </p>
      </div>
    </footer>
  );
}

export function SiteLayout({ children, signedIn = false }: { children: ReactNode; signedIn?: boolean }) {
  return (
    <div className="site">
      <SiteHeader signedIn={signedIn} />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
