import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemapStyle } from "@/lib/basemap";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { COLOR, PHONE_MQ, type Case } from "@/lib/fire-ui";
import { MapTools } from "@/components/fire-map-tools";
import { ContextLayers, onMill } from "@/components/fire-layers";
import type { FireScene, FireScenes, FireSceneTiles } from "@/lib/fire.server";

type ImgSrc = "base" | "s2" | "s1";
type S2Style = "quickfire" | "swir" | "true";
export type Bounds = [number, number, number, number];

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** An empty control slot: React portals the tool buttons into it so MapLibre stacks them under the zoom buttons. */
export class SlotControl implements maplibregl.IControl {
  el = document.createElement("div");
  constructor(cls: string) {
    this.el.className = cls;
  }
  onAdd() {
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}
/** Same as the detail's per-day dots: latest day red, then orange, then yellow. */
const DAY_COLORS = ["#ff3b1f", "#ff9f1c", "#ffd166"];

/**
 * One map for both places it is used: `overview` (every incident, click to
 * select, reports the visible bounds) and `focus` (one incident: its plot,
 * every detection, the mill, and the Sentinel imagery controls).
 */
export function FireMap({
  incidents,
  colorOf,
  selected,
  onSelect,
  onView,
  mode,
  imagery = false,
  mill,
  me,
  tools = true,
  weeks = false,
  context,
}: {
  incidents: Case[];
  colorOf: (i: Case) => string;
  selected: Case | null;
  onSelect?: (id: string | null) => void;
  onView?: (b: Bounds) => void;
  mode: "overview" | "focus";
  imagery?: boolean;
  mill?: { lat: number; lon: number; name: string } | null;
  /** The viewer's live position (field page). */
  me?: { lat: number; lon: number } | null;
  /** Ruler, area, coordinates, radius and full screen (off on the small field-page map). */
  tools?: boolean;
  /** Overview shows cases older than a week (4 weeks, or a case window over 7 days): add the "over a week" legend row. */
  weeks?: boolean;
  /** Context layers (plots coverage, RSPO, burned areas) with these cases for the RSPO popup counts. */
  context?: Case[];
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [toolEl, setToolEl] = useState<HTMLElement | null>(null);
  // While a measuring tool is active, clicks draw instead of selecting incidents.
  const toolOn = useRef(false);
  const [tooling, setTooling] = useState(false);
  const onToolActive = useCallback((on: boolean) => {
    toolOn.current = on;
    setTooling(on);
  }, []);
  const cb = useRef({ onSelect, onView });
  cb.current = { onSelect, onView };

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle("esri"),
      center: [112, -1.5],
      zoom: 4.2,
      attributionControl: { compact: true },
      cooperativeGestures: mode === "focus",
      // Keeps the focus map's pixels so the incident prints with its map.
      preserveDrawingBuffer: mode === "focus",
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
    // Dev only: lets Playwright scripts (deck recordings) drive the camera; never set in production builds.
    if (import.meta.env.DEV) (window as unknown as { __flmap?: maplibregl.Map }).__flmap = map;
    if (tools) {
      const slot = new SlotControl("maplibregl-ctrl maplibregl-ctrl-group fl-mtools");
      map.addControl(slot, "top-left");
      setToolEl(slot.el);
    }
    map.on("load", () => {
      for (const id of ["plots", "pts", "mill", "me"]) map.addSource(id, { type: "geojson", data: EMPTY });
      // Overview: cluster below zoom 9 so 1,000+ incidents stay readable.
      map.addSource("inc", {
        type: "geojson",
        data: EMPTY,
        ...(mode === "overview" ? { cluster: true, clusterMaxZoom: 8, clusterRadius: 38, clusterProperties: { hot: ["+", ["case", ["get", "hot"], 1, 0]] } } : {}),
      });
      map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": "#ffffff", "fill-opacity": ["case", ["boolean", ["get", "sel"], false], 0.18, 0.06] } });
      map.addLayer({
        id: "plots-line",
        type: "line",
        source: "plots",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2], "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "pts",
        type: "circle",
        source: "pts",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 4, 50, 6, 300, 9],
          // age 0 = the case's latest day; older days fade from orange to yellow.
          "circle-color": ["match", ["get", "age"], 0, DAY_COLORS[0], 1, DAY_COLORS[1], DAY_COLORS[2]],
          "circle-opacity": 0.92,
          "circle-stroke-color": "#3a1600",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "inc-halo",
        type: "circle",
        source: "inc",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "hot"], true]],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 7, 12, 18], "circle-color": COLOR.new24, "circle-opacity": 0.22 },
      });
      map.addLayer({
        id: "cl",
        type: "circle",
        source: "inc",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 12, 20, 17, 100, 24, 500, 32],
          "circle-color": ["case", [">", ["get", "hot"], 0], COLOR.new24, COLOR.newOld],
          "circle-opacity": 0.88,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "cl-n",
        type: "symbol",
        source: "inc",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Regular"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "inc",
        type: "circle",
        source: "inc",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            ["case", ["boolean", ["get", "sel"], false], 8, 4],
            10,
            ["case", ["boolean", ["get", "sel"], false], 10, 6],
            14,
            ["case", ["boolean", ["get", "sel"], false], 12, 8],
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["boolean", ["get", "sel"], false], 3, 1.2],
        },
      });
      map.addLayer({
        id: "mill",
        type: "symbol",
        source: "mill",
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.4 },
      });
      map.addLayer({ id: "mill-dot", type: "circle", source: "mill", paint: { "circle-radius": 6, "circle-color": "#1d1d1f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 14, "circle-color": "#2f6fdf", "circle-opacity": 0.2 } });
      map.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 6, "circle-color": "#2f6fdf", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      if (mode === "overview") {
        map.on("click", "inc", (ev) => {
          if (toolOn.current || onMill(map, ev.point)) return;
          const ft = ev.features?.[0];
          if (ft) cb.current.onSelect?.(String(ft.properties?.id));
        });
        map.on("click", "cl", async (ev) => {
          if (toolOn.current || onMill(map, ev.point)) return;
          const ft = ev.features?.[0];
          if (!ft) return;
          const zoom = await (map.getSource("inc") as maplibregl.GeoJSONSource).getClusterExpansionZoom(Number(ft.properties?.cluster_id));
          map.easeTo({ center: (ft.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.2 });
        });
        for (const id of ["inc", "cl"]) {
          map.on("mouseenter", id, () => {
            if (!toolOn.current) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", id, () => {
            if (!toolOn.current) map.getCanvas().style.cursor = "";
          });
        }
        const report = () => {
          const b = map.getBounds();
          cb.current.onView?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        };
        map.on("moveend", report);
        report();
      }
      setReady(true);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setToolEl(null);
      setReady(false);
    };
  }, [mode, tools]);

  // Data.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    const list = mode === "focus" ? (selected ? [selected] : []) : incidents;
    src("inc")?.setData({
      type: "FeatureCollection",
      // Oldest first so the newest are drawn on top; the selected one last.
      features: list
        .slice()
        .reverse()
        .sort((a, b) => Number(a.id === selected?.id) - Number(b.id === selected?.id))
        .map((i) => {
          const color = colorOf(i);
          return {
            type: "Feature" as const,
            properties: { id: i.id, color, hot: color === COLOR.new24, sel: i.id === selected?.id },
            geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
          };
        }),
    });
    // Plots and hotspots of the selected case only: the overview stays one dot per company.
    src("plots")?.setData({
      type: "FeatureCollection",
      features: (selected?.aff ?? [])
        .filter((a) => a.plot?.g?.length)
        .map((a) => ({ type: "Feature" as const, properties: { id: a.id, sel: true }, geometry: { type: "MultiPolygon" as const, coordinates: a.plot.g } })),
    });
    const lastIdx = (selected?.days.length ?? 1) - 1;
    src("pts")?.setData({
      type: "FeatureCollection",
      features: (selected?.pts ?? []).map(([lon, lat, frp, di]) => ({
        type: "Feature" as const,
        properties: { frp, age: lastIdx - (di ?? lastIdx) },
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
      })),
    });
    src("mill")?.setData(
      mode === "focus" && mill
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: mill.name }, geometry: { type: "Point", coordinates: [mill.lon, mill.lat] } }] }
        : EMPTY,
    );
    if (mode === "overview" && !fitted.current && incidents.length && !selected) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      incidents.forEach((i) => b.extend([i.lon, i.lat]));
      map.fitBounds(b, { padding: 48, maxZoom: 9, duration: 0 });
    }
  }, [incidents, selected, ready, mode, mill, colorOf]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("me") as maplibregl.GeoJSONSource | undefined)?.setData(
      me ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [me.lon, me.lat] } }] } : EMPTY,
    );
  }, [me?.lat, me?.lon, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once the viewer's position is known, show it and the fire together.
  const meFitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me || !selected || meFitted.current) return;
    meFitted.current = true;
    const b = new maplibregl.LngLatBounds();
    b.extend([me.lon, me.lat]);
    b.extend([selected.lon, selected.lat]);
    map.fitBounds(b, { padding: { top: 48, right: 48, bottom: 72, left: 48 }, maxZoom: 15, duration: 0 });
  }, [me, ready, selected]);

  // Camera on the selected incident.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selected) return;
    // Frame the case: its hotspots and the plots they touch (a big estate can span tens of km,
    // so plots only add to the frame within 3 km of a hotspot).
    const b = new maplibregl.LngLatBounds();
    selected.pts.forEach(([lon, lat]) => b.extend([lon, lat]));
    b.extend([selected.lon, selected.lat]);
    const near = (x: number, y: number) => selected.pts.some(([lon, lat]) => Math.abs(lon - x) < 0.03 && Math.abs(lat - y) < 0.03);
    for (const a of selected.aff) for (const poly of a.plot?.g ?? []) for (const [x, y] of poly[0]) if (near(x, y)) b.extend([x, y]);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(b, {
      padding: mode === "focus" ? { top: 56, right: 56, bottom: 72, left: 56 } : 80,
      maxZoom: 15,
      duration: mode === "overview" && fitted.current && !calm ? 600 : 0,
    });
    fitted.current = true;
  }, [selected?.id, ready, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className={`fl-map ${mode} ${tooling ? "tooling" : ""}`} role="region" aria-label={f.navMap}>
      <div ref={ref} className="fl-map-canvas" />
      {tools && ready && toolEl && mapRef.current ? <MapTools map={mapRef.current} el={toolEl} wrap={wrapRef.current} onActive={onToolActive} /> : null}
      {context && ready && mapRef.current && mode === "overview" ? <ContextLayers map={mapRef.current} cases={context} blocked={() => toolOn.current} /> : null}
      {imagery && selected ? <Imagery key={selected.id} incident={selected} map={ready ? mapRef.current : null} /> : null}
      {mode === "overview" ? (
        <div className="fl-legend map-card" aria-label={f.legend}>
          {(
            [
              [COLOR.new24, f.lgNew24],
              [COLOR.new3, f.lgNew3],
              [COLOR.newOld, f.lgNew7],
              ...(weeks ? [[COLOR.newWeek, f.lgNewWeek] as const] : []),
              [COLOR.active, f.stActive],
              [COLOR.extinguished, f.stOut],
              [COLOR.false_alarm, f.stFalse],
            ] as readonly (readonly [string, string])[]
          ).map(([c, label]) => (
            <span key={label}>
              <i style={{ background: c }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Every Sentinel-1/2 pass over the incident (or any point and day), drawn under `before`. */
export function Imagery({ incident: sel, map, before = "plots-fill" }: { incident: Pick<Case, "id" | "lat" | "lon" | "day">; map: maplibregl.Map | null; before?: string }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const [scenes, setScenes] = useState<FireScenes | null>(null);
  const [src, setSrc] = useState<ImgSrc>("base");
  const [s2Style, setS2Style] = useState<S2Style>("quickfire");
  const [s2Day, setS2Day] = useState<string | null>(null);
  const [s1Day, setS1Day] = useState<string | null>(null);
  const [tiles, setTiles] = useState<FireSceneTiles | null>(null);
  const [tilesState, setTilesState] = useState<"idle" | "loading" | "done">("idle");
  // Closed by default on phones: the card would cover most of a small map.
  const [open, setOpen] = useState(() => typeof window === "undefined" || !window.matchMedia(PHONE_MQ).matches);

  useEffect(() => {
    let alive = true;
    fetch(`/fire/imagery?lat=${sel.lat}&lon=${sel.lon}&date=${sel.day}`)
      .then((r) => (r.ok ? r.json() : { s2: [], s1: [] }))
      .then((v: FireScenes) => {
        if (!alive) return;
        setScenes(v);
        // Default: the first pass on or after the fire day, else the newest before it.
        const pick = (list: FireScene[]) => {
          const after = list.filter((x) => x.day >= sel.day);
          return (after.length ? after[after.length - 1] : list[0])?.day ?? null;
        };
        setS2Day(pick(v.s2));
        setS1Day(pick(v.s1));
      })
      .catch(() => alive && setScenes({ s2: [], s1: [] }));
    return () => {
      alive = false;
    };
  }, [sel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeDay = src === "s2" ? s2Day : src === "s1" ? s1Day : null;
  useEffect(() => {
    setTiles(null);
    if (src === "base" || !activeDay) {
      setTilesState("idle");
      return;
    }
    let alive = true;
    setTilesState("loading");
    fetch(`/fire/imagery?lat=${sel.lat}&lon=${sel.lon}&kind=${src}&day=${activeDay}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: FireSceneTiles | null) => {
        if (!alive) return;
        setTiles(v);
        setTilesState("done");
      })
      .catch(() => {
        if (!alive) return;
        setTiles(null);
        setTilesState("done");
      });
    return () => {
      alive = false;
    };
  }, [sel.id, src, activeDay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map) return;
    const clear = () => {
      if (!map.getStyle()) return;
      if (map.getLayer("img")) map.removeLayer("img");
      if (map.getSource("img")) map.removeSource("img");
    };
    clear();
    const url = src === "s2" ? tiles?.[s2Style] : src === "s1" ? tiles?.sar : undefined;
    if (url) {
      map.addSource("img", { type: "raster", tiles: [url], tileSize: 256, minzoom: 8, maxzoom: 15, attribution: "Copernicus Sentinel data · Microsoft Planetary Computer" });
      map.addLayer({ id: "img", type: "raster", source: "img", minzoom: 8 }, map.getLayer(before) ? before : undefined);
    }
    return clear;
  }, [map, tiles, src, s2Style, before]);

  const fmtD = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const list = src === "s2" ? scenes?.s2 ?? [] : src === "s1" ? scenes?.s1 ?? [] : [];
  const setDay = src === "s2" ? setS2Day : setS1Day;
  const idx = activeDay ? list.findIndex((x) => x.day === activeDay) : -1;
  const tag = (d: string) => (d < sel.day ? f.imgBeforeTag : d === sel.day ? f.imgEventTag : f.imgAfterTag);
  const lastBefore = list.find((x) => x.day < sel.day)?.day;
  const firstAfter = [...list].reverse().find((x) => x.day >= sel.day)?.day;
  const note = src === "s1" ? f.imgS1Note : s2Style === "quickfire" ? f.imgQuickNote : s2Style === "true" ? f.imgTrueNote : f.imgS2Note;

  return (
    <div className={`fl-img map-card ${open ? "" : "closed"}`}>
      <button type="button" className="fl-img-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <b>{f.imagery}</b>
        <span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {!open ? null : !scenes ? (
        <p>{f.imgLoading}</p>
      ) : (
        <>
          <div className="seg" role="group" aria-label={f.imagery}>
            {(["base", "s2", "s1"] as const).map((k) => (
              <button key={k} type="button" className={src === k ? "on" : ""} aria-pressed={src === k} onClick={() => setSrc(k)}>
                {k === "base" ? f.imgBase : k === "s2" ? f.imgS2 : f.imgS1}
              </button>
            ))}
          </div>
          {src === "s2" ? (
            <div className="seg" role="group" aria-label={f.imgStyle}>
              {(["quickfire", "swir", "true"] as const).map((k) => (
                <button key={k} type="button" className={s2Style === k ? "on" : ""} aria-pressed={s2Style === k} onClick={() => setS2Style(k)}>
                  {k === "quickfire" ? f.imgStyleQuick : k === "swir" ? f.imgStyleSwir : f.imgStyleTrue}
                </button>
              ))}
            </div>
          ) : null}
          {src !== "base" ? (
            list.length === 0 ? (
              <p>{f.imgNone}</p>
            ) : (
              <>
                <div className="fl-img-day">
                  <button type="button" aria-label={f.imgOlder} title={f.imgOlder} disabled={idx < 0 || idx >= list.length - 1} onClick={() => setDay(list[idx + 1].day)}>
                    ‹
                  </button>
                  <select value={activeDay ?? ""} onChange={(e) => setDay(e.target.value)} aria-label={f.imgDay}>
                    {list.map((x) => (
                      <option key={x.day} value={x.day}>
                        {fmtD(x.day)} · {tag(x.day)}
                        {x.cloud != null ? ` · ${fill(f.imgCloud, { n: x.cloud })}` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label={f.imgNewer} title={f.imgNewer} disabled={idx <= 0} onClick={() => setDay(list[idx - 1].day)}>
                    ›
                  </button>
                </div>
                <div className="fl-img-jumps">
                  <button type="button" className="btn-text small" disabled={!lastBefore || lastBefore === activeDay} onClick={() => lastBefore && setDay(lastBefore)}>
                    {f.imgLastBefore}
                  </button>
                  <button type="button" className="btn-text small" disabled={!firstAfter || firstAfter === activeDay} onClick={() => firstAfter && setDay(firstAfter)}>
                    {f.imgFirstAfter}
                  </button>
                </div>
                <p>
                  {tilesState === "loading" ? f.imgLoading : tilesState === "done" && !tiles ? f.imgNone : note}
                  {src === "s2" && s2Style === "quickfire" ? <span className="fl-img-credit">{f.imgQuickCredit}</span> : null}
                </p>
              </>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
