import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SiteLayout } from "@/components/site/site-chrome";
import { useI18n } from "@/lib/i18n";
import { EARTHLINE } from "@/lib/site-copy";

type ContactSearch = { early?: boolean };

/**
 * Contact + Early Access request (feedback 2, Doc 3 §5.5). There is no mail
 * backend in this deployment, so the form composes an email to Earthline's
 * sales address in the visitor's own mail app and says so plainly — a form
 * that silently goes nowhere would be worse than none.
 */
export const Route = createFileRoute("/contact")({
  validateSearch: (search: Record<string, unknown>): ContactSearch => ({
    early: [true, 1, "1", "true"].includes(search.early as never) ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Contact · PalmTrace by Earthline" },
      { name: "description", content: "Request Early Access to PalmTrace or contact Earthline in Jakarta." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { s } = useI18n();
  const { early } = Route.useSearch();
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [wantsAccess, setWantsAccess] = useState(!!early);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const subject = wantsAccess ? s.cSubjectEarly : s.cSubject;
    const body = [
      `${s.cName}: ${name}`,
      `${s.cOrg}: ${org}`,
      role ? `${s.cRole}: ${role}` : "",
      wantsAccess ? `✓ ${s.cEarly}` : "",
      "",
      message,
    ]
      .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
      .join("\n");
    window.location.href = `mailto:${EARTHLINE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <SiteLayout>
      <article className="page">
        <header className="page-hero">
          <div className="wrap narrow">
            <h1>{s.cTitle}</h1>
            <p className="lead">{s.cLead}</p>
          </div>
        </header>
        <div className="wrap contact-grid">
          <form className="contact-form" onSubmit={onSubmit}>
            <label>
              {s.cName}
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
            <label>
              {s.cOrg}
              <input value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" required />
            </label>
            <label>
              {s.cRole}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">—</option>
                <option value={s.cRoleSustainability}>{s.cRoleSustainability}</option>
                <option value={s.cRoleProcurement}>{s.cRoleProcurement}</option>
                <option value={s.cRoleMill}>{s.cRoleMill}</option>
                <option value={s.cRoleOther}>{s.cRoleOther}</option>
              </select>
            </label>
            <label>
              {s.cMessage}
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} />
            </label>
            <label className="check">
              <input type="checkbox" checked={wantsAccess} onChange={(e) => setWantsAccess(e.target.checked)} />
              {s.cEarly}
            </label>
            <button type="submit" className="btn-dark lg">
              {s.cSend}
            </button>
            <p className="form-note">{s.cSendNote.replace("{email}", EARTHLINE.email)}</p>
          </form>
          <aside className="contact-card">
            <h2>{EARTHLINE.legal}</h2>
            <dl>
              <div>
                <dt>{s.cOffice}</dt>
                <dd>{EARTHLINE.address}</dd>
              </div>
              <div>
                <dt>{s.cPhone}</dt>
                <dd>
                  <a href={EARTHLINE.phoneHref}>{EARTHLINE.phone}</a>
                </dd>
              </div>
              <div>
                <dt>{s.cEmail}</dt>
                <dd>
                  <a href={`mailto:${EARTHLINE.email}`}>{EARTHLINE.email}</a>
                </dd>
              </div>
            </dl>
            <a className="text-link" href={EARTHLINE.mapsHref} target="_blank" rel="noopener noreferrer">
              {s.cDirections} ↗
            </a>
            <a className="text-link" href={EARTHLINE.site} rel="noopener">
              earthline.info →
            </a>
          </aside>
        </div>
      </article>
    </SiteLayout>
  );
}
