import { useEffect, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Carousel } from "@/components/carousel";
import { KpiTile } from "@/components/kpi-tile";
import { DATA_AS_OF } from "@/lib/data-meta";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { fill, formatCount, formatDate, formatHa, formatPct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EudrSummaryResult } from "@/lib/eudr-aggregates.server";
import type { PlotComplyFilter } from "@/lib/app-search";
import { mitigationText } from "@/lib/ledger-geo";

type Props = {
  /** Each mill's own `id` (umlId__group__refinery), not the bare UML ID —
   * the same physical mill can supply more than one chain with a genuinely
   * different plot set for each. */
  millIds: string[];
  /** Every mill in the view, including ones with no UML ID — what coverage
   * ("{covered} of {total}") is measured against. Defaults to millIds. */
  totalMills?: number;
  /** "chain": the Summary tab. "mill": the sidebar card for one mill. */
  variant: "chain" | "mill";
  /** "grid" (default): the full 2-column chart-grid used by the chain-wide
   * Summary tab. "carousel": one slide at a time with dot/arrow nav — used
   * by the sidebar's fixed-height per-mill summary so it never needs to
   * scroll internally. */
  layout?: "grid" | "carousel" | "compact";
  /** Present mode: drop the coverage notice (the figures still say how many
   * mills they cover). */
  hideCoverageNotice?: boolean;
  onOpenMap?: () => void;
  /** Mill id → display name, for the compliance list. */
  millNames?: Map<string, string>;
  /** Opens a mill's plots filtered to compliant or non-compliant ones. */
  onOpenPlots?: (millId: string, plots: PlotComplyFilter) => void;
};

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 1 21h22L12 3z" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.51" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="7.5" x2="12" y2="7.51" />
    </svg>
  );
}

const RISK_COLORS = ["var(--color-risk-low)", "var(--color-risk-medium)", "var(--color-risk-high)"];
const COMPLY_COLORS = ["var(--color-comply)", "var(--color-noncomply)"];
const MIT_COLORS = [
  "var(--chart-a)",
  "var(--chart-b)",
  "var(--chart-c)",
  "var(--chart-d)",
  "var(--chart-e)",
  "var(--chart-f)",
];
// Matches the ["HL", "HPT", "HP", "HPK"] order overlapData is built in below.
const OVERLAP_COLORS = ["var(--forest-hl)", "var(--forest-hpt)", "var(--forest-hp)", "var(--forest-hpk)"];
const TYPE_COLORS = ["var(--color-type-1)", "var(--color-type-2)", "var(--color-type-3)"];

type PercentLabelArgs = {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
};

/**
 * Bar value label drawn to the right of a horizontal bar on one line —
 * recharts' default LabelList wraps text to the bar's own width, which
 * broke a short bar's "36.413 ha" over two lines.
 */
function rightValueLabel(format: (v: number) => string) {
  return function RightValueLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) {
    const x = Number(props.x ?? 0) + Number(props.width ?? 0) + 6;
    const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2;
    return (
      <text x={x} y={y} dominantBaseline="central" fontSize={11} fontWeight={600} fill="var(--color-fg)">
        {format(Number(props.value ?? 0))}
      </text>
    );
  };
}

/** The hovered slice grows a little — the pies answer the pointer. */
function renderActiveSlice(raw: unknown) {
  const props = raw as {
    cx: number;
    cy: number;
    innerRadius: number;
    outerRadius: number;
    startAngle: number;
    endAngle: number;
    fill: string;
  };
  return (
    <Sector
      cx={props.cx}
      cy={props.cy}
      innerRadius={props.innerRadius}
      outerRadius={props.outerRadius + 6}
      startAngle={props.startAngle}
      endAngle={props.endAngle}
      fill={props.fill}
    />
  );
}

function renderPercentLabel({ cx, cy, midAngle, outerRadius, percent }: PercentLabelArgs) {
  if (percent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="var(--color-fg)"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

export function EudrSummaryView({
  millIds,
  totalMills,
  variant,
  layout = "grid",
  hideCoverageNotice,
  onOpenMap,
  millNames,
  onOpenPlots,
}: Props) {
  const [activePie, setActivePie] = useState<{ chart: string; index: number } | null>(null);
  const [listTab, setListTab] = useState<PlotComplyFilter | null>(null);
  const { t, lang } = useI18n();
  const [summary, setSummary] = useState<EudrSummaryResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Kept apart from "no data" so a failed request isn't reported as "no plot
  // data has been prepared for this mill" — which is exactly what a supplier
  // saw for a BNS mill whose data was there all along.
  const [loadError, setLoadError] = useState<"" | "failed" | "session">("");
  const [retryNonce, setRetryNonce] = useState(0);
  // A plain string key so the effect below doesn't re-run on every render
  // just because `millIds` is a new array reference with the same content.
  // JSON.stringify, not millIds.join(","): SJIM's refinery names contain a
  // literal comma ("SINAR TAYAN INTI MULYA, KALBAR"), which a join/split
  // round-trip through "," silently shredded a composite mill id in two —
  // every SJIM EUDR summary request came out empty because of it.
  const millIdsKey = JSON.stringify(millIds);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void fetchWithRetry("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ millIds }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setSummary((await res.json()) as EudrSummaryResult);
          return;
        }
        setSummary(null);
        setLoadError(res.status === 401 ? "session" : "failed");
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setLoadError("failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `millIds` intentionally excluded: `millIdsKey` (JSON.stringify of it) is the stable proxy dependency, and always changes exactly when `millIds`'s content does.
  }, [millIdsKey, retryNonce]);

  const haF = (v: number) => formatHa(v, lang);
  const countF = (v: number) => formatCount(v, lang);
  const asOf = fill(t.dataAsOf, { date: formatDate(DATA_AS_OF, lang) });

  if (loading) {
    return (
      <div className="eudr-summary">
        <div className="eudr-loading" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>{t.eudrLoading}</p>
        </div>
        {variant === "chain" ? <div className="skeleton-grid" aria-hidden="true" /> : null}
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="eudr-summary">
        <div className="eudr-notice danger" role="alert">
          <WarningIcon />
          <p>{loadError === "session" ? t.sessionExpired : t.eudrLoadError}</p>
          {loadError === "session" ? (
            <a className="eudr-notice-action" href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/app" : window.location.pathname + window.location.search)}`}>
              {t.signIn}
            </a>
          ) : (
            <button type="button" className="eudr-notice-action" onClick={() => setRetryNonce((n) => n + 1)}>
              {t.retry}
            </button>
          )}
        </div>
      </div>
    );
  }

  const total = totalMills ?? summary?.millsRequested ?? millIds.length;
  // millsWithData (not totalPlots) is the right check here — a mill with a
  // prepared-but-genuinely-empty plot file would have totalPlots === 0 yet
  // still count as "covered", which totalPlots alone can't distinguish from
  // "no data uploaded at all".
  if (!summary || summary.millsWithData === 0) {
    if (variant === "mill") {
      return (
        <div className="eudr-summary">
          <div className="eudr-notice info">
            <InfoIcon />
            <p>{t.millSummaryEmpty}</p>
          </div>
        </div>
      );
    }
    // A group with only its master list is a normal state, not a broken
    // page (feedback 2, U-05): say so, and point at what *is* there.
    return (
      <div className="eudr-summary">
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <InfoIcon />
          </span>
          <h2>{t.eudrEmptyTitle}</h2>
          <p>{fill(t.eudrEmpty, { mills: countF(total) })}</p>
          {onOpenMap ? (
            <button type="button" className="btn-primary" onClick={onOpenMap}>
              {t.eudrGoToMap}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const covered = summary.millsWithData;
  const partial = covered < total;
  const complyData = [
    { name: t.comply, value: summary.comply.yes },
    { name: t.nonComply, value: summary.comply.no },
  ];
  const riskData = [
    { name: t.riskLow, value: summary.risk.low },
    { name: t.riskMedium, value: summary.risk.medium },
    { name: t.riskHigh, value: summary.risk.high },
  ];
  const defoData = Object.entries(summary.deforestationByYear).map(([year, ha]) => ({ year, ha }));
  const totalDefo = defoData.reduce((s, d) => s + d.ha, 0);
  const cutoffYear = DATA_AS_OF.slice(0, 4);
  const mitigationData = (Object.entries(summary.mitigation) as [string, { count: number; areaHa: number }][]).map(
    ([letter, v]) => ({ letter: `${letter}`, count: v.count, areaHa: v.areaHa }),
  );
  const overlapData = (["HL", "HPT", "HP", "HPK"] as const).map((k) => ({
    name: k,
    ha: summary.forestOverlap[k],
  }));
  const typeNames: Record<string, string> = {
    "Independent Smallholder": t.typeIndependent,
    Company: t.typeCompany,
    "Scheme Smallholder": t.typeScheme,
  };
  const typeData = Object.entries(summary.plotType).filter(([, v]) => v.count > 0);
  const typeTotalArea = typeData.reduce((s, [, v]) => s + v.areaHa, 0);

  // ADM feedback 1 and 3: clicking the compliant share leads to the compliant
  // plots, the non-compliant share to the non-compliant ones.
  const canList = variant === "chain" && !!onOpenPlots && summary.mills.length > 0;
  const shownTab: PlotComplyFilter = listTab ?? (summary.comply.yes > 0 ? "comply" : "noncomply");
  function openList(which: PlotComplyFilter) {
    setListTab(which);
    document.getElementById("comply-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const sliceFilter: PlotComplyFilter[] = ["comply", "noncomply"];

  const kpiCard = (
    <div className={`kpi-row ${layout === "compact" ? "compact" : "summary-kpis"}`}>
      <KpiTile value={countF(summary.totalPlots)} label={t.totalPlotKpi} hint={t.totalPlotHint} />
      <KpiTile value={haF(summary.totalAreaHa)} label={t.mappedAreaKpi} hint={t.mappedAreaHint} />
      {variant === "chain" ? (
        <KpiTile
          value={partial ? `${countF(covered)} / ${countF(total)}` : countF(covered)}
          label={t.millKpi}
          hint={t.millKpiHint}
        />
      ) : null}
      <KpiTile
        tone="comply"
        value={formatPct(summary.comply.yes, summary.totalPlots, lang)}
        label={t.eudrComplyKpi}
        hint={fill(t.eudrComplyHint, { n: countF(summary.comply.yes), total: countF(summary.totalPlots) })}
        sub={`${countF(summary.comply.yes)} ${t.plotsLabel}`}
        actions={
          canList
            ? [
                { label: t.seeComply, onClick: () => openList("comply") },
                { label: t.seeNonComply, onClick: () => openList("noncomply") },
              ]
            : undefined
        }
      />
      <KpiTile tone="danger" value={haF(totalDefo)} label={t.defoPost2020Kpi} hint={t.defoPost2020Hint} sub="2021–" />
    </div>
  );

  const chartCards: ReactNode[] = [
    <div className="chart-card" key="comply">
      <h3>{t.eudrComplianceChart}</h3>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={complyData}
            dataKey="value"
            innerRadius={42}
            outerRadius={62}
            paddingAngle={2}
            label={renderPercentLabel}
            labelLine
            isAnimationActive={false}
            activeIndex={activePie?.chart === "comply" ? activePie.index : undefined}
            activeShape={renderActiveSlice}
            onMouseEnter={(_: unknown, index: number) => setActivePie({ chart: "comply", index })}
            onMouseLeave={() => setActivePie(null)}
            onClick={(_: unknown, index: number) => {
              if (canList) openList(sliceFilter[index]);
            }}
            style={{ cursor: canList ? "pointer" : undefined }}
          >
            {complyData.map((_, i) => (
              <Cell key={i} fill={COMPLY_COLORS[i]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => countF(v)} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="chart-legend">
        {complyData.map((d, i) => (
          <li key={d.name}>
            {canList ? (
              <button type="button" className="legend-link" onClick={() => openList(sliceFilter[i])}>
                <i style={{ background: COMPLY_COLORS[i] }} />
                {d.name} <b>{countF(d.value)}</b>
              </button>
            ) : (
              <>
                <i style={{ background: COMPLY_COLORS[i] }} />
                {d.name} <b>{countF(d.value)}</b>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>,

    <div className="chart-card" key="risk">
      <h3>{t.riskDistributionChart}</h3>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={riskData}
            dataKey="value"
            innerRadius={42}
            outerRadius={62}
            paddingAngle={2}
            label={renderPercentLabel}
            labelLine
            isAnimationActive={false}
            activeIndex={activePie?.chart === "risk" ? activePie.index : undefined}
            activeShape={renderActiveSlice}
            onMouseEnter={(_: unknown, index: number) => setActivePie({ chart: "risk", index })}
            onMouseLeave={() => setActivePie(null)}
          >
            {riskData.map((_, i) => (
              <Cell key={i} fill={RISK_COLORS[i]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => countF(v)} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="chart-legend">
        {riskData.map((d, i) => (
          <li key={d.name}>
            <i style={{ background: RISK_COLORS[i] }} />
            {d.name} <b>{countF(d.value)}</b>
          </li>
        ))}
      </ul>
    </div>,

    <div className="chart-card" key="defo">
      <h3>{t.deforestationChart}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={defoData} margin={{ top: 22, left: 8, right: 8 }}>
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            tickFormatter={(y: string) => (y === cutoffYear ? `${y}*` : y)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip formatter={(v: number) => haF(v)} cursor={{ fill: "var(--color-hover)" }} />
          <Bar dataKey="ha" fill="var(--color-noncomply)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="ha" position="top" formatter={(v: number) => haF(v)} style={{ fontSize: 10, fill: "var(--color-fg)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {defoData.some((d) => d.year === cutoffYear) ? (
        <p className="chart-note">* {fill(t.deforestationNote, { year: cutoffYear })}</p>
      ) : null}
    </div>,

    <div className="chart-card" key="mitigation">
      <h3>{t.mitigationChart}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={mitigationData} layout="vertical" margin={{ left: 8, right: 96 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="letter" type="category" tick={{ fontSize: 12, fill: "var(--color-fg)" }} axisLine={false} tickLine={false} width={20} />
          <Tooltip formatter={(v: number) => haF(v)} cursor={{ fill: "var(--color-hover)" }} />
          <Bar dataKey="areaHa" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {mitigationData.map((_, i) => (
              <Cell key={i} fill={MIT_COLORS[i]} />
            ))}
            <LabelList dataKey="areaHa" content={rightValueLabel(haF)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ul className="mitigation-legend">
        {mitigationData.map((d, i) => (
          <li key={d.letter}>
            <i style={{ background: MIT_COLORS[i] }} />
            <span>
              <b>{d.letter}</b> — {mitigationText(d.letter, lang)}
            </span>
          </li>
        ))}
      </ul>
    </div>,

    // Horizontal bars scaled to the largest overlap, not to the whole
    // mapped area — against a 6-million-ha denominator every bar was a
    // sliver and the chart said nothing (feedback 2, U-07). Values sit on
    // the right of each bar.
    <div className="chart-card" key="overlap">
      <h3>{t.forestOverlapChart}</h3>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={overlapData} layout="vertical" margin={{ left: 8, right: 96 }}>
          <XAxis type="number" hide domain={[0, (max: number) => Math.max(max, 1)]} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: "var(--color-fg)" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip formatter={(v: number) => haF(v)} cursor={{ fill: "var(--color-hover)" }} />
          <Bar dataKey="ha" radius={[0, 3, 3, 0]} minPointSize={2} barSize={18} isAnimationActive={false}>
            {overlapData.map((_, i) => (
              <Cell key={i} fill={OVERLAP_COLORS[i]} />
            ))}
            <LabelList dataKey="ha" content={rightValueLabel(haF)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="chart-note">{t.forestOverlapNote}</p>
    </div>,

    <div className="chart-card" key="type">
      <h3>{t.plotTypeChart}</h3>
      <div className="stacked-bar">
        {typeData.map(([name, v], i) => (
          <div
            key={name}
            className="stacked-bar-seg"
            style={{ width: `${(v.areaHa / typeTotalArea) * 100}%`, background: TYPE_COLORS[i] }}
            title={`${typeNames[name] ?? name}: ${haF(v.areaHa)}`}
          />
        ))}
      </div>
      <ul className="chart-legend">
        {typeData.map(([name, v], i) => (
          <li key={name}>
            <i style={{ background: TYPE_COLORS[i] }} />
            {typeNames[name] ?? name} <b>{haF(v.areaHa)}</b>
          </li>
        ))}
      </ul>
    </div>,
  ];

  return (
    <div className="eudr-summary">
      {partial && !hideCoverageNotice ? (
        <div className="eudr-notice info">
          <InfoIcon />
          <p>
            {fill(t.eudrPartialCoverage, {
              covered: countF(covered),
              total: countF(total),
              missing: countF(total - covered),
            })}
          </p>
        </div>
      ) : null}
      {layout === "compact" ? (
        kpiCard
      ) : layout === "carousel" ? (
        <Carousel slides={[kpiCard, ...chartCards]} prevLabel={t.prevPage} nextLabel={t.nextPage} slideOfLabel={t.slideOf} />
      ) : (
        <>
          {kpiCard}
          <div className="chart-grid">{chartCards}</div>
          {canList ? (
            <ComplyList
              mills={summary.mills}
              names={millNames}
              tab={shownTab}
              onTab={setListTab}
              totals={summary.comply}
              onOpen={onOpenPlots!}
            />
          ) : null}
        </>
      )}
      <p className="data-asof">{asOf}</p>
    </div>
  );
}

function ComplyList({
  mills: allMills,
  names,
  tab,
  onTab,
  totals,
  onOpen,
}: {
  mills: EudrSummaryResult["mills"];
  names?: Map<string, string>;
  tab: PlotComplyFilter;
  onTab: (tab: PlotComplyFilter) => void;
  totals: { yes: number; no: number };
  onOpen: (millId: string, plots: PlotComplyFilter) => void;
}) {
  const { t, lang } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const countOf = (m: EudrSummaryResult["mills"][number]) => (tab === "comply" ? m.comply : m.nonComply);
  const mills = allMills.filter((m) => countOf(m) > 0).sort((a, b) => countOf(b) - countOf(a) || b.totalPlots - a.totalPlots);
  const shown = showAll ? mills : mills.slice(0, 8);
  const max = Math.max(...mills.map(countOf), 1);
  const tabs: { id: PlotComplyFilter; label: string; n: number }[] = [
    { id: "comply", label: t.complyTabYes, n: totals.yes },
    { id: "noncomply", label: t.complyTabNo, n: totals.no },
  ];
  return (
    <section className="chart-card noncomply-card" id="comply-list">
      <header className="noncomply-head">
        <div>
          <h3>{t.complyListTitle}</h3>
          <p className="chart-note">{tab === "comply" ? t.complyListIntro : t.nonComplyListIntro}</p>
        </div>
        <div className="seg" role="tablist" aria-label={t.complyListTitle}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              className={tab === x.id ? "on" : ""}
              aria-selected={tab === x.id}
              disabled={x.n === 0}
              onClick={() => {
                onTab(x.id);
                setShowAll(false);
              }}
            >
              {x.label} · {formatCount(x.n, lang)}
            </button>
          ))}
        </div>
      </header>
      <ol className="noncomply-list">
        {shown.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onOpen(m.id, tab)}>
              <span className="nc-name">{names?.get(m.id) ?? m.id}</span>
              <span className={`nc-bar ${tab === "comply" ? "yes" : ""}`} aria-hidden="true">
                <i style={{ width: `${(countOf(m) / max) * 100}%` }} />
              </span>
              <span className="nc-count tabular-nums">
                {fill(t.nonComplyOf, { n: formatCount(countOf(m), lang), total: formatCount(m.totalPlots, lang) })}
              </span>
              <span className="nc-open">{t.openOnMap} ›</span>
            </button>
          </li>
        ))}
      </ol>
      {mills.length > 8 ? (
        <button type="button" className="linkish" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t.showLess : fill(t.showAll, { n: formatCount(mills.length, lang) })}
        </button>
      ) : null}
    </section>
  );
}
