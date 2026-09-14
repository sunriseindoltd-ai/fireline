import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import type { EudrSummaryResult } from "@/lib/eudr-aggregates.server";
import { MITIGATION_DESCRIPTIONS } from "@/lib/ledger-geo";

type Props = {
  umlIds: string[];
  emptyLabel: string;
  loadingLabel: string;
  /** Shown as a warning banner above the charts when only some of the
   * requested mills have plot data uploaded — must contain "{covered}" and
   * "{total}" placeholders. */
  partialLabel: string;
};

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3 1 21h22L12 3z" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.51" />
    </svg>
  );
}

const RISK_COLORS = ["var(--color-accent-2)", "var(--color-warn)", "var(--color-danger)"];
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
const TYPE_COLORS = ["var(--color-accent-2)", "var(--color-accent)", "var(--color-foam)"];

function haFmt(n: number) {
  return n >= 1000
    ? `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}k ha`
    : `${Math.round(n).toLocaleString("id-ID")} ha`;
}

type PercentLabelArgs = {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
};

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

export function EudrSummaryView({ umlIds, emptyLabel, loadingLabel, partialLabel }: Props) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<EudrSummaryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const umlIdsKey = umlIds.join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch("/eudr-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ umlIds: umlIdsKey ? umlIdsKey.split(",") : [] }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EudrSummaryResult | null) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [umlIdsKey]);

  if (loading) {
    return (
      <div className="eudr-summary">
        <p className="eudr-empty">{loadingLabel}</p>
      </div>
    );
  }
  // millsWithData (not totalPlots) is the right check here — a mill with a
  // prepared-but-genuinely-empty plot file would have totalPlots === 0 yet
  // still count as "covered", which totalPlots alone can't distinguish from
  // "no data uploaded at all".
  if (!summary || summary.millsWithData === 0) {
    return (
      <div className="eudr-summary">
        <div className="eudr-notice">
          <WarningIcon />
          <p>{emptyLabel}</p>
        </div>
      </div>
    );
  }

  const partial = summary.millsWithData < summary.millsRequested;
  const complyPct = summary.totalPlots > 0 ? Math.round((summary.comply.yes / summary.totalPlots) * 100) : 0;
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
  const mitigationData = (Object.entries(summary.mitigation) as [string, { count: number; areaHa: number }][]).map(
    ([letter, v]) => ({ letter: `${letter}`, count: v.count, areaHa: v.areaHa }),
  );
  const overlapData = (["HL", "HPT", "HP", "HPK"] as const).map((k) => ({
    name: k,
    ha: summary.forestOverlap[k],
  }));
  const typeData = Object.entries(summary.plotType).filter(([, v]) => v.count > 0);
  const typeTotalArea = typeData.reduce((s, [, v]) => s + v.areaHa, 0);

  return (
    <div className="eudr-summary">
      {partial ? (
        <div className="eudr-notice">
          <WarningIcon />
          <p>
            {partialLabel
              .replaceAll("{covered}", summary.millsWithData.toLocaleString("id-ID"))
              .replaceAll("{total}", summary.millsRequested.toLocaleString("id-ID"))}
          </p>
        </div>
      ) : null}
      <div className="portfolio-kpis">
        <div>
          <b className="tabular-nums">{summary.totalPlots.toLocaleString("id-ID")}</b>
          <span>{t.totalPlotKpi}</span>
        </div>
        <div>
          <b className="tabular-nums">{haFmt(summary.totalAreaHa)}</b>
          <span>{t.mappedAreaKpi}</span>
        </div>
        <div>
          <b className="tabular-nums">
            {partial
              ? `${summary.millsWithData.toLocaleString("id-ID")}/${summary.millsRequested.toLocaleString("id-ID")}`
              : summary.millsWithData.toLocaleString("id-ID")}
          </b>
          <span>{t.millKpi}</span>
        </div>
        <div>
          <b className="tabular-nums" style={{ color: "var(--color-comply)" }}>
            {complyPct}%
          </b>
          <span>{t.eudrComplyKpi}</span>
        </div>
        <div>
          <b className="tabular-nums" style={{ color: "var(--color-danger)" }}>
            {haFmt(totalDefo)}
          </b>
          <span>{t.defoPost2020Kpi}</span>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
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
              >
                {complyData.map((_, i) => (
                  <Cell key={i} fill={COMPLY_COLORS[i]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString("id-ID")} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="chart-legend">
            {complyData.map((d, i) => (
              <li key={d.name}>
                <i style={{ background: COMPLY_COLORS[i] }} />
                {d.name} <b>{d.value.toLocaleString("id-ID")}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="chart-card">
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
              >
                {riskData.map((_, i) => (
                  <Cell key={i} fill={RISK_COLORS[i]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString("id-ID")} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="chart-legend">
            {riskData.map((d, i) => (
              <li key={d.name}>
                <i style={{ background: RISK_COLORS[i] }} />
                {d.name} <b>{d.value.toLocaleString("id-ID")}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="chart-card">
          <h3>{t.deforestationChart}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={defoData} margin={{ top: 20 }}>
              <XAxis dataKey="year" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip formatter={(v: number) => haFmt(v)} />
              <Bar dataKey="ha" fill="var(--color-danger)" radius={[3, 3, 0, 0]}>
                <LabelList dataKey="ha" position="top" formatter={(v: number) => haFmt(v)} style={{ fontSize: 10, fill: "var(--color-fg)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>{t.mitigationChart}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={mitigationData} layout="vertical" margin={{ left: 8, right: 48 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="letter" type="category" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={20} />
              <Tooltip formatter={(v: number) => haFmt(v)} />
              <Bar dataKey="areaHa" radius={[0, 3, 3, 0]}>
                {mitigationData.map((_, i) => (
                  <Cell key={i} fill={MIT_COLORS[i]} />
                ))}
                <LabelList dataKey="areaHa" position="right" formatter={(v: number) => haFmt(v)} style={{ fontSize: 10, fill: "var(--color-fg)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ul className="mitigation-legend">
            {mitigationData.map((d, i) => (
              <li key={d.letter}>
                <i style={{ background: MIT_COLORS[i] }} />
                <span>
                  <b>{d.letter}</b> — {MITIGATION_DESCRIPTIONS[d.letter]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="chart-card">
          <h3>{t.forestOverlapChart}</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={overlapData} layout="vertical" margin={{ left: 8, right: 48 }}>
              <XAxis type="number" hide domain={[0, summary.totalAreaHa]} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v: number) => haFmt(v)} />
              <Bar dataKey="ha" radius={[0, 3, 3, 0]}>
                {overlapData.map((_, i) => (
                  <Cell key={i} fill={OVERLAP_COLORS[i]} />
                ))}
                <LabelList dataKey="ha" position="right" formatter={(v: number) => haFmt(v)} style={{ fontSize: 10, fill: "var(--color-fg)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>{t.plotTypeChart}</h3>
          <div className="stacked-bar">
            {typeData.map(([name, v], i) => (
              <div
                key={name}
                className="stacked-bar-seg"
                style={{ width: `${(v.areaHa / typeTotalArea) * 100}%`, background: TYPE_COLORS[i] }}
                title={`${name}: ${haFmt(v.areaHa)}`}
              />
            ))}
          </div>
          <ul className="chart-legend">
            {typeData.map(([name, v], i) => (
              <li key={name}>
                <i style={{ background: TYPE_COLORS[i] }} />
                {name} <b>{haFmt(v.areaHa)}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
