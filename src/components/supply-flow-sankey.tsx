import { useEffect, useMemo, useRef, useState } from "react";
import { sankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { fill, formatCount, formatHa } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { VillageFlows } from "@/lib/eudr-aggregates.server";

export type FlowMill = { name: string; refinery: string; port: string };

type Kind = "village" | "mill" | "refinery" | "port";
type N = { id: string; label: string; full: string; kind: Kind };
type L = { source: string; target: string; value: number };

// Named nodes per column before the rest are grouped (user, 30 Sep 2026:
// "kalau desanya kebanyakan, digabung jadi Other").
const TOP_MILLS = 12;
const TOP_REFINERIES = 8;
const COLUMN_TONE: Record<Kind, string> = {
  village: "var(--color-risk-low)",
  mill: "var(--color-fg)",
  refinery: "var(--color-fg-2)",
  port: "var(--color-link)",
};
const LABEL_PX = 6.4; // average glyph width at 12px, for fitting labels

/**
 * The group Summary's supply flow (feedback 3, A-06): Village → Mill →
 * Refinery/KCP → Port, sized by plot area. Villages come from the plots
 * (the server keeps the largest by name and groups the rest), mills beyond
 * the largest few are grouped too, so the chart stays readable for a
 * 200-mill group. Mills without plot data have no area and are left out
 * (said under the chart). Same d3-sankey + plain SVG approach as
 * PortfolioSankey.
 */
export function SupplyFlowSankey({
  mills,
  hideCoverageNote,
}: {
  mills: Map<string, FlowMill>;
  /** Present mode: leave out "n mills without plot data…", like the
   * summary's own coverage notice. */
  hideCoverageNote?: boolean;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<VillageFlows | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const idsKey = JSON.stringify([...mills.keys()].sort());

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(720, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void fetchWithRetry("/village-flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ millIds: JSON.parse(idsKey) as string[] }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as VillageFlows);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const graph = useMemo(() => {
    if (!data || data.flows.length === 0) return null;
    const ha = (v: number) => formatHa(v, lang);
    const nodes = new Map<string, N>();
    const links = new Map<string, L>();
    const add = (source: string, target: string, value: number) => {
      const k = `${source}→${target}`;
      const l = links.get(k);
      if (l) l.value += value;
      else links.set(k, { source, target, value });
    };

    // Mills: the largest by area keep their name.
    const millArea = new Map<string, number>();
    for (const f of data.flows) millArea.set(f.millId, (millArea.get(f.millId) ?? 0) + f.ha);
    const rankedMills = [...millArea].sort((a, b) => b[1] - a[1]);
    const namedMills = new Set(rankedMills.slice(0, TOP_MILLS).map(([id]) => id));
    const otherMills = rankedMills.length - namedMills.size;
    const millNode = (id: string) => (namedMills.has(id) ? `m:${id}` : "m:__other__");

    // Refineries: same, by the area their mills bring.
    const refArea = new Map<string, number>();
    for (const [id, a] of millArea) {
      const r = mills.get(id)?.refinery || "—";
      refArea.set(r, (refArea.get(r) ?? 0) + a);
    }
    const rankedRefs = [...refArea].sort((a, b) => b[1] - a[1]);
    const namedRefs = new Set(rankedRefs.slice(0, TOP_REFINERIES).map(([r]) => r));
    const otherRefs = rankedRefs.length - namedRefs.size;
    const refNode = (r: string) => (namedRefs.has(r) ? `r:${r}` : "r:__other__");

    const villageName = new Map(data.villages.map((v) => [v.key, v]));
    const otherVillages = Math.max(0, data.villageCount - data.villages.length);
    for (const f of data.flows) {
      const vid = `v:${f.village}`;
      if (!nodes.has(vid)) {
        const v = villageName.get(f.village);
        const name =
          f.village === "other"
            ? fill(t.flowOtherVillages, { n: formatCount(otherVillages, lang) })
            : f.village === "none"
              ? t.flowNoVillage
              : v?.name.startsWith("#")
                ? fill(t.flowVillageCode, { id: v.name.slice(1) })
                : (v?.name ?? f.village);
        nodes.set(vid, { id: vid, label: name, full: v?.district ? `${name}, ${v.district}` : name, kind: "village" });
      }
      const mid = millNode(f.millId);
      if (!nodes.has(mid)) {
        const name = mid === "m:__other__" ? fill(t.flowOtherMills, { n: formatCount(otherMills, lang) }) : (mills.get(f.millId)?.name ?? f.millId);
        nodes.set(mid, { id: mid, label: name, full: name, kind: "mill" });
      }
      add(vid, mid, f.ha);
    }
    for (const [id, a] of millArea) {
      const m = mills.get(id);
      const ref = m?.refinery || "—";
      const rid = refNode(ref);
      if (!nodes.has(rid)) {
        const name = rid === "r:__other__" ? fill(t.flowOtherRefineries, { n: formatCount(otherRefs, lang) }) : ref;
        nodes.set(rid, { id: rid, label: name, full: name, kind: "refinery" });
      }
      add(millNode(id), rid, a);
      const port = m?.port?.trim() || "";
      const pid = `p:${port || "__none__"}`;
      if (!nodes.has(pid)) {
        const name = port || t.flowNoPort;
        nodes.set(pid, { id: pid, label: name, full: name, kind: "port" });
      }
      add(rid, pid, a);
    }

    const perColumn = (k: Kind) => [...nodes.values()].filter((n) => n.kind === k).length;
    const rows = Math.max(perColumn("village"), perColumn("mill"), perColumn("refinery"), perColumn("port"));
    const height = Math.max(380, Math.min(860, rows * 34));
    const left = 190;
    const right = 170;
    const layout = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(10)
      .nodePadding(12)
      .nodeAlign(sankeyLeft)
      .extent([
        [left, 8],
        [width - right, height - 8],
      ]);
    const g = layout({ nodes: [...nodes.values()].map((d) => ({ ...d })), links: [...links.values()].map((d) => ({ ...d })) });
    const colGap = (width - left - right) / 3;
    return { ...g, height, left, right, colGap, ha };
  }, [data, mills, t, lang, width]);

  // Everything upstream and downstream of the hovered node.
  const lit = useMemo(() => {
    if (!hover || !graph) return null;
    const on = new Set<string>([hover]);
    const walk = (id: string, dir: "up" | "down") => {
      for (const l of graph.links) {
        const [from, to] = dir === "down" ? [l.source.id, l.target.id] : [l.target.id, l.source.id];
        if (from === id && !on.has(to)) {
          on.add(to);
          walk(to, dir);
        }
      }
    };
    walk(hover, "down");
    walk(hover, "up");
    return on;
  }, [hover, graph]);

  function showTip(e: React.PointerEvent, text: string) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left + (boxRef.current?.scrollLeft ?? 0), y: e.clientY - box.top, text });
  }
  // Below the pointer in the upper half, above it in the lower half — the
  // scroll box clips anything that runs past its bottom edge.
  const tipStyle = (tp: { x: number; y: number }) =>
    graph && tp.y > graph.height / 2
      ? { left: tp.x + 12, bottom: graph.height - tp.y + 12 }
      : { left: tp.x + 12, top: tp.y + 12 };

  const leftOut = useMemo(() => {
    const withArea = new Set(data?.flows.map((f) => f.millId));
    return [...mills.keys()].filter((id) => !withArea.has(id)).length;
  }, [data, mills]);
  const linkPath = sankeyLinkHorizontal();

  return (
    <section className="chart-card sankey-card flow-card">
      <header className="sankey-head">
        <div>
          <h3>{t.flowTitle}</h3>
          <p className="chart-note">
            {fill(t.flowIntro, {
              n: formatCount(data?.villages.length ?? 0, lang),
              total: formatCount(data?.villageCount ?? 0, lang),
            })}
          </p>
        </div>
      </header>
      {state === "loading" ? (
        <div className="eudr-loading" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>{t.flowLoading}</p>
        </div>
      ) : state === "error" || !graph ? (
        <p className="chart-note">{state === "error" ? t.flowError : t.flowEmpty}</p>
      ) : (
        <div className="sankey-box" ref={boxRef} onPointerLeave={() => setTip(null)}>
          <svg width={width} height={graph.height} role="img" aria-label={t.flowTitle}>
            <g fill="none">
              {graph.links.map((l, i) => {
                const on = !!lit && lit.has(l.source.id) && lit.has(l.target.id);
                return (
                  <path
                    key={i}
                    d={linkPath(l) ?? ""}
                    stroke={on ? COLUMN_TONE[l.source.kind] : "var(--color-line)"}
                    strokeOpacity={lit ? (on ? 0.7 : 0.1) : 0.45}
                    strokeWidth={Math.max(1, l.width ?? 1)}
                    onPointerEnter={() => setHover(l.source.id)}
                    onPointerMove={(e) =>
                      showTip(e, fill(t.flowTooltip, { from: l.source.full, to: l.target.full, ha: graph.ha(l.value) }))
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
              const labelLeft = n.kind === "village";
              // Room up to the next column (or the page edge) decides how much
              // of the name fits; the tooltip always has all of it.
              const room = labelLeft ? graph.left - 12 : n.kind === "port" ? graph.right - 12 : graph.colGap - 24;
              const max = Math.max(8, Math.floor(room / LABEL_PX));
              const label = n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label;
              return (
                <g
                  key={n.id}
                  className="sankey-node"
                  opacity={on ? 1 : 0.3}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerMove={(e) => showTip(e, `${n.full}: ${graph.ha(n.value ?? 0)}`)}
                  onPointerLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                >
                  <title>{`${n.full}: ${graph.ha(n.value ?? 0)}`}</title>
                  <rect
                    x={n.x0}
                    y={n.y0}
                    width={(n.x1 ?? 0) - (n.x0 ?? 0)}
                    height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))}
                    rx={2}
                    fill={COLUMN_TONE[n.kind]}
                  />
                  <text
                    x={labelLeft ? (n.x0 ?? 0) - 8 : (n.x1 ?? 0) + 6}
                    y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                    dy="0.35em"
                    textAnchor={labelLeft ? "end" : "start"}
                    className={`sankey-label ${n.kind === "mill" ? "group" : n.kind === "refinery" ? "refinery" : ""}`}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
          {tip ? (
            <div className="sankey-tip" style={tipStyle(tip)}>
              {tip.text}
            </div>
          ) : null}
        </div>
      )}
      {state === "ready" && leftOut > 0 && !hideCoverageNote ? (
        <p className="chart-note flow-footnote">{fill(t.flowMillsLeftOut, { n: formatCount(leftOut, lang) })}</p>
      ) : null}
    </section>
  );
}
