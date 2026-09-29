import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount, formatHa } from "@/lib/format";
import { SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyGroupOf, type SoyCopy } from "@/lib/soy-copy";
import "maplibre-gl/dist/maplibre-gl.css";

export type SoyPlant = {
  id: string;
  name: string;
  address: string;
  state: string;
  lat: number;
  lon: number;
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
  features: { type: "Feature"; properties: { plant: string }; geometry: Geometry }[];
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
  return Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}

/**
 * The soy workspace's map: crushing plants, their 40-mile sourcing areas and
 * — once a plant is selected — that plant's soybean fields, shaded by how
 * many of the last 8 seasons each grew soybeans. Clicking a field shows its
 * details and crop history; clicking a plant selects it.
 */
export function SoyMap({
  plants,
  buffers,
  selected,
  fields,
  cdlNames,
  sc,
  lang,
  onSelectPlant,
}: {
  plants: SoyPlant[];
  buffers: SoyBuffers;
  selected: string | null;
  fields: SoyFieldCollection | null;
  cdlNames: Record<string, string>;
  sc: SoyCopy;
  lang: Lang;
  onSelectPlant: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("imagery");
  // Latest values for handlers bound once at mount.
  const live = useRef({ cdlNames, sc, lang, onSelectPlant });
  live.current = { cdlNames, sc, lang, onSelectPlant };

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
        map.addSource("buffers", { type: "geojson", data: buffers as never });
        map.addSource("fields", { type: "geojson", data: EMPTY_FC });
        map.addSource("plants", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: plants.map((p) => ({
              type: "Feature",
              properties: { id: p.id, name: p.name },
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            })),
          },
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

        for (const layer of ["fields-fill", "plants"]) {
          map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
        }
        map.on("click", "plants", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === "string") live.current.onSelectPlant(id);
        });
        map.on("click", "fields-fill", (e) => {
          if (!map) return;
          if (map.queryRenderedFeatures(e.point, { layers: ["plants"] }).length) return;
          const p = e.features?.[0]?.properties as
            SoyFieldCollection["features"][number]["properties"] | undefined;
          if (!p) return;
          const { cdlNames: names, sc: c, lang: l } = live.current;
          const codes = String(p.cdl).split(",");
          const history = codes
            .map((code, i) => {
              const n = code === "" ? null : Number(code);
              const name = n == null ? "—" : (names[String(n)] ?? `CDL ${n}`);
              const color = SOY_GROUP_COLORS[soyGroupOf(n)];
              return `<li><span>${2018 + i}</span><i style="background:${color}"></i>${escapeHtml(name)}</li>`;
            })
            .join("");
          const ha = Number(p.ha);
          const html = `<div class="soy-pop">
            <p class="soy-pop-k">${escapeHtml(c.fieldId)}</p><p class="soy-pop-v mono">${escapeHtml(String(p.id))}</p>
            <p class="soy-pop-k">${escapeHtml(c.fieldArea)}</p><p class="soy-pop-v">${escapeHtml(formatHa(ha, l))} · ${escapeHtml(fill(c.acres, { n: (ha / 0.40468564224).toLocaleString(l === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) }))}</p>
            <p class="soy-pop-k">${escapeHtml(c.fieldLocation)}</p><p class="soy-pop-v">${escapeHtml(`${p.county}, ${p.st}`)}</p>
            <p class="soy-pop-k">${escapeHtml(c.fieldHistory)}</p><ul class="soy-pop-hist">${history}</ul>
          </div>`;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ maxWidth: "320px", closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
        });
        mapRef.current = map;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // Plants/buffers come from one static file; the map is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selected plant: emphasise its sourcing area and fit the view to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const on = ["==", ["get", "plant"], selected ?? ""] as never;
    map.setPaintProperty("buffers-line", "line-width", ["case", on, 2.6, 1.2] as never);
    map.setPaintProperty(
      "buffers-line",
      "line-opacity",
      selected ? (["case", on, 1, 0.55] as never) : 0.9,
    );
    map.setPaintProperty(
      "buffers-fill",
      "fill-opacity",
      selected ? (["case", on, 0.08, 0.02] as never) : 0.06,
    );
    const geoms = buffers.features
      .filter((f) => !selected || f.properties.plant === selected)
      .map((f) => f.geometry);
    const b = bboxOf(geoms);
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

  return (
    <div className="soy-map">
      <div ref={containerRef} className="soy-map-canvas" />
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
