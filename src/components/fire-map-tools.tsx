import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type maplibregl from "maplibre-gl";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { fill } from "@/lib/format";
import { centroid, circleRing, formatArea, formatDD, formatDMS, formatLength, pathLengthM, ringAreaM2, type LngLat } from "@/lib/fire-measure";

export type Tool = "ruler" | "area" | "point" | "circle";
const RADII = [500, 1000, 2000, 5000];
const SRC = "tool";
const PREVIEW = "tool-preview";
const YELLOW = "#ffd60a";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Simple measuring tools drawn on the FireLine map: ruler (distance along a
 * path), area of a polygon, coordinates of a point and a radius circle, plus a
 * full-screen toggle. The toolbar is portalled into a MapLibre control slot so
 * it stacks under the zoom buttons; the readout is a card in the map corner.
 */
export function MapTools({ map, el, wrap, onActive }: { map: maplibregl.Map; el: HTMLElement; wrap: HTMLElement | null; onActive: (on: boolean) => void }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const [tool, setTool] = useState<Tool | null>(null);
  const [pts, setPts] = useState<LngLat[]>([]);
  const [done, setDone] = useState(false);
  const [radius, setRadius] = useState(1000);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const st = useRef({ tool, pts, done });
  st.current = { tool, pts, done };

  const finish = useCallback(() => {
    const { tool, pts } = st.current;
    if (!tool) return;
    // A double-click also fires two clicks on the same spot: drop the repeat.
    const w = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    setPts(w);
    if (w.length >= (tool === "area" ? 3 : 2)) setDone(true);
  }, []);

  // Sources, layers and map events (once per map).
  useEffect(() => {
    if (!map.getStyle()) return;
    map.addSource(SRC, { type: "geojson", data: EMPTY });
    map.addSource(PREVIEW, { type: "geojson", data: EMPTY });
    map.addLayer({ id: "tool-fill", type: "fill", source: SRC, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": YELLOW, "fill-opacity": 0.16 } });
    map.addLayer({ id: "tool-line-bg", type: "line", source: SRC, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#1d1d1f", "line-width": 5, "line-opacity": 0.55 }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "tool-line", type: "line", source: SRC, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": YELLOW, "line-width": 2.5 }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "tool-preview", type: "line", source: PREVIEW, paint: { "line-color": YELLOW, "line-width": 2, "line-dasharray": [2, 2] } });
    map.addLayer({
      id: "tool-pts",
      type: "circle",
      source: SRC,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": ["case", ["boolean", ["get", "big"], false], 6, 4.5], "circle-color": "#ffffff", "circle-stroke-color": "#1d1d1f", "circle-stroke-width": 2 },
    });
    map.addLayer({
      id: "tool-lbl",
      type: "symbol",
      source: SRC,
      filter: ["has", "label"],
      layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Regular"], "text-anchor": "top", "text-offset": [0, 0.8], "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.6 },
    });

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { tool, done } = st.current;
      if (!tool) return;
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      if (tool === "point" || tool === "circle") {
        setPts([p]);
        setDone(true);
      } else if (done) {
        setPts([p]);
        setDone(false);
      } else setPts((v) => [...v, p]);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      if (!st.current.tool) return;
      e.preventDefault();
      finish();
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const { tool, pts, done } = st.current;
      const src = map.getSource(PREVIEW) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!tool || done || !pts.length || tool === "point" || tool === "circle") return src.setData(EMPTY);
      const c: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const coords = tool === "area" && pts.length >= 2 ? [pts[pts.length - 1], c, pts[0]] : [pts[pts.length - 1], c];
      src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
    };
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      map.off("mousemove", onMove);
      try {
        if (!map.getStyle()) return;
        for (const id of ["tool-lbl", "tool-pts", "tool-preview", "tool-line", "tool-line-bg", "tool-fill"]) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of [SRC, PREVIEW]) if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* map already removed */
      }
    };
  }, [map, finish]);

  // Tool on/off: cursor, double-click zoom, and tell the map to stop selecting incidents.
  useEffect(() => {
    onActive(!!tool);
    map.getCanvas().style.cursor = tool ? "crosshair" : "";
    if (tool) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    if (!tool) (map.getSource(PREVIEW) as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY);
  }, [tool, map, onActive]);

  // Keyboard: Enter finishes, Esc closes the tool (the drawing stays until cleared).
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setTool(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, finish]);

  // Draw the current measurement.
  const length = pathLengthM(pts);
  const area = tool === "area" && pts.length >= 3 ? ringAreaM2(pts) : 0;
  useEffect(() => {
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const fts: GeoJSON.Feature[] = [];
    const pt = (c: LngLat, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } });
    if (tool === "point" && pts[0]) fts.push(pt(pts[0], { big: true, label: formatDD(pts[0][1], pts[0][0]) }));
    else if (tool === "circle" && pts[0]) {
      fts.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(pts[0], radius)] } });
      fts.push(pt(pts[0], { big: true, label: formatLength(radius, lang) }));
    } else if (tool === "ruler" || tool === "area") {
      if (pts.length >= 2) fts.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: tool === "area" && done ? [...pts, pts[0]] : pts } });
      if (tool === "area" && pts.length >= 3) {
        fts.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } });
        fts.push(pt(centroid(pts), { label: formatArea(ringAreaM2(pts), lang) }));
      }
      pts.forEach((p, i) => fts.push(pt(p, tool === "ruler" && i > 0 ? { label: formatLength(pathLengthM(pts.slice(0, i + 1)), lang) } : {})));
    }
    src.setData({ type: "FeatureCollection", features: fts });
    if (done || !pts.length) (map.getSource(PREVIEW) as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY);
  }, [map, tool, pts, done, radius, lang]);

  // Full screen on the whole map box (overlays included).
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement && document.fullscreenElement === wrap);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [wrap]);
  const toggleFull = () => {
    if (!wrap) return;
    if (document.fullscreenElement === wrap) void document.exitFullscreen();
    else void wrap.requestFullscreen?.();
  };

  const pick = (t: Tool) => {
    if (t === tool) {
      setTool(null);
      return;
    }
    if (t !== tool) {
      setPts([]);
      setDone(false);
    }
    setTool(t);
  };
  const clear = () => {
    setPts([]);
    setDone(false);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const canFull = typeof document !== "undefined" && !!document.fullscreenEnabled;
  const toolbar = (
    <>
      {canFull ? (
        <button type="button" onClick={toggleFull} title={full ? f.toolExitFullscreen : f.toolFullscreen} aria-label={full ? f.toolExitFullscreen : f.toolFullscreen} aria-pressed={full}>
          <Icon k={full ? "exit" : "full"} />
        </button>
      ) : null}
      {(
        [
          ["ruler", f.toolRuler],
          ["area", f.toolArea],
          ["point", f.toolPoint],
          ["circle", f.toolCircle],
        ] as [Tool, string][]
      ).map(([k, label]) => (
        <button key={k} type="button" className={tool === k ? "on" : ""} onClick={() => pick(k)} title={label} aria-label={label} aria-pressed={tool === k} data-tool={k}>
          <Icon k={k} />
        </button>
      ))}
      {pts.length ? (
        <button type="button" onClick={clear} title={f.toolClear} aria-label={f.toolClear} data-tool="clear">
          <Icon k="clear" />
        </button>
      ) : null}
    </>
  );

  const name = tool === "ruler" ? f.toolRuler : tool === "area" ? f.toolArea : tool === "point" ? f.toolPoint : f.toolCircle;
  const hint = tool === "ruler" ? f.toolRulerHint : tool === "area" ? f.toolAreaHint : tool === "point" ? f.toolPointHint : f.toolCircleHint;
  const min = tool === "area" ? 3 : 2;
  const p0 = pts[0];

  return (
    <>
      {createPortal(toolbar, el)}
      {tool ? (
        <div className="fl-measure map-card" role="dialog" aria-label={name}>
          <div className="fl-measure-head">
            <b>{name}</b>
            <button type="button" className="fl-x" aria-label={f.toolClose} onClick={() => setTool(null)}>
              ×
            </button>
          </div>
          <p className="fl-measure-hint">{hint}</p>
          {tool === "ruler" && pts.length ? (
            <dl>
              <dt>{f.toolTotal}</dt>
              <dd className="tabular-nums">{pts.length >= 2 ? formatLength(length, lang) : "—"}</dd>
              <dt>{fill(f.toolPointsN, { n: pts.length })}</dt>
              <dd />
            </dl>
          ) : null}
          {tool === "area" && pts.length ? (
            <dl>
              <dt>{f.toolAreaVal}</dt>
              <dd className="tabular-nums">{pts.length >= 3 ? formatArea(area, lang) : "—"}</dd>
              <dt>{f.toolPerimeter}</dt>
              <dd className="tabular-nums">{pts.length >= 3 ? formatLength(pathLengthM([...pts, pts[0]]), lang) : "—"}</dd>
              <dt>{fill(f.toolPointsN, { n: pts.length })}</dt>
              <dd />
            </dl>
          ) : null}
          {tool === "point" && p0 ? (
            <>
              <code className="fl-measure-coord">{formatDD(p0[1], p0[0])}</code>
              <code className="fl-measure-coord">{formatDMS(p0[1], p0[0])}</code>
              <div className="fl-measure-actions">
                <button type="button" className="btn-secondary small" onClick={() => copy(formatDD(p0[1], p0[0]))}>
                  {copied ? f.toolCopied : f.toolCopy}
                </button>
                <a className="btn-text small" href={`https://www.google.com/maps?q=${p0[1].toFixed(6)},${p0[0].toFixed(6)}`} target="_blank" rel="noopener noreferrer">
                  {f.toolGmaps}
                </a>
              </div>
            </>
          ) : null}
          {tool === "circle" ? (
            <>
              <div className="fl-measure-chips" role="group" aria-label={f.toolRadius}>
                {RADII.map((r) => (
                  <button key={r} type="button" className={radius === r ? "on" : ""} aria-pressed={radius === r} onClick={() => setRadius(r)}>
                    {formatLength(r, lang)}
                  </button>
                ))}
              </div>
              {p0 ? (
                <dl>
                  <dt>{f.toolRadius}</dt>
                  <dd className="tabular-nums">{formatLength(radius, lang)}</dd>
                  <dt>{f.toolCircleArea}</dt>
                  <dd className="tabular-nums">{formatArea(Math.PI * radius * radius, lang)}</dd>
                  <dt>{f.toolPoint}</dt>
                  <dd className="tabular-nums">{formatDD(p0[1], p0[0])}</dd>
                </dl>
              ) : null}
            </>
          ) : null}
          {(tool === "ruler" || tool === "area") && pts.length ? (
            <div className="fl-measure-actions">
              {!done ? (
                <>
                  <button type="button" className="btn-secondary small" disabled={pts.length < min} onClick={finish}>
                    {f.toolDone}
                  </button>
                  <button type="button" className="btn-text small" onClick={() => setPts((v) => v.slice(0, -1))}>
                    {f.toolUndo}
                  </button>
                </>
              ) : null}
              <button type="button" className="btn-text small" onClick={clear}>
                {f.toolClear}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Icon({ k }: { k: Tool | "clear" | "full" | "exit" }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (k) {
    case "ruler":
      return (
        <svg {...common}>
          <path d="M3 17 17 3l4 4L7 21z" />
          <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
        </svg>
      );
    case "area":
      return (
        <svg {...common}>
          <path d="M5 7 12 4l7 4-2 9H7z" />
          <circle cx="5" cy="7" r="1.3" fill="currentColor" />
          <circle cx="12" cy="4" r="1.3" fill="currentColor" />
          <circle cx="19" cy="8" r="1.3" fill="currentColor" />
          <circle cx="17" cy="17" r="1.3" fill="currentColor" />
          <circle cx="7" cy="17" r="1.3" fill="currentColor" />
        </svg>
      );
    case "point":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <path d="M12 12h8" />
        </svg>
      );
    case "clear":
      return (
        <svg {...common}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      );
    case "full":
      return (
        <svg {...common}>
          <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />
        </svg>
      );
  }
}
