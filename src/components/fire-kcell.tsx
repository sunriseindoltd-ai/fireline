import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/**
 * One figure in a summary strip (.fl-kgroup > .fl-kcells): label over value, an optional grey sub line, and with
 * `of` the true share of the whole drawn as a thin bar under the value.
 */
export function KCell({
  value,
  of,
  label,
  hint,
  sub,
  tone,
  onClick,
}: {
  value: number | string;
  of?: number;
  label: string;
  hint?: string;
  sub?: ReactNode;
  tone?: "danger";
  onClick?: () => void;
}) {
  const { lang } = useI18n();
  const body = (
    <>
      <span className="fl-kl">{label}</span>
      <span className={`fl-kv tabular-nums ${tone ?? ""}`}>{typeof value === "number" ? formatCount(value, lang) : value}</span>
      {of && typeof value === "number" ? (
        <span className="fl-kbar" aria-hidden="true">
          <i style={{ width: `${(value / of) * 100}%` }} />
        </span>
      ) : null}
      {sub ? <span className="fl-ksub">{sub}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="fl-kcell" title={hint} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="fl-kcell" title={hint}>
      {body}
    </div>
  );
}
