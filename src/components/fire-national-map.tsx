import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemapStyle } from "@/lib/basemap";
import { fill, formatCount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { nationalCopy } from "@/lib/fire-national-copy";
import { COLOR } from "@/lib/fire-ui";
import { PT, SRC_KEYS, ageClass, inWin, ptIn, waLink, type NatData, type Win } from "@/lib/fire-national";
import { pointAlert } from "@/lib/fire-national-wa";
import { Imagery, SlotControl, type Bounds } from "@/components/fire-map";
import { MapTools } from "@/components/fire-map-tools";
import { ContextLayers, distKm, onMill } from "@/components/fire-layers";

const EMPTY = { type: "FeatureCollection" as const, features: [] };
const ID_BBOX: [number, number, number, number] = [95, -11, 141, 6];
const AGE_COLORS = [COLOR.new24, COLOR.new3, COLOR.newOld, COLOR.newWeek];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The national hotspot map: every point of the period coloured by the age of its last detection, the
 * selected company's points ringed, a popup per point (where, whose boundary, which estate). `fit` moves
 * the camera (a company, a province); `onView` reports the visible bounds.
 */
export function NationalMap({
  data,
  win,
  selOwner,
  onSelectOwner,
  onView,
  fit,
  compact = false,
  imageryFor = null,
  labels = 5,
}: {
  data: NatData;
  win: Win;
  selOwner: number | null;
  onSelectOwner?: (o: number) => void;
  onView?: (b: Bounds) => void;
  /** Frame these bounds when the object changes. */
  fit?: { bbox: Bounds; key: string } | null;
  /** Small map on the overview: no tools, no layer card. */
  compact?: boolean;
  /** Sentinel-1/2 imagery card for this point and day (the selected company's newest hotspot). */
  imageryFor?: { id: string; lat: number; lon: number; day: string } | null;
  /** Label the companies with the most hotspots in the period (0 = none). */
  labels?: number;
}) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [toolEl, setToolEl] = useState<HTMLElement | null>(null);
  const toolOn = useRef(false);
  const [tooling, setTooling] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const onToolActive = useCallback((on: boolean) => {
    toolOn.current = on;
    setTooling(on);
  }, []);
  const popup = useRef<maplibregl.Popup | null>(null);
  const live = useRef({ data, lang, onSelectOwner, onView });
  live.current = { data, lang, onSelectOwner, onView };
  // Mill popup: detections of the period drawn on the map within `km` of the mill.
  const nearMill = (lon: number, lat: number, km: number) => {
    const p = data.pts;
    const nDays = data.days.length;
    let n = 0;
    for (let i = 0; i < p.length; i += PT) {
      if (!ptIn(p, i, win, nDays)) continue;
      const x = p[i] / 1e4, y = p[i + 1] / 1e4;
      if (Math.abs(y - lat) > km / 100 || Math.abs(x - lon) > km / 100) continue;
      if (distKm(lon, lat, x, y) <= km) n += p[i + 3];
    }
    return { n, period: win === "24" ? f.winName24 : win === "7" ? f.winName7 : f.winName28 };
  };

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle("esri"),
      bounds: ID_BBOX,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
    if (import.meta.env.DEV) (window as unknown as { __natmap?: maplibregl.Map }).__natmap = map;
    if (!compact) {
      const slot = new SlotControl("maplibregl-ctrl maplibregl-ctrl-group fl-mtools");
      map.addControl(slot, "top-left");
      setToolEl(slot.el);
    }
    map.on("load", () => {
      map.addSource("npts", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "npts",
        type: "circle",
        source: "npts",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["interpolate", ["linear"], ["get", "n"], 1, 1.6, 20, 3], 8, ["interpolate", ["linear"], ["get", "n"], 1, 3, 20, 6], 12, ["interpolate", ["linear"], ["get", "n"], 1, 6, 20, 10]],
          "circle-color": ["match", ["get", "a"], 0, AGE_COLORS[0], 1, AGE_COLORS[1], 2, AGE_COLORS[2], AGE_COLORS[3]],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#3a1600",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 0, 8, 0.6],
        },
      });
      map.addSource("nlbl", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "npts-sel",
        type: "circle",
        source: "npts",
        filter: ["==", ["get", "o"], -2],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 7, 12, 12],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "nlbl",
        type: "symbol",
        source: "nlbl",
        layout: {
          "text-field": ["get", "t"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 9, 13],
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "text-max-width": 14,
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.6 },
      });
      if (!compact) {
        map.on("click", "npts", (ev) => {
          if (toolOn.current || onMill(map, ev.point)) return;
          const ft = ev.features?.[0];
          if (ft) showPopup(map, Number(ft.properties?.i), ev.lngLat);
        });
        map.on("mouseenter", "npts", () => {
          if (!toolOn.current) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "npts", () => {
          if (!toolOn.current) map.getCanvas().style.cursor = "";
        });
      }
      const report = () => {
        const b = map.getBounds();
        live.current.onView?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      map.on("moveend", report);
      report();
      setReady(true);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      popup.current?.remove();
      map.remove();
      mapRef.current = null;
      setToolEl(null);
      setReady(false);
    };
  }, [compact]); // eslint-disable-line react-hooks/exhaustive-deps

  function showPopup(map: maplibregl.Map, i: number, at: maplibregl.LngLatLike) {
    const { data: d, lang: lg } = live.current;
    const c = nationalCopy[lg];
    const p = d.pts;
    const n = (v: number) => formatCount(v, lg);
    const kab = d.kab[p[i + 7]];
    const unit = p[i + 6] >= 0 ? d.units[p[i + 6]] : null;
    const owner = unit && unit.o >= 0 ? d.owners[unit.o] : null;
    const lat = p[i + 1] / 1e4, lon = p[i] / 1e4;
    const when = new Date(Date.parse(d.generated) - p[i + 8] * 60000);
    const whenTxt = new Intl.DateTimeFormat(lg === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(when);
    const srcKey = unit ? SRC_KEYS.find(([, b]) => b === unit.s)?.[0] : undefined;
    const rows: [string, string][] = [
      [c.popWhen, `${whenTxt} WIB`],
      [c.popN, n(p[i + 3])],
      [c.popFrp, `${n(p[i + 4])} MW`],
      [c.popConf, c.conf[p[i + 5]] ?? "—"],
      [c.popWhere, kab ? `${kab.n}, ${d.prov[kab.p]?.id ?? ""}` : "—"],
    ];
    if (owner) {
      rows.push([c.popOwner, owner.group ? `${owner.name} (${owner.group})` : owner.name]);
      if (unit?.u) rows.push([c.popUnit, unit.u]);
      if (srcKey) rows.push([c.popSrc, c.src[srcKey]]);
    }
    rows.push([c.popCoords, `${lat.toFixed(4)}, ${lon.toFixed(4)}`]);
    const html = `<div class="fl-pop nat"><b>${esc(owner ? owner.name : c.popNone)}</b>${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}<p class="nat-pop-links"><a class="nat-wa-btn" href="${esc(waLink(pointAlert(d, i, lg)))}" target="_blank" rel="noopener">${esc(c.wa)}</a><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">${esc(c.popGmaps)}</a>${owner && live.current.onSelectOwner ? `<button type="button" class="linkish" data-owner="${unit!.o}">${esc(c.popCompany)}</button>` : ""}</p></div>`;
    popup.current?.remove();
    popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px", className: "fl-popup" }).setLngLat(at).setHTML(html).addTo(map);
    popup.current
      .getElement()
      .querySelector<HTMLButtonElement>("button[data-owner]")
      ?.addEventListener("click", (e) => {
        live.current.onSelectOwner?.(Number((e.currentTarget as HTMLButtonElement).dataset.owner));
        popup.current?.remove();
      });
  }

  // Points of the period (rebuilt only when the data or the period change: 28 days is ~240k points).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const p = data.pts;
    const nDays = data.days.length;
    const feats: GeoJSON.Feature[] = [];
    for (let i = 0; i < p.length; i += PT) {
      if (!ptIn(p, i, win, nDays)) continue;
      const u = p[i + 6];
      feats.push({
        type: "Feature",
        properties: { i, n: p[i + 3], a: ageClass(p[i + 8]), t: p[i + 8], o: u >= 0 ? data.units[u].o : -1 },
        geometry: { type: "Point", coordinates: [p[i] / 1e4, p[i + 1] / 1e4] },
      });
    }
    // Oldest first so the newest draw on top.
    feats.sort((a, b) => b.properties!.t - a.properties!.t);
    // 28 days takes the map a few seconds to draw: say so instead of showing an empty map.
    setDrawing(true);
    (map.getSource("npts") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    map.once("idle", () => setDrawing(false));
  }, [data, win, ready]);
  // The selected company: ringed on top, the rest dimmed (paint only, instant).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const o = selOwner ?? -2;
    map.setFilter("npts-sel", ["==", ["get", "o"], o]);
    map.setPaintProperty("npts", "circle-opacity", selOwner === null ? 0.9 : ["case", ["==", ["get", "o"], o], 0.95, 0.35]);
  }, [selOwner, ready]);

  // Labels: the companies with the most hotspots in the period, at their busiest spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Same ranking and figures as the company list (the owner's own count); the map points only give the spot.
    const p = data.pts;
    const at = new Map<number, number>();
    for (let i = 0; i < p.length; i += PT) {
      const u = p[i + 6];
      if (u < 0 || !ptIn(p, i, win, data.days.length)) continue;
      const o = data.units[u].o;
      if (o < 0) continue;
      const j = at.get(o);
      if (j === undefined || p[i + 3] > p[j + 3]) at.set(o, i);
    }
    const top = [...at.keys()]
      .map((o) => [o, inWin(data.owners[o], win).n] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, labels);
    (map.getSource("nlbl") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: top.map(([o, v]) => {
        const i = at.get(o)!;
        return {
          type: "Feature",
          properties: { t: `${data.owners[o].name}\n${fill(f.lblN, { n: formatCount(v, lang) })}` },
          geometry: { type: "Point", coordinates: [p[i] / 1e4, p[i + 1] / 1e4] },
        };
      }),
    });
  }, [data, win, ready, lang, labels]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fit) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [w, s, e, n] = fit.bbox;
    const pad = 0.02;
    map.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], { padding: compact ? 24 : 64, maxZoom: 12, duration: calm ? 0 : 800 });
  }, [fit?.key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className={`fl-map overview nat-map ${compact ? "compact" : ""} ${tooling ? "tooling" : ""}`} role="region" aria-label={f.navMap}>
      <div ref={ref} className="fl-map-canvas" />
      {drawing ? (
        <p className="nat-map-busy" role="status">
          {f.drawing}
        </p>
      ) : null}
      {!compact && ready && toolEl && mapRef.current ? <MapTools map={mapRef.current} el={toolEl} wrap={wrapRef.current} onActive={onToolActive} /> : null}
      {imageryFor ? <Imagery key={imageryFor.id} incident={imageryFor} map={ready ? mapRef.current : null} before="npts" /> : null}
      {!compact && ready && mapRef.current ? (
        <ContextLayers map={mapRef.current} cases={null} blocked={() => toolOn.current} keys={["prov", "rspo", "burned", "roads", "rivers", "mills"]} before="npts" top={["npts"]} store="fireline.natLayers" initial={{ prov: true }} near={nearMill} />
      ) : null}
      <div className="fl-legend map-card" aria-label={f.legend}>
        <span className="nat-legend-head">{f.legend}</span>
        {(
          [
            [AGE_COLORS[0], f.lg24],
            ...(win === "24" ? [] : [[AGE_COLORS[1], f.lg3] as const, [AGE_COLORS[2], f.lg7] as const]),
            ...(win === "28" ? [[AGE_COLORS[3], f.lgOld] as const] : []),
          ] as readonly (readonly [string, string])[]
        ).map(([c, label]) => (
          <span key={label}>
            <i style={{ background: c }} aria-hidden="true" />
            {label}
          </span>
        ))}
        {selOwner !== null ? (
          <span>
            <i className="nat-ring" aria-hidden="true" />
            {f.lgSel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
