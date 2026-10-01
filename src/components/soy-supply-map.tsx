import { useEffect, useRef, useState, type ReactNode } from "react";
import { BASEMAPS, BASEMAP_ORDER, DEFAULT_BASEMAP, basemapStyle, setBasemap, type BasemapId } from "@/components/chain-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa } from "@/lib/format";
import { SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyGroupOf } from "@/lib/soy-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  BAND_COLORS,
  FIELD_COLOR,
  NC_COLOR,
  NC_INK,
  NC_MARK,
  PLANT_COLOR,
  RAIL_COLOR,
  RIVER_COLOR,
  TP_COLOR,
  arc,
  circle,
  circleBounds,
  groupOf,
  comboMembers,
  inScope,
  isCombo,
  pct,
  levelOf,
  scopeBounds,
  unitParts,
  type Band,
  type Basis,
  type Catchment,
  type NcProps,
  type SupplyData,
  type SupplyFieldProps,
} from "@/lib/soy-supply";
import { usePersistentState } from "@/lib/use-persistent";
import "maplibre-gl/dist/maplibre-gl.css";

export type SoyFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
};
type FC = { type: "FeatureCollection"; features: SoyFeature[] };
const EMPTY: FC = { type: "FeatureCollection", features: [] };

export type SupplyMapMode = "supply" | "corridor";
export type SupplyColorBy = "status" | "years";
/** What the map has loaded for the current scope — the field table's rows. */
export type ScopeFields = {
  fields: SoyFeature[];
  nc: SoyFeature[];
  /** The scope is one catchment and all its fields are loaded. */
  complete: boolean;
  loading: boolean;
  failed?: boolean;
  /** The scope these fields belong to (the view may already show another). */
  scope: string | null;
};
export type MapFocus = { bbox?: [[number, number], [number, number]]; center?: [number, number]; zoom?: number; nonce: number };

type LayerKey = "fields" | "nc" | "rings" | "adm" | "tp" | "rail" | "rivers" | "corridors" | "roads";
type Remote = "rail" | "rivers" | "corridors" | "roads";
const REMOTE: Remote[] = ["rail", "rivers", "corridors", "roads"];
const DEFAULTS: Record<SupplyMapMode, Record<LayerKey, boolean>> = {
  supply: { fields: true, nc: true, rings: true, adm: true, tp: true, rail: false, rivers: false, corridors: false, roads: false },
  corridor: { fields: true, nc: false, rings: true, adm: true, tp: true, rail: true, rivers: true, corridors: true, roads: false },
};
const DATA_FLOOR = ["direct-area", "grid", "corridors", "rivers", "fields"];
// Soybean density: coarse cells in supply.json, finer ones (layers/grid.json)
// take over as the map zooms in.
const GRID_LAYERS = ["grid", "grid-1", "grid-2", "grid-3"];
type GridRow = number[];
function gridFC(rows: GridRow[], d: number): FC {
  return {
    type: "FeatureCollection",
    features: rows.map(([gx, gy, a, cov, r10, v10, e10, share]) => ({
      type: "Feature",
      properties: { a, cov, r10, v10, e10, p: share ?? 0 },
      geometry: {
        type: "Polygon",
        coordinates: [[[gx! * d, gy! * d], [(gx! + 1) * d, gy! * d], [(gx! + 1) * d, (gy! + 1) * d], [gx! * d, (gy! + 1) * d], [gx! * d, gy! * d]]], // prettier-ignore
      },
    })),
  };
}
/** Share of a grid cell under these soybean fields (%) at each colour step. */
const GRID_STEPS = [1, 5, 10, 20, 35];
/** Peak opacity of the non-compliant glow. */
const NC_GLOW = 0.42;
let fineGrid: { deg: number; minZoom: number; rows: GridRow[] }[] | null = null;
let gridLevels: Promise<{ deg: number; minZoom: number; rows: GridRow[] }[]> | null = null;

// Kept across tab switches and remounts: nothing is fetched twice per visit.
const unitCache = new Map<string, SoyFeature[]>();
const unitInflight = new Map<string, Promise<SoyFeature[]>>();

/** One catchment's fields (fields/units/<id>.geojson), like a PalmTrace mill's plot file. */
export function loadUnit(id: string): Promise<SoyFeature[]> {
  const hit = unitCache.get(id);
  if (hit) return Promise.resolve(hit);
  let pr = unitInflight.get(id);
  if (!pr) {
    pr = fetch(`/data/fields/units/${encodeURIComponent(id)}.geojson`)
      .then((res) => (res.ok ? (res.json() as Promise<FC>) : Promise.reject(new Error(String(res.status)))))
      .then((fc) => {
        for (const f of fc.features) addCenter(f);
        unitCache.set(id, fc.features);
        return fc.features;
      })
      .finally(() => unitInflight.delete(id));
    unitInflight.set(id, pr);
  }
  return pr;
}
const remoteCache = new Map<string, FC>();
let ncCache: FC | null = null;
let ncInflight: Promise<FC> | null = null;

export function loadNonCompliant(): Promise<FC> {
  if (ncCache) return Promise.resolve(ncCache);
  ncInflight ??= fetch("/data/fields/noncomply.geojson")
    .then((res) => (res.ok ? (res.json() as Promise<FC>) : Promise.reject(new Error(String(res.status)))))
    .then((fc) => {
      for (const f of fc.features) addCenter(f);
      ncCache = fc;
      return fc;
    })
    .finally(() => {
      ncInflight = null;
    });
  return ncInflight;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function row(k: string, v: string, mono = false) {
  return `<p class="soy-pop-k">${esc(k)}</p><p class="soy-pop-v${mono ? " mono" : ""}">${esc(v)}</p>`;
}
export function bboxOf(g: SoyFeature["geometry"]): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // prettier-ignore
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x! < minX) minX = x!;
      if (y! < minY) minY = y!;
      if (x! > maxX) maxX = x!;
      if (y! > maxY) maxY = y!;
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null; // prettier-ignore
}
/** Stores a feature's centre as _x/_y once (scope tests, table, focus). */
function addCenter(f: SoyFeature) {
  if (f.properties._x != null) return;
  const b = f.geometry.type === "Point" ? null : bboxOf(f.geometry);
  const [x, y] = b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : (f.geometry.coordinates as [number, number]);
  f.properties._x = x;
  f.properties._y = y;
}
const center = (f: SoyFeature) => [Number(f.properties._x), Number(f.properties._y)] as const;

function distanceExpr(basis: Basis) {
  const r = ["coalesce", ["get", "r"], 999];
  const v = ["coalesce", ["get", "v"], 999];
  return basis === "rail" ? r : basis === "river" ? v : ["min", r, v];
}
function bandColorExpr(basis: Basis) {
  return ["step", distanceExpr(basis), BAND_COLORS.b5, 5.0001, BAND_COLORS.b10, 10.0001, BAND_COLORS.b20, 20.0001, BAND_COLORS.far, 998, BAND_COLORS.none]; // prettier-ignore
}

/**
 * SoyTrace's map, in PalmTrace's portfolio → group → mill order: Quincy with
 * everything (level 1, soybean density only), one supplier type — the direct
 * Quincy catchment (0–40, 40–80, 0–80 mi), ADM elevators, or third
 * parties — with only its circles (level 2), and one catchment with its
 * fields (level 3, one file, like a mill's plots). All radii are statute
 * miles. "corridor" mode adds rail, rivers and 5/10-mile bands and shades the
 * fields by distance.
 */
export function SoySupplyMap({
  data,
  mode,
  selected,
  onSelect,
  colorBy,
  basis,
  band,
  cdlNames,
  catchments,
  c,
  lang,
  onScopeFields,
  selectedField,
  onSelectField,
  focus,
  toolsSlot,
}: {
  data: SupplyData;
  mode: SupplyMapMode;
  selected: string | null;
  onSelect: (id: string | null) => void;
  colorBy: SupplyColorBy;
  basis: Basis;
  band: Band;
  cdlNames: Record<string, string>;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  lang: Lang;
  onScopeFields?: (s: ScopeFields) => void;
  selectedField?: string | null;
  onSelectField?: (f: SoyFeature | null) => void;
  focus?: MapFocus | null;
  toolsSlot?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [bmStored, setBm] = usePersistentState<BasemapId>("soytrace.basemap", DEFAULT_BASEMAP);
  const basemap: BasemapId = bmStored in BASEMAPS ? bmStored : DEFAULT_BASEMAP;
  const [bmOpen, setBmOpen] = useState(false);
  const [on, setOn] = useState<Record<LayerKey, boolean>>(DEFAULTS[mode]);
  const [remote, setRemote] = useState<Record<Remote, "idle" | "loading" | "ready" | "error">>({
    rail: "idle",
    rivers: "idle",
    corridors: "idle",
    roads: "idle",
  });
  // ADM's ask: in the area zoomed in, the soybean acreage and the
  // compliant / non-compliant shares of it.
  const [inView, setInView] = useState<{ total: number; ncAcres: number; ncFields: number; approx: boolean; one: boolean } | null>(null);
  const [unitState, setUnitState] = useState<{ level: number; loading: boolean; failed: boolean }>({ level: 1, loading: false, failed: false });
  const [layersOpen, setLayersOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setLayersOpen(false);
  }, []);
  const [ncLoaded, setNcLoaded] = useState<FC | null>(ncCache);
  const live = useRef({ data, onSelect, cdlNames, catchments, c, lang, on, selected, onScopeFields, onSelectField, ncLoaded });
  live.current = { data, onSelect, cdlNames, catchments, c, lang, on, selected, onScopeFields, onSelectField, ncLoaded };
  const refreshRef = useRef<() => void>(() => undefined);

  // ------------------------------------------------------------------ build
  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      const q80 = data.rings.find((r) => r.id === "q80");
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(basemap) as never,
        bounds: circleBounds(data.plant.lon, data.plant.lat, (q80?.radiusM ?? 150000) * 2.2),
        fitBoundsOptions: { padding: 30 },
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

      map.on("load", () => {
        if (!map) return;
        const pt = (lon: number, lat: number, props: object): SoyFeature => ({
          type: "Feature",
          properties: props as Record<string, unknown>,
          geometry: { type: "Point", coordinates: [lon, lat] },
        });
        const ring = (lon: number, lat: number, r: number, props: object): SoyFeature => ({
          type: "Feature",
          properties: props as Record<string, unknown>,
          geometry: { type: "Polygon", coordinates: [circle(lon, lat, r)] },
        });
        map.addSource("grid", { type: "geojson", data: gridFC(data.grid, data.gridDeg) as never });
        for (const id of GRID_LAYERS.slice(1)) map.addSource(id, { type: "geojson", data: EMPTY as never });
        map.addSource("fields", { type: "geojson", data: EMPTY as never });
        map.addSource("nc", { type: "geojson", data: EMPTY as never });
        map.addSource("nc-pts", { type: "geojson", data: EMPTY as never });
        for (const r of REMOTE) map.addSource(r, { type: "geojson", data: EMPTY as never });
        map.addSource("rings", {
          type: "geojson",
          data: { type: "FeatureCollection", features: data.rings.map((r) => ring(data.plant.lon, data.plant.lat, r.radiusM, { id: r.id })) } as never,
        });
        const r40 = data.rings.find((r) => r.id === "q40")!.radiusM;
        const r80 = data.rings.find((r) => r.id === "q80")!.radiusM;
        // The area of the chosen direct catchment: 0–40 mi disc, 40–80 mi ring, 0–80 mi disc.
        const disc40 = circle(data.plant.lon, data.plant.lat, r40);
        const disc80 = circle(data.plant.lon, data.plant.lat, r80);
        map.addSource("direct-area", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { id: "q40" }, geometry: { type: "Polygon", coordinates: [disc40] } },
              { type: "Feature", properties: { id: "q80r" }, geometry: { type: "Polygon", coordinates: [disc80, [...disc40].reverse()] } },
              { type: "Feature", properties: { id: "q80" }, geometry: { type: "Polygon", coordinates: [disc80] } },
            ],
          } as never,
        });
        // Radius labels on each circle, due north of the plant.
        map.addSource("ring-pt", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.rings.map((r) => {
              const at = arc(data.plant.lon, data.plant.lat, r.radiusM, 0, 0, 1)[0]!;
              return pt(at[0]!, at[1]!, { id: r.id, name: fill(live.current.c.ringMiles, { n: r.nm }) });
            }),
          } as never,
        });
        map.addSource("adm-catch", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.admElevators.filter((e) => e.radiusM).map((e) => ring(e.lon, e.lat, e.radiusM!, { id: e.id })),
          } as never,
        });
        map.addSource("tp-catch", {
          type: "geojson",
          data: { type: "FeatureCollection", features: data.thirdParty.map((e) => ring(e.lon, e.lat, e.radiusM, { id: e.id, core: e.core })) } as never,
        });
        map.addSource("plant", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [pt(data.plant.lon, data.plant.lat, { name: data.plant.name })] } as never,
        });
        map.addSource("adm", {
          type: "geojson",
          data: { type: "FeatureCollection", features: data.admElevators.map((e) => pt(e.lon, e.lat, { id: e.id, name: e.city ?? e.name })) } as never,
        });
        map.addSource("tp", {
          type: "geojson",
          data: { type: "FeatureCollection", features: data.thirdParty.map((e) => pt(e.lon, e.lat, { id: e.id, name: e.company ?? "", core: e.core })) } as never,
        });

        map.addLayer({
          id: "direct-area",
          type: "fill",
          source: "direct-area",
          filter: ["==", ["get", "id"], "__none__"],
          paint: { "fill-color": "#ffffff", "fill-opacity": 0.14 },
        });
        for (const id of GRID_LAYERS) map.addLayer({ id, type: "fill", source: id, paint: { "fill-opacity": 0.72 } });
        // Finer grids once the map is zoomed in past the coarse cells.
        const loadFineGrid = () => {
          if (!map || map.getZoom() < 5.8) return;
          map.off("zoomend", loadFineGrid);
          gridLevels ??= fetch("/data/layers/grid.json")
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((j: { levels: { deg: number; minZoom: number; rows: GridRow[] }[] }) => j.levels);
          gridLevels
            .then((levels) => {
              if (!map || cancelled) return;
              levels.forEach((lv, i) => {
                const id = GRID_LAYERS[i + 1]!;
                (map!.getSource(id) as import("maplibre-gl").GeoJSONSource | undefined)?.setData(gridFC(lv.rows, lv.deg) as never);
                map!.setLayerZoomRange(id, lv.minZoom, levels[i + 1]?.minZoom ?? 24);
              });
              map.setLayerZoomRange("grid", 0, levels[0]!.minZoom);
              fineGrid = levels;
              measure();
            })
            .catch(() => {
              gridLevels = null;
            });
        };
        map.on("zoomend", loadFineGrid);
        loadFineGrid();
        // Bands only from zoom 6.5: zoomed out they blanket the 7 states.
        map.addLayer({
          id: "corridors",
          type: "fill",
          source: "corridors",
          minzoom: 6.5,
          layout: { visibility: "none" },
          paint: {
            "fill-color": ["match", ["get", "net"], "rail", "#ffffff", RIVER_COLOR] as never,
            "fill-opacity": ["match", ["get", "mi"], 5, 0.12, 0.07] as never,
          },
        });
        map.addLayer({
          id: "rivers",
          type: "fill",
          source: "rivers",
          layout: { visibility: "none" },
          paint: { "fill-color": RIVER_COLOR, "fill-opacity": ["case", ["get", "m"], 0.9, 0.55] as never },
        });
        map.addLayer({
          id: "rivers-line",
          type: "line",
          source: "rivers",
          minzoom: 7,
          layout: { visibility: "none" },
          paint: { "line-color": RIVER_COLOR, "line-width": ["case", ["get", "m"], 1.2, 0.6] as never },
        });
        map.addLayer({ id: "fields", type: "fill", source: "fields", paint: { "fill-opacity": 0.8 } });
        map.addLayer({
          id: "fields-line",
          type: "line",
          source: "fields",
          minzoom: 12,
          paint: { "line-color": "#0f3d22", "line-width": 0.6, "line-opacity": 0.6 },
        });
        map.addLayer({
          id: "roads",
          type: "line",
          source: "roads",
          layout: { visibility: "none" },
          paint: {
            "line-color": "#f1efe8",
            "line-opacity": 0.85,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "class"], [1, 2], 1.2, 0.4], 12, ["match", ["get", "class"], [1, 2], 3, 1.4]] as never, // prettier-ignore
          },
        });
        map.addLayer({
          id: "rail-casing",
          type: "line",
          source: "rail",
          minzoom: 8,
          layout: { visibility: "none" },
          filter: ["!=", ["get", "u"], "X"],
          paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 4] as never, "line-opacity": 0.75 },
        });
        map.addLayer({
          id: "rail",
          type: "line",
          source: "rail",
          layout: { visibility: "none" },
          paint: {
            "line-color": RAIL_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "u"], "M", 0.9, 0.5], 12, ["match", ["get", "u"], "M", 2, 1.2]] as never, // prettier-ignore
            "line-opacity": ["match", ["get", "u"], "X", 0.4, 1] as never,
            "line-dasharray": [3, 2],
          },
        });
        map.addLayer({
          id: "tp-catch",
          type: "line",
          source: "tp-catch",
          paint: { "line-color": TP_COLOR, "line-width": 1, "line-dasharray": [2, 2], "line-opacity": ["case", ["get", "core"], 0.85, 0.5] as never },
        });
        map.addLayer({
          id: "adm-catch",
          type: "line",
          source: "adm-catch",
          paint: { "line-color": "#ffffff", "line-width": 1.3, "line-dasharray": [3, 2], "line-opacity": 0.9 },
        });
        map.addLayer({ id: "rings", type: "line", source: "rings", paint: { "line-color": "#ffffff", "line-width": 2.2, "line-opacity": 0.95 } });
        map.addLayer({
          id: "nc-fill",
          type: "fill",
          source: "nc",
          minzoom: 9,
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "fill-color": NC_COLOR, "fill-opacity": 0.9 },
        });
        map.addLayer({
          id: "nc-line",
          type: "line",
          source: "nc",
          minzoom: 9,
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "line-color": NC_INK, "line-width": 1.2 },
        });
        // Zoomed out: a "firefly" — a tiny bright dot with a soft red glow.
        // Easy to spot over green fields, yet clearly a marker rather than a
        // disc whose size could be read as area. From zoom 11 the true
        // outline takes over (points delivered without a polygon keep it).
        const fade = (v: number) => ["interpolate", ["linear"], ["zoom"], 10.5, v, 11.5, ["case", ["get", "po"], v, 0]];
        map.addLayer({
          id: "nc-halo",
          type: "circle",
          source: "nc-pts",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 8, 8, 11, 10] as never,
            "circle-color": NC_MARK,
            "circle-blur": 1,
            "circle-opacity": fade(NC_GLOW) as never,
          },
        });
        map.addLayer({
          id: "nc-dot",
          type: "circle",
          source: "nc-pts",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 8, 2.3, 11, 3] as never,
            "circle-color": "#ff5442",
            "circle-stroke-color": "#ffe9e4",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 9, 0.8] as never,
            "circle-opacity": fade(1) as never,
            "circle-stroke-opacity": fade(1) as never,
          },
        });
        // A slow breathing glow (skipped for reduced motion).
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          let last = 0;
          const breathe = (t: number) => {
            if (cancelled || !map) return;
            if (t - last > 90 && map.getLayer("nc-halo") && map.getLayoutProperty("nc-halo", "visibility") !== "none") {
              last = t;
              const k = 0.5 + 0.5 * Math.sin(t / 700);
              map.setPaintProperty("nc-halo", "circle-opacity", fade(NC_GLOW * (0.6 + 0.6 * k)) as never);
            }
            requestAnimationFrame(breathe);
          };
          requestAnimationFrame(breathe);
        }
        // The selected field (table row or click).
        map.addLayer({
          id: "sel-line",
          type: "line",
          source: "fields",
          filter: ["==", ["get", "id"], "__none__"],
          paint: { "line-color": "#ffffff", "line-width": 3 },
        });
        map.addLayer({
          id: "sel-nc-line",
          type: "line",
          source: "nc",
          filter: ["==", ["get", "id"], "__none__"],
          paint: { "line-color": "#ffffff", "line-width": 3 },
        });
        map.addLayer({
          id: "tp",
          type: "circle",
          source: "tp",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 5.5] as never,
            "circle-color": TP_COLOR,
            "circle-stroke-color": "#1d1d1f",
            "circle-stroke-width": 1.4,
          },
        });
        map.addLayer({
          id: "adm",
          type: "circle",
          source: "adm",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7] as never,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#1d1d1f",
            "circle-stroke-width": 2.2,
          },
        });
        map.addLayer({
          id: "plant",
          type: "circle",
          source: "plant",
          paint: { "circle-radius": 8, "circle-color": PLANT_COLOR, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.8 },
        });
        const label = (id: string, source: string, minzoom: number, size: number) =>
          map!.addLayer({
            id,
            type: "symbol",
            source,
            minzoom,
            layout: {
              "text-field": ["get", "name"],
              "text-font": ["Open Sans Semibold"],
              "text-size": size,
              "text-variable-anchor": ["top", "bottom", "right", "left"],
              "text-radial-offset": 0.9,
              "text-allow-overlap": false,
            },
            paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.78)", "text-halo-width": 1.4 },
          });
        label("tp-label", "tp", 8, 11);
        label("ring-label", "ring-pt", 0, 12.5);
        map.setLayoutProperty("ring-label", "text-variable-anchor", ["bottom"]);
        map.setLayoutProperty("ring-label", "text-radial-offset", 0.4);
        map.setLayoutProperty("ring-label", "visibility", "none");
        label("adm-label", "adm", 5.5, 12);
        label("plant-label", "plant", 0, 13.5);

        for (const layer of ["plant", "adm", "tp", "nc-dot", "nc-fill", "fields"]) {
          map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
        }

        const open = (lngLat: import("maplibre-gl").LngLatLike, html: string, selectId?: string) => {
          if (!map) return;
          popupRef.current?.remove();
          const popup = new maplibregl.Popup({ maxWidth: "320px", closeButton: true }).setLngLat(lngLat).setHTML(html).addTo(map);
          popupRef.current = popup;
          if (selectId) {
            popup.getElement()?.querySelector("button[data-select]")?.addEventListener("click", () => {
              live.current.onSelect(selectId);
              popup.remove();
            });
          }
        };
        map.on("click", (e) => {
          if (!map) return;
          const layers = ["plant", "adm", "tp", "nc-dot", "nc-fill", "fields"].filter((l) => map!.getLayer(l));
          const hit = map.queryRenderedFeatures(e.point, { layers })[0];
          const { data: dt, c: cc, lang: l, catchments: cm, cdlNames: names, onSelectField: pick } = live.current;
          if (!hit) {
            pick?.(null);
            return;
          }
          const loc = l === "id" ? "id-ID" : "en-US";
          const num = (n: number | null | undefined, digits = 1) => (n == null ? "—" : n.toLocaleString(loc, { maximumFractionDigits: digits }));
          const acresHa = (a: number | null | undefined) => (a == null ? "—" : `${formatAcres(a, l)} · ${formatHa(a * AC_TO_HA, l)}`);
          const mi = (n: number | null | undefined) => (n == null ? cc.noNetworkData : fill(cc.milesShort, { n: num(n) }));
          const catchLine = (id: string) => {
            const k = cm.get(id);
            if (!k) return "";
            return row(cc.catchmentStats, fill(cc.soyInCatch, { area: formatAcres(k.compliant.acres, l), nc: formatCount(k.nonCompliant.fields, l) }));
          };
          const btn = (id: string) => (cm.has(id) ? `<button type="button" class="soy-pop-btn" data-select="${esc(id)}">${esc(cc.selectCatchment)}</button>` : "");
          const lid = hit.layer.id;
          const pid = String(hit.properties?.id ?? "");
          if (lid === "plant") {
            const p = dt.plant;
            open(
              e.lngLat,
              `<div class="soy-pop"><p class="soy-pop-kicker">${esc(cc.popPlant)}</p><p class="soy-pop-title">${esc(p.name)}</p>
              ${row(cc.location, [p.city, p.state].filter(Boolean).join(", "))}
              ${row(cc.toRail, mi(p.railMi))}${row(cc.toRiver, mi(p.riverMi))}
              ${catchLine("q40")}${catchLine("q80")}${btn("q40")}</div>`,
              "q40",
            );
            return;
          }
          if (lid === "adm") {
            const el = dt.admElevators.find((x) => x.id === pid);
            if (!el) return;
            const catchId = el.radiusM ? el.id : (dt.admElevators.find((x) => x.radiusM && x.city === el.city)?.id ?? el.id);
            open(
              e.lngLat,
              `<div class="soy-pop"><p class="soy-pop-kicker">${esc(cc.popAdm)}</p><p class="soy-pop-title">${esc(el.name)}</p>
              ${row(cc.location, [el.city, el.county, el.state].filter(Boolean).join(", ") || "—")}
              ${el.type ? row(cc.type, el.type) : ""}${el.river ? row(cc.river, el.river) : ""}
              ${row(cc.toRail, mi(el.railMi))}${row(cc.toRiver, mi(el.riverMi))}
              ${catchLine(catchId)}${btn(catchId)}</div>`,
              catchId,
            );
            return;
          }
          if (lid === "tp") {
            const el = dt.thirdParty.find((x) => x.id === pid);
            if (!el) return;
            open(
              e.lngLat,
              `<div class="soy-pop"><p class="soy-pop-kicker">${esc(cc.popTp)}</p><p class="soy-pop-title">${esc(el.company ?? "—")}</p>
              ${row(cc.location, [el.county, el.state].filter(Boolean).join(", ") || "—")}
              ${el.tract ? row("ID", el.tract, true) : ""}
              ${row(cc.toRail, mi(el.railMi))}${row(cc.toRiver, mi(el.riverMi))}
              ${catchLine(el.id)}${btn(el.id)}</div>`,
              el.id,
            );
            return;
          }
          // A field: the detail card when the view has one, else a popup.
          const src = lid === "fields" ? "fields" : "nc";
          const full = findFeature(src, String(hit.properties?.id ?? ""));
          if (pick && full) {
            popupRef.current?.remove();
            pick(full);
            return;
          }
          const history = (cdl: string) =>
            `<ul class="soy-pop-hist">${String(cdl)
              .split(",")
              .map((code, i) => {
                const n = code === "" ? null : Number(code);
                const name = n == null ? "—" : (names[String(n)] ?? `CDL ${n}`);
                return `<li><span>${2018 + i}</span><i style="background:${SOY_GROUP_COLORS[soyGroupOf(n)]}"></i>${esc(name)}</li>`;
              })
              .join("")}</ul>`;
          if (src === "nc") {
            const p = hit.properties as unknown as NcProps;
            open(
              e.lngLat,
              `<div class="soy-pop"><p class="soy-pop-kicker">${esc(p.po ? cc.popNcPoint : cc.popNc)}</p>
              ${row(cc.fieldId, String(p.id), true)}${row(cc.fieldArea, acresHa(Number(p.a)))}
              ${p.po ? "" : `<p class="soy-pop-k">${esc(cc.history)}</p>${history(String(p.c))}`}</div>`,
            );
            return;
          }
          const p = hit.properties as unknown as SupplyFieldProps;
          open(
            e.lngLat,
            `<div class="soy-pop"><p class="soy-pop-kicker">${esc(cc.popField)}</p>
            ${row(cc.fieldId, String(p.id), true)}${row(cc.area, acresHa(Number(p.a)))}
            ${row(cc.toRail, mi(p.r == null ? null : Number(p.r)))}${row(cc.toRiver, mi(p.v == null ? null : Number(p.v)))}
            <p class="soy-pop-k">${esc(cc.history)}</p>${history(String(p.c))}</div>`,
          );
        });

        // ------------------------------------------------ field loading
        let shown: SoyFeature[] = [];
        let token = 0;

        function findFeature(src: "fields" | "nc", id: string): SoyFeature | null {
          if (src === "nc") return live.current.ncLoaded?.features.find((f) => String(f.properties.id) === id) ?? null;
          return shown.find((f) => String(f.properties.id) === id) ?? null;
        }

        const push = (feats: SoyFeature[], state: { loading: boolean; failed: boolean }) => {
          if (!map) return;
          const { selected: scope, ncLoaded: ncFc } = live.current;
          const level = levelOf(scope);
          shown = feats;
          (map.getSource("fields") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats } as never);
          // The map always shows every non-compliant field ADM listed; the
          // table and figures count only those in the chosen scope.
          const all = ncFc?.features ?? [];
          const nc = all.filter((f) => inScope(scope, { flags: Number(f.properties.f), k: String(f.properties.k ?? "") }));
          (map.getSource("nc") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: all } as never);
          (map.getSource("nc-pts") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: all.map((f) => ({ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [...center(f)] } })),
          } as never);
          setUnitState({ level, ...state });
          measure(state.loading);
          live.current.onScopeFields?.({ fields: feats, nc, complete: level === 3 && !state.loading && !state.failed, ...state, scope });
        };

        const refresh = () => {
          if (!map) return;
          const { selected: scope, data: dt, on: onNow } = live.current;
          const level = levelOf(scope);
          const parts = level === 3 ? unitParts(scope, dt) : null;
          // Grid (soybean density) only on the overview; fields only for one catchment.
          for (const id of GRID_LAYERS) map.setLayoutProperty(id, "visibility", level === 1 && onNow.fields ? "visible" : "none");
          const my = ++token;
          if (!parts || !onNow.fields) {
            push([], { loading: false, failed: false });
            return;
          }
          // A field can be in several catchments: draw it once.
          const once = (lists: SoyFeature[][]) => {
            if (lists.length === 1) return lists[0]!;
            const seen = new Set<string>();
            const out: SoyFeature[] = [];
            for (const list of lists)
              for (const f of list) {
                const fid = String(f.properties.id);
                if (seen.has(fid)) continue;
                seen.add(fid);
                out.push(f);
              }
            return out;
          };
          const hits = parts.map((id) => unitCache.get(id));
          if (hits.every(Boolean)) {
            push(once(hits as SoyFeature[][]), { loading: false, failed: false });
            return;
          }
          push([], { loading: true, failed: false });
          Promise.all(parts.map(loadUnit))
            .then(once)
            .then((feats) => {
              if (my === token) push(feats, { loading: false, failed: false });
            })
            .catch(() => {
              if (my === token) push([], { loading: false, failed: true });
            });
        };
        refreshRef.current = refresh;

        // Figures for what the map shows: one catchment → its loaded fields;
        // overview → the density grid (≈, cells whose centre is in view) and
        // every non-compliant field of the supply chain in view.
        function measure(loading = false) {
          if (!map) return;
          const { selected: scope, ncLoaded: ncFc, data: dt } = live.current;
          const one = levelOf(scope) === 3;
          if (one && loading) {
            setInView(null);
            return;
          }
          const bb = map.getBounds();
          const W = bb.getWest(), E = bb.getEast(), S = bb.getSouth(), N = bb.getNorth(); // prettier-ignore
          const inB = (x: number, y: number) => x >= W && x <= E && y >= S && y <= N;
          let comp = 0;
          if (one) {
            for (const f of shown) if (inB(Number(f.properties._x), Number(f.properties._y))) comp += Number(f.properties.a) || 0;
          } else {
            let rows = dt.grid;
            let d = dt.gridDeg;
            const z = map.getZoom();
            for (const lv of fineGrid ?? []) if (z >= lv.minZoom) ({ rows, deg: d } = lv);
            for (const r of rows) if (inB((r[0]! + 0.5) * d, (r[1]! + 0.5) * d)) comp += r[2]!;
          }
          let ncAcres = 0, ncFields = 0; // prettier-ignore
          for (const f of ncFc?.features ?? []) {
            if (!inScope(one ? scope : "all", { flags: Number(f.properties.f), k: String(f.properties.k ?? "") })) continue;
            if (!inB(Number(f.properties._x), Number(f.properties._y))) continue;
            ncFields++;
            ncAcres += Number(f.properties.a) || 0;
          }
          setInView({ total: comp + ncAcres, ncAcres, ncFields, approx: !one, one });
        }
        map.on("moveend", () => measure());

        mapRef.current = map;
        if (import.meta.env.DEV && containerRef.current) {
          (containerRef.current as unknown as { __map?: unknown }).__map = map;
        }
        setReady(true);
        void loadNonCompliant()
          .then((fc) => {
            if (!cancelled) setNcLoaded(fc);
          })
          .catch(() => undefined);
        refresh();
      });
    })();
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      // A unit still loading must not touch the removed map.
      map = null;
      mapRef.current = null;
    };
    // The map is built once per view; everything reactive is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The container changes size with the side panel, drawer and window.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scope or loaded data changed → reload / refilter.
  useEffect(() => {
    if (ready) refreshRef.current();
  }, [ready, selected, ncLoaded, on.fields]);

  // Layer switches; remote layers load the first time they're switched on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    const set = (ids: string[], v: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", vis(v)));
    const group = groupOf(selected);
    set(["fields", "fields-line", "sel-line"], on.fields);
    set(["nc-fill", "nc-line", "nc-halo", "nc-dot", "sel-nc-line"], on.nc);
    set(["rings", "plant", "plant-label"], on.rings);
    const combo = isCombo(selected) ? comboMembers(selected!) : null;
    set(["direct-area", "ring-label"], on.rings && (group === "direct" || !!combo?.some((m) => m === "q40" || m === "q80")));
    set(["adm", "adm-catch", "adm-label"], on.adm && (!group || group === "adm"));
    set(["tp", "tp-catch", "tp-label"], on.tp && (group ? group === "tp" : !combo));
    set(["rail", "rail-casing"], on.rail);
    set(["rivers", "rivers-line"], on.rivers);
    set(["corridors"], on.corridors);
    set(["roads"], on.roads);
    for (const r of REMOTE) {
      if (!on[r] || remote[r] !== "idle") continue;
      const cached = remoteCache.get(r);
      if (cached) {
        (map.getSource(r) as import("maplibre-gl").GeoJSONSource | undefined)?.setData(cached as never);
        setRemote((s) => ({ ...s, [r]: "ready" }));
        continue;
      }
      setRemote((s) => ({ ...s, [r]: "loading" }));
      void fetch(`/data/layers/${r}.geojson`)
        .then((res) => (res.ok ? (res.json() as Promise<FC>) : Promise.reject(new Error(String(res.status)))))
        .then((fc) => {
          remoteCache.set(r, fc);
          (map.getSource(r) as import("maplibre-gl").GeoJSONSource | undefined)?.setData(fc as never);
          setRemote((s) => ({ ...s, [r]: "ready" }));
        })
        .catch(() => setRemote((s) => ({ ...s, [r]: "error" })));
    }
  }, [on, ready, remote, selected]);

  // Colouring: fields, grid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let fieldColor: unknown;
    if (mode === "corridor") fieldColor = bandColorExpr(basis);
    else if (colorBy === "years")
      fieldColor = ["step", ["get", "y"], SOY_YEARS_COLORS[0], ...SOY_YEARS_COLORS.slice(1).flatMap((col, i) => [i + 2, col])];
    else fieldColor = FIELD_COLOR;
    map.setPaintProperty("fields", "fill-color", fieldColor as never);
    const gridColor =
      mode === "corridor"
        ? [
            "case",
            ["<=", ["get", "cov"], 0],
            BAND_COLORS.none,
            ["step", ["/", ["get", basis === "rail" ? "r10" : basis === "river" ? "v10" : "e10"], ["max", ["get", "cov"], 1]], BAND_COLORS.far, 0.25, BAND_COLORS.b20, 0.6, BAND_COLORS.b10, 0.9, BAND_COLORS.b5], // prettier-ignore
          ]
        : ["step", ["get", "p"], SOY_YEARS_COLORS[0], GRID_STEPS[0], SOY_YEARS_COLORS[2], GRID_STEPS[1], SOY_YEARS_COLORS[4], GRID_STEPS[2], SOY_YEARS_COLORS[5], GRID_STEPS[3], SOY_YEARS_COLORS[6], GRID_STEPS[4], SOY_YEARS_COLORS[7]]; // prettier-ignore
    for (const id of GRID_LAYERS) map.setPaintProperty(id, "fill-color", gridColor as never);
  }, [mode, colorBy, basis, band, ready]);

  // Selected catchment: emphasise its outline, dim the others, fit to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = selected ?? "";
    const isTp = id === "tp" || id === "tpcore" || /^tp\d/.test(id);
    const isAdm = id === "adm" || /^adm\d/.test(id);
    const one = (x: string) => ["==", ["get", "id"], x];
    const direct = groupOf(id) === "direct";
    const mem = isCombo(id) ? comboMembers(id) : [id];
    const strong = mem.includes("q80") ? ["q80"] : mem.includes("q40") ? ["q40"] : id === "q80r" || id === "direct" ? ["q40", "q80"] : [];
    const admSel = mem.filter((m) => /^adm\d/.test(m));
    map.setPaintProperty("rings", "line-width", (strong.length ? ["match", ["get", "id"], strong, 3.4, 2.2] : 2.2) as never);
    map.setFilter("direct-area", ["in", ["get", "id"], ["literal", mem]] as never);
    map.setPaintProperty("rings", "line-opacity", (id && !direct && id !== "all" ? 0.4 : 0.95) as never);
    map.setPaintProperty("adm-catch", "line-width", (admSel.length ? ["match", ["get", "id"], admSel, 3, 1.1] : isAdm ? 2 : 1.3) as never);
    map.setPaintProperty("adm-catch", "line-opacity", (admSel.length ? ["match", ["get", "id"], admSel, 1, 0.35] : id && !isAdm && id !== "all" ? 0.4 : 0.9) as never);
    map.setPaintProperty("tp-catch", "line-width", (/^tp\d/.test(id) ? ["case", one(id), 3, 0.8] : isTp ? 1.6 : 1) as never);
    map.setPaintProperty(
      "tp-catch",
      "line-opacity",
      (/^tp\d/.test(id)
        ? ["case", one(id), 1, 0.25]
        : id === "tpcore"
          ? ["case", ["get", "core"], 0.95, 0.2]
          : isTp
            ? 0.9
            : id && id !== "all"
              ? 0.3
              : ["case", ["get", "core"], 0.85, 0.5]) as never,
    );
    popupRef.current?.remove();
    const b = scopeBounds(id, data);
    if (b) map.fitBounds(b, { padding: 30, duration: 700 });
  }, [selected, ready, data]);

  // Selected field highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const f = ["==", ["get", "id"], selectedField ?? "__none__"];
    map.setFilter("sel-line", f as never);
    map.setFilter("sel-nc-line", f as never);
  }, [selectedField, ready]);

  // Focus requests (table row, find box).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    if (focus.bbox) map.fitBounds(focus.bbox, { padding: 120, maxZoom: 14, duration: 700 });
    else if (focus.center) map.flyTo({ center: focus.center, zoom: focus.zoom ?? 14, duration: 700 });
  }, [focus?.nonce, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Basemap swap in place (keeps every data layer).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setBasemap(map, basemap, DATA_FLOOR);
    const light = basemap === "osm";
    const ink = light ? "#1d1d1f" : "#ffffff";
    for (const id of ["rings", "adm-catch", "sel-line", "sel-nc-line"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", ink);
    if (map.getLayer("direct-area")) {
      map.setPaintProperty("direct-area", "fill-color", ink);
      map.setPaintProperty("direct-area", "fill-opacity", light ? 0.07 : 0.14);
    }
    for (const id of ["ring-label", "plant-label", "adm-label", "tp-label"]) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "text-color", ink);
      map.setPaintProperty(id, "text-halo-color", light ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.78)");
    }
  }, [basemap, ready]);

  useEffect(() => {
    popupRef.current?.remove();
  }, [lang]);

  // One card: each row switches a layer and shows its map symbol.
  const level = unitState.level;
  const KEY: Record<LayerKey, { label: string; symbol: ReactNode; detail?: ReactNode }> = {
    fields:
      mode === "corridor"
        ? {
            label: c.layerFields,
            symbol: <i className="sq" style={{ background: BAND_COLORS.b10 }} />,
            detail: (
              <div className="soy-key-detail">
                <p className="soy-key-note">{fill(c.legendBands, { basis: (basis === "rail" ? c.rail : basis === "river" ? c.riverWord : c.either).toLowerCase() })}</p>
                {(
                  [
                    [BAND_COLORS.b5, fill(c.bandLe, { n: 5 })],
                    [BAND_COLORS.b10, fill(c.bandLe, { n: 10 })],
                    [BAND_COLORS.b20, fill(c.bandLe, { n: 20 })],
                    [BAND_COLORS.far, c.bandFar],
                    [BAND_COLORS.none, c.legendNoData],
                  ] as const
                ).map(([col, text]) => (
                  <p key={text} className="soy-legend-item">
                    <i className="sq" style={{ background: col }} /> {text}
                  </p>
                ))}
              </div>
            ),
          }
        : level === 1
          ? {
              label: c.legendDensity,
              symbol: <i className="sq" style={{ background: SOY_YEARS_COLORS[5] }} />,
              detail: (
                <div className="soy-key-detail">
                  <div className="soy-legend-ramp six">
                    {[0, 2, 4, 5, 6, 7].map((i) => (
                      <i key={i} style={{ background: SOY_YEARS_COLORS[i] }} />
                    ))}
                  </div>
                  <div className="soy-legend-ends">
                    <span>&lt; {GRID_STEPS[0]}%</span>
                    <span>≥ {GRID_STEPS[4]}%</span>
                  </div>
                </div>
              ),
            }
          : { label: c.legendCompliant, symbol: <i className="sq" style={{ background: FIELD_COLOR }} /> },
    nc: {
      label: c.legendNc,
      symbol: <i className="nc-ring" />,
      detail: <p className="soy-key-note">{c.legendNcDot}</p>,
    },
    rings: { label: c.keyRings, symbol: <><i className="dot" style={{ background: PLANT_COLOR }} /><i className="ln" /></> },
    adm: { label: c.keyAdm, symbol: <><i className="dot adm" /><i className="ln dash" /></> },
    tp: { label: c.keyTp, symbol: <><i className="dot" style={{ background: TP_COLOR }} /><i className="ln dash tp" /></> },
    rail: { label: c.layerRail, symbol: <i className="ln" style={{ borderTopColor: RAIL_COLOR }} /> },
    rivers: { label: c.layerRivers, symbol: <i className="ln thick" style={{ borderTopColor: RIVER_COLOR }} /> },
    corridors: { label: c.layerCorridors, symbol: <i className="sq" style={{ background: "#dfe9f7" }} /> },
    roads: { label: c.layerRoads, symbol: <i className="ln road" /> },
  };
  const order: LayerKey[] =
    mode === "corridor"
      ? ["fields", "rail", "rivers", "corridors", "rings", "adm", "tp", "nc", "roads"]
      : ["fields", "nc", "rings", "adm", "tp", "rail", "rivers", "roads"];

  return (
    <div className="soy-map supply-map">
      <div ref={containerRef} className="soy-map-canvas" />
      <div className="soy-map-tools">
        {toolsSlot}
        <details className="soy-layers soy-key map-card" open={layersOpen} onToggle={(e) => setLayersOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>{c.layers}</summary>
          <ul>
            {order.map((k) => {
              const st = (REMOTE as string[]).includes(k) ? remote[k as Remote] : null;
              const item = KEY[k];
              return (
                <li key={k} className={on[k] ? "" : "off"}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on[k]}
                      onChange={() => {
                        if (st === "error") setRemote((s) => ({ ...s, [k]: "idle" }));
                        setOn((s) => ({ ...s, [k]: !s[k] }));
                      }}
                    />
                    <span className="soy-key-symbol">{item.symbol}</span>
                    <span>
                      {item.label}
                      {on[k] && st === "loading" ? <em> {c.loading}</em> : null}
                      {on[k] && st === "error" ? <em className="err"> {c.failed}</em> : null}
                    </span>
                  </label>
                  {on[k] && item.detail ? item.detail : null}
                </li>
              );
            })}
          </ul>
          <p className="soy-key-foot">{c.legendMiles}</p>
        </details>
      </div>

      <div className="basemap-chip soy-basemap-chip">
        {bmOpen ? (
          <div className="basemap-menu" role="menu">
            {BASEMAP_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={basemap === id}
                className={basemap === id ? "on" : ""}
                onClick={() => {
                  setBm(id);
                  setBmOpen(false);
                }}
              >
                {BASEMAPS[id].label}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="basemap-chip-btn" aria-haspopup="menu" aria-expanded={bmOpen} onClick={() => setBmOpen((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5" strokeLinejoin="round" />
          </svg>
          <span className="basemap-chip-label">
            <small>{c.basemap}</small>
            {BASEMAPS[basemap].label}
          </span>
        </button>
      </div>

      {mode === "supply" && inView ? (
        <div className="soy-inview map-card" aria-live="polite">
          <p className="soy-inview-title">
            {c.inViewTitle} · {inView.one ? c.inViewCatchment : c.inViewChain}
          </p>
          <div className="soy-inview-row">
            <div>
              <b>
                {inView.approx ? "≈ " : ""}
                {formatAcres(inView.total, lang)}
              </b>
              <span>{c.inViewTotal}</span>
            </div>
            <div>
              <b className="bad">{formatAcres(inView.ncAcres, lang)}</b>
              <span>{c.inViewNcArea}</span>
            </div>
            <div>
              <b className="ok">{inView.total > 0 ? formatSharePct(pct(inView.total - inView.ncAcres, inView.total), lang) : "—"}</b>
              <span>{c.inViewCompliant}</span>
            </div>
            <div>
              <b>{inView.total > 0 ? formatSharePct(pct(inView.ncAcres, inView.total), lang) : "—"}</b>
              <span>{c.inViewShare}</span>
            </div>
          </div>
          <p className="soy-inview-note">
            {fill(c.inViewNc, { n: formatCount(inView.ncFields, lang) })}
            {inView.approx ? ` ${c.inViewApprox}` : ""}
          </p>
        </div>
      ) : null}
      {on.fields && unitState.level < 3 ? <p className="soy-map-status">{c.pickForFields}</p> : null}
      {on.fields && unitState.loading ? (
        <p className="soy-map-status">
          <span className="spinner" aria-hidden="true" /> {c.loadingFields}
        </p>
      ) : null}
      {unitState.failed ? <p className="soy-map-status error">{c.fieldsError}</p> : null}
    </div>
  );
}
