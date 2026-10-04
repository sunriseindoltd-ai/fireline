import { createFileRoute } from "@tanstack/react-router";
import { ogMeta } from "@/lib/og";
import { SiteLayout } from "@/components/site/site-chrome";
import { isProductId, type ProductId } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { aboutCopy } from "@/lib/product-pages-copy";
import { EARTHLINE } from "@/lib/site-copy";

type AboutSearch = { product?: ProductId };

/**
 * Why the product exists, who runs it, how access works — plus one
 * paragraph on the firm and a link home to earthline.info (feedback 2,
 * Doc 3 §5.3). Not a copy of the firm's own about page. Follows the product
 * the visitor came from (?product=palm|soy); without one it is the Earthline
 * Trace page. PalmTrace's copy lives in site-copy.ts, the others in
 * product-pages-copy.ts.
 */
export const Route = createFileRoute("/about")({
  validateSearch: (search: Record<string, unknown>): AboutSearch => ({
    product: isProductId(search.product) ? search.product : undefined,
  }),
  head: () => ({
    meta: [
      { title: "About · Earthline Trace" },
      {
        name: "description",
        content: "Why Earthline built PalmTrace and SoyTrace, who operates them, and how access to a workspace is granted.",
      },
      ...ogMeta({
        title: "About · Earthline Trace",
        description: "Why Earthline built PalmTrace and SoyTrace, who operates them, and how access to a workspace is granted.",
        path: "/about",
        image: "trace",
      }),
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { s, lang } = useI18n();
  const { product } = Route.useSearch();
  const page =
    product === "palm"
      ? {
          title: s.aTitle,
          lead: s.aLead,
          sections: [
            { title: s.aWhyTitle, body: s.aWhyBody },
            { title: s.aWhoTitle, body: s.aWhoBody },
            { title: s.aAccessTitle, body: s.aAccessBody },
          ],
        }
      : aboutCopy[product === "soy" ? "soy" : "umbrella"][lang];
  return (
    <SiteLayout product={product}>
      <article className="page">
        <header className="page-hero">
          <div className="wrap narrow">
            <h1>{page.title}</h1>
            <p className="lead">{page.lead}</p>
          </div>
        </header>
        <div className="wrap narrow prose">
          {page.sections.map((x) => (
            <section key={x.title}>
              <h2>{x.title}</h2>
              <p>{x.body}</p>
            </section>
          ))}
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
