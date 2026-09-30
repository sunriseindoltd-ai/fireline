import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getGateSession } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";
import { methodCopy } from "@/lib/method-copy";
import { EARTHLINE } from "@/lib/site-copy";
import { SiteLayout } from "@/components/site/site-chrome";
import { HeroMedia } from "@/components/site/hero-media";
import { CompareSlider } from "@/components/site/compare-slider";
import { ProductShowcase } from "@/components/site/product-showcase";

/**
 * Layer 1 — the product's front door (feedback 2, B-04 / Doc 3 §5.1), in
 * the quiet, light register of the references the team rated best. One job
 * per section: promise → proof → problem and a look inside → how it works →
 * what's inside → who it's for → versus the usual way → questions → the
 * rest of Earthline → ask. No portfolio figures and no client names.
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getGateSession();
    return { signedIn: session.ok };
  },
  head: () => ({
    meta: [
      { title: "PalmTrace by Earthline — every plot behind every mill" },
      {
        name: "description",
        content:
          "PalmTrace checks palm supply chains plot by plot against the EUDR cutoff of 31 December 2020, and keeps the evidence in one place your buyers can follow.",
      },
    ],
  }),
  component: Landing,
});

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  files: "M7 3h7l5 5v13H7zM14 3v5h5M4 7v14h11",
  layers: "M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
  doc: "M6 3h9l4 4v14H6zM9 12h7M9 16h5M15 3v4h4",
  satellite: "M4 14l6-6 6 6-6 6zM13 5l3-3 6 6-3 3M10 17l-6 4M16.5 3.5l4 4",
  terrain: "M2 20l6-10 4 6 3-4 7 8zM8 10l1.5-3",
  drone: "M4 6h4M16 6h4M6 6v2M18 6v2M8 10h8l-1 5H9zM12 15v3",
  survey: "M12 3v4M12 3l-6 18M12 3l6 18M8 14h8",
  sensor: "M4 7h16v10H4zM8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0M12 12h.01",
};

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M7 12h10" strokeLinecap="round" />
    </svg>
  );
}

function CopyLinkMock({ label, done }: { label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="url-mock" aria-hidden="true">
      <span className="url-dots">
        <i />
        <i />
        <i />
      </span>
      <code>
        …/app/<b>grup-a</b>/data?mill=<b>pks-012</b>
      </code>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? done : label}
      </button>
    </div>
  );
}

function Landing() {
  const { signedIn } = Route.useLoaderData();
  const { s, lang } = useI18n();
  const m = methodCopy[lang];
  const primary = signedIn ? (
    <Link to="/app/portfolio" className="btn-dark lg">
      {s.openWorkspace}
    </Link>
  ) : (
    <Link to="/contact" search={{ early: true }} className="btn-dark lg">
      {s.requestAccess}
    </Link>
  );

  const faqs = [
    [s.q1, s.a1],
    [s.q2, s.a2],
    [s.q3, s.a3],
    [s.q4, s.a4],
    [s.q5, s.a5],
    [s.q6, s.a6],
  ];

  return (
    <SiteLayout signedIn={signedIn}>
      <section className="hero">
        <div className="wrap hero-copy">
          <p className="hero-eyebrow">{s.heroEyebrow}</p>
          <h1>{s.heroTitle}</h1>
          <p className="hero-sub">{s.heroSub}</p>
          <div className="cta-row">
            {primary}
            <a href="#how" className="btn-link">
              {s.heroSecondary} <span aria-hidden="true">›</span>
            </a>
          </div>
        </div>
        <HeroMedia />
      </section>

      <section className="proof" aria-label={s.proof1}>
        <div className="wrap proof-grid">
          {[
            [s.proof1, s.proof1b],
            [s.proof2, s.proof2b],
            [s.proof3, s.proof3b],
            [s.proof4, s.proof4b],
          ].map(([title, body]) => (
            <div key={title}>
              <b>{title}</b>
              <span>{body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <header className="section-head left">
            <p className="section-eyebrow">{s.problemEyebrow}</p>
            <h2>{s.problemTitle}</h2>
          </header>
          <div className="three">
            {[
              [s.problem1Title, s.problem1Body, ICONS.files],
              [s.problem2Title, s.problem2Body, ICONS.layers],
              [s.problem3Title, s.problem3Body, ICONS.doc],
            ].map(([title, body, icon]) => (
              <article key={title} className="plain">
                <span className="plain-icon">
                  <Icon d={icon!} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>

          <header className="section-head showcase-head">
            <p className="section-eyebrow">{s.showcaseEyebrow}</p>
            <h2>{s.showcaseTitle}</h2>
          </header>
          <ProductShowcase />
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{s.howEyebrow}</p>
            <h2>{s.howTitle}</h2>
          </header>
          <ol className="steps">
            {[
              [s.how1Title, s.how1Body],
              [s.how2Title, s.how2Body],
              [s.how3Title, s.how3Body],
            ].map(([title, body], i) => (
              <li key={title}>
                <span className="step-num">{i + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="product">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{s.featuresEyebrow}</p>
            <h2>{s.featuresTitle}</h2>
          </header>
          <div className="bento">
            <article className="tile tile-map">
              <div className="tile-copy">
                <h3>{s.f1Title}</h3>
                <p>{s.f1Body}</p>
              </div>
              <div className="tile-visual map-visual" aria-hidden="true">
                <img src="/img/field-2020.jpg" alt="" loading="lazy" decoding="async" />
                <span className="vis-chip">
                  <i className="dot ok" /> {s.shotVerdictValue}
                </span>
              </div>
            </article>
            <article className="tile tile-cats">
              <div className="tile-copy">
                <h3>{s.f2Title}</h3>
                <p>{s.f2Body}</p>
              </div>
              <ul className="cat-mini">
                {m.classes.table.rows.map((row) => (
                  <li key={row[0]}>
                    <span className={`cat-letter cat-${row[0]!.toLowerCase()}`}>{row[0]}</span>
                    <span>
                      <b>{row[1]}</b>
                      <small>{row[2]}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="tile tile-compare">
              <div className="tile-copy">
                <h3>{s.f3Title}</h3>
                <p>{s.f3Body}</p>
              </div>
              <CompareSlider
                before="/img/field-2020.jpg"
                after="/img/field-2026.jpg"
                beforeLabel={s.compareBefore}
                afterLabel={s.compareAfter}
                label={s.compareLabel}
              />
            </article>
            <article className="tile tile-layers">
              <div className="tile-copy">
                <h3>{s.f4Title}</h3>
                <p>{s.f4Body}</p>
              </div>
              <ul className="layers-mini" aria-hidden="true">
                <li>
                  <i className="sw jrc" /> JRC GFC 2020
                </li>
                <li>
                  <i className="sw klhk" /> KLHK · HL · HP · HPT · HPK
                </li>
                <li>
                  <i className="sw verdict" /> Earthline
                </li>
              </ul>
            </article>
            <article className="tile">
              <div className="tile-copy">
                <h3>{s.f5Title}</h3>
                <p>{s.f5Body}</p>
              </div>
              <ul className="access-mock" aria-hidden="true">
                {[
                  [s.acc1, s.acc1b, "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"],
                  [s.acc2, s.acc2b, "M4 7h16v13H4zM9 7V4h6v3"],
                  [s.acc3, s.acc3b, "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"],
                ].map(([who, scope, icon]) => (
                  <li key={who}>
                    <span className="acc-icon">
                      <Icon d={icon!} size={16} />
                    </span>
                    <b>{who}</b>
                    <span className="acc-scope">{scope}</span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="tile">
              <div className="tile-copy">
                <h3>{s.f6Title}</h3>
                <p>{s.f6Body}</p>
              </div>
              <CopyLinkMock label={s.copyLink} done={s.copied} />
            </article>
            <article className="tile">
              <div className="tile-copy">
                <h3>{s.f7Title}</h3>
                <p>{s.f7Body}</p>
              </div>
              <div className="file-mock" aria-hidden="true">
                <span className="file-icon">
                  <Icon d={ICONS.doc} size={18} />
                </span>
                <span className="file-name">
                  <b>plots.geojson</b>
                  <small>
                    {s.f7Chip1} · {s.f7Chip2} · {s.f7Chip3}
                  </small>
                </span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{s.whoEyebrow}</p>
            <h2>{s.whoTitle}</h2>
          </header>
          <div className="three cards">
            <article className="card">
              <div className="who-preview" aria-hidden="true">
                <div className="mini-stack">
                  {[
                    ["a", 46],
                    ["b", 22],
                    ["c", 9],
                    ["d", 6],
                    ["e", 11],
                    ["f", 6],
                  ].map(([k, w]) => (
                    <i key={k} className={`cat-${k}`} style={{ width: `${w}%` }} />
                  ))}
                </div>
                <div className="mini-legend">
                  {["A", "B", "C", "D", "E", "F"].map((l) => (
                    <span key={l}>
                      <i className={`cat-${l.toLowerCase()}`} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <h3>{s.who1Title}</h3>
              <p>{s.who1Body}</p>
            </article>
            <article className="card">
              <div className="who-preview" aria-hidden="true">
                {[
                  ["A", 100, "ready"],
                  ["B", 64, "partial"],
                  ["C", 0, "master"],
                ].map(([g, w, st]) => (
                  <div key={g} className="mini-row">
                    <span>
                      {s.prevGroup} {g}
                    </span>
                    <span className="mini-bar">
                      <i style={{ width: `${w}%` }} />
                    </span>
                    <span className={`status-pill ${st}`}>{st === "ready" ? "✓" : `${w}%`}</span>
                  </div>
                ))}
              </div>
              <h3>{s.who2Title}</h3>
              <p>{s.who2Body}</p>
            </article>
            <article className="card">
              <div className="who-preview" aria-hidden="true">
                {[
                  ["0012", "ok"],
                  ["0013", "ok"],
                  ["0014", "bad"],
                ].map(([id, st]) => (
                  <div key={id} className="mini-row">
                    <span className="mono">
                      {s.prevPlot} {id}
                    </span>
                    <span className={`chip ${st}`}>{st === "ok" ? "✓" : "✕"}</span>
                  </div>
                ))}
              </div>
              <h3>{s.who3Title}</h3>
              <p>{s.who3Body}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap narrow">
          <header className="section-head">
            <p className="section-eyebrow">{s.compareEyebrow}</p>
            <h2>{s.compareTitle}</h2>
          </header>
          <div className="compare" role="table">
            <div className="compare-row head" role="row">
              <span role="columnheader">{s.compareColOld}</span>
              <span role="columnheader">{s.compareColNew}</span>
            </div>
            {[
              [s.cmp1Old, s.cmp1New],
              [s.cmp2Old, s.cmp2New],
              [s.cmp3Old, s.cmp3New],
              [s.cmp4Old, s.cmp4New],
            ].map(([oldV, newV]) => (
              <div className="compare-row" role="row" key={newV}>
                <span role="cell" className="old">
                  <Dash /> {oldV}
                </span>
                <span role="cell" className="new">
                  <Check /> {newV}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap narrow">
          <header className="section-head">
            <p className="section-eyebrow">{s.faqEyebrow}</p>
            <h2>{s.faqTitle}</h2>
          </header>
          <div className="faq">
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section more">
        <div className="wrap">
          <header className="section-head left">
            <p className="section-eyebrow">{s.moreEyebrow}</p>
            <h2>{s.moreTitle}</h2>
            <p className="more-body">{s.moreBody}</p>
          </header>
          <ul className="more-grid">
            {[
              [s.p1Title, s.p1Body, ICONS.satellite],
              [s.p2Title, s.p2Body, ICONS.terrain],
              [s.p3Title, s.p3Body, ICONS.drone],
              [s.p4Title, s.p4Body, ICONS.survey],
              [s.p5Title, s.p5Body, ICONS.sensor],
            ].map(([title, body, icon]) => (
              <li key={title}>
                <span className="more-icon">
                  <Icon d={icon!} />
                </span>
                <b>{title}</b>
                <span>{body}</span>
              </li>
            ))}
          </ul>
          <a className="btn-link" href={EARTHLINE.site} rel="noopener">
            {s.moreLink} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <section className="section close alt">
        <div className="wrap narrow">
          <h2>{s.closeTitle}</h2>
          <p>{s.closeBody}</p>
          <div className="cta-row center">
            {primary}
            <Link to="/contact" className="btn-link">
              {s.closeSecondary} <span aria-hidden="true">›</span>
            </Link>
          </div>
          <p className="soon">{s.soon}</p>
        </div>
      </section>
    </SiteLayout>
  );
}
