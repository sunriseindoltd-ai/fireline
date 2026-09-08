import { useEffect, useMemo, useRef, useState } from "react";
import type { Fc } from "@/lib/ledger";
import { describeNonComplyIssue, MITIGATION_DESCRIPTIONS } from "@/lib/ledger-geo";
import "maplibre-gl/dist/maplibre-gl.css";

type BasemapId = "esri" | "google" | "osm";

type Basemap = { label: string; tiles: string[]; attribution: string };

// Google's mt0-mt3.google.com tile endpoints are undocumented/unofficial —
// Google's terms require the Maps Platform API (a key + billing account)
// for tile access outside their own products, and can block or rate-limit
// this pattern without notice. Included here at the user's explicit request
// after being told about that risk; Esri and OSM below are both genuinely
// free-to-use services with no such caveat.
const BASEMAPS: Record<BasemapId, Basemap> = {
  esri: {
    label: "Esri Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri",
  },
  google: {
    label: "Google Satellite",
    tiles: [0, 1, 2, 3].map((n) => `https://mt${n}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`),
    attribution: "Imagery © Google",
  },
  osm: {
    label: "OpenStreetMap",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
  },
};

const DEFAULT_BASEMAP: BasemapId = "esri";

// MapLibre's `text-field` needs a `glyphs` URL (an SDF font/glyph server)
// configured in the style spec to render anything at all — without one,
// text symbol layers silently render nothing. MapLibre's own project
// serves generic font glyphs (not just for their demo tiles) at this URL,
// so mill-name labels can use a real text-field instead of the ensureMillIcon
// canvas-image trick (only usable for a small fixed set of glyphs, not
// arbitrary mill names).
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const LABEL_FONT = ["Open Sans Semibold"];

function basemapStyle(id: BasemapId) {
  const bm = BASEMAPS[id];
  return {
    version: 8 as const,
    glyphs: GLYPHS_URL,
    sources: {
      sat: { type: "raster" as const, tileSize: 256, tiles: bm.tiles, attribution: bm.attribution },
    },
    layers: [{ id: "sat", type: "raster" as const, source: "sat" }],
  };
}

/** Swaps the basemap in place (remove+re-add the "sat" source/layer with
 * new tiles+attribution) instead of map.setStyle(), which would otherwise
 * wipe every custom layer (mills/plots/areas) added after the initial
 * style load and require re-adding them all. Re-inserts "sat" at the
 * bottom of the layer stack — wherever the first custom layer currently
 * is — so switching basemap never covers up the data layers on top of it. */
function setBasemap(map: import("maplibre-gl").Map, id: BasemapId) {
  const bm = BASEMAPS[id];
  const beforeId = ["forest-fill", "areas-fill", "plots-fill", "mills"].find((l) =>
    map.getLayer(l),
  );
  if (map.getLayer("sat")) map.removeLayer("sat");
  if (map.getSource("sat")) map.removeSource("sat");
  map.addSource("sat", {
    type: "raster",
    tileSize: 256,
    tiles: bm.tiles,
    attribution: bm.attribution,
  });
  map.addLayer({ id: "sat", type: "raster", source: "sat" }, beforeId);
}

/**
 * fitBounds alone gives wildly inconsistent results across mills: a mill
 * with a few tightly-packed plots computes a very deep "perfect fit" zoom
 * (uncomfortably close), while a mill whose smallholder plots are spread
 * across a whole district computes a very shallow one (uncomfortably far).
 * cameraForBounds lets us compute the same "perfect fit" without moving the
 * camera, then clamp it into a comfortable band before actually applying it
 * — trading "always shows every last plot" for "always feels similar".
 */
function fitBoundsClamped(
  map: import("maplibre-gl").Map,
  bounds: import("maplibre-gl").LngLatBoundsLike,
  opts: { padding: number; minZoom: number; maxZoom: number; duration?: number },
) {
  const cam = map.cameraForBounds(bounds, { padding: opts.padding, maxZoom: opts.maxZoom });
  if (!cam || cam.center == null || cam.zoom == null) return;
  const zoom = Math.min(opts.maxZoom, Math.max(opts.minZoom, cam.zoom));
  if (opts.duration) {
    map.easeTo({ center: cam.center, zoom, duration: opts.duration });
  } else {
    map.jumpTo({ center: cam.center, zoom });
  }
}

type MapHandle = {
  remove: () => void;
  resize: () => void;
  loaded: () => boolean;
  fitBounds: (b: unknown, o: unknown) => void;
  getLayer: (id: string) => unknown;
  setPaintProperty: (layer: string, prop: string, value: unknown) => void;
  setLayoutProperty: (layer: string, prop: string, value: unknown) => void;
};

export type ChainMapLabels = {
  empty: string;
  legendVillage: string;
  legendBuffer: string;
  legendPlots: string;
  legendMills: string;
  legendAreas: string;
  legendForest: string;
  millsByRefinery: string;
  colorBy: string;
  traceability: string;
  compliance: string;
  risk: string;
  mitigation: string;
  type: string;
  layersTitle: string;
  basemap: string;
  comply: string;
  nonComply: string;
  nonComplyReason: string;
  riskLow: string;
  riskMedium: string;
  riskHigh: string;
  uml: string;
  hectare: string;
  findTitle: string;
  searchPlotPlaceholder: string;
  searchPlotEmpty: string;
  noMatches: string;
  plotId: string;
  company: string;
  goToCoordinate: string;
  coordinatePlaceholder: string;
  go: string;
  coordinateInvalid: string;
  noPlotAtCoordinate: string;
};

type Props = {
  millGeom: Fc | null;
  areas: Fc | null;
  plots: Fc | null;
  forest: Fc | null;
  selectedMillId: string | null;
  onSelectMill: (id: string | null) => void;
  /** Set (with a fresh `nonce` each time, so clicking the same plot twice
   * still re-triggers) to fly to and pop up a specific plot from `plots` —
   * driven by workspace.tsx's plot table. Identified by index into
   * `plots.features` (the same array reference workspace.tsx built the
   * table from), not the plot's `ID` property — some prepared plot files
   * have duplicate Plot IDs, which an ID-based lookup could resolve to the
   * wrong feature. */
  focusPlot: { index: number; nonce: number } | null;
  labels: ChainMapLabels;
};

// Same literal colors already established for these categories in
// styles.css tokens (--color-comply/--color-noncomply, --color-accent-2/
// --color-warn/--color-danger, --chart-a..f) and eudr-summary.tsx's
// TYPE_COLORS — MapLibre paint expressions can't consume CSS custom
// properties, so these are kept in sync by hand.
const TRACE_COLORS = { village: "#4a9b94", buffer: "#c4a574", unknown: "#d7d0c4" };
const COMPLY_COLORS = { yes: "#8bc178", no: "#e28a95" };
const RISK_COLORS = { low: "#1c7a72", medium: "#8a6a3a", high: "#9a3f32" };
const MIT_COLORS: Record<string, string> = {
  A: "#0f7c73",
  B: "#2f8f5b",
  C: "#9a9a3c",
  D: "#e08a2e",
  E: "#c8631f",
  F: "#b23a2e",
};
const TYPE_COLORS: Record<string, string> = {
  "Independent Smallholder": "#1c7a72",
  Company: "#0f4c4a",
  "Scheme Smallholder": "#d5ebe8",
};
const FALLBACK_COLOR = "#d7d0c4";

// Same dark green already established as "forest" in eudr-summary.tsx's
// OVERLAP_COLORS / styles.css's --forest-hl token — reused here instead of
// picked fresh so the same hue means "forest" in both places. Deliberately
// outside the trace/comply/risk/mitigation/type families above (all
// teal/tan/red/pale-green) so a plot fill on top of this layer never reads
// as "part of the forest" or vice versa.
const FOREST_COLOR = "#2e7d32";

// Mill points are colored by refinery instead of by traceability whenever
// more than one Refinery/KCP is in view at once (e.g. viewing a whole Group
// that has several) — otherwise every mill would render identically and
// there'd be no way to tell which refinery a given point belongs to.
const REFINERY_COLORS = [
  "#1c7a72",
  "#c4a574",
  "#5b8c9e",
  "#9d6b53",
  "#7a8c5a",
  "#a66b8f",
  "#4a7ba6",
  "#b58b3e",
];

function refineryColorFor(refinery: string, distinctRefineries: string[]): string {
  const i = distinctRefineries.indexOf(refinery);
  return i < 0 ? FALLBACK_COLOR : REFINERY_COLORS[i % REFINERY_COLORS.length]!;
}

/**
 * Registers a small factory-glyph bitmap as a MapLibre image, so mill
 * points can use `icon-image` instead of `text-field`. MapLibre's
 * `text-field` needs a `glyphs` URL (an SDF font/glyph server) configured
 * in the style spec to render anything at all, including emoji — our style
 * only has the satellite raster source, no glyph server, so text-field
 * would silently render nothing. Rendering the emoji to a canvas first
 * uses the browser's own font stack (which does support color emoji) and
 * sidesteps the glyph-server requirement entirely.
 */
function ensureMillIcon(map: import("maplibre-gl").Map) {
  if (map.hasImage("mill-icon")) return;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = `${Math.round(size * 0.75)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🏭", size / 2, size / 2 + size * 0.04);
  map.addImage("mill-icon", ctx.getImageData(0, 0, size, size));
}

function millColorExpression(distinctRefineries: string[]): any {
  if (distinctRefineries.length > 1) {
    const stops: unknown[] = [];
    distinctRefineries.forEach((r) => stops.push(r, refineryColorFor(r, distinctRefineries)));
    return ["match", ["get", "_refinery"], ...stops, "#f4efe6"];
  }
  return ["match", ["get", "_trace"], "village", "#d5ebe8", "buffer", "#efe4d2", "#f4efe6"];
}

type ColorBy = "trace" | "comply" | "risk" | "mitigation" | "type";

// Returns a MapLibre style-spec expression; matches how these expressions
// were typed inline (implicitly) before this was pulled into a function.
function fillColorExpression(colorBy: ColorBy): any {
  switch (colorBy) {
    case "comply":
      return [
        "match",
        ["get", "_comply"],
        "yes",
        COMPLY_COLORS.yes,
        "no",
        COMPLY_COLORS.no,
        FALLBACK_COLOR,
      ];
    case "risk":
      return [
        "match",
        ["get", "_risk"],
        "low",
        RISK_COLORS.low,
        "medium",
        RISK_COLORS.medium,
        "high",
        RISK_COLORS.high,
        FALLBACK_COLOR,
      ];
    case "mitigation":
      return [
        "match",
        ["get", "_mitigation"],
        "A",
        MIT_COLORS.A,
        "B",
        MIT_COLORS.B,
        "C",
        MIT_COLORS.C,
        "D",
        MIT_COLORS.D,
        "E",
        MIT_COLORS.E,
        "F",
        MIT_COLORS.F,
        FALLBACK_COLOR,
      ];
    case "type":
      return [
        "match",
        ["get", "TYPE"],
        "Independent Smallholder",
        TYPE_COLORS["Independent Smallholder"],
        "Company",
        TYPE_COLORS.Company,
        "Scheme Smallholder",
        TYPE_COLORS["Scheme Smallholder"],
        FALLBACK_COLOR,
      ];
    default:
      return [
        "match",
        ["get", "_trace"],
        "village",
        TRACE_COLORS.village,
        "buffer",
        TRACE_COLORS.buffer,
        TRACE_COLORS.unknown,
      ];
  }
}

type LegendEntry = { label: string; color: string; count: number };

function legendEntries(colorBy: ColorBy, plots: Fc | null, labels: ChainMapLabels): LegendEntry[] {
  const features = plots?.features ?? [];
  const countBy = (key: string, value: string) =>
    features.filter((f) => String(f.properties?.[key] ?? "") === value).length;

  if (colorBy === "comply") {
    return [
      { label: labels.comply, color: COMPLY_COLORS.yes, count: countBy("_comply", "yes") },
      { label: labels.nonComply, color: COMPLY_COLORS.no, count: countBy("_comply", "no") },
    ];
  }
  if (colorBy === "risk") {
    return [
      { label: labels.riskLow, color: RISK_COLORS.low, count: countBy("_risk", "low") },
      { label: labels.riskMedium, color: RISK_COLORS.medium, count: countBy("_risk", "medium") },
      { label: labels.riskHigh, color: RISK_COLORS.high, count: countBy("_risk", "high") },
    ];
  }
  if (colorBy === "mitigation") {
    return ["A", "B", "C", "D", "E", "F"].map((letter) => ({
      label: letter,
      color: MIT_COLORS[letter]!,
      count: countBy("_mitigation", letter),
    }));
  }
  if (colorBy === "type") {
    return Object.entries(TYPE_COLORS).map(([label, color]) => ({
      label,
      color,
      count: countBy("TYPE", label),
    }));
  }
  return [
    {
      label: labels.legendVillage,
      color: TRACE_COLORS.village,
      count: countBy("_trace", "village"),
    },
    { label: labels.legendBuffer, color: TRACE_COLORS.buffer, count: countBy("_trace", "buffer") },
  ];
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function haShort(n: number) {
  return n >= 1000
    ? `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}k`
    : Math.round(n).toLocaleString("id-ID");
}

function plotPopupHtml(props: Record<string, unknown>, labels: ChainMapLabels): string {
  const mill = String(props._mill || props.Mill_name || "");
  const uml = String(props.UML_ID ?? "");
  // `PlotID` (scripts/prepare-plots.mjs) — genuinely unique per plot. The
  // source `ID` column looks similar but is actually a shared block/batch
  // code (confirmed duplicated across many distinct plots), so it's never
  // shown as "the" plot id.
  const plotId = String(props.PlotID ?? "");
  const company = String(props.COMPANY ?? "").trim();
  const ha = Number(props.HECTARAGE ?? 0);
  const complyRaw = props.EUDR_Comply;
  const comply = complyRaw === "YES" ? labels.comply : complyRaw === "NO" ? labels.nonComply : "—";
  const complyClass = complyRaw === "YES" ? "ok" : complyRaw === "NO" ? "bad" : "";
  const risk = String(props.Overall_Risk ?? "—");
  const mitLetter = String(props._mitigation ?? "").toUpperCase();
  // The canonical A–F wording (src/lib/ledger-geo.ts) rather than this
  // plot's own free-text Risk_Mitigation_Class, which isn't always worded
  // identically across rows/mills even for the same letter — falls back to
  // the raw text only if the letter itself couldn't be parsed.
  const mitigation =
    MITIGATION_DESCRIPTIONS[mitLetter] ?? String(props.Risk_Mitigation_Class ?? "—");
  const type = String(props.TYPE ?? "—");
  const nonComplyReason = complyRaw === "NO" ? describeNonComplyIssue(props.Desc_Issue) : "";

  const row = (label: string, value: string, cls = "") =>
    `<div class="plot-popup-row"><span>${escapeHtml(label)}</span><b class="${cls}">${escapeHtml(value)}</b></div>`;

  return `<div class="plot-popup">
    <h4>${escapeHtml(mill || uml || "Plot")}</h4>
    ${row(labels.plotId, plotId || "—")}
    ${row(labels.company, company || "—")}
    ${row(labels.uml, uml || "—")}
    ${row(labels.hectare, `${haShort(ha)} ha`)}
    ${row(labels.compliance, comply, complyClass)}
    ${row(labels.risk, risk)}
    ${row(labels.type, type)}
    <p class="plot-popup-note"><span>${escapeHtml(`${labels.mitigation}${mitLetter ? ` (${mitLetter})` : ""}`)}</span>${escapeHtml(mitigation)}</p>
    ${nonComplyReason ? `<p class="plot-popup-note bad"><span>${escapeHtml(labels.nonComplyReason)}</span>${escapeHtml(nonComplyReason)}</p>` : ""}
  </div>`;
}

// `maplibre-gl`'s type declarations don't expose a `default` export (only
// named classes), even though the dynamic `import("maplibre-gl")).default`
// used throughout this file resolves fine at runtime via ESM/CJS interop —
// so anywhere the *type* of that namespace object is needed (as opposed to
// just using it as a value right after importing it), this narrower type
// stands in for it with just the constructors actually used outside the
// mount effect's own closure.
type MaplibreGlNamespace = {
  Popup: typeof import("maplibre-gl").Popup;
  Marker: typeof import("maplibre-gl").Marker;
};

/** Shared by the map-click handler, search-result clicks, and the
 * coordinate lookup — one place that builds and shows a plot popup. */
function showPlotPopup(
  maplibregl: Pick<MaplibreGlNamespace, "Popup">,
  map: import("maplibre-gl").Map,
  popupRef: { current: import("maplibre-gl").Popup | null },
  lngLat: import("maplibre-gl").LngLatLike,
  feature: { properties?: Record<string, unknown> | null },
  labels: ChainMapLabels,
) {
  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
    .setLngLat(lngLat)
    .setHTML(plotPopupHtml(feature.properties ?? {}, labels))
    .addTo(map);
}

/** Flies the map to a plot feature's bounds and opens its popup — shared by
 * the search-result click and the plot-table row click (workspace.tsx). */
function focusOnPlotFeature(
  map: import("maplibre-gl").Map,
  maplibregl: Pick<MaplibreGlNamespace, "Popup">,
  popupRef: { current: import("maplibre-gl").Popup | null },
  feature: Fc["features"][number],
  labels: ChainMapLabels,
) {
  const bounds = featureBounds(feature);
  if (!bounds) return;
  fitBoundsClamped(map, bounds, { padding: 60, minZoom: 14, maxZoom: 18, duration: 600 });
  const center: [number, number] = [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
  showPlotPopup(maplibregl, map, popupRef, center, feature, labels);
}

/** Bounding box of a single feature's geometry, for zooming to it. */
function featureBounds(feature: {
  geometry?: { coordinates?: unknown } | null;
}): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let any = false;
  walk(feature.geometry?.coordinates, (lng, lat) => {
    any = true;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  return any
    ? [
        [minLng, minLat],
        [maxLng, maxLat],
      ]
    : null;
}

/** Case-insensitive substring match against a plot's Company or its unique
 * `PlotID` (scripts/prepare-plots.mjs) — not the source `ID` column, which
 * is a shared block/batch code rather than a per-plot identifier. */
function matchingPlots(plots: Fc | null, query: string): Fc["features"] {
  const q = query.trim().toLowerCase();
  if (!q || !plots) return [];
  return plots.features
    .filter((f) => {
      const company = String(f.properties?.COMPANY ?? "").toLowerCase();
      const id = String(f.properties?.PlotID ?? "").toLowerCase();
      return company.includes(q) || id.includes(q);
    })
    .slice(0, 8);
}

function parseCoordinate(input: string): [number, number] | null {
  const parts = input
    .trim()
    .split(/[,\s]+/)
    .map(Number);
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lon] = parts as [number, number];
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}

/** Ray-casting point-in-polygon, one linear ring. */
function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInRings(pt: [number, number], rings: number[][][]): boolean {
  if (!pointInRing(pt, rings[0]!)) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(pt, rings[k]!)) return false; // inside a hole
  }
  return true;
}

/** Does `pt` ([lng, lat]) fall inside this Polygon/MultiPolygon geometry? */
function pointInGeometry(
  pt: [number, number],
  geometry: { type: string; coordinates: unknown } | null | undefined,
): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInRings(pt, geometry.coordinates as number[][][]);
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).some((rings) => pointInRings(pt, rings));
  }
  return false;
}

export function ChainMap({
  millGeom,
  areas,
  plots,
  forest,
  selectedMillId,
  onSelectMill,
  focusPlot,
  labels,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const maplibreRef = useRef<MaplibreGlNamespace | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const selectedRef = useRef(selectedMillId);
  selectedRef.current = selectedMillId;
  const onSelectRef = useRef(onSelectMill);
  onSelectRef.current = onSelectMill;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const [colorBy, setColorBy] = useState<ColorBy>("comply");
  const colorByRef = useRef(colorBy);
  colorByRef.current = colorBy;
  const [basemap, setBasemapState] = useState<BasemapId>(DEFAULT_BASEMAP);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const [visible, setVisible] = useState({ mills: true, plots: true, areas: true, forest: true });
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [panelOpen, setPanelOpen] = useState(true);
  const [findOpen, setFindOpen] = useState(true);
  const [plotQuery, setPlotQuery] = useState("");
  const [coordInput, setCoordInput] = useState("");
  // Stores whether the coordinate is invalid, not the translated message
  // itself — otherwise switching languages while the error is showing would
  // leave it frozen in whichever language was active when it was set.
  const [coordInvalid, setCoordInvalid] = useState(false);

  // More than one Refinery/KCP in view (e.g. a whole Group) -> color mill
  // points by refinery instead of traceability so they stay distinguishable.
  const distinctRefineries = useMemo(() => {
    const set = new Set<string>();
    for (const f of millGeom?.features ?? []) {
      const r = String(f.properties?._refinery ?? "");
      if (r) set.add(r);
    }
    return [...set];
  }, [millGeom]);

  const hasGeom =
    (millGeom?.features.length ?? 0) +
      (areas?.features.length ?? 0) +
      (plots?.features.length ?? 0) >
    0;

  useEffect(() => {
    if (!root.current || !hasGeom) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !root.current) return;
      maplibreRef.current = maplibregl;

      map = new maplibregl.Map({
        container: root.current,
        style: basemapStyle(basemapRef.current),
        center: [112, 0.5],
        zoom: 4.2,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map as unknown as MapHandle;

      map.on("load", () => {
        if (!map) return;
        const sel = selectedRef.current ?? "";
        const bounds = new maplibregl.LngLatBounds();
        let any = false;
        const ext = (fc: Fc | null) => {
          if (!fc) return;
          for (const f of fc.features) {
            walk(f.geometry?.coordinates, (lng, lat) => {
              bounds.extend([lng, lat]);
              any = true;
            });
          }
        };

        // Added before areas/plots/mills so it always sits directly above
        // the basemap and below every data layer — a solid-looking green
        // wash that plot/area fills and outlines always render on top of,
        // never the other way around.
        if (forest && forest.features.length) {
          map.addSource("forest", { type: "geojson", data: forest as GeoJSON.GeoJSON });
          map.addLayer({
            id: "forest-fill",
            type: "fill",
            source: "forest",
            layout: { visibility: visibleRef.current.forest ? "visible" : "none" },
            paint: {
              "fill-color": FOREST_COLOR,
              "fill-opacity": 0.45,
            },
          });
        }
        if (areas && areas.features.length) {
          map.addSource("areas", { type: "geojson", data: areas as GeoJSON.GeoJSON });
          map.addLayer({
            id: "areas-fill",
            type: "fill",
            source: "areas",
            layout: { visibility: visibleRef.current.areas ? "visible" : "none" },
            paint: {
              "fill-color": [
                "match",
                ["get", "_kind"],
                "village",
                "#0f4c4a",
                "buffer",
                "#8a6a3a",
                "#1c7a72",
              ],
              "fill-opacity": 0.28,
            },
          });
          map.addLayer({
            id: "areas-line",
            type: "line",
            source: "areas",
            layout: { visibility: visibleRef.current.areas ? "visible" : "none" },
            paint: {
              "line-color": ["match", ["get", "_kind"], "buffer", "#efe4d2", "#d5ebe8"],
              "line-width": 1.4,
            },
          });
          ext(areas);
        }
        if (plots && plots.features.length) {
          map.addSource("plots", { type: "geojson", data: plots as GeoJSON.GeoJSON });
          map.addLayer({
            id: "plots-fill",
            type: "fill",
            source: "plots",
            layout: { visibility: visibleRef.current.plots ? "visible" : "none" },
            paint: {
              "fill-color": fillColorExpression(colorByRef.current),
              "fill-opacity": ["case", ["==", ["get", "_id"], sel], 0.35, 0.18],
            },
          });
          map.addLayer({
            id: "plots-line",
            type: "line",
            source: "plots",
            layout: { visibility: visibleRef.current.plots ? "visible" : "none" },
            paint: {
              "line-color": fillColorExpression(colorByRef.current),
              "line-opacity": 0.9,
              "line-width": 1.1,
            },
          });
          ext(plots);

          map.on("click", "plots-fill", (e) => {
            const feature = e.features?.[0];
            if (!feature || !map) return;
            showPlotPopup(maplibregl, map, popupRef, e.lngLat, feature, labelsRef.current);
          });
          map.on("mouseenter", "plots-fill", () => {
            map!.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "plots-fill", () => {
            map!.getCanvas().style.cursor = "";
          });
        }
        if (millGeom && millGeom.features.length) {
          map.addSource("mills", { type: "geojson", data: millGeom as GeoJSON.GeoJSON });
          map.addLayer({
            id: "mills",
            type: "circle",
            source: "mills",
            layout: { visibility: visibleRef.current.mills ? "visible" : "none" },
            paint: {
              "circle-radius": ["case", ["==", ["get", "_id"], sel], 10, 7],
              "circle-color": millColorExpression(distinctRefineries),
              "circle-stroke-width": 1.6,
              "circle-stroke-color": "#1a2423",
            },
          });
          // A small factory glyph on top of the colored dot, so mill points
          // read as "this is a mill" at a glance instead of a generic dot.
          ensureMillIcon(map);
          map.addLayer({
            id: "mills-icon",
            type: "symbol",
            source: "mills",
            layout: {
              visibility: visibleRef.current.mills ? "visible" : "none",
              "icon-image": "mill-icon",
              "icon-size": ["case", ["==", ["get", "_id"], sel], 0.55, 0.38],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          });
          // Mill name, shown only once zoomed in far enough that individual
          // points have room to breathe — at the wide portfolio-level zoom
          // (4-9, see fitBoundsClamped calls below) many mills can sit close
          // together and labels would just overlap into noise.
          map.addLayer({
            id: "mills-label",
            type: "symbol",
            source: "mills",
            minzoom: 10,
            layout: {
              visibility: visibleRef.current.mills ? "visible" : "none",
              "text-field": ["get", "_mill"],
              "text-font": LABEL_FONT,
              "text-size": 11,
              "text-offset": [0, 1.1],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-optional": true,
            },
            paint: {
              "text-color": "#f4efe6",
              "text-halo-color": "#1a2423",
              "text-halo-width": 1.2,
            },
          });
          ext(millGeom);
          for (const layerId of ["mills", "mills-icon"]) {
            map.on("click", layerId, (e) => {
              const id = e.features?.[0]?.properties?._id;
              onSelectRef.current(typeof id === "string" && id ? id : null);
            });
            map.on("mouseenter", layerId, () => {
              map!.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layerId, () => {
              map!.getCanvas().style.cursor = "";
            });
          }
        }
        // Prefer zooming to the selected mill's own geometry (this is what
        // "click a mill row" is supposed to do) over the whole chain's
        // spread. Needed here, not just in the selectedMillId-keyed effect
        // below: this whole map instance gets torn down and recreated
        // whenever `plots` changes (see the effect's dependency array) —
        // which is exactly what happens on every mill selection — so by the
        // time that other effect runs, `mapRef.current` is often still null
        // (the dynamic `import("maplibre-gl")` above hasn't resolved yet)
        // and it silently no-ops.
        const selBounds = new maplibregl.LngLatBounds();
        let selAny = false;
        if (sel) {
          const extSelected = (fc: Fc | null) => {
            if (!fc) return;
            for (const f of fc.features) {
              if (String(f.properties?._id ?? "") !== sel) continue;
              walk(f.geometry?.coordinates, (lng, lat) => {
                selBounds.extend([lng, lat]);
                selAny = true;
              });
            }
          };
          extSelected(millGeom);
          extSelected(plots);
        }
        // Resize before fitting bounds — the container may not have had its
        // final layout size yet when the map was constructed (e.g. right
        // after a tab switch), and fitBounds computes its zoom/center from
        // the canvas's current dimensions.
        map.resize();
        if (selAny) {
          fitBoundsClamped(map, selBounds, { padding: 80, minZoom: 8, maxZoom: 13 });
        } else if (any) {
          fitBoundsClamped(map, bounds, { padding: 48, minZoom: 4, maxZoom: 9 });
        }
      });
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      popupRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [hasGeom, millGeom, areas, plots, forest, distinctRefineries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    const sel = selectedMillId ?? "";
    if (map.getLayer("plots-fill")) {
      map.setPaintProperty("plots-fill", "fill-opacity", [
        "case",
        ["==", ["get", "_id"], sel],
        0.35,
        0.18,
      ]);
    }
    if (map.getLayer("mills")) {
      map.setPaintProperty("mills", "circle-radius", ["case", ["==", ["get", "_id"], sel], 10, 7]);
    }
    if (map.getLayer("mills-icon")) {
      map.setLayoutProperty("mills-icon", "icon-size", [
        "case",
        ["==", ["get", "_id"], sel],
        0.55,
        0.38,
      ]);
    }
  }, [selectedMillId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedMillId) return;
    const boundsPts: [number, number][] = [];
    const take = (fc: Fc | null) => {
      if (!fc) return;
      for (const f of fc.features) {
        if (String(f.properties?._id ?? "") !== selectedMillId) continue;
        walk(f.geometry?.coordinates, (lng, lat) => boundsPts.push([lng, lat]));
      }
    };
    take(millGeom);
    take(plots);
    if (boundsPts.length === 0) return;
    const lngs = boundsPts.map((p) => p[0]);
    const lats = boundsPts.map((p) => p[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    fitBoundsClamped(map as unknown as import("maplibre-gl").Map, bounds, {
      padding: 80,
      minZoom: 8,
      maxZoom: 13,
      duration: 600,
    });
  }, [selectedMillId, millGeom, plots]);

  // Symbology switch — repaint the already-mounted plots layer instead of
  // remounting the whole map (same pattern as the selection-driven opacity
  // effect above).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded() || !map.getLayer("plots-fill")) return;
    map.setPaintProperty("plots-fill", "fill-color", fillColorExpression(colorBy));
    if (map.getLayer("plots-line")) {
      map.setPaintProperty("plots-line", "line-color", fillColorExpression(colorBy));
    }
  }, [colorBy]);

  // Basemap switch — live-swap the raster source's tiles instead of
  // map.setStyle(), which would wipe every custom layer added since load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    setBasemap(map as unknown as import("maplibre-gl").Map, basemap);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    if (map.getLayer("mills")) {
      map.setLayoutProperty("mills", "visibility", visible.mills ? "visible" : "none");
      map.setLayoutProperty("mills-icon", "visibility", visible.mills ? "visible" : "none");
      map.setLayoutProperty("mills-label", "visibility", visible.mills ? "visible" : "none");
    }
    if (map.getLayer("plots-fill")) {
      map.setLayoutProperty("plots-fill", "visibility", visible.plots ? "visible" : "none");
      map.setLayoutProperty("plots-line", "visibility", visible.plots ? "visible" : "none");
    }
    if (map.getLayer("areas-fill")) {
      map.setLayoutProperty("areas-fill", "visibility", visible.areas ? "visible" : "none");
      map.setLayoutProperty("areas-line", "visibility", visible.areas ? "visible" : "none");
    }
    if (map.getLayer("forest-fill")) {
      map.setLayoutProperty("forest-fill", "visibility", visible.forest ? "visible" : "none");
    }
  }, [visible]);

  const entries = useMemo(() => legendEntries(colorBy, plots, labels), [colorBy, plots, labels]);
  const searchResults = useMemo(() => matchingPlots(plots, plotQuery), [plots, plotQuery]);

  function selectSearchResult(feature: Fc["features"][number]) {
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;
    focusOnPlotFeature(map, maplibregl, popupRef, feature, labels);
    setPlotQuery("");
  }

  // Driven by workspace.tsx's plot table (row click).
  useEffect(() => {
    if (!focusPlot || !plots) return;
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;
    const feature = plots.features[focusPlot.index];
    if (!feature) return;
    focusOnPlotFeature(map, maplibregl, popupRef, feature, labels);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plots`/`labels` intentionally excluded: re-running this on every plot-set change would re-fly the map without a new click.
  }, [focusPlot]);

  function goToCoordinate() {
    const parsed = parseCoordinate(coordInput);
    if (!parsed) {
      setCoordInvalid(true);
      return;
    }
    setCoordInvalid(false);
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;
    const [lat, lon] = parsed;
    const point: [number, number] = [lon, lat];
    map.flyTo({ center: point, zoom: 16 });
    markerRef.current?.remove();
    markerRef.current = null;

    const hit = plots?.features.find((f) => pointInGeometry(point, f.geometry));
    if (hit) {
      showPlotPopup(maplibregl, map, popupRef, point, hit, labels);
      return;
    }
    popupRef.current?.remove();
    const marker = new maplibregl.Marker({ color: "#9a3f32" })
      .setLngLat(point)
      .setPopup(new maplibregl.Popup({ closeButton: true }).setText(labels.noPlotAtCoordinate))
      .addTo(map);
    marker.togglePopup();
    markerRef.current = marker;
  }

  if (!hasGeom) {
    return <div className="map-empty">{labels.empty}</div>;
  }

  const colorByOptions: { key: ColorBy; label: string }[] = [
    { key: "trace", label: labels.traceability },
    { key: "comply", label: labels.compliance },
    { key: "risk", label: labels.risk },
    { key: "mitigation", label: labels.mitigation },
    { key: "type", label: labels.type },
  ];

  return (
    <div className="map-wrap">
      <div ref={root} className="map-root" />
      <div className="map-panels">
        <div className="map-find">
          <button
            type="button"
            className="map-layers-header"
            aria-expanded={findOpen}
            onClick={() => setFindOpen((v) => !v)}
          >
            <span>{labels.findTitle}</span>
            <span className={`nav-tree-chevron ${findOpen ? "open" : ""}`} aria-hidden="true" />
          </button>
          {findOpen ? (
            <div className="map-layers-body">
              {plots && plots.features.length ? (
                <div className="map-find-search">
                  <input
                    type="search"
                    value={plotQuery}
                    onChange={(e) => setPlotQuery(e.target.value)}
                    placeholder={labels.searchPlotPlaceholder}
                    aria-label={labels.searchPlotPlaceholder}
                  />
                  {plotQuery.trim() ? (
                    <ul className="map-find-results">
                      {searchResults.length === 0 ? (
                        <li className="map-find-empty">{labels.noMatches}</li>
                      ) : (
                        searchResults.map((f, i) => (
                          <li key={i}>
                            <button type="button" onClick={() => selectSearchResult(f)}>
                              <b>{String(f.properties?.PlotID ?? "—")}</b>
                              <span>{String(f.properties?.COMPANY ?? "").trim() || "—"}</span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="map-find-empty">{labels.searchPlotEmpty}</p>
              )}
              <p className="map-layers-kicker">{labels.goToCoordinate}</p>
              <form
                className="map-find-coord"
                onSubmit={(e) => {
                  e.preventDefault();
                  goToCoordinate();
                }}
              >
                <input
                  type="text"
                  value={coordInput}
                  onChange={(e) => {
                    setCoordInput(e.target.value);
                    setCoordInvalid(false);
                  }}
                  placeholder={labels.coordinatePlaceholder}
                  aria-label={labels.coordinatePlaceholder}
                />
                <button type="submit">{labels.go}</button>
              </form>
              {coordInvalid ? <p className="map-find-error">{labels.coordinateInvalid}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="map-layers">
          <button
            type="button"
            className="map-layers-header"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span>{labels.layersTitle}</span>
            <span className={`nav-tree-chevron ${panelOpen ? "open" : ""}`} aria-hidden="true" />
          </button>
          {panelOpen ? (
            <div className="map-layers-body">
              <p className="map-layers-kicker">{labels.colorBy}</p>
              <div className="map-color-by">
                {colorByOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={colorBy === opt.key ? "on" : ""}
                    onClick={() => setColorBy(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <ul className="map-legend-list">
                {entries.map((e) => (
                  <li key={e.label}>
                    <i className="swatch" style={{ background: e.color }} />
                    <span>{e.label}</span>
                    <b className="tabular-nums">{e.count.toLocaleString("id-ID")}</b>
                  </li>
                ))}
              </ul>
              <label className="map-layer-toggle">
                <input
                  type="checkbox"
                  checked={visible.plots}
                  onChange={(ev) => setVisible((v) => ({ ...v, plots: ev.target.checked }))}
                />
                {labels.legendPlots}
              </label>
              <label className="map-layer-toggle">
                <input
                  type="checkbox"
                  checked={visible.mills}
                  onChange={(ev) => setVisible((v) => ({ ...v, mills: ev.target.checked }))}
                />
                {labels.legendMills}
              </label>
              {areas && areas.features.length ? (
                <label className="map-layer-toggle">
                  <input
                    type="checkbox"
                    checked={visible.areas}
                    onChange={(ev) => setVisible((v) => ({ ...v, areas: ev.target.checked }))}
                  />
                  {labels.legendAreas}
                </label>
              ) : null}
              {forest && forest.features.length ? (
                <label className="map-layer-toggle">
                  <input
                    type="checkbox"
                    checked={visible.forest}
                    onChange={(ev) => setVisible((v) => ({ ...v, forest: ev.target.checked }))}
                  />
                  <i className="swatch" style={{ background: FOREST_COLOR }} />
                  {labels.legendForest}
                </label>
              ) : null}
              {distinctRefineries.length > 1 ? (
                <>
                  <p className="map-layers-kicker">{labels.millsByRefinery}</p>
                  <ul className="map-legend-list">
                    {distinctRefineries.map((r) => (
                      <li key={r}>
                        <i
                          className="swatch"
                          style={{ background: refineryColorFor(r, distinctRefineries) }}
                        />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="map-layers-kicker">{labels.basemap}</p>
              <div className="map-color-by">
                {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={basemap === id ? "on" : ""}
                    onClick={() => setBasemapState(id)}
                  >
                    {BASEMAPS[id].label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function walk(coords: unknown, visit: (lng: number, lat: number) => void) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visit(coords[0], coords[1]);
    return;
  }
  for (const c of coords) walk(c, visit);
}
