import { useEffect, useMemo, useRef, useState } from "react";
import { sankey, sankeyLinkHorizontal, sankeyJustify } from "d3-sankey";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { groupLabel, type Chain } from "@/lib/ledger";

type Mode = "trace" | "coverage";

/** Shortens a label to what fits in `px` at the chart's 12px type; the
 * node's tooltip and <title> keep the full name. */
function fitLabel(label: string, px: number) {
  const max = Math.max(8, Math.floor(px / 6.4));
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
type Kind = "group" | "refinery" | "end";
type N = { id: string; label: string; kind: Kind; chainId: string | null; tone?: string };
type L = { source: string; target: string; value: number };

/**
 * Group → Refinery/KCP → (traceability | plot coverage), sized by mill
 * count. Hovering a node or a band highlights everything it connects to;
 * clicking a group or refinery opens it. Drawn with d3-sankey's layout and
 * plain React SVG, so it follows the page's tokens and language.
 */
export function PortfolioSankey({
  chains,
  coveredIds,
  onSelectChain,
  onSelectRefinery,
}: {
  chains: Chain[];
  coveredIds: Set<string> | null;
  onSelectChain: (chainId: string) => void;
  onSelectRefinery: (chainId: string, refinery: string) => void;
}) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<Mode>("trace");
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const endMeta = useMemo(
    () =>
      mode === "trace"
        ? [
            { id: "end:village", label: t.traceVillage, tone: "var(--color-risk-low)" },
            { id: "end:buffer", label: t.traceBufferPlain, tone: "var(--color-risk-medium)" },
            { id: "end:unknown", label: t.traceUnknown, tone: "var(--color-line)" },
          ]
        : [
            { id: "end:covered", label: t.withPlotsLabel, tone: "var(--color-comply)" },
            { id: "end:master", label: t.withoutPlotsLabel, tone: "var(--color-line)" },
          ],
    [mode, t],
  );

  const graph = useMemo(() => {
    const nodes = new Map<string, N>();
    const links = new Map<string, L>();
    const add = (source: string, target: string) => {
      const k = `${source}→${target}`;
      const l = links.get(k);
      if (l) l.value += 1;
      else links.set(k, { source, target, value: 1 });
    };
    for (const c of chains) {
      const gid = `g:${c.id}`;
      nodes.set(gid, { id: gid, label: groupLabel(c.name), kind: "group", chainId: c.id });
      for (const m of c.mills) {
        const ref = m.refinery || "—";
        const rid = `r:${c.id}:${ref}`;
        if (!nodes.has(rid)) nodes.set(rid, { id: rid, label: ref, kind: "refinery", chainId: c.id });
        add(gid, rid);
        const end =
          mode === "trace"
            ? m.traceability === "village"
              ? "end:village"
              : m.traceability === "buffer"
                ? "end:buffer"
                : "end:unknown"
            : coveredIds?.has(m.id)
              ? "end:covered"
              : "end:master";
        add(rid, end);
      }
    }
    for (const e of endMeta) {
      if ([...links.values()].some((l) => l.target === e.id)) {
        nodes.set(e.id, { id: e.id, label: e.label, kind: "end", chainId: null, tone: e.tone });
      }
    }
    const height = Math.max(420, Math.min(760, nodes.size * 15));
    const layout = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(10)
      .nodePadding(7)
      .nodeAlign(sankeyJustify)
      .extent([
        [150, 8],
        [width - 150, height - 8],
      ]);
    return {
      height,
      // Room between columns, for fitting labels (feedback 3, A-06).
      colGap: (width - 300) / 2,
      ...layout({ nodes: [...nodes.values()].map((d) => ({ ...d })), links: [...links.values()].map((d) => ({ ...d })) }),
    };
  }, [chains, coveredIds, mode, endMeta, width]);

  // The hovered node and only its own path: a group lights its refineries
  // and their end nodes; a refinery lights its group and ends; an end node
  // lights the refineries feeding it and their groups.
  const lit = useMemo(() => {
    if (!hover) return null;
    const on = new Set<string>([hover]);
    const from = (id: string) => graph.links.filter((l) => l.source.id === id).map((l) => l.target.id);
    const into = (id: string) => graph.links.filter((l) => l.target.id === id).map((l) => l.source.id);
    if (hover.startsWith("g:")) {
      for (const r of from(hover)) {
        on.add(r);
        for (const e of from(r)) on.add(e);
      }
    } else if (hover.startsWith("r:")) {
      for (const g of into(hover)) on.add(g);
      for (const e of from(hover)) on.add(e);
    } else {
      for (const r of into(hover)) {
        on.add(r);
        for (const g of into(r)) on.add(g);
      }
    }
    return on;
  }, [hover, graph]);

  // A band is lit only when it lies on that path — for an end node, just
  // the bands flowing into it, not the same refinery's other outputs.
  const bandLit = (s: string, tg: string) =>
    !!lit && lit.has(s) && lit.has(tg) && (!hover?.startsWith("end:") || !tg.startsWith("end:") || tg === hover);

  const linkPath = sankeyLinkHorizontal();
  const endTone = (id: string) => endMeta.find((e) => e.id === id)?.tone ?? "var(--color-line)";

  function showTip(e: React.PointerEvent, text: string) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text });
  }

  return (
    <section className="chart-card sankey-card">
      <header className="sankey-head">
        <div>
          <h3>{t.sankeyTitle}</h3>
          <p className="chart-note">{mode === "trace" ? t.sankeyIntroTrace : t.sankeyIntroCoverage}</p>
        </div>
        <div className="seg" role="group" aria-label={t.sankeyTitle}>
          <button type="button" className={mode === "trace" ? "on" : ""} aria-pressed={mode === "trace"} onClick={() => setMode("trace")}>
            {t.trace}
          </button>
          <button
            type="button"
            className={mode === "coverage" ? "on" : ""}
            aria-pressed={mode === "coverage"}
            onClick={() => setMode("coverage")}
            disabled={!coveredIds}
          >
            {t.coverageKpi}
          </button>
        </div>
      </header>
      <div className="sankey-box" ref={boxRef} onPointerLeave={() => setTip(null)}>
        <svg width={width} height={graph.height} role="img" aria-label={t.sankeyTitle}>
          <g fill="none">
            {graph.links.map((l, i) => {
              const on = !lit || bandLit(l.source.id, l.target.id);
              const tone = l.target.kind === "end" ? endTone(l.target.id) : "var(--color-faint)";
              return (
                <path
                  key={i}
                  d={linkPath(l) ?? ""}
                  stroke={on && lit ? tone : "var(--color-line)"}
                  strokeOpacity={lit ? (on ? 0.75 : 0.12) : 0.45}
                  strokeWidth={Math.max(1, l.width)}
                  onPointerEnter={() => setHover(l.source.id)}
                  onPointerMove={(e) =>
                    showTip(
                      e,
                      fill(t.sankeyTooltip, { from: l.source.label, to: l.target.label, n: formatCount(l.value, lang) }),
                    )
                  }
                  onPointerLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                />
              );
            })}
          </g>
          {graph.nodes.map((n) => {
            const on = !lit || lit.has(n.id);
            const clickable = n.kind !== "end";
            const fillColor = n.kind === "group" ? "var(--color-fg)" : n.kind === "refinery" ? "var(--color-fg-2)" : (n.tone ?? "var(--color-line)");
            const labelLeft = n.kind === "group";
            return (
              <g
                key={n.id}
                className={`sankey-node ${clickable ? "clickable" : ""}`}
                opacity={on ? 1 : 0.3}
                onPointerEnter={() => setHover(n.id)}
                onPointerMove={(e) =>
                  showTip(
                    e,
                    `${n.label}: ${formatCount(n.value, lang)} ${t.mills}${n.id === "end:unknown" ? ` — ${t.sankeyUnknownNote}` : ""}`,
                  )
                }
                onPointerLeave={() => {
                  setHover(null);
                  setTip(null);
                }}
                onClick={() => {
                  if (n.kind === "group" && n.chainId) onSelectChain(n.chainId);
                  if (n.kind === "refinery" && n.chainId && n.label !== "—") onSelectRefinery(n.chainId, n.label);
                }}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={`${n.label}, ${formatCount(n.value, lang)} ${t.mills}`}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && clickable) {
                    e.preventDefault();
                    if (n.kind === "group" && n.chainId) onSelectChain(n.chainId);
                    if (n.kind === "refinery" && n.chainId) onSelectRefinery(n.chainId, n.label);
                  }
                }}
              >
                <title>{`${n.label}: ${formatCount(n.value, lang)} ${t.mills}`}</title>
                <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(1, n.y1 - n.y0)} rx={2} fill={fillColor} />
                <text
                  x={labelLeft ? n.x0 - 8 : n.kind === "end" ? n.x1 + 8 : n.x1 + 6}
                  y={(n.y0 + n.y1) / 2}
                  dy="0.35em"
                  textAnchor={labelLeft ? "end" : "start"}
                  className={`sankey-label ${n.kind}`}
                >
                  {fitLabel(n.label, n.kind === "refinery" ? graph.colGap - 24 : 138)}
                  {n.kind !== "refinery" ? <tspan className="sankey-count"> {formatCount(n.value, lang)}</tspan> : null}
                </text>
              </g>
            );
          })}
        </svg>
        {tip ? (
          <div className="sankey-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            {tip.text}
          </div>
        ) : null}
      </div>
      {mode === "trace" && graph.nodes.some((n) => n.id === "end:unknown") ? (
        <p className="chart-note flow-footnote">{t.sankeyUnknownNote}</p>
      ) : null}
    </section>
  );
}

