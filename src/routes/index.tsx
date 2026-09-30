import { Link, createFileRoute } from "@tanstack/react-router";
import { ogMeta } from "@/lib/og";
import { BrandMark } from "@/components/brand-mark";
import { SiteLayout } from "@/components/site/site-chrome";
import { brandCopy } from "@/lib/brand-copy";
import { COMING_SOON, PRODUCTS } from "@/lib/brand";
import { fill } from "@/lib/format";
import { getGateSession } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";

/**
 * The Earthline Trace umbrella page: what the platform is, one card per
 * commodity product (PalmTrace, SoyTrace; CoffeeTrace listed as coming soon),
 * what Earthline does across them and how a workspace is set up. Each
 * product's own landing (/palm, /soy) carries the detail. No client names.
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getGateSession();
    return { signedIn: session.ok };
  },
  head: () => ({
    meta: [
      { title: brandCopy.en.uTitleMeta },
      { name: "description", content: brandCopy.en.uDescMeta },
      ...ogMeta({
        title: brandCopy.en.uTitleMeta,
        description: brandCopy.en.uDescMeta,
        path: "/",
        image: "trace",
      }),
    ],
  }),
  component: UmbrellaHome,
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
  shield: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  satellite: "M4 14l6-6 6 6-6 6zM13 5l3-3 6 6-3 3M10 17l-6 4M16.5 3.5l4 4",
  layers: "M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
};

function UmbrellaHome() {
  const { signedIn } = Route.useLoaderData();
  const { s, lang } = useI18n();
  const b = brandCopy[lang];
  const products = [
    {
      ...PRODUCTS.palm,
      tag: b.palmTag,
      body: b.palmBody,
      img: "/img/palm-card-900.jpg",
      alt: b.palmCardAlt,
      shotAlt: b.palmShotAlt,
    },
    {
      ...PRODUCTS.soy,
      tag: b.soyTag,
      body: b.soyBody,
      img: "/img/soy/elevator-900.jpg",
      alt: b.soyCardAlt,
      shotAlt: b.soyShotAlt,
    },
  ];

  return (
    <SiteLayout signedIn={signedIn}>
      <section className="hero">
        <div className="wrap hero-copy">
          <p className="hero-eyebrow">{b.uEyebrow}</p>
          <h1>{b.uTitle}</h1>
          <p className="hero-sub">{b.uSub}</p>
          <div className="cta-row">
            {signedIn ? (
              <Link to="/app/portfolio" className="btn-dark lg">
                {s.openWorkspace}
              </Link>
            ) : (
              <a href="#products" className="btn-dark lg">
                {b.uPrimary}
              </a>
            )}
            <Link to="/contact" className="btn-link">
              {b.uSecondary} <span aria-hidden="true">›</span>
            </Link>
          </div>
        </div>
        {/* The products themselves, one click from the first screen
            (feedback 3, A-07) — sample-data stills, as on /palm and /soy. */}
        <figure className="umbrella-shots">
          <div className="umbrella-shots-row">
            {products.map((p) => (
              <Link key={p.id} to={p.path} className="umbrella-shot" data-product={p.id}>
                <img
                  src={`/img/hero/${p.id}-${lang}.jpg`}
                  alt={p.shotAlt}
                  width={1280}
                  height={800}
                  fetchPriority="high"
                  decoding="async"
                />
                <span className="umbrella-shot-chip">
                  <BrandMark product={p.id} size={16} />
                  {p.name}
                  <span aria-hidden="true">›</span>
                </span>
              </Link>
            ))}
          </div>
          <figcaption>{b.heroShotsNote}</figcaption>
        </figure>
      </section>

      <section className="section" id="products">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{b.productsEyebrow}</p>
            <h2>{b.productsTitle}</h2>
          </header>
          <ul className="product-cards">
            {products.map((p) => (
              <li key={p.id}>
                <Link to={p.path} className="product-card" data-product={p.id}>
                  <img
                    className="product-card-media"
                    src={p.img}
                    alt={p.alt}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="product-card-status live">{b.live}</span>
                  <h3>{p.name}</h3>
                  <p className="product-card-tag">{p.tag}</p>
                  <p>{p.body}</p>
                  <span className="product-card-link">
                    {fill(b.openProduct, { name: p.name })} <span aria-hidden="true">›</span>
                  </span>
                </Link>
              </li>
            ))}
            {COMING_SOON.map((name) => (
              <li key={name}>
                <div className="product-card soon" aria-disabled="true">
                  <span className="product-card-media placeholder" aria-hidden="true" />
                  <span className="product-card-status">{b.soon}</span>
                  <h3>{name}</h3>
                  <p className="product-card-tag">{b.coffeeTag}</p>
                  <p>{b.coffeeBody}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <header className="section-head left">
            <p className="section-eyebrow">{b.servicesEyebrow}</p>
            <h2>{b.servicesTitle}</h2>
          </header>
          <div className="four">
            {[
              [b.sv1Title, b.sv1Body, ICONS.shield],
              [b.sv2Title, b.sv2Body, ICONS.target],
              [b.sv3Title, b.sv3Body, ICONS.satellite],
              [b.sv4Title, b.sv4Body, ICONS.layers],
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
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <header className="section-head">
            <p className="section-eyebrow">{b.howEyebrow}</p>
            <h2>{b.howTitle}</h2>
          </header>
          <ol className="steps">
            {[
              [b.how1Title, b.how1Body],
              [b.how2Title, b.how2Body],
              [b.how3Title, b.how3Body],
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

      <section className="section close alt">
        <div className="wrap narrow">
          <h2>{b.closeTitle}</h2>
          <p>{b.closeBody}</p>
          <div className="cta-row center">
            <Link to="/contact" search={{ early: true }} className="btn-dark lg">
              {s.requestAccess}
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
