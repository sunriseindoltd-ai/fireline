import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { KCell } from "@/components/fire-kcell";
import { StatusChip, distLabel } from "@/components/fire-incident";
import { DayAxis } from "@/components/fire-national";
import { WhatsAppLogo } from "@/components/brand-icons";
import { basemapStyle } from "@/lib/basemap";
import { addOutsideMask } from "@/lib/outside-mask";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { nationalCopy } from "@/lib/fire-national-copy";
import { change, waLink } from "@/lib/fire-national";
import { fill, formatCount } from "@/lib/format";
import { ago, fmtDay, fmtWhen, wibDay, type Case, type FireResponse, type StatusKey } from "@/lib/fire-ui";
import type { Polygon } from "@/lib/fire-geo";

/** Hotspots per estate are kept per WIB day (no hour), so the short period is "today and yesterday": 2 days. */
type Win = "2" | "7" | "28";
type BBox = [number, number, number, number];
type Shapes = Record<string, Polygon[]>;
type Zone = GeoJSON.Polygon | GeoJSON.MultiPolygon;
const EMPTY = { type: "FeatureCollection" as const, features: [] };
const DAY = 86400000;
const WIN_DAYS: Record<Win, number> = { "2": 2, "7": 7, "28": 28 };
/** Map style of the GAPKI flyer and wall (user, 2 Nov 2026): yellow boundaries, grey-white dashed 500 m zone, hotspots with a
 *  yellow-orange core, red rim and a soft red glow. */
const STYLE = { boundary: "#ffd60a", zone: "#d9dee2", core: "#ffd278", rim: "#ff3c1e", glow: "#ff4614" };
/** About 500 m in degrees, to frame a plot together with its zone. */
const ZONE_DEG = 0.0046;

/** A company's case seen through a period: detections per day in it, its points in it. */
type Seen = { c: Case; n: number; prev: number; pts: Case["pts"]; last: string | null };
function seen(c: Case, first: string, prevFirst: string): Seen {
  let n = 0, prev = 0;
  let last: string | null = null;
  for (const d of c.days) {
    if (d.day >= first) {
      n += d.n;
      if (!last || d.day > last) last = d.day;
    } else if (d.day >= prevFirst) prev += d.n;
  }
  return { c, n, prev, pts: c.pts.filter(([, , , di]) => (c.days[di]?.day ?? "") >= first), last };
}

/** A box around the points, padded, at width:height `aspect`. */
function frame(pts: [number, number][], aspect: number, pad: number, min = 0.03): BBox {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  let dw = Math.max(e - w, min) * (1 + pad);
  let dh = Math.max(n - s, min) * (1 + pad);
  if (dw / dh < aspect) dw = dh * aspect;
  else dh = dw / aspect;
  const cx = (w + e) / 2, cy = (s + n) / 2;
  return [cx - dw / 2, cy - dh / 2, cx + dw / 2, cy + dh / 2];
}
const corners = (g: Polygon[]): [number, number][] => g.flatMap((poly) => (poly[0] ?? []).map(([x, y]) => [x, y] as [number, number]));
const ringsOf = (g: Polygon[]) => g.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y])));
const svgPath = (rings: number[][][]) => rings.map((ring) => ring.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(5)},${(-y).toFixed(5)}`).join("") + "Z").join("");
const zoneRings = (z: Zone | null | undefined): number[][][] => (!z ? [] : z.type === "Polygon" ? z.coordinates : z.coordinates.flat());

/**
 * Snapshot for a card: Esri World Imagery for the box, the plots in yellow, the 500 m zone dashed, the period's hotspots in
 * the flyer's style, in one SVG so everything lines up at any size (`slice` = cover; imageSR 4326 on both sides).
 */
function Shot({ box, plots, zones, pts }: { box: BBox; plots: Polygon[][]; zones: (Zone | null | undefined)[]; pts: [number, number][] }) {
  const [W, S, E, N] = box;
  const h = Math.round((544 * (N - S)) / (E - W));
  const src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${W.toFixed(4)},${S.toFixed(4)},${E.toFixed(4)},${N.toFixed(4)}&bboxSR=4326&imageSR=4326&size=544,${h}&format=jpg&f=image`;
  const r = (E - W) * 0.0055;
  const inView = pts.filter(([x, y]) => x > W && x < E && y > S && y < N);
  return (
    <svg className="flx-shot" viewBox={`${W} ${-N} ${E - W} ${N - S}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="flx-glow">
          <stop offset="0" stopColor={STYLE.glow} stopOpacity="0.6" />
          <stop offset="1" stopColor={STYLE.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <image href={src} x={W} y={-N} width={E - W} height={N - S} preserveAspectRatio="none" />
      {zones.map((z, k) => (z ? <path key={`z${k}`} d={svgPath(zoneRings(z))} className="flx-shot-zone" vectorEffect="non-scaling-stroke" /> : null))}
      {plots.map((g, k) => (
        <path key={`p${k}`} d={svgPath(g.flat() as unknown as number[][][])} className="flx-shot-plot" vectorEffect="non-scaling-stroke" />
      ))}
      {inView.map(([x, y], k) => (
        <circle key={`g${k}`} cx={x} cy={-y} r={r * 2.8} fill="url(#flx-glow)" />
      ))}
      {inView.map(([x, y], k) => (
        <circle key={`c${k}`} cx={x} cy={-y} r={r} className="flx-shot-pt" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Legend in the flyer's words: hotspots of the period, plantation boundary, the 500 m zone. */
function Key({ winName }: { winName: string }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  return (
    <div className="fl-legend map-card flx-key">
      <span>
        <i className="flx-key-pt" aria-hidden="true" />
        {fill(f.homeKeyPts, { win: winName })}
      </span>
      <span>
        <i className="flx-key-bnd" aria-hidden="true" />
        {f.homeKeyBnd}
      </span>
      <span>
        <i className="flx-key-zone" aria-hidden="true" />
        {f.homeKeyZone}
      </span>
    </div>
  );
}

/**
 * The hero map, drawn like the Indonesia one in the flyer's style: Esri imagery, the plots in yellow, the 500 m zone
 * dashed, the period's hotspots, each estate labelled with its count; framed on the hotspots, the left kept for the text.
 */
function HeroMap({ rows, all, shapes, zones, padLeft, winName }: { rows: Seen[]; all: Case[]; shapes: Shapes; zones: Record<string, Zone | null>; padLeft: number; winName: string }) {
  const { lang } = useI18n();
  const g = nationalCopy[lang];
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: basemapStyle("esri"), bounds: [95, -11, 141, 6], interactive: false, attributionControl: { compact: true } });
    addOutsideMask(map);
    map.on("load", () => {
      map.addSource("hzone", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "hzone", type: "line", source: "hzone", paint: { "line-color": STYLE.zone, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.1, 12, 1.8], "line-dasharray": [3, 2.5], "line-opacity": 0.9 } });
      map.addSource("hplots", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "hplots-line", type: "line", source: "hplots", paint: { "line-color": STYLE.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 10, 1.8, 13, 2.6] } });
      map.addSource("hpts", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "hpts-glow", type: "circle", source: "hpts", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 9, 4, 11, 6, 14, 10], "circle-color": STYLE.glow, "circle-opacity": 0.5, "circle-blur": 1 } });
      map.addLayer({
        id: "hpts",
        type: "circle",
        source: "hpts",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.1, 9, 1.6, 11, 2.3, 14, 3.6],
          "circle-color": STYLE.core,
          "circle-stroke-color": STYLE.rim,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 11, 1.1, 14, 1.5],
        },
      });
      map.addSource("hlbl", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "hlbl",
        type: "symbol",
        source: "hlbl",
        layout: { "text-field": ["get", "t"], "text-size": 12.5, "text-font": ["Noto Sans Regular"], "text-anchor": "left", "text-offset": [0.9, 0], "text-max-width": 16, "text-allow-overlap": false },
        paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.6 },
      });
      setReady(true);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);
  // points, labels and framing follow the period
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const xy: [number, number][] = rows.flatMap((s) => s.pts.map(([x, y]) => [x, y] as [number, number]));
    (map.getSource("hpts") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: xy.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })),
    });
    (map.getSource("hlbl") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: rows
        .filter((s) => s.n > 0)
        .slice(0, 6)
        .map((s) => {
          const p = s.pts.reduce((b, q) => (q[2] > b[2] ? q : b), s.pts[0] ?? [s.c.lon, s.c.lat, 0, 0]);
          return { type: "Feature", properties: { t: `${s.c.name}\n${fill(g.lblN, { n: formatCount(s.n, lang) })}` }, geometry: { type: "Point", coordinates: [p[0], p[1]] } };
        }),
    });
    // a quiet period still shows the estates: framed on every case of the span
    const at = xy.length ? xy : all.map((c) => [c.lon, c.lat] as [number, number]);
    if (at.length) {
      const [w, s, e, n] = frame(at, 1, 0.15, 0.02);
      const el = ref.current!;
      // phone: the map is its own band above the text (CSS), without labels
      const narrow = el.clientWidth < 600;
      map.setLayoutProperty("hlbl", "visibility", narrow ? "none" : "visible");
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: narrow ? { left: 24, right: 24, top: 64, bottom: 24 } : { left: Math.round(el.clientWidth * padLeft), right: 40, top: 70, bottom: 50 }, maxZoom: 13, duration: 0 },
      );
    }
  }, [rows, all, ready, lang, padLeft, g.lblN]);
  // plot outlines and their 500 m zones as they arrive
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const feats: GeoJSON.Feature[] = [];
    for (const c of all)
      for (const p of c.aff) {
        const gg = shapes[p.id];
        if (gg?.length) feats.push({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: ringsOf(gg) } });
      }
    (map.getSource("hplots") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    (map.getSource("hzone") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: Object.values(zones)
        .filter((z): z is Zone => !!z)
        .map((z) => ({ type: "Feature", properties: {}, geometry: z })),
    });
  }, [all, shapes, zones, ready]);
  return (
    <div className="fl-map overview nat-map compact">
      <div ref={ref} className="fl-map-canvas" />
      <Key winName={winName} />
    </div>
  );
}

/** Solid status badge on a card, readable on imagery (the Indonesia cards use the same look). */
function Badge({ s }: { s: StatusKey }) {
  return (
    <span className={`flx-st ${s}`}>
      <StatusChip s={s} />
    </span>
  );
}

/**
 * Home of a company account (user, 2 Nov 2026: "buatkan beranda kek beranda yang Indonesia", "aku suka tampilan ini"):
 * the Indonesia home for one company — its hotspots on satellite imagery over a chosen period, the figures it acts on,
 * its estates as a whole and plot by plot, detections per day.
 */
export function CompanyHome({
  data,
  org,
  now,
  st,
  onOpen,
  onGo,
}: {
  data: FireResponse;
  org: string;
  now: number;
  st: (i: Case) => StatusKey;
  onOpen: (id: string) => void;
  onGo: (v: "inbox" | "map") => void;
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const g = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  // the period chosen before; the first time, the shortest one that has hotspots (an estate quiet for a week opens on 28 days)
  const [win, setWin] = useState<Win>(() => {
    try {
      const w = localStorage.getItem("fireline.homeWin");
      if (w === "2" || w === "7" || w === "28") return w;
    } catch {}
    const lastDay = data.history.reduce((a, c) => (c.last > a ? c.last : a), "");
    const age = lastDay ? (now - Date.parse(lastDay)) / DAY : Infinity;
    return age <= 2 ? "2" : age <= 7 ? "7" : "28";
  });
  const pickWin = (w: Win) => {
    setWin(w);
    try {
      localStorage.setItem("fireline.homeWin", w);
    } catch {}
  };
  // first WIB day of the period (today counts); the period before has the same length
  const first = wibDay(new Date(now - (WIN_DAYS[win] - 1) * DAY).toISOString());
  const prevFirst = wibDay(new Date(Date.parse(first) - WIN_DAYS[win] * DAY).toISOString());
  const winName = win === "2" ? f.homeWinName2 : win === "7" ? g.winName7 : g.winName28;
  // the whole 4-week span, so 28 days works; the period picks the days
  const rows = useMemo(
    () =>
      data.history
        .map((c) => seen(c, first, prevFirst))
        .filter((s) => s.n > 0)
        .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || b.n - a.n),
    [data.history, first, prevFirst],
  );
  const total = rows.reduce((a, s) => a + s.n, 0);
  // the period before: 28 days is the whole span held, so there is none
  const prev = win === "28" ? null : data.history.reduce((a, c) => a + seen(c, first, prevFirst).prev, 0);

  // plot outlines and 500 m zones of every case (one small request each)
  const [shapes, setShapes] = useState<Shapes>({});
  const [zones, setZones] = useState<Record<string, Zone | null>>({});
  const ids = data.history.slice(0, 12).map((c) => c.id).join(",");
  useEffect(() => {
    let alive = true;
    for (const id of ids.split(",").filter(Boolean)) {
      fetch(`/fire/shapes?e=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((s: Shapes) => alive && setShapes((cur) => ({ ...cur, ...s })))
        .catch(() => {});
      fetch(`/fire/buffer?e=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((z: Zone | null) => alive && setZones((cur) => ({ ...cur, [id]: z })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [ids]);

  // the company's own plot numbers (Plot 01, 02 …): the PalmTrace IDs belong to the supply chain, not to this company
  const plotNo = useMemo(() => {
    const ids = [...new Set(data.history.flatMap((c) => c.aff.map((p) => p.id)))].sort();
    const w = String(ids.length).length < 2 ? 2 : String(ids.length).length;
    return new Map(ids.map((id, i) => [id, String(i + 1).padStart(w, "0")]));
  }, [data.history]);
  // plot by plot: every affected plot whose latest hotspot falls in the period
  const plotRows = useMemo(
    () =>
      rows
        .flatMap((s) => s.c.aff.filter((p) => wibDay(p.last) >= first).map((p) => ({ s, p })))
        .sort((a, b) => b.p.last.localeCompare(a.p.last) || b.p.n - a.p.n),
    [rows, first],
  );

  const k = useMemo(() => {
    const plots = new Map<string, number>();
    for (const { p } of plotRows) plots.set(p.id, p.plot.ha || 0);
    const days = new Set(rows.flatMap((s) => s.c.days.filter((d) => d.day >= first).map((d) => d.day)));
    return {
      h24: data.history.filter((c) => now - Date.parse(c.last) <= DAY).length,
      open: rows.filter((s) => st(s.c) === "new").length,
      plots: plots.size,
      ha: [...plots.values()].reduce((a, v) => a + v, 0),
      days: days.size,
    };
  }, [rows, plotRows, first, now, st, data.history]);

  // detections per day over the last 28 days (7 for the short periods), as on the Indonesia chart
  const perDay = useMemo(() => {
    const span = win === "28" ? 28 : 7;
    const m = new Map<string, number>();
    for (let d = span - 1; d >= 0; d--) m.set(wibDay(new Date(now - d * DAY).toISOString()), 0);
    for (const c of data.history) for (const d of c.days) if (m.has(d.day)) m.set(d.day, (m.get(d.day) ?? 0) + d.n);
    return [...m];
  }, [data.history, win, now]);
  const max = Math.max(1, ...perDay.map(([, v]) => v));
  const peak = perDay.reduce((a, b) => (b[1] > a[1] ? b : a), perDay[0] ?? ["", 0]);

  const changeTxt = (a: number, b: number | null) => {
    const c = change(a, b);
    if (!c) return "";
    if (c.dir === "same") return g.same;
    return c.pct === null ? g.up : `${c.dir === "up" ? "▲" : "▼"} ${c.pct}%`;
  };
  const top = rows[0];
  const digest = [
    fill(f.homeWaHead, { org, time: fmtWhen(data.generated, lang) }),
    fill(f.homeWaTotal, { win: winName, n: n(total) }),
    ...rows.slice(0, 8).map((s) => `• ${s.c.name}: ${fill(g.lblN, { n: n(s.n) })}, ${fill(f.homeTileLast, { ago: ago(s.c.last, now, lang) })}${st(s.c) === "new" ? ` (${f.stNew.toLowerCase()})` : ""}`),
  ].join("\n");

  const winSeg = (
    <div className="seg fl-seg nat-win" role="group" aria-label={g.win}>
      {(
        [
          ["2", f.homeW2],
          ["7", g.w7],
          ["28", g.w28],
        ] as const
      ).map(([key, label]) => (
        <button key={key} type="button" className={win === key ? "on" : ""} aria-pressed={win === key} onClick={() => pickWin(key)}>
          {label}
        </button>
      ))}
    </div>
  );
  const ptsOf = (s: Seen) => (s.pts.length ? s.pts : s.c.pts).map(([x, y]) => [x, y] as [number, number]);

  return (
    <div className="page fl-page nat-page flx-home">
      <section className="flx-hero" aria-label={org}>
        <div className="flx-hero-map" aria-hidden="true">
          <HeroMap rows={rows} all={data.history} shapes={shapes} zones={zones} padLeft={0.42} winName={winName} />
        </div>
        <div className="flx-hero-shade" aria-hidden="true" />
        <div className="flx-hero-win">{winSeg}</div>
        <div className="flx-hero-text">
          <span className="flx-eyebrow">{fill(f.homeEyebrow, { org, win: winName })}</span>
          {total ? (
            <h1>
              <span className="flx-hero-n tabular-nums">{n(total)}</span>
              <span className="flx-hero-unit">{f.homeUnit}</span>
            </h1>
          ) : (
            <h1 className="flx-home-none">{fill(f.homeNone, { win: winName })}</h1>
          )}
          <p>
            {prev !== null ? fill(g.kpiPrevWin, { days: WIN_DAYS[win], n: n(prev), pct: changeTxt(total, prev) }) : null}
            {top && rows.length > 1 ? (
              <>
                {prev !== null ? <br /> : null}
                {fill(f.homeTop, { name: top.c.name, n: n([...rows].sort((a, b) => b.n - a.n)[0].n), m: n(total) })}
              </>
            ) : top ? (
              <>
                {prev !== null ? <br /> : null}
                {fill(f.homeLead1, { plots: n(k.plots) })}
              </>
            ) : null}
          </p>
          <div className="flx-hero-cta">
            <button type="button" className="btn-primary flx-big" onClick={() => onGo("inbox")}>
              {f.homeCases}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <a className="btn-secondary flx-big flx-glass" href={waLink(digest)} target="_blank" rel="noopener noreferrer" title={g.waNote}>
              <WhatsAppLogo /> {g.waDigest}
            </a>
          </div>
        </div>
        <span className="flx-hero-credit">{fill(f.homeCredit, { time: fmtWhen(data.generated, lang) })}</span>
      </section>

      <section className="fl-kgroup nat-kstrip" aria-label={org}>
        <div className="fl-kcells">
          <KCell value={k.h24} label={f.homeK24} hint={f.kpi24Hint} tone={k.h24 ? "danger" : undefined} sub={fill(data.history.length === 1 ? f.homeOf1 : f.homeOf, { n: n(data.history.length) })} />
          <KCell value={k.open} of={rows.length || undefined} label={f.kpiOpen} hint={f.kpiOpenHint} onClick={k.open ? () => onGo("inbox") : undefined} sub={fill(rows.length === 1 ? f.homeOf1 : f.homeOf, { n: n(rows.length) })} />
          <KCell value={k.plots} label={f.homePlots} sub={k.ha ? fill(f.homePlotsSub, { ha: `${n(Math.round(k.ha))} ha` }) : undefined} />
          <KCell value={k.days} label={f.homeDays} sub={fill(f.homeDaysSub, { n: n(WIN_DAYS[win]) })} />
        </div>
      </section>

      {rows.length ? (
        <section className="flx-row-sec" aria-labelledby="flx-own">
          <div className="flx-row-head">
            <h2 id="flx-own">{f.homeTiles}</h2>
            <span className="flx-row-note">{fill(f.homeTilesNote, { win: winName })}</span>
            <button type="button" className="flx-row-all linkish" onClick={() => onGo("inbox")}>
              {g.tilesAll} ›
            </button>
          </div>
          <div className="flx-row">
            {rows.map((s) => {
              const plots = s.c.aff.map((p) => shapes[p.id]).filter((x): x is Polygon[] => !!x?.length);
              const at = plots.length ? plots.flatMap(corners) : ptsOf(s);
              const box = frame(at, 1.8, 0.25, 0.02);
              return (
                <button key={s.c.id} type="button" className="flx-tile" onClick={() => onOpen(s.c.id)} title={f.homeOpen}>
                  <span className="flx-tile-img">
                    <Shot box={box} plots={plots} zones={[zones[s.c.id]]} pts={ptsOf(s)} />
                    <span className="flx-tile-badge">
                      <Badge s={st(s.c)} />
                    </span>
                  </span>
                  <span className="flx-tile-body">
                    <b>{s.c.name}</b>
                    <small>{[s.c.mills.slice(0, 2).join(", "), s.c.plot.village || s.c.plot.district].filter(Boolean).join(" · ")}</small>
                    <span className="flx-tile-n">
                      <strong className="tabular-nums">{n(s.n)}</strong> {g.heroUnit} · {fill(s.c.aff.length === 1 ? f.homePlot1 : f.homePlotN, { n: n(s.c.aff.length) })}
                    </span>
                    <span className={now - Date.parse(s.c.last) <= DAY ? "flx-tile-24" : "flx-tile-ago"}>{fill(f.homeTileLast, { ago: ago(s.c.last, now, lang) })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {plotRows.length ? (
        <section className="flx-row-sec" aria-labelledby="flx-plots">
          <div className="flx-row-head">
            <h2 id="flx-plots">{f.homePlotsTitle}</h2>
            <span className="flx-row-note">{fill(f.homePlotsNote, { n: n(plotRows.length), win: winName })}</span>
          </div>
          <div className="flx-row">
            {plotRows.slice(0, 40).map(({ s, p }) => {
              const shape = shapes[p.id];
              const box: BBox = shape?.length ? frame(corners(shape), 1.8, 0.2, ZONE_DEG * 2.4) : frame(ptsOf(s), 1.8, 0.3);
              const [w0, s0, e0, n0] = box;
              const near = ptsOf(s).filter(([x, y]) => x > w0 - ZONE_DEG && x < e0 + ZONE_DEG && y > s0 - ZONE_DEG && y < n0 + ZONE_DEG);
              return (
                <button key={`${s.c.id}:${p.id}`} type="button" className="flx-tile flx-plot-tile" onClick={() => onOpen(s.c.id)} title={f.homeOpen}>
                  <span className="flx-tile-img">
                    <Shot box={box} plots={shape ? [shape] : []} zones={[zones[s.c.id]]} pts={near} />
                    <span className="flx-tile-badge">
                      <Badge s={st(s.c)} />
                    </span>
                  </span>
                  <span className="flx-tile-body">
                    <b className="flx-plot-id">{fill(f.homePlotLabel, { n: plotNo.get(p.id) ?? "" })}</b>
                    <small>{[p.plot.village, p.plot.district].filter(Boolean).join(", ") || s.c.name}</small>
                    <span className="flx-tile-n">
                      <strong className="tabular-nums">{n(p.n)}</strong> {g.heroUnit} · {distLabel(p.d, lang)}
                    </span>
                    <span className={now - Date.parse(p.last) <= DAY ? "flx-tile-24" : "flx-tile-ago"}>
                      {[p.plot.ha ? `${n(Math.round(p.plot.ha))} ha` : "", fill(f.homeTileLast, { ago: ago(p.last, now, lang) })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="fl-note flx-row-credit">{f.homeTilesCredit}</p>
        </section>
      ) : null}

      <section className="chart-card fl-perday flx-home-days">
        <div className="fl-card-head">
          <h2 className="fl-h2">{peak[1] ? fill(f.homePerDayPeak, { n: n(peak[1]), day: fmtDay(peak[0], lang) }) : f.homePerDay}</h2>
        </div>
        <div className="fl-days nat-days" role="img" aria-label={f.homePerDay}>
          {perDay.map(([d, v], i) => (
            <div key={d} className={`fl-day ${i === perDay.length - 1 ? "today" : ""}`} title={`${fmtDay(d, lang)}: ${n(v)}`}>
              <span className={`fl-day-bar ${v ? "" : "zero"}`} style={{ height: `${v ? Math.max(2, (v / max) * 100) : 1}%` }}>
                {v ? <i style={{ flexGrow: 1, background: "var(--flx-hot)" }} /> : null}
              </span>
            </div>
          ))}
        </div>
        <DayAxis days={perDay.map(([d]) => d)} />
        <p className="fl-note">{f.homePerDayNote}</p>
      </section>
    </div>
  );
}
