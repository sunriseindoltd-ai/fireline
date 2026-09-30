import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount, formatHa } from "@/lib/format";
import { SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyGroupOf, type SoyCopy } from "@/lib/soy-copy";
import "maplibre-gl/dist/maplibre-gl.css";

export type SoyPlant = {
  id: string;
  name: string;
  /** Sourcing area this plant belongs to (Decatur West + East share one). */
  area: string;
  address: string;
  state: string;
  lat: number;
  lon: number;
};
export type SoyElevator = {
  name: string | null;
  commodity: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  address: string | null;
  license: string | null;
  licenseStatus: string | null;
  licenseType: string | null;
  capacity: number | null;
  lat: number;
  lon: number;
  /** State the point actually falls in, vs `state` as listed. */
  pointState: string | null;
  locationMismatch: boolean;
  area: string | null;
};
export type SoyFlagged = {
  id: string;
  state: string | null;
  county: string | null;
  changeAcres: number | null;
  fieldAcres: number | null;
  totalAcres: number | null;
  crop2024: string | null;
  crop2025: string | null;
  soy2026: string | null;
  lat: number;
  lon: number;
  area: string | null;
};
type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
export type SoyFieldCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: Geometry;
    properties: {
      id: string;
      ha: number;
      county: string;
      st: string;
      cdl: string;
      soyYears: number;
    };
  }[];
};
export type SoyBuffers = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { area: string }; geometry: Geometry }[];
};

type Basemap = "imagery" | "map";
const TILES: Record<Basemap, { tiles: string[]; attribution: string; maxzoom?: number }> = {
  imagery: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 18,
  },
  map: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
  },
};
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };
const AC_TO_HA = 0.40468564224;

/** Context layers, fetched from the soy bucket the first time they're
 * switched on. Rail and rivers come from the client's ADM_SOY.gdb since
 * 30 Sep 2026 (rivers are NHD river-area polygons); roads from USA_diaz. */
type LineLayer = "rail" | "rivers" | "roads";
type LayerKey = "fields" | "elevators" | "flagged" | LineLayer;
const LINE_LAYERS: LineLayer[] = ["roads", "rivers", "rail"];
const SWATCH: Record<LayerKey, string> = {
  fields: SOY_YEARS_COLORS[4],
  elevators: "#ffffff",
  flagged: "#c9695e",
  rail: "#2b2b2e",
  rivers: "#4a93ea",
  roads: "#f1efe8",
};
const DEFAULT_ON: Record<LayerKey, boolean> = {
  fields: true,
  elevators: true,
  flagged: true,
  rail: false,
  rivers: false,
  roads: false,
};

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function bboxOf(geoms: Geometry[]): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // prettier-ignore
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  geoms.forEach((g) => walk(g.coordinates));
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null; // prettier-ignore
}

function row(k: string, v: string, mono = false) {
  return `<p class="soy-pop-k">${escapeHtml(k)}</p><p class="soy-pop-v${mono ? " mono" : ""}">${escapeHtml(v)}</p>`;
}

/**
 * The soy workspace's map: crushing plants, their 40-mile sourcing areas and
 * — once an area is selected — its soybean fields, shaded by how many of the
 * last 8 seasons each grew soybeans. Also ADM's grain elevators and flagged
 * ("non-compliant") field points, and rail / rivers / roads for context, each
 * switchable in the Layers card. Clicking a feature opens its details;
 * clicking a plant selects its sourcing area.
 */
export function SoyMap({
  plants,
  buffers,
  elevators,
  flagged,
  selected,
  fields,
  cdlNames,
  sc,
  lang,
  onSelectArea,
}: {
  plants: SoyPlant[];
  buffers: SoyBuffers;
  elevators: SoyElevator[];
  flagged: SoyFlagged[];
  selected: string | null;
  fields: SoyFieldCollection | null;
  cdlNames: Record<string, string>;
  sc: SoyCopy;
  lang: Lang;
  onSelectArea: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("imagery");
  // The Layers card starts open on wide screens, folded on phones (it would
  // cover most of the map there).
  const [layersOpen, setLayersOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setLayersOpen(false);
  }, []);
  const [on, setOn] = useState<Record<LayerKey, boolean>>(DEFAULT_ON);
  const [lineState, setLineState] = useState<
    Record<LineLayer, "idle" | "loading" | "ready" | "error">
  >({
    rail: "idle",
    rivers: "idle",
    roads: "idle",
  });
  // Latest values for handlers bound once at mount.
  const live = useRef({ cdlNames, sc, lang, onSelectArea, elevators, flagged });
  live.current = { cdlNames, sc, lang, onSelectArea, elevators, flagged };

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      const b = bboxOf(buffers.features.map((f) => f.geometry));
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
        bounds: b ?? undefined,
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        const points = <T extends { lat: number; lon: number }>(
          rows: T[],
          props: (r: T, i: number) => object,
        ) => ({
          type: "FeatureCollection" as const,
          features: rows.map((r, i) => ({
            type: "Feature" as const,
            properties: props(r, i),
            geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
          })),
        });
        map.addSource("buffers", { type: "geojson", data: buffers as never });
        map.addSource("fields", { type: "geojson", data: EMPTY_FC });
        for (const l of LINE_LAYERS) map.addSource(l, { type: "geojson", data: EMPTY_FC });
        map.addSource("plants", {
          type: "geojson",
          data: points(plants, (p) => ({ id: p.id, name: p.name, area: p.area })) as never,
        });
        map.addSource("elevators", {
          type: "geojson",
          data: points(elevators, (e, i) => ({ i, mismatch: e.locationMismatch })) as never,
        });
        map.addSource("flagged", {
          type: "geojson",
          data: points(flagged, (_f, i) => ({ i })) as never,
        });

        map.addLayer({
          id: "buffers-fill",
          type: "fill",
          source: "buffers",
          paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 },
        });
        map.addLayer({
          id: "fields-fill",
          type: "fill",
          source: "fields",
          paint: {
            // 1…8 seasons in soybeans -> SOY_YEARS_COLORS[0…7]. (`at` over a
            // literal array won't do: MapLibre types it as strings, not colours.)
            "fill-color": [
              "step",
              ["get", "soyYears"],
              SOY_YEARS_COLORS[0],
              ...SOY_YEARS_COLORS.slice(1).flatMap((c, i) => [i + 2, c]),
            ] as never,
            "fill-opacity": 0.78,
          },
        });
        map.addLayer({
          id: "fields-line",
          type: "line",
          source: "fields",
          minzoom: 11,
          paint: { "line-color": "#0f3d22", "line-width": 0.6, "line-opacity": 0.7 },
        });
        map.addLayer({
          id: "roads",
          type: "line",
          source: "roads",
          layout: { visibility: "none" },
          paint: {
            "line-color": SWATCH.roads,
            "line-opacity": 0.85,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              ["match", ["get", "class"], [1, 2], 1.2, 0.4],
              12,
              ["match", ["get", "class"], [1, 2], 3, 1.4],
            ] as never,
          },
        });
        map.addLayer({
          id: "rivers-fill",
          type: "fill",
          source: "rivers",
          layout: { visibility: "none" },
          paint: { "fill-color": SWATCH.rivers, "fill-opacity": 0.75 },
        });
        map.addLayer({
          id: "rivers",
          type: "line",
          source: "rivers",
          layout: { visibility: "none" },
          paint: {
            "line-color": SWATCH.rivers,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 12, 2.2] as never,
          },
        });
        map.addLayer({
          id: "rail-casing",
          type: "line",
          source: "rail",
          layout: { visibility: "none" },
          paint: {
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.2, 12, 4] as never,
            "line-opacity": 0.8,
          },
        });
        map.addLayer({
          id: "rail",
          type: "line",
          source: "rail",
          layout: { visibility: "none" },
          paint: {
            "line-color": SWATCH.rail,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2] as never,
            "line-dasharray": [3, 2],
          },
        });
        map.addLayer({
          id: "buffers-line",
          type: "line",
          source: "buffers",
          paint: {
            "line-color": "#ffffff",
            "line-width": 1.4,
            "line-dasharray": [2, 2],
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "flagged",
          type: "circle",
          source: "flagged",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3.5, 12, 7] as never,
            "circle-color": SWATCH.flagged,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "elevators",
          type: "circle",
          source: "elevators",
          paint: {
            "circle-radius": 5.5,
            "circle-color": SWATCH.elevators,
            "circle-stroke-color": ["case", ["get", "mismatch"], "#d2a95b", "#1d1d1f"] as never,
            "circle-stroke-width": ["case", ["get", "mismatch"], 3, 2] as never,
          },
        });
        map.addLayer({
          id: "plants",
          type: "circle",
          source: "plants",
          paint: {
            "circle-radius": 7,
            "circle-color": "#1f6fd1",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });
        map.addLayer({
          id: "plants-label",
          type: "symbol",
          source: "plants",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Semibold"],
            "text-size": 13,
            // Decatur (West) and (East) sit ~1 km apart: let the second label move
            // to another side of its point instead of being dropped.
            "text-variable-anchor": ["top", "bottom", "right", "left"],
            "text-radial-offset": 1,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.75)",
            "text-halo-width": 1.4,
          },
        });

        for (const layer of ["fields-fill", "plants", "elevators", "flagged"]) {
          map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
        }
        const open = (lngLat: import("maplibre-gl").LngLatLike, html: string) => {
          if (!map) return;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ maxWidth: "320px", closeButton: true })
            .setLngLat(lngLat)
            .setHTML(html)
            .addTo(map);
        };
        // One click handler, topmost feature first (plants > elevators >
        // flagged points > fields), so overlapping layers never open two popups.
        map.on("click", (e) => {
          if (!map) return;
          const hit = map.queryRenderedFeatures(e.point, {
            layers: ["plants", "elevators", "flagged", "fields-fill"],
          })[0];
          if (!hit) return;
          const { cdlNames: names, sc: c, lang: l, onSelectArea: selectArea } = live.current;
          const loc = l === "id" ? "id-ID" : "en-US";
          const num = (n: number | null, digits = 1) =>
            n == null ? "—" : n.toLocaleString(loc, { maximumFractionDigits: digits });
          if (hit.layer.id === "plants") {
            const area = hit.properties?.area;
            if (typeof area === "string") selectArea(area);
            return;
          }
          if (hit.layer.id === "elevators") {
            const el = live.current.elevators[Number(hit.properties?.i)];
            if (!el) return;
            const warn = el.locationMismatch
              ? `<p class="soy-pop-warn">${escapeHtml(fill(c.elMismatch, { at: el.pointState ?? "—", listed: el.state ?? "—" }))}</p>`
              : "";
            open(
              e.lngLat,
              `<div class="soy-pop">
              <p class="soy-pop-kicker">${escapeHtml(c.elevator)}</p><p class="soy-pop-title">${escapeHtml(el.name ?? "—")}</p>
              ${row(c.fieldLocation, [el.city, el.county, el.state].filter(Boolean).join(", "))}
              ${el.address ? row(c.elAddress, el.address) : ""}
              ${row(c.elCapacity, num(el.capacity, 0))}
              ${row(c.elLicense, [el.licenseType, el.license, el.licenseStatus].filter(Boolean).join(" · ") || "—")}
              ${warn}</div>`,
            );
            return;
          }
          if (hit.layer.id === "flagged") {
            const f = live.current.flagged[Number(hit.properties?.i)];
            if (!f) return;
            const acres = (a: number | null) =>
              a == null ? "—" : `${num(a)} acres · ${formatHa(a * AC_TO_HA, l)}`;
            const soy = f.soy2026 === "Y" ? c.yes : f.soy2026 === "N" ? c.no : (f.soy2026 ?? "—");
            open(
              e.lngLat,
              `<div class="soy-pop">
              <p class="soy-pop-kicker">${escapeHtml(c.flagged)}</p>
              ${row(c.fieldId, f.id, true)}
              ${row(c.fieldLocation, [f.county, f.state].filter(Boolean).join(", "))}
              ${row(c.flChange, acres(f.changeAcres))}
              ${row(c.flFieldArea, acres(f.fieldAcres))}
              ${row(c.flCrops, `${f.crop2024 ?? "—"} → ${f.crop2025 ?? "—"}`)}
              ${row(c.flSoy2026, soy)}</div>`,
            );
            return;
          }
          const p = hit.properties as SoyFieldCollection["features"][number]["properties"];
          const history = String(p.cdl)
            .split(",")
            .map((code, i) => {
              const n = code === "" ? null : Number(code);
              const name = n == null ? "—" : (names[String(n)] ?? `CDL ${n}`);
              return `<li><span>${2018 + i}</span><i style="background:${SOY_GROUP_COLORS[soyGroupOf(n)]}"></i>${escapeHtml(name)}</li>`;
            })
            .join("");
          const ha = Number(p.ha);
          open(
            e.lngLat,
            `<div class="soy-pop">
            ${row(c.fieldId, String(p.id), true)}
            ${row(c.fieldArea, `${formatHa(ha, l)} · ${fill(c.acres, { n: num(ha / AC_TO_HA) })}`)}
            ${row(c.fieldLocation, `${p.county}, ${p.st}`)}
            <p class="soy-pop-k">${escapeHtml(c.fieldHistory)}</p><ul class="soy-pop-hist">${history}</ul></div>`,
          );
        });
        mapRef.current = map;
        // Dev only: lets browser checks project lng/lat to screen points.
        if (import.meta.env.DEV && containerRef.current) {
          (containerRef.current as unknown as { __map?: unknown }).__map = map;
        }
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // Plants/buffers/points come from one static file; the map is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selected area: emphasise it and fit the view to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const hit = ["==", ["get", "area"], selected ?? ""] as never;
    map.setPaintProperty("buffers-line", "line-width", ["case", hit, 2.6, 1.2] as never);
    map.setPaintProperty(
      "buffers-line",
      "line-opacity",
      selected ? (["case", hit, 1, 0.55] as never) : 0.9,
    );
    map.setPaintProperty(
      "buffers-fill",
      "fill-opacity",
      selected ? (["case", hit, 0.08, 0.02] as never) : 0.06,
    );
    const b = bboxOf(
      buffers.features
        .filter((f) => !selected || f.properties.area === selected)
        .map((f) => f.geometry),
    );
    if (b) map.fitBounds(b, { padding: 40, duration: 700 });
    popupRef.current?.remove();
  }, [selected, ready, buffers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("fields") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(
      (fields ?? EMPTY_FC) as never,
    );
  }, [fields, ready]);

  // Layer switches; a line layer's data is fetched the first time it's on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (v: boolean) => (v ? "visible" : "none");
    for (const id of ["fields-fill", "fields-line"])
      map.setLayoutProperty(id, "visibility", vis(on.fields));
    map.setLayoutProperty("elevators", "visibility", vis(on.elevators));
    map.setLayoutProperty("flagged", "visibility", vis(on.flagged));
    map.setLayoutProperty("roads", "visibility", vis(on.roads));
    for (const id of ["rivers", "rivers-fill"]) map.setLayoutProperty(id, "visibility", vis(on.rivers));
    for (const id of ["rail", "rail-casing"]) map.setLayoutProperty(id, "visibility", vis(on.rail));
    for (const l of LINE_LAYERS) {
      if (!on[l] || lineState[l] !== "idle") continue;
      setLineState((s) => ({ ...s, [l]: "loading" }));
      void fetch(`/data/layers/${l}.geojson`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((fc) => {
          (map.getSource(l) as import("maplibre-gl").GeoJSONSource | undefined)?.setData(
            fc as never,
          );
          setLineState((s) => ({ ...s, [l]: "ready" }));
        })
        .catch(() => setLineState((s) => ({ ...s, [l]: "error" })));
    }
  }, [on, ready, lineState]);

  // An open popup was rendered in the previous language.
  useEffect(() => {
    popupRef.current?.remove();
  }, [lang]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("imagery", "visibility", basemap === "imagery" ? "visible" : "none");
    map.setLayoutProperty("map", "visibility", basemap === "map" ? "visible" : "none");
  }, [basemap, ready]);

  const layerLabel: Record<LayerKey, string> = {
    fields: sc.layerFields,
    elevators: sc.layerElevators,
    flagged: sc.layerFlagged,
    rail: sc.layerRail,
    rivers: sc.layerRivers,
    roads: sc.layerRoads,
  };
  const toggle = (k: LayerKey) => {
    if (k !== "fields" && k !== "elevators" && k !== "flagged" && lineState[k] === "error") {
      setLineState((s) => ({ ...s, [k]: "idle" }));
    }
    setOn((s) => ({ ...s, [k]: !s[k] }));
  };

  return (
    <div className="soy-map">
      <div ref={containerRef} className="soy-map-canvas" />
      <div className="soy-map-tools">
        <div className="soy-map-basemap seg" role="group" aria-label="Basemap">
          {(["imagery", "map"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={basemap === k ? "on" : ""}
              aria-pressed={basemap === k}
              onClick={() => setBasemap(k)}
            >
              {k === "imagery" ? sc.basemapImagery : sc.basemapMap}
            </button>
          ))}
        </div>
        <details
          className="soy-layers map-card"
          open={layersOpen}
          onToggle={(e) => setLayersOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{sc.layersTitle}</summary>
          <ul>
            {(["fields", "elevators", "flagged", "rail", "rivers", "roads"] as const).map((k) => {
              const st = k === "rail" || k === "rivers" || k === "roads" ? lineState[k] : null;
              return (
                <li key={k}>
                  <label>
                    <input type="checkbox" checked={on[k]} onChange={() => toggle(k)} />
                    <i className={`soy-swatch ${k}`} style={{ background: SWATCH[k] }} />
                    {layerLabel[k]}
                    {on[k] && st === "loading" ? <em> {sc.layerLoading}</em> : null}
                    {on[k] && st === "error" ? <em className="err"> {sc.layerFailed}</em> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      </div>
      <div className="soy-map-legend map-card">
        <p className="soy-legend-title">{sc.legendTitle}</p>
        <div className="soy-legend-ramp">
          {SOY_YEARS_COLORS.map((c, i) => (
            <span key={c} style={{ background: c }} title={fill(sc.yearsN, { n: i + 1 })} />
          ))}
        </div>
        <div className="soy-legend-ends">
          <span>1</span>
          <span>{formatCount(8, lang)}</span>
        </div>
        <p className="soy-legend-note">{sc.legendNote}</p>
        <p className="soy-legend-item">
          <i className="dot" /> {sc.legendPlant}
        </p>
        <p className="soy-legend-item">
          <i className="ring" /> {sc.legendBuffer}
        </p>
      </div>
    </div>
  );
}
