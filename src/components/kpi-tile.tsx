import type { ReactNode } from "react";

/**
 * One KPI. `hint` is the one-sentence definition every figure must carry
 * (what it counts, which filter, which date — feedback 2, "jejak audit
 * angka"); it shows on hover/focus and is read out by screen readers.
 */
export function KpiTile({
  value,
  label,
  hint,
  sub,
  tone,
  onClick,
  action,
  actions,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  sub?: ReactNode;
  tone?: "comply" | "danger";
  /** Makes the whole tile a button (e.g. "see the non-compliant plots"). */
  onClick?: () => void;
  /** Short call to action shown under the figure when `onClick` is set. */
  action?: string;
  /** Several links under the figure; use instead of `onClick` when the tile
   * leads to more than one place. */
  actions?: { label: string; onClick: () => void }[];
}) {
  return (
    <div
      className={`kpi ${tone ?? ""} ${onClick ? "clickable" : ""}`}
      tabIndex={hint || onClick ? 0 : undefined}
      role={onClick ? "button" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <b className="tabular-nums">{value}</b>
      <span className="kpi-label">
        {label}
        {hint ? (
          <span className="kpi-info" aria-hidden="true">
            i
          </span>
        ) : null}
      </span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
      {onClick && action ? <span className="kpi-action">{action} ›</span> : null}
      {!onClick && actions?.length ? (
        <span className="kpi-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="kpi-action" onClick={a.onClick}>
              {a.label} ›
            </button>
          ))}
        </span>
      ) : null}
      {hint ? (
        <span className="kpi-hint" role="tooltip">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
