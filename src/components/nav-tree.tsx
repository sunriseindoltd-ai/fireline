import type { Chain } from "@/lib/ledger";

type Props = {
  chains: Chain[];
  selectedChain: string | null;
  selectedRefinery: string | null;
  onSelect: (chainId: string | null, refinery: string | null) => void;
  portfolioLabel: string;
  supplyChainListLabel: string;
  groupPlaceholderLabel: string;
  refineryPlaceholderLabel: string;
  villageLabel: string;
  bufferLabel: string;
};

/**
 * Group → Refinery/KCP navigation as two dropdowns instead of a clickable
 * list: picking a Group in the first `<select>` narrows the second to that
 * group's Refinery/KCP options (hidden entirely for single-refinery
 * groups, same as before). Keeps the sidebar's height fixed regardless of
 * how many groups or refineries exist, unlike the flat list this replaced.
 */
export function NavTree({
  chains,
  selectedChain,
  selectedRefinery,
  onSelect,
  portfolioLabel,
  supplyChainListLabel,
  groupPlaceholderLabel,
  refineryPlaceholderLabel,
  villageLabel,
  bufferLabel,
}: Props) {
  const activeChain = chains.find((c) => c.id === selectedChain) ?? null;

  return (
    <div className="nav-tree">
      <button
        type="button"
        className={`nav-tree-portfolio ${selectedChain === null ? "on" : ""}`}
        onClick={() => onSelect(null, null)}
      >
        {portfolioLabel}
      </button>

      <p className="nav-tree-kicker">{supplyChainListLabel}</p>

      <select
        className="nav-tree-select nav-tree-select-group"
        aria-label={supplyChainListLabel}
        value={selectedChain ?? ""}
        onChange={(e) => onSelect(e.target.value || null, null)}
      >
        <option value="">{groupPlaceholderLabel}</option>
        {chains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {activeChain && activeChain.refineries.length > 1 ? (
        <select
          className="nav-tree-select"
          aria-label={refineryPlaceholderLabel}
          value={selectedRefinery ?? ""}
          onChange={(e) => onSelect(activeChain.id, e.target.value || null)}
        >
          <option value="">{refineryPlaceholderLabel}</option>
          {activeChain.refineries.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}

      {activeChain ? (
        <p className="cm tabular-nums nav-tree-summary">
          {activeChain.mills.length} · {activeChain.village} {villageLabel} · {activeChain.buffer} {bufferLabel}
        </p>
      ) : null}
    </div>
  );
}
