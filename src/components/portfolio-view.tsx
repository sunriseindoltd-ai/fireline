import { useMemo } from "react";
import type { Chain } from "@/lib/ledger";

type Props = {
  chains: Chain[];
  onSelectChain: (chainId: string) => void;
  labels: {
    groups: string;
    refineries: string;
    mills: string;
    village: string;
    buffer: string;
  };
};

export function PortfolioView({ chains, onSelectChain, labels }: Props) {
  const totals = useMemo(() => {
    const mills = chains.reduce((n, c) => n + c.mills.length, 0);
    const village = chains.reduce((n, c) => n + c.village, 0);
    const buffer = chains.reduce((n, c) => n + c.buffer, 0);
    const refineries = new Set(chains.flatMap((c) => c.refineries)).size;
    return { groups: chains.length, refineries, mills, village, buffer };
  }, [chains]);

  return (
    <div className="portfolio">
      <div className="portfolio-kpis">
        <div>
          <b className="tabular-nums">{totals.groups}</b>
          <span>{labels.groups}</span>
        </div>
        <div>
          <b className="tabular-nums">{totals.refineries}</b>
          <span>{labels.refineries}</span>
        </div>
        <div>
          <b className="tabular-nums">{totals.mills}</b>
          <span>{labels.mills}</span>
        </div>
        <div>
          <b className="tabular-nums">{totals.village}</b>
          <span>{labels.village}</span>
        </div>
        <div>
          <b className="tabular-nums">{totals.buffer}</b>
          <span>{labels.buffer}</span>
        </div>
      </div>
      <div className="portfolio-groups">
        {chains.map((c) => (
          <button
            type="button"
            key={c.id}
            className="portfolio-card"
            onClick={() => onSelectChain(c.id)}
          >
            <span className="cn">{c.name}</span>
            <span className="portfolio-card-stats tabular-nums">
              <span>
                {c.mills.length} {labels.mills}
              </span>
              <span>
                {c.refineries.length} {labels.refineries}
              </span>
            </span>
            <span className="cm tabular-nums">
              {c.village} {labels.village} · {c.buffer} {labels.buffer}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
