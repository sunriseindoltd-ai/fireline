import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { groupLabel, type Chain } from "@/lib/ledger";
import type { ChainCoverage } from "@/components/portfolio-view";

/**
 * The workspace's one navigation control: which supply-chain group you are
 * in. Lives in the header (not a sidebar dropdown), is searchable, and shows
 * each group's plot coverage so "which one has data?" is answered before
 * the click.
 */
export function ScopeSwitcher({
  chains,
  coverage,
  currentId,
  onSelect,
}: {
  chains: Chain[];
  coverage: Map<string, ChainCoverage>;
  currentId: string | null;
  onSelect: (chainId: string | null) => void;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = chains.find((c) => c.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chains.filter((c) => c.name.toLowerCase().includes(s) || groupLabel(c.name).toLowerCase().includes(s)) : chains;
  }, [chains, q]);

  function pick(id: string | null) {
    setOpen(false);
    setQ("");
    onSelect(id);
  }

  return (
    <div className="scope" ref={rootRef}>
      <button
        type="button"
        className="scope-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current ? groupLabel(current.name) : t.portfolio}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="scope-menu">
          <input
            ref={inputRef}
            type="search"
            className="scope-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.searchGroups}
            aria-label={t.searchGroups}
          />
          <ul id={listId} role="listbox" aria-label={t.supplyChainList}>
            <li role="option" aria-selected={currentId === null}>
              <button type="button" className={currentId === null ? "on" : ""} onClick={() => pick(null)}>
                <span>{t.portfolio}</span>
                <small>{t.allGroups}</small>
              </button>
            </li>
            {filtered.map((c) => {
              const cov = coverage.get(c.id);
              return (
                <li key={c.id} role="option" aria-selected={c.id === currentId}>
                  <button type="button" className={c.id === currentId ? "on" : ""} onClick={() => pick(c.id)}>
                    <span>{groupLabel(c.name)}</span>
                    <small>
                      {formatCount(c.mills.length, lang)} {t.mills}
                      {cov ? ` · ${formatCount(cov.covered, lang)} ${t.withPlots}` : ""}
                    </small>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? <li className="scope-empty">{t.noMatches}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
