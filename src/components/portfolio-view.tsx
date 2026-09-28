import { useMemo, useState } from "react";
import { groupLabel, type Chain } from "@/lib/ledger";
import { useI18n } from "@/lib/i18n";
import { formatCount, formatPct } from "@/lib/format";
import { KpiTile } from "@/components/kpi-tile";
import { PortfolioSankey } from "@/components/portfolio-sankey";

/** How many of a group's mills have plot-level analysis. */
export type ChainCoverage = { covered: number; total: number };

type Props = {
  chains: Chain[];
  /** Empty until /coverage answers — the status column just stays blank. */
  coverage: Map<string, ChainCoverage>;
  coveredIds: Set<string> | null;
  onSelectChain: (chainId: string) => void;
  onSelectRefinery: (chainId: string, refinery: string) => void;
};

type SortKey = "name" | "status" | "mills" | "refineries" | "village" | "buffer";

function coverageStatus(c: ChainCoverage | undefined): "ready" | "partial" | "master" | null {
  if (!c) return null;
  if (c.covered === 0) return "master";
  return c.covered >= c.total ? "ready" : "partial";
}

/**
 * The portfolio as a list you can scan and sort — every group on one line
 * with its coverage — rather than a wall of identical cards (feedback 2,
 * U-06 / "UX workspace").
 */
export function PortfolioView({ chains, coverage, coveredIds, onSelectChain, onSelectRefinery }: Props) {
  const { t, lang } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });
  const totals = useMemo(() => {
    const mills = chains.reduce((n, c) => n + c.mills.length, 0);
    const village = chains.reduce((n, c) => n + c.village, 0);
    const buffer = chains.reduce((n, c) => n + c.buffer, 0);
    const refineries = new Set(chains.flatMap((c) => c.refineries)).size;
    const covered = chains.reduce((n, c) => n + (coverage.get(c.id)?.covered ?? 0), 0);
    return { groups: chains.length, refineries, mills, village, buffer, covered };
  }, [chains, coverage]);

  const statusRank = { ready: 0, partial: 1, master: 2 } as const;
  const rows = useMemo(() => {
    const val = (c: Chain): string | number => {
      switch (sort.key) {
        case "name":
          return c.name.toLowerCase();
        case "status": {
          const cov = coverage.get(c.id);
          const s = coverageStatus(cov);
          // Ready first, then partial by share covered, then master-only.
          return s ? statusRank[s] * 10 - (cov ? cov.covered / cov.total : 0) : 99;
        }
        case "mills":
          return c.mills.length;
        case "refineries":
          return c.refineries.length;
        case "village":
          return c.village;
        default:
          return c.buffer;
      }
    };
    return [...chains].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusRank is a constant literal.
  }, [chains, coverage, sort]);

  const statusText = { ready: t.statusReady, partial: t.statusPartial, master: t.statusMaster };

  function Th({ k, label, num }: { k: SortKey; label: string; num?: boolean }) {
    const active = sort.key === k;
    return (
      <th className={num ? "num" : ""} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`th-sort ${active ? "on" : ""}`}
          aria-label={t.sortBy.replace("{col}", label)}
          onClick={() => setSort(active ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: num ? -1 : 1 })}
        >
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{t.ledger}</p>
        <h1>{t.portfolio}</h1>
        <p>{t.portfolioIntro}</p>
      </header>
      <div className="kpi-row">
        <KpiTile value={formatCount(totals.groups, lang)} label={t.groupsKpi} />
        <KpiTile value={formatCount(totals.refineries, lang)} label={t.refineriesKpi} />
        <KpiTile value={formatCount(totals.mills, lang)} label={t.millsKpi} />
        <KpiTile
          value={coverage.size ? formatPct(totals.covered, totals.mills, lang) : "—"}
          label={t.coverageKpi}
          hint={t.coverageKpiHint}
          sub={coverage.size ? `${formatCount(totals.covered, lang)} ${t.mills}` : undefined}
        />
      </div>
      <PortfolioSankey
        chains={chains}
        coveredIds={coveredIds}
        onSelectChain={onSelectChain}
        onSelectRefinery={onSelectRefinery}
      />
      <div className="table-card">
        <table className="data-table group-table">
          <thead>
            <tr>
              <Th k="name" label={t.colGroup} />
              <Th k="status" label={t.colCoverage} />
              <Th k="mills" label={t.millsKpi} num />
              <Th k="refineries" label={t.refineriesKpi} num />
              <Th k="village" label={t.village} num />
              <Th k="buffer" label={t.buffer} num />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const cov = coverage.get(c.id);
              const status = coverageStatus(cov);
              return (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => onSelectChain(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectChain(c.id);
                    }
                  }}
                >
                  <td>
                    <b className="group-name">{groupLabel(c.name)}</b>
                  </td>
                  <td>
                    {status && cov ? (
                      <span className="coverage-cell">
                        <span className={`status-pill ${status}`}>{statusText[status]}</span>
                        <span className="coverage-bar" aria-hidden="true">
                          <i style={{ width: `${(cov.covered / cov.total) * 100}%` }} />
                        </span>
                        <span className="coverage-num tabular-nums">
                          {formatCount(cov.covered, lang)}/{formatCount(cov.total, lang)}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num tabular-nums">{formatCount(c.mills.length, lang)}</td>
                  <td className="num tabular-nums">{formatCount(c.refineries.length, lang)}</td>
                  <td className="num tabular-nums">{formatCount(c.village, lang)}</td>
                  <td className="num tabular-nums">{formatCount(c.buffer, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
