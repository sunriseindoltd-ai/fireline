import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount, formatHa } from "@/lib/format";
import { SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyGroupOf } from "@/lib/soy-copy";
import type { SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  BAND_COLORS,
  FIELD_COLOR,
  FLAG,
  NC_COLOR,
  NC_INK,
  PLANT_COLOR,
  RAIL_COLOR,
  RIVER_COLOR,
  TP_COLOR,
  circle,
  circleBounds,
  tierBit,
  type Band,
  type Basis,
  type Catchment,
  type NcProps,
  type SupplyData,
  type SupplyFieldProps,
} from "@/lib/soy-supply";
import "maplibre-gl/dist/maplibre-gl.css";

type Feature = { type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
type FC = { type: "FeatureCollection"; features: Feature[] };
const EMPTY: FC = { type: "FeatureCollection", features: [] };

export type SupplyMapMode = "supply" | "corridor";
export type SupplyColorBy = "status" | "years";
type LayerKey = "fields" | "nc" | "rings" | "adm" | "tp" | "rail" | "rivers" | "corridors" | "roads";
type Remote = "rail" | "rivers" | "corridors" | "roads";
const REMOTE: Remote[] = ["rail", "rivers", "corridors", "roads"];

const DEFAULTS: Record<SupplyMapMode, Record<LayerKey, boolean>> = {
  supply: { fields: true, nc: true, rings: true, adm: true, tp: true, rail: false, rivers: false, corridors: false, roads: false },
  corridor: { fields: true, nc: false, rings: true, adm: true, tp: true, rail: true, rivers: true, corridors: true, roads: false },
};
const FIELDS_MIN_ZOOM = 9;
const MAX_CELLS = 24;
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const TILES = {
  imagery: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 18,
  },
  map: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors" },
};

// Kept across view switches and remounts: the same cells and layers are
// never fetched twice in one visit.
const cellCache = new Map<string, Feature[]>();
const remoteCache = new Map<string, FC>();
let ncCache: FC | null = null;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function row(k: string, v: string, mono = false) {
  return `<p class="soy-pop-k">${esc(k)}</p><p class="soy-pop-v${mono ? " mono" : ""}">${esc(v)}</p>`;
}
function centerOf(g: Feature["geometry"]): [number, number] | null {
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
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

/** Value used for the distance colouring, per basis (999 = no data). */
function distanceExpr(basis: Basis) {
  const r = ["coalesce", ["get", "r"], 999];
  const v = ["coalesce", ["get", "v"], 999];
  return basis === "rail" ? r : basis === "river" ? v : ["min", r, v];
}
function bandColorExpr(basis: Basis) {
  return [
    "step",
    distanceExpr(basis),
    BAND_COLORS.b5,
    5.0001,
    BAND_COLORS.b10,
    10.0001,
    BAND_COLORS.b20,
    20.0001,
    BAND_COLORS.far,
    998,
    BAND_COLORS.none,
  ];
}

/**
 * SoyTrace's supply-chain map (Quincy plant, ADM and third-party elevators,
 * their catchments, compliant and non-compliant fields) and, in "corridor"
 * mode, the same with rail, rivers and 5/10-mile bands, fields coloured by
 * distance. Zoomed out, a density grid stands in for the ~390k fields; from
 * zoom 9 the fields load by 0.25° cell. Non-compliant fields always keep
 * their real outline — zoomed out they're marked by small dots only.
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<"imagery" | "map">("imagery");
  const [on, setOn] = useState<Record<LayerKey, boolean>>(DEFAULTS[mode]);
  const [remote, setRemote] = useState<Record<Remote, "idle" | "loading" | "ready" | "error">>({
    rail: "idle",
    rivers: "idle",
    corridors: "idle",
    roads: "idle",
  });
  const [cellState, setCellState] = useState<{ zoomOk: boolean; loading: number; failed: boolean }>({
    zoomOk: false,
    loading: 0,
    failed: false,
  });
  const [layersOpen, setLayersOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setLayersOpen(false);
  }, []);
  const live = useRef({ data, onSelect, cdlNames, catchments, c, lang, on });
  live.current = { data, onSelect, cdlNames, catchments, c, lang, on };

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
        style: {
          version: 8,
          glyphs: GLYPHS_URL,
          sources: {
            imagery: { type: "raster", tileSize: 256, ...TILES.imagery },
            map: { type: "raster", tileSize: 256, ...TILES.map },
          },
          layers: [
            { id: "imagery", type: "raster", source: "imagery" },
            { id: "map", type: "raster", source: "map", layout: { visibility: "none" } },
          ],
        },
        bounds: circleBounds(data.plant.lon, data.plant.lat, (q80?.radiusM ?? 150000) * 2.2),
        fitBoundsOptions: { padding: 30 },
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

      map.on("load", () => {
        if (!map) return;
        const pt = (lon: number, lat: number, props: object): Feature => ({
          type: "Feature",
          properties: props as Record<string, unknown>,
          geometry: { type: "Point", coordinates: [lon, lat] },
        });
        const ring = (lon: number, lat: number, r: number, props: object): Feature => ({
          type: "Feature",
          properties: props as Record<string, unknown>,
          geometry: { type: "Polygon", coordinates: [circle(lon, lat, r)] },
        });
        const d = data.gridDeg;
        const grid: FC = {
          type: "FeatureCollection",
          features: data.grid.map(([gx, gy, a, cov, r10, v10, e10]) => ({
            type: "Feature",
            properties: { a, cov, r10, v10, e10 },
            geometry: {
              type: "Polygon",
              coordinates: [[[gx * d, gy * d], [(gx + 1) * d, gy * d], [(gx + 1) * d, (gy + 1) * d], [gx * d, (gy + 1) * d], [gx * d, gy * d]]], // prettier-ignore
            },
          })),
        };
        map.addSource("grid", { type: "geojson", data: grid as never });
        map.addSource("fields", { type: "geojson", data: EMPTY as never });
        map.addSource("nc", { type: "geojson", data: EMPTY as never });
        map.addSource("nc-pts", { type: "geojson", data: EMPTY as never });
        for (const r of REMOTE) map.addSource(r, { type: "geojson", data: EMPTY as never });
        map.addSource("rings", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.rings.map((r) => ring(data.plant.lon, data.plant.lat, r.radiusM, { id: r.id })),
          } as never,
        });
        map.addSource("adm-catch", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.admElevators
              .filter((e) => e.radiusM)
              .map((e) => ring(e.lon, e.lat, e.radiusM!, { id: e.id })),
          } as never,
        });
        map.addSource("tp-catch", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.thirdParty.map((e) => ring(e.lon, e.lat, e.radiusM, { id: e.id, core: e.core })),
          } as never,
        });
        map.addSource("plant", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [pt(data.plant.lon, data.plant.lat, { name: data.plant.name })] } as never,
        });
        map.addSource("adm", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.admElevators.map((e) => pt(e.lon, e.lat, { id: e.id, name: e.city ?? e.name })),
          } as never,
        });
        map.addSource("tp", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: data.thirdParty.map((e) => pt(e.lon, e.lat, { id: e.id, name: e.company ?? "", core: e.core })),
          } as never,
        });

        map.addLayer({ id: "grid", type: "fill", source: "grid", maxzoom: FIELDS_MIN_ZOOM, paint: { "fill-opacity": 0.72 } });
        // Bands only from zoom 6.5: zoomed out they blanket the 7 states and
        // hide the density shading underneath.
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
        map.addLayer({ id: "fields", type: "fill", source: "fields", minzoom: FIELDS_MIN_ZOOM, paint: { "fill-opacity": 0.78 } });
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
          paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.6, 12, 4] as never, "line-opacity": 0.75 },
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
        map.addLayer({
          id: "rings",
          type: "line",
          source: "rings",
          paint: {
            "line-color": "#ffffff",
            "line-width": 2.2,
            "line-dasharray": ["literal", [1, 0]] as never,
            "line-opacity": 0.95,
          },
        });
        map.addLayer({
          id: "nc-fill",
          type: "fill",
          source: "nc",
          minzoom: FIELDS_MIN_ZOOM,
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "fill-color": NC_COLOR, "fill-opacity": 0.9 },
        });
        map.addLayer({
          id: "nc-line",
          type: "line",
          source: "nc",
          minzoom: FIELDS_MIN_ZOOM,
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "line-color": NC_INK, "line-width": 1.2 },
        });
        map.addLayer({
          id: "nc-dot",
          type: "circle",
          source: "nc-pts",
          paint: {
            // Small and unoutlined: a marker for where a field is, not a
            // symbol whose size could be read as its area.
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.3, 8, 2, 11, 3] as never,
            "circle-color": NC_COLOR,
            "circle-stroke-color": NC_INK,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0, 9, 0.6] as never,
            // Polygon markers fade out once the true outline is legible;
            // point-only records stay.
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 1, 11.5, ["case", ["get", "po"], 1, 0]] as never,
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 1, 11.5, ["case", ["get", "po"], 1, 0]] as never,
          },
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
          if (!hit) return;
          const { data: dt, c: cc, lang: l, catchments: cm, cdlNames: names } = live.current;
          const loc = l === "id" ? "id-ID" : "en-US";
          const num = (n: number | null | undefined, digits = 1) =>
            n == null ? "—" : n.toLocaleString(loc, { maximumFractionDigits: digits });
          const acresHa = (a: number | null | undefined) =>
            a == null ? "—" : `${formatHa(a * AC_TO_HA, l)} · ${fill(cc.acres, { n: num(a) })}`;
          const mi = (n: number | null | undefined) => (n == null ? cc.noNetworkData : fill(cc.milesShort, { n: num(n) }));
          const catchLine = (id: string) => {
            const k = cm.get(id);
            if (!k) return "";
            return row(
              cc.catchmentStats,
              fill(cc.soyInCatch, {
                area: formatHa(k.compliant.acres * AC_TO_HA, l),
                nc: formatCount(k.nonCompliant.fields, l),
              }),
            );
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
              ${catchLine("q40")}${catchLine("q80")}</div>`,
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
          const history = (cdl: string) =>
            `<ul class="soy-pop-hist">${String(cdl)
              .split(",")
              .map((code, i) => {
                const n = code === "" ? null : Number(code);
                const name = n == null ? "—" : (names[String(n)] ?? `CDL ${n}`);
                return `<li><span>${2018 + i}</span><i style="background:${SOY_GROUP_COLORS[soyGroupOf(n)]}"></i>${esc(name)}</li>`;
              })
              .join("")}</ul>`;
          const tiers = (f: number) =>
            [
              f & FLAG.q40 ? cc.scopeQ40 : f & FLAG.q80 ? cc.scopeQ80 : null,
              f & FLAG.adm ? cc.scopeAdm : null,
              f & FLAG.tp ? cc.scopeTp : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—";
          if (lid === "nc-dot" || lid === "nc-fill") {
            const p = hit.properties as unknown as NcProps;
            const before =
              p.b === "treed" ? cc.ncBeforeTreed : p.b === "natural" ? cc.ncBeforeNatural : p.b === "crop" ? cc.ncBeforeCrop : cc.unknown;
            open(
              e.lngLat,
              `<div class="soy-pop"><p class="soy-pop-kicker">${esc(p.po ? cc.popNcPoint : cc.popNc)}</p>
              ${row(cc.fieldId, String(p.id), true)}
              ${row(cc.location, [p.n, p.s].filter(Boolean).join(", ") || "—")}
              ${row(cc.fieldArea, acresHa(Number(p.a)))}
              ${row(cc.changedArea, acresHa(p.ch == null ? null : Number(p.ch)))}
              ${p.po ? "" : row(cc.before, before)}
              ${p.po || p.y == null ? "" : row(cc.firstCrop, String(p.y))}
              ${row(cc.crops2425, `${p.c24 ?? "—"} → ${p.c25 ?? "—"}`)}
              ${row(cc.soy2026, p.s26 ?? "—")}
              ${row(cc.memberOf, tiers(Number(p.f)))}
              ${Number(p.f) & FLAG.dual ? `<p class="soy-pop-warn">${esc(cc.alsoCompliant)}</p>` : ""}
              ${p.po ? "" : `<p class="soy-pop-k">${esc(cc.history)}</p>${history(String(p.c))}`}</div>`,
            );
            return;
          }
          const p = hit.properties as unknown as SupplyFieldProps;
          open(
            e.lngLat,
            `<div class="soy-pop"><p class="soy-pop-kicker">${esc(cc.popField)}</p>
            ${row(cc.fieldId, String(p.id), true)}
            ${row(cc.area, acresHa(Number(p.a)))}
            ${row(cc.location, [p.n, p.s].filter(Boolean).join(", "))}
            ${row(cc.memberOf, tiers(Number(p.f)))}
            ${row(cc.toRail, mi(p.r == null ? null : Number(p.r)))}
            ${row(cc.toRiver, mi(p.v == null ? null : Number(p.v)))}
            <p class="soy-pop-k">${esc(cc.history)}</p>${history(String(p.c))}</div>`,
          );
        });

        // Field cells in view, from zoom 9.
        let wanted = new Set<string>();
        let inflight = 0;
        const available = new Set(live.current.data.cells.map(([x, y]) => `${x}_${y}`));
        const push = () => {
          if (!map) return;
          const feats: Feature[] = [];
          for (const k of wanted) {
            const f = cellCache.get(k);
            if (f) feats.push(...f);
          }
          (map.getSource("fields") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: feats,
          } as never);
        };
        const refresh = () => {
          if (!map) return;
          const zoomOk = map.getZoom() >= FIELDS_MIN_ZOOM;
          if (!zoomOk || !live.current.on.fields) {
            setCellState((s) => ({ ...s, zoomOk }));
            return;
          }
          const b = map.getBounds();
          const deg = live.current.data.cellDeg;
          const ctr = map.getCenter();
          const list: { k: string; d: number }[] = [];
          for (let x = Math.floor(b.getWest() / deg); x <= Math.floor(b.getEast() / deg); x++) {
            for (let y = Math.floor(b.getSouth() / deg); y <= Math.floor(b.getNorth() / deg); y++) {
              const k = `${x}_${y}`;
              if (!available.has(k)) continue;
              list.push({ k, d: Math.hypot((x + 0.5) * deg - ctr.lng, (y + 0.5) * deg - ctr.lat) });
            }
          }
          list.sort((a, b2) => a.d - b2.d);
          wanted = new Set(list.slice(0, MAX_CELLS).map((x) => x.k));
          push();
          let failed = false;
          for (const k of wanted) {
            if (cellCache.has(k)) continue;
            inflight++;
            setCellState({ zoomOk, loading: inflight, failed });
            void fetch(`/data/fields/cells/${k}.geojson`)
              .then((res) => (res.ok ? (res.json() as Promise<FC>) : Promise.reject(new Error(String(res.status)))))
              .then((fc) => {
                cellCache.set(k, fc.features);
                if (wanted.has(k)) push();
              })
              .catch(() => {
                failed = true;
              })
              .finally(() => {
                inflight--;
                setCellState({ zoomOk, loading: inflight, failed });
              });
          }
          setCellState((s) => ({ ...s, zoomOk, loading: inflight }));
        };
        map.on("moveend", refresh);
        (map as unknown as { __refreshCells?: () => void }).__refreshCells = refresh;

        mapRef.current = map;
        if (import.meta.env.DEV && containerRef.current) {
          (containerRef.current as unknown as { __map?: unknown }).__map = map;
        }
        setReady(true);
        refresh();
      });
    })();
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once per view; everything reactive is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Non-compliant fields (one ~1 MB file).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !on.nc) return;
    const apply = (fc: FC) => {
      (map.getSource("nc") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(fc as never);
      const pts: FC = {
        type: "FeatureCollection",
        features: fc.features.flatMap((f) => {
          const at = f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : centerOf(f.geometry);
          return at ? [{ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: at } }] : [];
        }),
      };
      (map.getSource("nc-pts") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(pts as never);
    };
    if (ncCache) return apply(ncCache);
    void fetch("/data/fields/noncomply.geojson")
      .then((res) => (res.ok ? (res.json() as Promise<FC>) : Promise.reject(new Error(String(res.status)))))
      .then((fc) => {
        ncCache = fc;
        apply(fc);
      })
      .catch(() => undefined);
  }, [ready, on.nc]);

  // Layer switches; remote layers load the first time they're switched on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    const set = (ids: string[], v: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", vis(v)));
    set(["fields", "fields-line", "grid"], on.fields);
    set(["nc-fill", "nc-line", "nc-dot"], on.nc);
    set(["rings", "plant", "plant-label"], on.rings);
    set(["adm", "adm-catch", "adm-label"], on.adm);
    set(["tp", "tp-catch", "tp-label"], on.tp);
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
    (map as unknown as { __refreshCells?: () => void }).__refreshCells?.();
  }, [on, ready, remote]);

  // Colouring: fields, grid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bit = tierBit(selected);
    let fieldColor: unknown;
    if (mode === "corridor") fieldColor = bandColorExpr(basis);
    else if (colorBy === "years")
      fieldColor = ["step", ["get", "y"], SOY_YEARS_COLORS[0], ...SOY_YEARS_COLORS.slice(1).flatMap((col, i) => [i + 2, col])];
    else fieldColor = FIELD_COLOR;
    map.setPaintProperty("fields", "fill-color", fieldColor as never);
    // MapLibre has no bitwise operator: test the tier bit arithmetically.
    const hasBit = bit == null ? true : [">=", ["%", ["get", "f"], bit * 2], bit];
    map.setPaintProperty("fields", "fill-opacity", (bit == null ? 0.8 : ["case", hasBit, 0.85, 0.22]) as never);
    const gridColor =
      mode === "corridor"
        ? [
            "case",
            ["<=", ["get", "cov"], 0],
            BAND_COLORS.none,
            [
              "step",
              ["/", ["get", basis === "rail" ? "r10" : basis === "river" ? "v10" : "e10"], ["max", ["get", "cov"], 1]],
              BAND_COLORS.far,
              0.25,
              BAND_COLORS.b20,
              0.6,
              BAND_COLORS.b10,
              0.9,
              BAND_COLORS.b5,
            ],
          ]
        : ["step", ["get", "a"], SOY_YEARS_COLORS[0], 1000, SOY_YEARS_COLORS[2], 4000, SOY_YEARS_COLORS[4], 10000, SOY_YEARS_COLORS[5], 20000, SOY_YEARS_COLORS[6], 35000, SOY_YEARS_COLORS[7]]; // prettier-ignore
    map.setPaintProperty("grid", "fill-color", gridColor as never);
  }, [mode, colorBy, basis, band, selected, ready]);

  // Selected catchment: emphasise its outline, dim the others, fit to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = selected ?? "";
    const isTp = id === "tp" || id === "tpcore" || /^tp\d/.test(id);
    const isAdm = id === "adm" || /^adm\d/.test(id);
    const one = (x: string) => ["==", ["get", "id"], x];
    map.setPaintProperty("rings", "line-width", ["case", one(id), 3.4, 2.2] as never);
    map.setPaintProperty("rings", "line-opacity", (id && id !== "q40" && id !== "q80" && id !== "all" ? 0.45 : 0.95) as never);
    map.setPaintProperty("adm-catch", "line-width", (/^adm\d/.test(id) ? ["case", one(id), 3, 1.1] : isAdm ? 2 : 1.3) as never);
    map.setPaintProperty("adm-catch", "line-opacity", (/^adm\d/.test(id) ? ["case", one(id), 1, 0.35] : id && !isAdm && id !== "all" ? 0.4 : 0.9) as never);
    map.setPaintProperty(
      "tp-catch",
      "line-width",
      (/^tp\d/.test(id) ? ["case", one(id), 3, 0.8] : isTp ? 1.6 : 1) as never,
    );
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
    // Fit to the selection.
    const d = live.current.data;
    let b: [[number, number], [number, number]] | null = null;
    const merge = (bb: [[number, number], [number, number]]) => {
      b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; // prettier-ignore
    };
    if (id === "q40" || id === "q80") {
      const r = d.rings.find((x) => x.id === id)!;
      merge(circleBounds(d.plant.lon, d.plant.lat, r.radiusM));
    } else if (/^adm\d/.test(id)) {
      const e = d.admElevators.find((x) => x.id === id);
      if (e) merge(circleBounds(e.lon, e.lat, e.radiusM ?? 37000));
    } else if (/^tp\d/.test(id)) {
      const e = d.thirdParty.find((x) => x.id === id);
      if (e) merge(circleBounds(e.lon, e.lat, e.radiusM));
    } else if (id === "adm") {
      d.admElevators.forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM ?? 37000)));
    } else if (id === "tp" || id === "tpcore") {
      d.thirdParty.filter((e) => id === "tp" || e.core).forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
    } else {
      d.thirdParty.forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM)));
      d.admElevators.forEach((e) => merge(circleBounds(e.lon, e.lat, e.radiusM ?? 37000)));
    }
    if (b) map.fitBounds(b, { padding: 30, duration: 700 });
  }, [selected, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("imagery", "visibility", basemap === "imagery" ? "visible" : "none");
    map.setLayoutProperty("map", "visibility", basemap === "map" ? "visible" : "none");
  }, [basemap, ready]);

  useEffect(() => {
    popupRef.current?.remove();
  }, [lang]);

  const LABEL: Record<LayerKey, string> = {
    fields: c.layerFields,
    nc: c.layerNc,
    rings: c.layerPlantRings,
    adm: c.layerAdm,
    tp: c.layerTp,
    rail: c.layerRail,
    rivers: c.layerRivers,
    corridors: c.layerCorridors,
    roads: c.layerRoads,
  };
  const SW: Record<LayerKey, string> = {
    fields: mode === "corridor" ? BAND_COLORS.b10 : FIELD_COLOR,
    nc: NC_COLOR,
    rings: PLANT_COLOR,
    adm: "#ffffff",
    tp: TP_COLOR,
    rail: RAIL_COLOR,
    rivers: RIVER_COLOR,
    corridors: "#dfe9f7",
    roads: "#f1efe8",
  };
  const order: LayerKey[] =
    mode === "corridor"
      ? ["fields", "rail", "rivers", "corridors", "rings", "adm", "tp", "nc", "roads"]
      : ["fields", "nc", "rings", "adm", "tp", "rail", "rivers", "roads"];
  const basisName = basis === "rail" ? c.rail : basis === "river" ? c.riverWord : c.either;

  return (
    <div className="soy-map supply-map">
      <div ref={containerRef} className="soy-map-canvas" />
      <div className="soy-map-tools">
        <div className="soy-map-basemap seg" role="group" aria-label="Basemap">
          {(["imagery", "map"] as const).map((k) => (
            <button key={k} type="button" className={basemap === k ? "on" : ""} aria-pressed={basemap === k} onClick={() => setBasemap(k)}>
              {k === "imagery" ? c.basemapImagery : c.basemapMap}
            </button>
          ))}
        </div>
        <details className="soy-layers map-card" open={layersOpen} onToggle={(e) => setLayersOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>{c.layers}</summary>
          <ul>
            {order.map((k) => {
              const st = (REMOTE as string[]).includes(k) ? remote[k as Remote] : null;
              return (
                <li key={k}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on[k]}
                      onChange={() => {
                        if (st === "error") setRemote((s) => ({ ...s, [k]: "idle" }));
                        setOn((s) => ({ ...s, [k]: !s[k] }));
                      }}
                    />
                    <i className={`soy-swatch ${k}`} style={{ background: SW[k] }} />
                    {LABEL[k]}
                    {on[k] && st === "loading" ? <em> {c.loading}</em> : null}
                    {on[k] && st === "error" ? <em className="err"> {c.failed}</em> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      </div>

      <div className="soy-map-legend map-card supply-legend">
        {mode === "corridor" ? (
          <>
            <p className="soy-legend-title">{fill(c.legendBands, { basis: basisName.toLowerCase() })}</p>
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
          </>
        ) : (
          <>
            <p className="soy-legend-item">
              <i className="sq" style={{ background: FIELD_COLOR }} /> {c.legendCompliant}
            </p>
            <p className="soy-legend-item">
              <i className="sq" style={{ background: NC_COLOR, outline: `1px solid ${NC_INK}` }} /> {c.legendNc}
            </p>
            <p className="soy-legend-note">{c.legendNcDot}</p>
          </>
        )}
        <p className="soy-legend-item">
          <i className="dot" style={{ background: PLANT_COLOR }} /> {c.legendPlant}
        </p>
        <p className="soy-legend-item">
          <i className="dot adm" /> {c.legendAdm}
        </p>
        <p className="soy-legend-item">
          <i className="dot" style={{ background: TP_COLOR }} /> {c.legendTp}
        </p>
      </div>

      {on.fields && !cellState.zoomOk ? <p className="soy-map-status">{c.zoomForFields}</p> : null}
      {on.fields && cellState.zoomOk && cellState.loading > 0 ? (
        <p className="soy-map-status">
          <span className="spinner" aria-hidden="true" /> {c.loadingFields}
        </p>
      ) : null}
      {cellState.failed ? <p className="soy-map-status error">{c.fieldsError}</p> : null}
    </div>
  );
}
