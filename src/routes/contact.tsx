import { createFileRoute } from "@tanstack/react-router";
import { ogMeta } from "@/lib/og";
import { useState, type FormEvent } from "react";
import { SiteLayout } from "@/components/site/site-chrome";
import { isProductId, withBrand, type ProductId } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { EARTHLINE } from "@/lib/site-copy";

type ContactSearch = { early?: boolean; product?: ProductId };

/**
 * Contact + early-access request (feedback 2, Doc 3 §5.5; feedback 3, A-15).
 * The form posts to /contact-request, which stores the request for Earthline
 * (admin Requests page in the workspace). If that fails, the visitor can
 * still send the same text from their own mail app.
 */
export const Route = createFileRoute("/contact")({
  validateSearch: (search: Record<string, unknown>): ContactSearch => ({
    early: [true, 1, "1", "true"].includes(search.early as never) ? true : undefined,
    product: isProductId(search.product) ? search.product : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Contact · Earthline Trace" },
      {
        name: "description",
        content:
          "Request early access to Earthline Trace — PalmTrace, SoyTrace — or contact Earthline in Jakarta.",
      },
      ...ogMeta({
        title: "Contact · Earthline Trace",
        description:
          "Request early access to Earthline Trace — PalmTrace, SoyTrace — or contact Earthline in Jakarta.",
        path: "/contact",
        image: "trace",
      }),
    ],
  }),
  component: ContactPage,
});

const COMMODITY_KEYS = ["palm", "soy", "coffee", "other"] as const;
const SIZE_KEYS = ["1-10", "11-50", "51-200", "200+", "unsure"] as const;
const TIMELINE_KEYS = ["now", "3m", "12m", "exploring"] as const;
const ROLE_KEYS = ["sustainability", "procurement", "refinery", "mill", "consultant", "other"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function ContactPage() {
  const { s, lang } = useI18n();
  const { early, product } = Route.useSearch();
  // Copy names PalmTrace; it now names whichever product the visitor came from
  // (or Earthline Trace from the umbrella page).
  const b = (text: string) => withBrand(text, product);
  const [form, setForm] = useState({
    name: "",
    email: "",
    organisation: "",
    role: "",
    commodities: product === "soy" ? ["soy"] : product === "palm" ? ["palm"] : ([] as string[]),
    chainSize: "",
    regions: "",
    timeline: "",
    message: "",
    earlyAccess: !!early,
    consent: false,
    website: "", // honeypot
  });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "limited">("idle");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const roleLabel: Record<(typeof ROLE_KEYS)[number], string> = {
    sustainability: s.cRoleSustainability,
    procurement: s.cRoleProcurement,
    refinery: s.cRoleRefinery,
    mill: s.cRoleMill,
    consultant: s.cRoleConsultant,
    other: s.cRoleOther,
  };
  const commodityLabel: Record<(typeof COMMODITY_KEYS)[number], string> = {
    palm: s.cCommodityPalm,
    soy: s.cCommoditySoy,
    coffee: s.cCommodityCoffee,
    other: s.cCommodityOther,
  };
  const timelineLabel: Record<(typeof TIMELINE_KEYS)[number], string> = {
    now: s.cTimelineNow,
    "3m": s.cTimeline3m,
    "12m": s.cTimeline12m,
    exploring: s.cTimelineExploring,
  };

  // The same request as an email, for when the form can't reach the server.
  function mailtoHref() {
    const subject = b(form.earlyAccess ? s.cSubjectEarly : s.cSubject);
    const body = [
      `${s.cName}: ${form.name}`,
      `${s.cEmailLabel}: ${form.email}`,
      `${s.cOrg}: ${form.organisation}`,
      form.role ? `${s.cRole}: ${roleLabel[form.role as keyof typeof roleLabel]}` : "",
      form.commodities.length
        ? `${s.cCommodities}: ${form.commodities.map((c) => commodityLabel[c as keyof typeof commodityLabel]).join(", ")}`
        : "",
      form.chainSize ? `${s.cChainSize}: ${form.chainSize === "unsure" ? s.cSizeUnsure : form.chainSize}` : "",
      form.regions ? `${s.cRegions}: ${form.regions}` : "",
      form.timeline ? `${s.cTimeline}: ${timelineLabel[form.timeline as keyof typeof timelineLabel]}` : "",
      form.earlyAccess ? `✓ ${b(s.cEarly)}` : "",
      "",
      form.message,
    ]
      .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
      .join("\n");
    return `mailto:${EARTHLINE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(form.email.trim())) {
      setEmailInvalid(true);
      return;
    }
    setEmailInvalid(false);
    setState("sending");
    try {
      const res = await fetch("/contact-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, product: product ?? "", lang }),
      });
      setState(res.ok ? "sent" : res.status === 429 ? "limited" : "error");
    } catch {
      setState("error");
    }
  }

  const optional = <span className="optional">({s.cOptional})</span>;
  const [noteBefore, noteAfter] = s.cSendNote.split("{email}");

  return (
    <SiteLayout product={product}>
      <article className="page">
        <header className="page-hero">
          <div className="wrap narrow">
            <h1>{s.cTitle}</h1>
            <p className="lead">{b(s.cLead)}</p>
          </div>
        </header>
        <div className="wrap contact-grid">
          {state === "sent" ? (
            <div className="contact-form contact-sent" role="status">
              <h2>{s.cSentTitle}</h2>
              <p>{s.cSentBody.replace("{email}", form.email.trim())}</p>
            </div>
          ) : (
            <form className="contact-form" onSubmit={onSubmit}>
              <label>
                {s.cName}
                <input value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" maxLength={120} required />
              </label>
              <label>
                {s.cEmailLabel}
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="email"
                  maxLength={160}
                  aria-invalid={emailInvalid || undefined}
                  required
                />
                {emailInvalid ? <span className="field-error">{s.cInvalidEmail}</span> : null}
              </label>
              <label>
                {s.cOrg}
                <input
                  value={form.organisation}
                  onChange={(e) => set("organisation", e.target.value)}
                  autoComplete="organization"
                  maxLength={160}
                  required
                />
              </label>
              <label>
                <span>
                  {s.cRole} {optional}
                </span>
                <select value={form.role} onChange={(e) => set("role", e.target.value)}>
                  <option value="">—</option>
                  {ROLE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {roleLabel[k]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="choice-group">
                <legend>
                  {s.cCommodities} {optional}
                </legend>
                {COMMODITY_KEYS.map((k) => (
                  <label key={k} className="chip-check">
                    <input
                      type="checkbox"
                      checked={form.commodities.includes(k)}
                      onChange={(e) =>
                        set("commodities", e.target.checked ? [...form.commodities, k] : form.commodities.filter((c) => c !== k))
                      }
                    />
                    <span>{commodityLabel[k]}</span>
                  </label>
                ))}
              </fieldset>
              <div className="form-row">
                <label>
                  <span>
                    {s.cChainSize} {optional}
                  </span>
                  <select value={form.chainSize} onChange={(e) => set("chainSize", e.target.value)}>
                    <option value="">—</option>
                    {SIZE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k === "unsure" ? s.cSizeUnsure : k}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>
                    {s.cTimeline} {optional}
                  </span>
                  <select value={form.timeline} onChange={(e) => set("timeline", e.target.value)}>
                    <option value="">—</option>
                    {TIMELINE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {timelineLabel[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span>
                  {s.cRegions} {optional}
                </span>
                <input value={form.regions} onChange={(e) => set("regions", e.target.value)} placeholder={s.cRegionsHint} maxLength={300} />
              </label>
              <label>
                <span>
                  {s.cMessage} {optional}
                </span>
                <textarea value={form.message} onChange={(e) => set("message", e.target.value)} rows={5} maxLength={4000} />
              </label>
              {/* Honeypot: off-screen, skipped by keyboard and screen readers. */}
              <label className="hp" aria-hidden="true">
                Website
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={form.earlyAccess} onChange={(e) => set("earlyAccess", e.target.checked)} />
                {b(s.cEarly)}
              </label>
              <label className="check">
                <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} required />
                {s.cConsent}
              </label>
              {state === "error" || state === "limited" ? (
                <div className="form-error" role="alert">
                  <p>{state === "limited" ? s.cRateLimited : s.cSendError}</p>
                  <a className="text-link" href={mailtoHref()}>
                    {s.cSendByEmail} →
                  </a>
                </div>
              ) : null}
              <button type="submit" className="btn-dark lg" disabled={state === "sending"}>
                {state === "sending" ? s.cSending : s.cSend}
              </button>
              <p className="form-note">
                {noteBefore}
                <a href={`mailto:${EARTHLINE.email}`}>{EARTHLINE.email}</a>
                {noteAfter}
              </p>
            </form>
          )}
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
            <a
              className="text-link"
              href={EARTHLINE.mapsHref}
              target="_blank"
              rel="noopener noreferrer"
            >
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
