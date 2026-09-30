import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LangToggle } from "@/components/lang-toggle";
import { formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AccessRequest, AccessRequestStatus } from "@/lib/access-requests.server";

type Filter = "all" | AccessRequestStatus;

/**
 * Admin-only inbox for the public contact form (feedback 3, A-15): who asked,
 * for which commodity and chain, and whether Earthline has replied. Status is
 * the only thing that can be changed here; replying happens by email.
 */
export function AccessRequestsPage() {
  const { t, s, lang } = useI18n();
  const [rows, setRows] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("new");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void fetch("/access-requests")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { requests: AccessRequest[] };
        if (!cancelled) setRows(body.requests);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  async function setStatus(id: string, status: AccessRequestStatus) {
    setRows((r) => r?.map((x) => (x.id === id ? { ...x, status } : x)) ?? r);
    const res = await fetch("/access-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => null);
    if (!res?.ok) setNonce((n) => n + 1); // put the stored state back
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, new: 0, contacted: 0, closed: 0 };
    for (const r of rows ?? []) {
      c.all++;
      c[r.status]++;
    }
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);

  const statusLabel: Record<AccessRequestStatus, string> = {
    new: t.requestsNew,
    contacted: t.requestsContacted,
    closed: t.requestsClosed,
  };
  const roleLabel: Record<string, string> = {
    sustainability: s.cRoleSustainability,
    procurement: s.cRoleProcurement,
    refinery: s.cRoleRefinery,
    mill: s.cRoleMill,
    consultant: s.cRoleConsultant,
    other: s.cRoleOther,
  };
  const commodityLabel: Record<string, string> = {
    palm: s.cCommodityPalm,
    soy: s.cCommoditySoy,
    coffee: s.cCommodityCoffee,
    other: s.cCommodityOther,
  };
  const timelineLabel: Record<string, string> = {
    now: s.cTimelineNow,
    "3m": s.cTimeline3m,
    "12m": s.cTimeline12m,
    exploring: s.cTimelineExploring,
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="app requests-app">
      <header className="app-header">
        <Link to="/app/portfolio" className="app-brand">
          <BrandMark size={22} />
          <span className="word">Earthline Trace</span>
        </Link>
        <div className="app-actions">
          <Link to="/app/portfolio" className="btn-text">
            ← {t.requestsBack}
          </Link>
          <LangToggle />
        </div>
      </header>
      <main className="app-main">
        <div className="page requests-page">
          <header className="requests-head">
            <h1>{t.requestsTitle}</h1>
            <p className="chart-note">{t.requestsIntro}</p>
            <div className="seg" role="group" aria-label={t.requestsTitle}>
              {(["new", "contacted", "closed", "all"] as const).map((k) => (
                <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {k === "all" ? t.requestsAll : statusLabel[k]} <span className="tabular-nums">{formatCount(counts[k], lang)}</span>
                </button>
              ))}
            </div>
          </header>
          {error ? (
            <div className="eudr-notice danger" role="alert">
              <p>{t.requestsError}</p>
              <button type="button" className="eudr-notice-action" onClick={() => setNonce((n) => n + 1)}>
                {t.retry}
              </button>
            </div>
          ) : rows == null ? (
            <div className="eudr-loading" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
            </div>
          ) : shown.length === 0 ? (
            <p className="chart-note">{t.requestsEmpty}</p>
          ) : (
            <ul className="request-list">
              {shown.map((r) => {
                const facts: [string, string][] = [
                  [s.cRole, roleLabel[r.role] ?? ""],
                  [s.cCommodities, r.commodities.map((c) => commodityLabel[c] ?? c).join(", ")],
                  [s.cChainSize, r.chainSize === "unsure" ? s.cSizeUnsure : r.chainSize],
                  [s.cTimeline, timelineLabel[r.timeline] ?? ""],
                  [s.cRegions, r.regions],
                ];
                return (
                  <li key={r.id} className={`request-card ${r.status}`}>
                    <div className="request-top">
                      <div>
                        <h2>
                          {r.name} <span>· {r.organisation}</span>
                        </h2>
                        <p className="request-meta">
                          <a href={`mailto:${r.email}`}>{r.email}</a> · {when(r.receivedAt)}
                          {r.product ? ` · ${r.product === "soy" ? "SoyTrace" : "PalmTrace"}` : ""}
                          {r.earlyAccess ? <span className="status-pill ready">{t.requestsEarly}</span> : null}
                        </p>
                      </div>
                      <label className="request-status">
                        <span className="sr-only">{t.requestsStatus}</span>
                        <select value={r.status} onChange={(e) => void setStatus(r.id, e.target.value as AccessRequestStatus)}>
                          {(["new", "contacted", "closed"] as const).map((k) => (
                            <option key={k} value={k}>
                              {statusLabel[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <dl className="request-facts">
                      {facts
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                    </dl>
                    {r.message ? <p className="request-message">{r.message}</p> : null}
                    <a className="btn-secondary request-reply" href={`mailto:${r.email}?subject=${encodeURIComponent(`Earthline Trace — ${r.organisation}`)}`}>
                      {t.requestsReply}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
