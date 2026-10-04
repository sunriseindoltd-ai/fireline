import { createFileRoute } from "@tanstack/react-router";
import { ogMeta } from "@/lib/og";
import { SiteLayout } from "@/components/site/site-chrome";
import { useI18n } from "@/lib/i18n";
import { soyMethodCopy } from "@/lib/product-pages-copy";

/**
 * Public SoyTrace methodology (/soy/method) — the counterpart of PalmTrace's
 * /method: sources, catchments, fields, the client's compliance
 * classification, rail and river, units, what it does not do. No client
 * names or figures.
 */
const META = soyMethodCopy.en;

export const Route = createFileRoute("/soy_/method")({
  head: () => ({
    meta: [
      { title: META.metaTitle },
      { name: "description", content: META.metaDescription },
      ...ogMeta({ title: META.metaTitle, description: META.metaDescription, path: "/soy/method", image: "soy" }),
    ],
  }),
  component: SoyMethodPage,
});

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="m-table-wrap">
      <table className="m-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.join("|")}>
              {r.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rules({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

function SoyMethodPage() {
  const { lang } = useI18n();
  const m = soyMethodCopy[lang];
  const toc: [string, string][] = [
    ["role", m.role.title],
    ["sources", m.sources.title],
    ["catchments", m.catchments.title],
    ["fields", m.fields.title],
    ["compliance", m.compliance.title],
    ["transport", m.transport.title],
    ["units", m.units.title],
    ["privacy", m.privacy.title],
    ["not", m.not.title],
  ];
  return (
    <SiteLayout product="soy">
      <article className="page">
        <header className="page-hero">
          <div className="wrap narrow">
            <h1>{m.title}</h1>
            <p className="lead">{m.lead}</p>
          </div>
        </header>
        <div className="wrap narrow prose">
          <nav className="toc" aria-label={m.onThisPage}>
            <p className="toc-title">{m.onThisPage}</p>
            <ol>
              {toc.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <section id="role">
            <h2>{m.role.title}</h2>
            <p>{m.role.body}</p>
          </section>

          <section id="sources">
            <h2>{m.sources.title}</h2>
            <p>{m.sources.body}</p>
            <DataTable head={m.sources.table.head} rows={m.sources.table.rows} />
          </section>

          <section id="catchments">
            <h2>{m.catchments.title}</h2>
            <p>{m.catchments.body}</p>
            <Rules items={m.catchments.rules} />
          </section>

          <section id="fields">
            <h2>{m.fields.title}</h2>
            <p>{m.fields.body}</p>
            <Rules items={m.fields.rules} />
          </section>

          <section id="compliance">
            <h2>{m.compliance.title}</h2>
            <p>{m.compliance.body}</p>
            <Rules items={m.compliance.rules} />
          </section>

          <section id="transport">
            <h2>{m.transport.title}</h2>
            <p>{m.transport.body}</p>
            <Rules items={m.transport.rules} />
          </section>

          <section id="units">
            <h2>{m.units.title}</h2>
            <DataTable head={m.units.table.head} rows={m.units.table.rows} />
          </section>

          <section id="privacy">
            <h2>{m.privacy.title}</h2>
            <p>{m.privacy.body}</p>
          </section>

          <section id="not" className="callout">
            <h2>{m.not.title}</h2>
            <Rules items={m.not.items} />
          </section>
        </div>
      </article>
    </SiteLayout>
  );
}
