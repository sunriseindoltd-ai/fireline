import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/site-chrome";
import { JRC_LAYER } from "@/lib/data-meta";
import { useI18n } from "@/lib/i18n";
import { methodCopy } from "@/lib/method-copy";

/**
 * Public methodology (feedback 2, Doc 3 §5.2) — rewritten from Earthline's
 * documented EUDR procedure (see method-copy.ts for what was left out and
 * why). Calm, technical, quotable by a buyer; no client data.
 */
export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [
      { title: "Methodology · PalmTrace by Earthline" },
      {
        name: "description",
        content:
          "How Earthline tests palm supply chains for EUDR: a binary plot verdict (deforestation-free and legal), village risk, mitigation categories A–F, baselines, alert validation and geometry rules.",
      },
    ],
  }),
  component: MethodPage,
});

function DataTable({ head, rows, first }: { head: string[]; rows: string[][]; first?: "cat" }) {
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
              {r.map((c, i) =>
                i === 0 && first === "cat" ? (
                  <td key={i}>
                    <span className={`cat-letter cat-${c.toLowerCase()}`}>{c}</span>
                  </td>
                ) : (
                  <td key={i}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodPage() {
  const { lang } = useI18n();
  const m = methodCopy[lang];
  const toc: [string, string][] = [
    ["role", m.role.title],
    ["verdict", m.verdict.title],
    ["risk", m.risk.title],
    ["classes", m.classes.title],
    ["baseline", m.baseline.title],
    ["alerts", m.alerts.title],
    ["spatial", m.spatial.title],
    ["geometry", m.geometry.title],
    ["qa", m.qa.title],
    ["delivery", m.delivery.title],
    ["monitoring", m.monitoring.title],
    ["palmtrace", m.palmtrace.title],
    ["not", m.not.title],
  ];
  return (
    <SiteLayout>
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

          <section id="verdict">
            <h2>{m.verdict.title}</h2>
            <p>{m.verdict.body}</p>
            <div className="tests">
              {m.verdict.tests.map((test) => (
                <div key={test.name} className="test-card">
                  <h3>{test.name}</h3>
                  <p>{test.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="risk">
            <h2>{m.risk.title}</h2>
            <p>{m.risk.body}</p>
            <ul className="chips-list">
              {m.risk.variables.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <p className="small">{m.risk.note}</p>
          </section>

          <section id="classes">
            <h2>{m.classes.title}</h2>
            <p>{m.classes.body}</p>
            <DataTable head={m.classes.table.head} rows={m.classes.table.rows} first="cat" />
            <p className="small">{m.classes.note}</p>
          </section>

          <section id="baseline">
            <h2>{m.baseline.title}</h2>
            <p>{m.baseline.body}</p>
            <DataTable head={m.baseline.table.head} rows={m.baseline.table.rows} />
          </section>

          <section id="alerts">
            <h2>{m.alerts.title}</h2>
            <p>{m.alerts.body}</p>
            <DataTable head={m.alerts.table.head} rows={m.alerts.table.rows} />
            <ul>
              {m.alerts.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section id="spatial">
            <h2>{m.spatial.title}</h2>
            <p>{m.spatial.body}</p>
            <DataTable head={m.spatial.table.head} rows={m.spatial.table.rows} />
          </section>

          <section id="geometry">
            <h2>{m.geometry.title}</h2>
            <ul>
              {m.geometry.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section id="qa">
            <h2>{m.qa.title}</h2>
            <DataTable head={m.qa.table.head} rows={m.qa.table.rows} />
          </section>

          <section id="delivery">
            <h2>{m.delivery.title}</h2>
            <p>{m.delivery.body}</p>
            <ul>
              {m.delivery.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section id="monitoring">
            <h2>{m.monitoring.title}</h2>
            <p>{m.monitoring.body}</p>
            <ul>
              {m.monitoring.triggers.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section id="palmtrace">
            <h2>{m.palmtrace.title}</h2>
            <p>{m.palmtrace.body.replace("{version}", JRC_LAYER.version)}</p>
          </section>

          <section id="not" className="callout">
            <h2>{m.not.title}</h2>
            <ul>
              {m.not.items.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <p className="source-note">{m.legal}</p>
        </div>
      </article>
    </SiteLayout>
  );
}
