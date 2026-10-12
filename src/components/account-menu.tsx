import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LangToggle } from "@/components/lang-toggle";
import { useI18n } from "@/lib/i18n";
import type { TENANTS, Tenant } from "@/lib/tenants";

type TenantInfo = (typeof TENANTS)[number];

/**
 * Everything about "me and this session" behind one header button — client,
 * language, presentation mode, the admin inbox and sign out — so the header
 * itself only carries navigation.
 */
export function AccountMenu({
  tenant,
  tenants,
  onSwitchTenant,
  showRequests,
  canPresent,
  present,
  onPresent,
  onSignOut,
  extra = [],
  presentHint,
}: {
  tenant: Tenant;
  /** Clients this account may switch between; fewer than two = no picker. */
  tenants: readonly TenantInfo[];
  onSwitchTenant: (next: Tenant) => void;
  showRequests: boolean;
  canPresent: boolean;
  present: boolean;
  onPresent: (on: boolean) => void;
  onSignOut: () => void;
  /** Product-specific entries (SoyTrace: the report, the tour), above sign out. */
  extra?: { label: string; hint?: string; onClick: () => void }[];
  /** What presentation mode hides in this product (PalmTrace's wording otherwise). */
  presentHint?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = tenants.find((x) => x.id === tenant);
  const label = tenants.length > 1 && current ? current.label : t.accountGeneric;

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="acct" ref={rootRef}>
      <button
        type="button"
        className="acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.accountMenu}
        title={t.accountMenu}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" strokeLinecap="round" />
        </svg>
        <span className="acct-label">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="acct-menu" role="menu" aria-label={t.accountMenu}>
          {tenants.length > 1 ? (
            <section>
              <p className="acct-kicker">{t.clientLabel}</p>
              {tenants.map((tn) => (
                <button
                  key={tn.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tn.id === tenant}
                  className={`acct-item ${tn.id === tenant ? "on" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (tn.id !== tenant) onSwitchTenant(tn.id);
                  }}
                >
                  {tn.label}
                  {tn.id === tenant ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </section>
          ) : null}
          <section className="acct-row">
            <p className="acct-kicker">{t.menuLanguage}</p>
            <LangToggle />
          </section>
          {canPresent ? (
            <section>
              <label className="acct-switch">
                <span>
                  <b>{t.menuPresent}</b>
                  <small>{presentHint ?? t.menuPresentHint}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={present}
                  onChange={(e) => {
                    onPresent(e.target.checked);
                    setOpen(false);
                  }}
                />
              </label>
            </section>
          ) : null}
          {extra.length ? (
            <section>
              {extra.map((x) => (
                <button
                  key={x.label}
                  type="button"
                  className="acct-item acct-item-rich"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    x.onClick();
                  }}
                >
                  <b>{x.label}</b>
                  {x.hint ? <small>{x.hint}</small> : null}
                </button>
              ))}
            </section>
          ) : null}
          <section>
            {showRequests ? (
              <Link
                to="/app/requests"
                className="acct-item"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {t.requestsNav}
              </Link>
            ) : null}
            <button type="button" className="acct-item" role="menuitem" onClick={onSignOut}>
              {t.signOut}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
