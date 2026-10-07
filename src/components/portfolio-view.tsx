import { useMemo, useState } from "react";
import { groupLabel, type Chain } from "@/lib/ledger";
import { useI18n } from "@/lib/i18n";
import { fill, formatCount, formatHa, formatPct } from "@/lib/format";
import { KpiTile } from "@/components/kpi-tile";
import { PortfolioSankey } from "@/components/portfolio-sankey";

/** How many of a group's mills have plot-level analysis. */
export type ChainCoverage = { covered: number; total: number };

/** One mill's plot figures, from /eudr-summary (eudr-stats.json). */
export type MillStat = { totalPlots: number; comply: number; nonComply: number; areaHa: number };

type Props = {
  chains: Chain[];
  /** Empty until /coverage answers — the coverage figures just stay blank. */
  coverage: Map<string, ChainCoverage>;
  coveredIds: Set<string> | null;
  /** Null until /eudr-summary answers. */
  millStats: Map<string, MillStat> | null;
  onSelectChain: (chainId: string) => void;
  onSelectRefinery: (chainId: string, refinery: string) => void;
};

type SortKey = "name" | "mills" | "plots" | "area" | "comply";
type GroupRow = { chain: Chain; cov: ChainCoverage | undefined; plots: number; comply: number; areaHa: number };

/**
 * The portfolio: the groups first, as one sortable list with their plot
 * figures (feedback 2, U-06 — a list, not a wall of cards), then the flow
 * chart for those who want the structure. Groups without any plot data sit
 * apart on one line so they don't read as empty rows.
 */
export function PortfolioView({ chains, coverage, coveredIds, millStats, onSelectChain, onSelectRefinery }: Props) {
  const { t, lang } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "plots", dir: -1 });

  const groups = useMemo<GroupRow[]>(
    () =>
      chains.map((chain) => {
        let plots = 0;
        let comply = 0;
        let areaHa = 0;
        for (const m of chain.mills) {
          const s = millStats?.get(m.id);
          if (!s) continue;
          plots += s.totalPlots;
          comply += s.comply;
          areaHa += s.areaHa;
        }
        return { chain, cov: coverage.get(chain.id), plots, comply, areaHa };
      }),
    [chains, coverage, millStats],
  );

  const totals = useMemo(() => {
    const sum = (f: (g: GroupRow) => number) => groups.reduce((n, g) => n + f(g), 0);
    return {
      groups: groups.length,
      mills: sum((g) => g.chain.mills.length),
      covered: sum((g) => g.cov?.covered ?? 0),
      plots: sum((g) => g.plots),
      comply: sum((g) => g.comply),
      areaHa: sum((g) => g.areaHa),
    };
  }, [groups]);

  // Until the figures arrive every group counts as "with data", so the
  // table doesn't flash everything into the no-data line and back.
  const hasData = (g: GroupRow) => !millStats || g.plots > 0 || (g.cov?.covered ?? 0) > 0;
  const rows = useMemo(() => {
    const val = (g: GroupRow): string | number => {
      switch (sort.key) {
        case "name":
          return g.chain.name.toLowerCase();
        case "mills":
          return g.chain.mills.length;
        case "plots":
          return g.plots;
        case "area":
          return g.areaHa;
        default:
          return g.plots ? g.comply / g.plots : -1;
      }
    };
    return groups
      .filter(hasData)
      .sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || a.chain.name.localeCompare(b.chain.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasData reads millStats, already a dependency via groups.
  }, [groups, sort, millStats]);
  const noData = groups.filter((g) => !hasData(g));

  const loading = millStats == null;
  const num = (v: number, f: (n: number) => string) => (loading ? "…" : v ? f(v) : "—");

  function Th({ k, label, numeric }: { k: SortKey; label: string; numeric?: boolean }) {
    const active = sort.key === k;
    return (
      <th className={numeric ? "num" : ""} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`th-sort ${active ? "on" : ""}`}
          aria-label={t.sortBy.replace("{col}", label)}
          onClick={() => setSort(active ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: numeric ? -1 : 1 })}
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
        <KpiTile
          value={formatCount(totals.mills, lang)}
          label={t.millsKpi}
          hint={t.coverageKpiHint}
          sub={coverage.size ? fill(t.pfMillsSub, { n: formatCount(totals.covered, lang) }) : undefined}
        />
        <KpiTile
          value={loading ? "—" : formatCount(totals.plots, lang)}
          label={t.totalPlotKpi}
          sub={loading ? undefined : fill(t.pfAnalysedSub, { ha: formatHa(totals.areaHa, lang) })}
        />
        <KpiTile
          tone="comply"
          value={loading ? "—" : formatPct(totals.comply, totals.plots, lang)}
          label={t.eudrComplyKpi}
          sub={loading ? undefined : `${formatCount(totals.comply, lang)} ${t.plotsLabel}`}
        />
      </div>

      <section className="pf-groups">
        <div className="pf-groups-head">
          <h2>{t.pfGroupsTitle}</h2>
          <p>{t.pfGroupsIntro}</p>
        </div>
        <div className="table-card">
          <table className="data-table pf-table">
            <thead>
              <tr>
                <Th k="name" label={t.colGroup} />
                <Th k="mills" label={t.millsKpi} numeric />
                <Th k="plots" label={t.colPlots} numeric />
                <Th k="area" label={t.colArea} numeric />
                <Th k="comply" label={t.colComply} />
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const { chain: c, cov } = g;
                const partial = cov && cov.covered > 0 && cov.covered < cov.total;
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
                    <td className="num tabular-nums">
                      {formatCount(c.mills.length, lang)}
                      {partial ? <small className="pf-sub">{fill(t.pfMillsSub, { n: formatCount(cov.covered, lang) })}</small> : null}
                    </td>
                    <td className="num tabular-nums">{num(g.plots, (v) => formatCount(v, lang))}</td>
                    <td className="num tabular-nums">{num(g.areaHa, (v) => formatHa(v, lang))}</td>
                    <td>
                      {g.plots ? (
                        <span className="pf-comply">
                          <span className="pf-bar" aria-hidden="true">
                            <i style={{ width: `${(g.comply / g.plots) * 100}%` }} />
                          </span>
                          <span className="tabular-nums">{formatPct(g.comply, g.plots, lang)}</span>
                        </span>
                      ) : (
                        <span className="pf-muted">{loading ? "…" : "—"}</span>
                      )}
                    </td>
                    <td className="pf-go" aria-hidden="true">
                      ›
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {noData.length ? (
          <p className="pf-nodata">
            <span>{t.pfNoPlotGroups}:</span>
            {noData.map((g) => (
              <button key={g.chain.id} type="button" className="linkish" onClick={() => onSelectChain(g.chain.id)}>
                {groupLabel(g.chain.name)}
                <small> · {formatCount(g.chain.mills.length, lang)} {t.mills}</small>
              </button>
            ))}
          </p>
        ) : null}
      </section>

      <PortfolioSankey chains={chains} coveredIds={coveredIds} onSelectChain={onSelectChain} onSelectRefinery={onSelectRefinery} />
    </div>
  );
}
