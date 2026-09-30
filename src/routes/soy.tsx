import { Link, createFileRoute } from "@tanstack/react-router";
import { ogMeta } from "@/lib/og";
import { SiteLayout } from "@/components/site/site-chrome";
import { ProductShowcase } from "@/components/site/product-showcase";
import { brandCopy } from "@/lib/brand-copy";
import { getGateSession } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";

/**
 * SoyTrace's landing (Earthline Trace product for soybeans): crushing plants,
 * their sourcing areas and the soybean fields inside. It promises what the
 * workspace shows today — statistics and maps — not an EUDR analysis it
 * doesn't run yet. No client names.
 */
export const Route = createFileRoute("/soy")({
  loader: async () => {
    const session = await getGateSession();
    return { signedIn: session.ok };
  },
  head: () => ({
    meta: [
      { title: brandCopy.en.sTitleMeta },
      { name: "description", content: brandCopy.en.sDescMeta },
      ...ogMeta({
        title: brandCopy.en.sTitleMeta,
        description: brandCopy.en.sDescMeta,
        path: "/soy",
        image: "soy",
      }),
    ],
  }),
  component: SoyLanding,
});

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
};

function SoyLanding() {
  const { signedIn } = Route.useLoaderData();
  const { s, lang } = useI18n();
  const b = brandCopy[lang];
  const primary = signedIn ? (
    <Link to="/app/portfolio" className="btn-dark lg">
      {s.openWorkspace}
    </Link>
  ) : (
    <Link to="/contact" search={{ early: true, product: "soy" }} className="btn-dark lg">
      {s.requestAccess}
    </Link>
  );

  return (
    <SiteLayout signedIn={signedIn} product="soy">
      <section className="hero">
        <div className="wrap hero-copy">
          <p className="hero-eyebrow">{b.sEyebrow}</p>
          <h1>{b.sTitle}</h1>
          <p className="hero-sub">{b.sSub}</p>
          <div className="cta-row">
            {primary}
            <a href="#features" className="btn-link">
              {b.sSecondary} <span aria-hidden="true">›</span>
            </a>
          </div>
        </div>
      </section>

      <section className="proof" aria-label={b.sProof1}>
        <div className="wrap proof-grid">
          {[
            [b.sProof1, b.sProof1b],
            [b.sProof2, b.sProof2b],
            [b.sProof3, b.sProof3b],
            [b.sProof4, b.sProof4b],
          ].map(([title, body]) => (
            <div key={title}>
              <b>{title}</b>
              <span>{body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <div className="wrap">
          <header className="section-head left">
            <p className="section-eyebrow">{b.sFeatEyebrow}</p>
            <h2>{b.sFeatTitle}</h2>
          </header>
          <div className="three">
            {[
              [b.sf1Title, b.sf1Body, ICONS.map],
              [b.sf2Title, b.sf2Body, ICONS.history],
              [b.sf3Title, b.sf3Body, ICONS.chart],
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
            <p className="section-eyebrow">{b.sShowEyebrow}</p>
            <h2>{b.sShowTitle}</h2>
          </header>
          <ProductShowcase
            dir="/img/soy/showcase"
            note={b.sShowNote}
            slides={[
              { key: "areas", title: b.sShow1Title, body: b.sShow1Body },
              { key: "fields", title: b.sShow2Title, body: b.sShow2Body },
              { key: "stats", title: b.sShow3Title, body: b.sShow3Body },
              { key: "context", title: b.sShow4Title, body: b.sShow4Body },
            ]}
          />

          <div className="split">
            <figure className="split-media">
              <img
                src="/img/soy/context-map-1600.jpg"
                srcSet="/img/soy/context-map-900.jpg 900w, /img/soy/context-map-1600.jpg 1600w"
                sizes="(max-width: 860px) 100vw, 640px"
                alt={b.sSplitAlt}
                width={1600}
                height={1067}
                loading="lazy"
                decoding="async"
              />
              <figcaption>{b.sSplitCaption}</figcaption>
            </figure>
            <div className="split-copy">
              <p className="section-eyebrow">{b.sSplitEyebrow}</p>
              <h2>{b.sSplitTitle}</h2>
              <p>{b.sSplitBody}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{b.sHowEyebrow}</p>
            <h2>{b.sHowTitle}</h2>
          </header>
          <ol className="steps">
            {[
              [b.sh1Title, b.sh1Body],
              [b.sh2Title, b.sh2Body],
              [b.sh3Title, b.sh3Body],
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

      {/* Stock photograph (Pixabay licence) as a quiet background for the ask. */}
      <section className="section close close-photo" data-bg="harvest">
        <div className="wrap narrow">
          <h2>{b.sCloseTitle}</h2>
          <p>{b.sCloseBody}</p>
          <div className="cta-row center">
            {primary}
            <Link to="/contact" search={{ product: "soy" }} className="btn-link">
              {s.closeSecondary} <span aria-hidden="true">›</span>
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
