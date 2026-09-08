import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toggleSetValue } from "@/lib/plot-filters";

const MENU_WIDTH = 220;

function FunnelIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M4 5h16l-6 8v6l-4 2v-8z" strokeLinejoin="round" />
    </svg>
  );
}

export type ColumnFilterOption = { value: string; label: string; count: number };

type Props = {
  label: string;
  options: ColumnFilterOption[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  clearLabel: string;
};

/**
 * A funnel icon that opens a checkbox list of this column's distinct
 * values, portaled to `document.body` and positioned from the trigger
 * button's own bounding box — not nested/absolute inside the table, whose
 * `.table-wrap { overflow: auto }` would otherwise clip it exactly like the
 * map popups this same feedback round flagged as "sering kepotong".
 */
export function ColumnFilterMenu({ label, options, selected, onChange, clearLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = selected !== null;

  useEffect(() => {
    if (!open) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - MENU_WIDTH - 8),
      });
    }
    place();
    function onDocDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  function toggle(value: string) {
    onChange(toggleSetValue(selected, value, options.map((o) => o.value)));
  }

  return (
    <span className="col-filter">
      <button
        type="button"
        ref={btnRef}
        className={`col-filter-btn ${active ? "on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <FunnelIcon />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="col-filter-menu"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="col-filter-menu-head">
                <span className="truncate">{label}</span>
                <button type="button" onClick={() => onChange(null)} disabled={!active}>
                  {clearLabel}
                </button>
              </div>
              <ul>
                {options.map((opt) => (
                  <li key={opt.value}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected === null || selected.has(opt.value)}
                        onChange={() => toggle(opt.value)}
                      />
                      <span className="truncate">{opt.label}</span>
                      <b className="tabular-nums">{opt.count.toLocaleString("id-ID")}</b>
                    </label>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
