import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/site-chrome";
import { useI18n } from "@/lib/i18n";
import { EARTHLINE } from "@/lib/site-copy";

/**
 * Why the product exists, who runs it, how access works — plus one
 * paragraph on the firm and a link home to earthline.info (feedback 2,
 * Doc 3 §5.3). Not a copy of the firm's own about page.
 */
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About · PalmTrace by Earthline" },
      {
        name: "description",
        content: "Why Earthline built PalmTrace, who operates it, and how access to the workspace is granted.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { s } = useI18n();
  return (
    <SiteLayout product="palm">
      <article className="page">
        <header className="page-hero">
          <div className="wrap narrow">
            <h1>{s.aTitle}</h1>
            <p className="lead">{s.aLead}</p>
          </div>
        </header>
        <div className="wrap narrow prose">
          <section>
            <h2>{s.aWhyTitle}</h2>
            <p>{s.aWhyBody}</p>
          </section>
          <section>
            <h2>{s.aWhoTitle}</h2>
            <p>{s.aWhoBody}</p>
          </section>
          <section>
            <h2>{s.aAccessTitle}</h2>
            <p>{s.aAccessBody}</p>
          </section>
          <section className="callout">
            <h2>{s.aFirmTitle}</h2>
            <p>{s.aFirmBody}</p>
            <a className="text-link" href={EARTHLINE.site} rel="noopener">
              {s.aFirmLink} →
            </a>
          </section>
        </div>
      </article>
    </SiteLayout>
  );
}
