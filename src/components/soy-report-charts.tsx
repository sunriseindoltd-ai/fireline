/**
 * Print charts for the SoyTrace report (soy-report.tsx), drawn in plain
 * HTML/CSS so they stay crisp in a PDF and use the page's own type. A printed
 * page has no hover, so every mark carries its value as a label (that is the
 * "table view" of each chart). Specs: thin bars (≤ 24 px) with a 4 px rounded
 * data end, a 2 px white gap between touching segments, hairline baseline,
 * text in ink colours (never the series colour), a legend for ≥ 2 series.
 *
 * Colours: categorical sets validated with the dataviz palette check
 * (adjacent CVD ΔE ≥ 9, normal-vision ΔE ≥ 16; light surface). The yellow and
 * aqua slots sit below 3:1 on white, which is why their values are always
 * written out.
 */

/** Crop groups in stack order (soy at the base): green, yellow, blue, aqua, orange, violet. */
export const CROP_COLORS = {
  soy: "#008300",
  corn: "#eda100",
  other: "#2a78d6",
  grass: "#1baf7a",
  fallow: "#eb6834",
  noncrop: "#4a3aa7",
} as const;
/** Rail / river / rail or river. */
export const NET_COLORS = { rail: "#4a3aa7", river: "#2a78d6", either: "#008300" } as const;

type Row = { key: string; label: string; value: number; text: string; sub?: string };

/** Horizontal bars, one series: label · bar · value at the tip. */
export function HBars({ rows, color, max, room = 12 }: { rows: Row[]; color: string; max?: number; /** Width kept free for the value label, in em. */ room?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="rc-hbars">
      {rows.map((r) => (
        <div key={r.key} className="rc-hrow">
          <span className="rc-hlabel">{r.label}</span>
          <span className="rc-htrack">
            {/* The bar takes its share of the track minus room for the value label. */}
            <i style={{ width: `calc((100% - ${room}em) * ${top > 0 ? Math.max(r.value / top, r.value > 0 ? 0.008 : 0) : 0})`, background: color }} />
            <b>
              {r.text}
              {r.sub ? <small> · {r.sub}</small> : null}
            </b>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Columns, one series, value on each cap and an optional second line under the axis label. */
export function Columns({ rows, color, height = 130 }: { rows: Row[]; color: string; height?: number }) {
  const top = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="rc-cols">
      <div className="rc-plot" style={{ height }}>
        {rows.map((r) => (
          <div key={r.key} className="rc-col">
            <i style={{ height: `${top > 0 ? (r.value / top) * 100 : 0}%`, background: color }}>
              <b>{r.text}</b>
            </i>
          </div>
        ))}
      </div>
      <div className="rc-axis">
        {rows.map((r) => (
          <span key={r.key}>
            {r.label}
            {r.sub ? <small>{r.sub}</small> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

type Series = { key: string; label: string; color: string };

function Legend({ series, values }: { series: Series[]; values?: Record<string, string> }) {
  return (
    <ul className="rc-legend">
      {series.map((s) => (
        <li key={s.key}>
          <i style={{ background: s.color }} />
          {s.label}
          {values?.[s.key] ? <b>{values[s.key]}</b> : null}
        </li>
      ))}
    </ul>
  );
}

/** 100% stacked columns (shares of each column), the first series labelled inside where it fits. */
export function StackColumns({
  cols,
  series,
  height = 170,
  fmt,
}: {
  cols: { key: string; label: string; parts: Record<string, number> }[];
  series: Series[];
  height?: number;
  fmt: (pct: number) => string;
}) {
  return (
    <div className="rc-stack">
      <Legend series={series} />
      <div className="rc-plot" style={{ height }}>
        {cols.map((col) => {
          const total = series.reduce((a, s) => a + (col.parts[s.key] ?? 0), 0);
          return (
            <div key={col.key} className="rc-col stacked">
              {series.map((s, i) => {
                const p = total > 0 ? ((col.parts[s.key] ?? 0) / total) * 100 : 0;
                if (p <= 0) return null;
                // Only the base series is labelled, and only where the text fits (≥ 9% of the column).
                const label = i === 0 && (p / 100) * height >= 15;
                return (
                  <i key={s.key} title={`${s.label}: ${fmt(p)}`} style={{ flex: `0 1 ${p}%`, background: s.color }}>
                    {label ? <em>{fmt(p)}</em> : null}
                  </i>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="rc-axis">
        {cols.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
      </div>
    </div>
  );
}

/** One 100% bar split into parts, with a legend that carries every value. */
export function ShareBar({ parts, fmt }: { parts: (Series & { value: number; text: string })[]; fmt: (pct: number) => string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="rc-share">
      <div className="rc-sharebar">
        {shown.map((p) => (
          <i key={p.key} style={{ flex: `0 1 ${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <Legend series={shown} values={Object.fromEntries(shown.map((p) => [p.key, `${p.text} · ${fmt(total > 0 ? (p.value / total) * 100 : 0)}`]))} />
    </div>
  );
}

/** Grouped columns: a few groups × a few series, every column labelled. */
export function GroupedColumns({
  groups,
  series,
  height = 150,
  max = 100,
}: {
  groups: { key: string; label: string; values: Record<string, { value: number; text: string }> }[];
  series: Series[];
  height?: number;
  max?: number;
}) {
  return (
    <div className="rc-grouped">
      <Legend series={series} />
      <div className="rc-plot" style={{ height }}>
        {groups.map((g) => (
          <div key={g.key} className="rc-group">
            {series.map((s) => {
              const v = g.values[s.key];
              return (
                <div key={s.key} className="rc-col">
                  <i style={{ height: `${max > 0 ? ((v?.value ?? 0) / max) * 100 : 0}%`, background: s.color }}>
                    <b>{v?.text ?? ""}</b>
                  </i>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="rc-axis">
        {groups.map((g) => (
          <span key={g.key}>{g.label}</span>
        ))}
      </div>
    </div>
  );
}
