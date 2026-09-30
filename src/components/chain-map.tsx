import { useEffect, useMemo, useRef, useState } from "react";
import type { Copy, Lang } from "@/lib/copy";
import { JRC_LAYER } from "@/lib/data-meta";
import { formatCount, formatHa } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Fc } from "@/lib/ledger";
import { describeNonComplyIssue, issueText, locationText, mitigationText } from "@/lib/ledger-geo";
import { usePersistentState } from "@/lib/use-persistent";
import {
  EMPTY_PLOT_FILTERS,
  plotFilterExpression,
  toggleFilterValue,
  isPlotFilterActive,
  activePlotFilterCount,
  type PlotFilters,
} from "@/lib/plot-filters";
import "maplibre-gl/dist/maplibre-gl.css";

type BasemapId = "esri" | "google" | "osm" | "s2-2020" | "s2-2026";

type Basemap = {
  label: string;
  tiles: string[];
  attribution: string;
  /** Imagery year for a dated layer — also drives the note shown under the
   * basemap switcher. Undefined for the undated "latest" basemaps. */
  year?: number;
  /** Zoom range this source actually serves tiles for. Below `minzoom` the
   * Esri basemap stands in (as a context-only underlay); above `maxzoom`
   * MapLibre overzooms the last level instead of requesting more tiles. */
  minzoom?: number;
  maxzoom?: number;
  /** Same-year imagery drawn directly beneath `tiles` to fill whatever it
   * leaves empty — never a different year, so a gap can't be papered over
   * with undated or later imagery. */
  fillTiles?: string[];
};

// Dated Sentinel-2 L2A imagery (10 m, Copernicus data — free for commercial
// use) for deforestation evidence either side of the EUDR cutoff
// (31 Dec 2020). Esri Wayback was the obvious first pick but can't serve
// this purpose: its "2020" and "2026" releases are snapshot dates, not
// capture dates — around BNS's BUMI KHATULISTIWA MANDIRI mill both are the
// same 10 Sep 2015 WorldView-2 scene.
//
// Served by Microsoft Planetary Computer's mosaic tiler, anonymously (no
// key). Each id below is the deterministic hash of a registered search —
// re-POSTing the same body to
// https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register
// reproduces the same id, so one call restores it if ever purged:
//   {"filter-lang":"cql2-json","filter":{"op":"and","args":[
//     {"op":"=","args":[{"property":"collection"},"sentinel-2-l2a"]},
//     {"op":"anyinteracts","args":[{"property":"datetime"},
//       {"interval":["<year>-01-01T00:00:00Z","<year>-12-31T23:59:59Z"]}]},
//     {"op":"<=","args":[{"property":"eo:cloud_cover"},30]}]},
//    "sortby":[{"field":"eo:cloud_cover","direction":"asc"}]}
//
// 2020 is a per-pixel median of the 10 clearest scenes — any single 2020
// scene over Sumatra still carries 20%+ cloud, which the median removes.
// The tiler caps each tile at ~5 s, though, so near an orbit's swath edge
// the median can run out of time before covering the whole tile; the
// clearest-scene mosaic of the same 2020 search sits underneath as
// `fillTiles` (complete coverage, cloudier) so those strips still show 2020.
// 2026 has too few scenes yet for a median to beat cloud, so it takes the
// clearest scene per tile instead (already cloud-free in the areas tested).
// Tiles render on demand: a few seconds each on first view.
const PC_MOSAIC = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic";
const S2_VISUAL = "collection=sentinel-2-l2a&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png";
const S2_ATTRIBUTION = "Contains modified Copernicus Sentinel data · Microsoft Planetary Computer";

// Google's mt0-mt3.google.com tile endpoints are undocumented/unofficial —
// Google's terms require the Maps Platform API (a key + billing account)
// for tile access outside their own products, and can block or rate-limit
// this pattern without notice. Included here at the user's explicit request
// after being told about that risk; Esri and OSM below are both genuinely
// free-to-use services with no such caveat.
const BASEMAPS: Record<BasemapId, Basemap> = {
  esri: {
    label: "Esri World Imagery",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    // Esri's imagery over rural Sumatra/Kalimantan often stops at z17 —
    // past that it serves grey "Map data not yet available" tiles. Capping
    // the source makes MapLibre overzoom the last real tile instead.
    maxzoom: 17,
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
  "s2-2020": {
    label: "Sentinel-2 · 2020",
    tiles: [
      `${PC_MOSAIC}/c4cd1dfa0bd799858b2fc5d40af4d2da/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${S2_VISUAL}&pixel_selection=median&skipcovered=false&exitwhenfull=false&items_limit=10`,
    ],
    fillTiles: [`${PC_MOSAIC}/c4cd1dfa0bd799858b2fc5d40af4d2da/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${S2_VISUAL}`],
    attribution: `${S2_ATTRIBUTION} (2020)`,
    year: 2020,
    minzoom: 10,
    maxzoom: 14,
  },
  "s2-2026": {
    label: "Sentinel-2 · 2026",
    tiles: [`${PC_MOSAIC}/37869bf8977442843b3315fa4b866e0d/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${S2_VISUAL}`],
    attribution: `${S2_ATTRIBUTION} (2026)`,
    year: 2026,
    minzoom: 10,
    maxzoom: 14,
  },
};

const DEFAULT_BASEMAP: BasemapId = "esri";
// Skeleton: gone this long after the style loads even if imagery is still
// arriving, and at the latest after TILE_TIMEOUT_MS; by then, no basemap
// tile at all (or this many failed ones) shows the retry notice.
const REVEAL_AFTER_LOAD_MS = 2500;
const TILE_TIMEOUT_MS = 8000;
const TILE_ERRORS_BEFORE_NOTICE = 4;
// Esri and Google first — the imagery Earthline's team works on day to day
// (feedback 2, Doc 2 §3); OSM as the schematic fallback; the dated
// Sentinel-2 pair last, for before/after-cutoff comparison.
const BASEMAP_ORDER: BasemapId[] = ["esri", "google", "osm", "s2-2020", "s2-2026"];

// MapLibre's `text-field` needs a `glyphs` URL (an SDF font/glyph server)
// configured in the style spec to render anything at all — without one,
// text symbol layers silently render nothing. MapLibre's own project
// serves generic font glyphs (not just for their demo tiles) at this URL,
// so mill-name labels can use a real text-field instead of the ensureMillIcon
// canvas-image trick (only usable for a small fixed set of glyphs, not
// arbitrary mill names).
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const LABEL_FONT = ["Open Sans Semibold"];

/** The "sat" source/layer for `id`, plus — for a zoom-limited basemap —
 * "sat-under" (Esri, zoomed out only) and, if it has one, "sat-fill" (its
 * same-year gap filler). Shared by the initial style and setBasemap. */
function basemapParts(id: BasemapId) {
  const bm = BASEMAPS[id];
  const esri = BASEMAPS.esri;
  const zoomLimited = bm.minzoom != null;
  const sources: Record<string, import("maplibre-gl").RasterSourceSpecification> = {};
  const layers: import("maplibre-gl").RasterLayerSpecification[] = [];
  // A zoom-limited source (the dated Sentinel-2 layers) gets Esri drawn
  // beneath it only where it serves nothing (zoomed out past its minzoom),
  // so a wide view still has context without ever mixing Esri's undated
  // imagery into the dated layer's own zoom range.
  if (zoomLimited) {
    sources["sat-under"] = { type: "raster", tileSize: 256, tiles: esri.tiles, attribution: esri.attribution };
    layers.push({ id: "sat-under", type: "raster", source: "sat-under", maxzoom: bm.minzoom });
  }
  const zoomProps = {
    ...(bm.minzoom != null ? { minzoom: bm.minzoom } : {}),
    ...(bm.maxzoom != null ? { maxzoom: bm.maxzoom } : {}),
  };
  if (bm.fillTiles) {
    sources["sat-fill"] = { type: "raster", tileSize: 256, tiles: bm.fillTiles, ...zoomProps };
    layers.push({ id: "sat-fill", type: "raster", source: "sat-fill", ...(zoomLimited ? { minzoom: bm.minzoom } : {}) });
  }
  sources.sat = {
    type: "raster",
    tileSize: 256,
    tiles: bm.tiles,
    attribution: bm.attribution,
    ...zoomProps,
  };
  layers.push({ id: "sat", type: "raster", source: "sat", ...(zoomLimited ? { minzoom: bm.minzoom } : {}) });
  return { sources, layers };
}

function basemapStyle(id: BasemapId) {
  const { sources, layers } = basemapParts(id);
  return { version: 8 as const, glyphs: GLYPHS_URL, sources, layers };
}

/** Swaps the basemap in place (remove+re-add the "sat" source/layer with
 * new tiles+attribution) instead of map.setStyle(), which would otherwise
 * wipe every custom layer (mills/plots/areas) added after the initial
 * style load and require re-adding them all. Re-inserts "sat" at the
 * bottom of the layer stack — wherever the first custom layer currently
 * is — so switching basemap never covers up the data layers on top of it. */
function setBasemap(map: import("maplibre-gl").Map, id: BasemapId) {
  const beforeId = ["forest-fill", "areas-fill", "plots-halo", "plots-fill", "mills"].find((l) =>
    map.getLayer(l),
  );
  for (const layer of ["sat", "sat-fill", "sat-under"]) {
    if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(layer)) map.removeSource(layer);
  }
  const { sources, layers } = basemapParts(id);
  for (const [sourceId, source] of Object.entries(sources)) map.addSource(sourceId, source);
  for (const layer of layers) map.addLayer(layer, beforeId);
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
  setFilter: (layer: string, filter: unknown) => void;
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
  /** Shown under the basemap switcher while a dated (Sentinel-2) layer is
   * active — "{year}" is replaced with its imagery year. */
  basemapDatedNote: string;
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
  location: string;
  coordinates: string;
  goToCoordinate: string;
  coordinatePlaceholder: string;
  go: string;
  coordinateInvalid: string;
  noPlotAtCoordinate: string;
  close: string;
  clearFilters: string;
  filtersActive: string;
  clear: string;
  seeMore: string;
  back: string;
  nonComplyDetailTitle: string;
  physicalReasonLabel: string;
  socialReasonLabel: string;
  deforestationByYearLabel: string;
  forestOverlapLabel: string;
};

type Props = {
  millGeom: Fc | null;
  /** Every mill in the view, with or without coordinates — the loader says
   * "n of total" when some can't be placed (feedback 3, A-01). */
  millTotal?: number;
  /** Mills matching the side list's search (feedback 3, M-1): the map dims
   * the rest and zooms to these. Null when there's no search. */
  matchMillIds?: string[] | null;
  areas: Fc | null;
  plots: Fc | null;
  /** JRC forest cover — null until first switched on (it's ~20 MB). */
  forest: Fc | null;
  forestOn: boolean;
  forestLoading: boolean;
  onForestOnChange: (on: boolean) => void;
  /** The selected mill's plots are being fetched. */
  plotsLoading: boolean;
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
  /** Lifted up to workspace.tsx because the plot table's column-header
   * filters (workspace.tsx) and this map's legend-as-filter buttons need to
   * narrow the exact same set of plots. */
  plotFilters: PlotFilters;
  onPlotFiltersChange: (next: PlotFilters) => void;
  /** Changes whenever the surrounding layout does (sidebar, dock, full-map,
   * language) — a belt-and-braces resize on top of the ResizeObserver. */
  layoutKey: string;
};

/** The ChainMapLabels shape, built from the shared dictionary. */
function mapLabels(t: Copy): ChainMapLabels {
  return {
    empty: t.mapEmpty,
    legendVillage: t.legendVillage,
    legendBuffer: t.legendBuffer,
    legendPlots: t.legendPlots,
    legendMills: t.legendMills,
    legendAreas: t.legendAreas,
    legendForest: t.legendForest,
    millsByRefinery: t.millsByRefinery,
    colorBy: t.colorBy,
    traceability: t.trace,
    compliance: t.eudrComplyKpi,
    risk: t.riskLabel,
    mitigation: t.mitigationLabel,
    type: t.typeLabel,
    layersTitle: t.layersTitle,
    basemap: t.basemap,
    basemapDatedNote: t.basemapDatedNote,
    comply: t.comply,
    nonComply: t.nonComply,
    nonComplyReason: t.nonComplyReason,
    riskLow: t.riskLow,
    riskMedium: t.riskMedium,
    riskHigh: t.riskHigh,
    uml: t.uml,
    hectare: t.popupHectare,
    findTitle: t.findTitle,
    searchPlotPlaceholder: t.searchPlotPlaceholder,
    searchPlotEmpty: t.searchPlotEmpty,
    noMatches: t.noMatches,
    plotId: t.plotId,
    company: t.company,
    location: t.location,
    coordinates: t.coordinates,
    goToCoordinate: t.goToCoordinate,
    coordinatePlaceholder: t.coordinatePlaceholder,
    go: t.go,
    coordinateInvalid: t.coordinateInvalid,
    noPlotAtCoordinate: t.noPlotAtCoordinate,
    close: t.close,
    clearFilters: t.clearFilters,
    filtersActive: t.filtersActive,
    clear: t.clear,
    seeMore: t.seeMore,
    back: t.back,
    nonComplyDetailTitle: t.nonComplyDetailTitle,
    physicalReasonLabel: t.physicalReasonLabel,
    socialReasonLabel: t.socialReasonLabel,
    deforestationByYearLabel: t.deforestationByYearLabel,
    forestOverlapLabel: t.forestOverlapLabel,
  };
}

// Same literal colors already established for these categories in
// styles.css tokens (--color-comply/--color-noncomply, --color-accent-2/
// --color-warn/--color-danger, --chart-a..f) and eudr-summary.tsx's
// TYPE_COLORS — MapLibre paint expressions can't consume CSS custom
// properties, so these are kept in sync by hand.
// Soft, low-saturation tones (redesign 2: "hindari warna yang berani") that
// still read on top of dark canopy imagery — every outline also gets a dark
// halo underneath. Mirrors the data tokens in styles.css.
const TRACE_COLORS = { village: "#a9d6c3", buffer: "#e6cf9a", unknown: "#c9ccd1" };
// Mill points with no traceability class (millColorExpression's fallback).
const MILL_UNKNOWN_COLOR = "#e8eef4";
const COMPLY_COLORS = { yes: "#9ed7b1", no: "#f0a197" };
const RISK_COLORS = { low: "#a9d6c3", medium: "#ecc98a", high: "#f0a197" };
const MIT_COLORS: Record<string, string> = {
  A: "#8fc7a8",
  B: "#b3d69a",
  C: "#d9d49a",
  D: "#ecc98a",
  E: "#eeae8c",
  F: "#f0a197",
};
const TYPE_COLORS: Record<string, string> = {
  "Independent Smallholder": "#a9d6c3",
  Company: "#b8c7e0",
  "Scheme Smallholder": "#e6cf9a",
};
const FALLBACK_COLOR = "#c9ccd1";
// Dark halo drawn under every plot outline — a pink/green outline straight
// on top of green canopy imagery disappears (feedback 2, §4.2).
const HALO_COLOR = "#111114";

// Same dark green already established as "forest" in eudr-summary.tsx's
// OVERLAP_COLORS / styles.css's --forest-hl token — reused here instead of
// picked fresh so the same hue means "forest" in both places. Deliberately
// outside the trace/comply/risk/mitigation/type families above (all
// teal/tan/red/pale-green) so a plot fill on top of this layer never reads
// as "part of the forest" or vice versa.
const FOREST_COLOR = "#3f6b4e";

// Mill points are colored by refinery instead of by traceability whenever
// more than one Refinery/KCP is in view at once (e.g. viewing a whole Group
// that has several) — otherwise every mill would render identically and
// there'd be no way to tell which refinery a given point belongs to.
const REFINERY_COLORS = [
  "#ffffff",
  "#e6cf9a",
  "#b8c7e0",
  "#eeae8c",
  "#a9d6c3",
  "#d9c2e0",
  "#c9ccd1",
  "#d9d49a",
];

function refineryColorFor(refinery: string, distinctRefineries: string[]): string {
  const i = distinctRefineries.indexOf(refinery);
  return i < 0 ? FALLBACK_COLOR : REFINERY_COLORS[i % REFINERY_COLORS.length]!;
}

/**
 * Registers a small factory silhouette (drawn with canvas paths, not an
 * emoji — emoji rendered differently per OS and read as clip-art) as a
 * MapLibre image, so each mill point reads as "a mill" on top of its dot.
 */
function ensureMillIcon(map: import("maplibre-gl").Map) {
  if (map.hasImage("mill-icon")) return;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#1d1d1f";
  ctx.beginPath();
  // base + saw-tooth roof
  ctx.moveTo(10, 38);
  ctx.lineTo(10, 24);
  ctx.lineTo(17, 29);
  ctx.lineTo(17, 24);
  ctx.lineTo(24, 29);
  ctx.lineTo(24, 24);
  ctx.lineTo(30, 28);
  // chimney
  ctx.lineTo(30, 11);
  ctx.lineTo(36, 11);
  ctx.lineTo(36, 38);
  ctx.closePath();
  ctx.fill();
  map.addImage("mill-icon", ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function millColorExpression(distinctRefineries: string[]): any {
  if (distinctRefineries.length > 1) {
    const stops: unknown[] = [];
    distinctRefineries.forEach((r) => stops.push(r, refineryColorFor(r, distinctRefineries)));
    return ["match", ["get", "_refinery"], ...stops, MILL_UNKNOWN_COLOR];
  }
  return ["match", ["get", "_trace"], "village", TRACE_COLORS.village, "buffer", TRACE_COLORS.buffer, MILL_UNKNOWN_COLOR];
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

type LegendEntry = { label: string; color: string; count: number; value: string };

function legendEntries(
  colorBy: ColorBy,
  plots: Fc | null,
  labels: ChainMapLabels,
  typeNames: Record<string, string>,
): LegendEntry[] {
  const features = plots?.features ?? [];
  const countBy = (key: string, value: string) =>
    features.filter((f) => String(f.properties?.[key] ?? "") === value).length;

  if (colorBy === "comply") {
    return [
      { label: labels.comply, color: COMPLY_COLORS.yes, count: countBy("_comply", "yes"), value: "yes" },
      { label: labels.nonComply, color: COMPLY_COLORS.no, count: countBy("_comply", "no"), value: "no" },
    ];
  }
  if (colorBy === "risk") {
    return [
      { label: labels.riskLow, color: RISK_COLORS.low, count: countBy("_risk", "low"), value: "low" },
      {
        label: labels.riskMedium,
        color: RISK_COLORS.medium,
        count: countBy("_risk", "medium"),
        value: "medium",
      },
      { label: labels.riskHigh, color: RISK_COLORS.high, count: countBy("_risk", "high"), value: "high" },
    ];
  }
  if (colorBy === "mitigation") {
    return ["A", "B", "C", "D", "E", "F"].map((letter) => ({
      label: letter,
      color: MIT_COLORS[letter]!,
      count: countBy("_mitigation", letter),
      value: letter,
    }));
  }
  if (colorBy === "type") {
    return Object.entries(TYPE_COLORS).map(([value, color]) => ({
      label: typeNames[value] ?? value,
      color,
      count: countBy("TYPE", value),
      value,
    }));
  }
  return [
    {
      label: labels.legendVillage,
      color: TRACE_COLORS.village,
      count: countBy("_trace", "village"),
      value: "village",
    },
    {
      label: labels.legendBuffer,
      color: TRACE_COLORS.buffer,
      count: countBy("_trace", "buffer"),
      value: "buffer",
    },
  ];
}

/** Every legal value for one color-by dimension — the "select everything"
 * baseline a legend toggle collapses back to `null` (no filter) against. */
function filterUniverse(colorBy: ColorBy): string[] {
  switch (colorBy) {
    case "comply":
      return ["yes", "no"];
    case "risk":
      return ["low", "medium", "high"];
    case "mitigation":
      return ["A", "B", "C", "D", "E", "F"];
    case "type":
      return Object.keys(TYPE_COLORS);
    default:
      return ["village", "buffer"];
  }
}


// Mirrors DEF_YEARS in src/lib/eudr-aggregates.server.ts / scripts/prepare-eudr-stats.mjs.
const DEF_YEAR_FIELDS = [
  ["Def_21", "2021"],
  ["Def_22", "2022"],
  ["Def_23", "2023"],
  ["Def_24", "2024"],
  ["Def_25", "2025"],
  ["Def_26", "2026"],
] as const;

// Every forest/protected-area code a plot can carry its own ha overlap
// under — a superset of the 4 (HL/HP/HPK/HPT) the EUDR summary chart
// tracks, since a single plot's own non-compliance can be driven by any of
// these (see ISSUE_DESCRIPTIONS, src/lib/ledger-geo.ts).
const OVERLAP_CODES: readonly string[] = [
  "HL",
  "HP",
  "HPK",
  "HPT",
  "CA",
  "FL_LAIN",
  "KSA_KPA",
  "SM",
  "TAHURA",
  "TB",
  "TN",
  "TWA",
];

type NonComplyDetail = {
  physicalReason: string;
  socialReason: string;
  deforestationByYear: { year: string; ha: number }[];
  overlapBreakdown: { label: string; ha: number }[];
};

type PlotDetail = {
  id: string;
  title: string;
  rows: { label: string; value: string; cls?: "ok" | "bad" }[];
  coordinates: { lat: number; lon: number } | null;
  mitigation: { label: string; text: string };
  nonComplyReason: string;
  // null when the plot complies (there's nothing to drill into) or when a
  // non-compliant plot's own fields don't actually carry any of this
  // detail — same defensive stance as the rest of this file toward
  // possibly-sparse source data.
  nonComplyDetail: NonComplyDetail | null;
};

/**
 * The "See more" slide's content — deliberately reads straight from the
 * plot's own already-prepared explanatory fields (Physical_Reason,
 * Social_Reason) and per-category ha columns rather than re-deriving
 * anything, so it can only ever say more than the one-line
 * describeNonComplyIssue() summary already shown, never something
 * inconsistent with it.
 */
function buildNonComplyDetail(props: Record<string, unknown>, lang: Lang): NonComplyDetail | null {
  const physicalReason = String(props.Physical_Reason ?? "").trim();
  const socialReason = String(props.Social_Reason ?? "").trim();
  const deforestationByYear = DEF_YEAR_FIELDS.map(([col, year]) => ({
    year,
    ha: Number(props[col]) || 0,
  })).filter((d) => d.ha > 0);
  const issueCodes = String(props.Desc_Issue ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const overlapBreakdown = issueCodes
    .filter((code) => OVERLAP_CODES.includes(code))
    .map((code) => ({ label: issueText(code, lang), ha: Number(props[code]) || 0 }))
    .filter((o) => o.ha > 0);

  if (!physicalReason && !socialReason && deforestationByYear.length === 0 && overlapBreakdown.length === 0) {
    return null;
  }
  return { physicalReason, socialReason, deforestationByYear, overlapBreakdown };
}

/**
 * Structured plot attributes for the right-side detail deck — a plain data
 * object (not an HTML string, unlike the MapLibre popup this replaced) so
 * React renders and escapes it directly.
 */
function buildPlotDetail(
  props: Record<string, unknown>,
  labels: ChainMapLabels,
  lang: Lang,
  typeNames: Record<string, string>,
): PlotDetail {
  const mill = String(props._mill || props.Mill_name || "");
  const uml = String(props.UML_ID ?? "");
  // `PlotID` (scripts/prepare-plots.mjs) — genuinely unique per plot. The
  // source `ID` column looks similar but is actually a shared block/batch
  // code (confirmed duplicated across many distinct plots), so it's never
  // shown as "the" plot id.
  const plotId = String(props.PlotID ?? "");
  const company = String(props.COMPANY ?? "").trim();
  // `_hectarage` (set by decoratePlots, src/lib/ledger-geo.ts) rather than
  // reading `HECTARAGE` here directly — DOMAS's prepared plots use
  // `Hectarage` instead, and this deck receives whatever properties the
  // clicked map feature already carries (decorated, not raw).
  const ha = Number(props._hectarage ?? 0);
  // `_comply` (decorated, ledger-geo.ts) rather than reading `EUDR_Comply`
  // here directly — BNS's deforestation-noise-threshold adjustment only
  // lands on the decorated field, so reading the raw property here would
  // show "Non-Compliant" for a plot the table/mitigation badge both already
  // treat as compliant.
  const complyDecorated = props._comply;
  const comply = complyDecorated === "yes" ? labels.comply : complyDecorated === "no" ? labels.nonComply : "—";
  const complyClass = complyDecorated === "yes" ? "ok" : complyDecorated === "no" ? "bad" : undefined;
  const riskKey = String(props._risk ?? "");
  const risk =
    riskKey === "low"
      ? labels.riskLow
      : riskKey === "medium"
        ? labels.riskMedium
        : riskKey === "high"
          ? labels.riskHigh
          : String(props.Overall_Risk ?? "—");
  const mitLetter = String(props._mitigation ?? "").toUpperCase();
  // The canonical A–F wording (src/lib/ledger-geo.ts) rather than this
  // plot's own free-text Risk_Mitigation_Class, which isn't always worded
  // identically across rows/mills even for the same letter — falls back to
  // the raw text only if the letter itself couldn't be parsed.
  const mitigationDescription =
    mitigationText(mitLetter, lang) ?? String(props.Risk_Mitigation_Class ?? "—");
  const typeRaw = String(props.TYPE ?? "");
  const type = typeNames[typeRaw] ?? (typeRaw || "—");
  const nonComplyReason = complyDecorated === "no" ? describeNonComplyIssue(props.Desc_Issue, lang) : "";
  const location = locationText(props);
  const lat = Number(props.LAT ?? NaN);
  const lon = Number(props.LON ?? NaN);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

  const rows: PlotDetail["rows"] = [
    { label: labels.plotId, value: plotId || "—" },
    { label: labels.company, value: company || "—" },
    { label: labels.uml, value: uml || "—" },
  ];
  if (location) rows.push({ label: labels.location, value: location });
  rows.push({ label: labels.hectare, value: formatHa(ha, lang) });
  rows.push({ label: labels.compliance, value: comply, cls: complyClass });
  rows.push({ label: labels.risk, value: risk });
  rows.push({ label: labels.type, value: type });

  return {
    id: plotId || uml || mill,
    title: mill || uml || "Plot",
    rows,
    coordinates: hasCoords ? { lat, lon } : null,
    mitigation: {
      label: `${labels.mitigation}${mitLetter ? ` (${mitLetter})` : ""}`,
      text: mitigationDescription,
    },
    nonComplyReason,
    nonComplyDetail: complyDecorated === "no" ? buildNonComplyDetail(props, lang) : null,
  };
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
  LngLatBounds: typeof import("maplibre-gl").LngLatBounds;
};

/** Flies the map to a plot feature's bounds and selects it (opens/updates
 * the detail deck) — shared by the search-result click and the plot-table
 * row click (workspace.tsx). Selecting a plot no longer opens a MapLibre
 * popup: those routinely got clipped by the map container's edge, which is
 * exactly the feedback that prompted replacing it with the deck panel. */
function focusOnPlotFeature(
  map: import("maplibre-gl").Map,
  feature: Fc["features"][number],
  select: (id: string, props: Record<string, unknown>) => void,
) {
  const bounds = featureBounds(feature);
  if (!bounds) return;
  fitBoundsClamped(map, bounds, { padding: 60, minZoom: 14, maxZoom: 17, duration: 600 });
  const id = String(feature.properties?.PlotID ?? "");
  if (id) select(id, feature.properties ?? {});
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
  millTotal,
  matchMillIds = null,
  areas,
  plots,
  forest,
  forestOn,
  forestLoading,
  onForestOnChange,
  plotsLoading,
  selectedMillId,
  onSelectMill,
  focusPlot,
  plotFilters,
  onPlotFiltersChange,
  layoutKey,
}: Props) {
  const { t, lang } = useI18n();
  const labels = useMemo(() => mapLabels(t), [t]);
  const typeNames = useMemo<Record<string, string>>(
    () => ({
      "Independent Smallholder": t.typeIndependent,
      Company: t.typeCompany,
      "Scheme Smallholder": t.typeScheme,
    }),
    [t],
  );
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const maplibreRef = useRef<MaplibreGlNamespace | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const selectedRef = useRef(selectedMillId);
  selectedRef.current = selectedMillId;
  const onSelectRef = useRef(onSelectMill);
  onSelectRef.current = onSelectMill;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const plotFiltersRef = useRef(plotFilters);
  plotFiltersRef.current = plotFilters;
  // Bumped every time a (re)created map finishes loading — effects that add
  // layers after the fact (the lazily-fetched JRC layer) key on it.
  const [mapReady, setMapReady] = useState(0);
  const [tilesReady, setTilesReady] = useState(false);
  // Basemap tiles that error out (or never arrive) used to leave the
  // skeleton up forever, since it waited for MapLibre's "idle" (feedback 3,
  // A-01/M-4). Now the skeleton goes on load or after a timeout, and this
  // flags a basemap that still has nothing to show.
  const [tileTrouble, setTileTrouble] = useState(false);
  const tileStatsRef = useRef({ ok: 0, err: 0 });
  const tileTimerRef = useRef<number | undefined>(undefined);
  const armTileWatch = () => {
    tileStatsRef.current = { ok: 0, err: 0 };
    setTileTrouble(false);
    window.clearTimeout(tileTimerRef.current);
    tileTimerRef.current = window.setTimeout(() => {
      if (tileStatsRef.current.ok === 0) setTileTrouble(true);
    }, TILE_TIMEOUT_MS);
  };
  useEffect(() => () => window.clearTimeout(tileTimerRef.current), []);

  const [colorBy, setColorBy] = useState<ColorBy>("comply");
  const colorByRef = useRef(colorBy);
  colorByRef.current = colorBy;
  // Remembered per browser (feedback 2, Doc 2 §4.1) — someone who works on
  // Google imagery shouldn't have to re-pick it on every visit.
  const [basemapStored, setBasemapState] = usePersistentState<BasemapId>("palmtrace.basemap", DEFAULT_BASEMAP);
  const basemap: BasemapId = basemapStored in BASEMAPS ? basemapStored : DEFAULT_BASEMAP;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  // The basemap the current map instance is showing — set when the map is
  // built and on every swap, so a reload doesn't re-add the same tiles (and
  // reset the tile-trouble watch) for nothing.
  const appliedBasemapRef = useRef<BasemapId | null>(null);
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false);
  const [visible, setVisible] = useState({ mills: true, plots: true, areas: true });
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const forestOnRef = useRef(forestOn);
  forestOnRef.current = forestOn;
  const [panelOpen, setPanelOpen] = usePersistentState("palmtrace.panel.layers", true);
  // On a phone the open Layers card covers most of the map — start it
  // closed there unless the viewer has already chosen.
  useEffect(() => {
    try {
      if (window.innerWidth < 860 && localStorage.getItem("palmtrace.panel.layers") == null) setPanelOpen(false);
    } catch {
      /* storage blocked — keep the default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first render only.
  }, []);
  const [findOpen, setFindOpen] = usePersistentState("palmtrace.panel.find", false);
  const [plotQuery, setPlotQuery] = useState("");
  const [coordInput, setCoordInput] = useState("");
  // Stores whether the coordinate is invalid, not the translated message
  // itself — otherwise switching languages while the error is showing would
  // leave it frozen in whichever language was active when it was set.
  const [coordInvalid, setCoordInvalid] = useState(false);
  // The plot currently shown in the right-side detail deck + highlighted
  // blue on the map. Toggled off by re-clicking the same plot or the deck's
  // own close button; clicking a *different* plot swaps the content instead
  // of closing it — see the click handler and selectPlot() below.
  const [selectedPlot, setSelectedPlot] = useState<{
    id: string;
    props: Record<string, unknown>;
  } | null>(null);
  const selectPlot = (id: string, props: Record<string, unknown>) => {
    setSelectedPlot((prev) => (prev?.id === id ? null : { id, props }));
  };
  const selectPlotRef = useRef(selectPlot);
  selectPlotRef.current = selectPlot;

  // A mill switch (or any other change to which plots are loaded) hands
  // ChainMap a brand-new `plots` object — the previously selected plot may
  // not even exist in it anymore, so the deck/highlight shouldn't linger.
  useEffect(() => {
    setSelectedPlot(null);
  }, [plots]);

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
    setTilesReady(false);

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
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      mapRef.current = map as unknown as MapHandle;
      appliedBasemapRef.current = basemapRef.current;
      // Dev only: lets scripts/capture-showcase.mjs hide canvas-drawn labels
      // (mill names) before taking the public product screenshots.
      if (import.meta.env.DEV) (window as unknown as { __palmtraceMap?: unknown }).__palmtraceMap = map;
      const reveal = () => {
        if (!cancelled) setTilesReady(true);
      };
      map.once("idle", reveal);
      // "idle" waits for every tile and glyph request — one hung request kept
      // the skeleton up for good. Once the style has loaded the data layers
      // draw regardless of the imagery, so cap the wait.
      map.once("load", () => window.setTimeout(reveal, REVEAL_AFTER_LOAD_MS));
      window.setTimeout(reveal, TILE_TIMEOUT_MS);
      armTileWatch();
      const isBasemapSource = (id: unknown) => typeof id === "string" && id.startsWith("sat");
      map.on("data", (e) => {
        const ev = e as { dataType?: string; sourceId?: string; tile?: unknown };
        if (ev.dataType !== "source" || !ev.tile || !isBasemapSource(ev.sourceId)) return;
        tileStatsRef.current.ok += 1;
        setTileTrouble(false);
      });
      map.on("error", (e) => {
        const ev = e as { sourceId?: string; tile?: unknown };
        if (!ev.tile || !isBasemapSource(ev.sourceId)) return;
        const stats = tileStatsRef.current;
        stats.err += 1;
        if (stats.ok === 0 && stats.err >= TILE_ERRORS_BEFORE_NOTICE) {
          setTileTrouble(true);
          reveal();
        }
      });

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
                TRACE_COLORS.village,
                "buffer",
                TRACE_COLORS.buffer,
                TRACE_COLORS.village,
              ],
              "fill-opacity": 0.14,
            },
          });
          map.addLayer({
            id: "areas-line",
            type: "line",
            source: "areas",
            layout: { visibility: visibleRef.current.areas ? "visible" : "none" },
            paint: {
              "line-color": ["match", ["get", "_kind"], "buffer", TRACE_COLORS.buffer, TRACE_COLORS.village],
              "line-width": 1.4,
              "line-dasharray": [3, 2],
            },
          });
          ext(areas);
        }
        if (plots && plots.features.length) {
          map.addSource("plots", { type: "geojson", data: plots as GeoJSON.GeoJSON });
          // MapLibre filter expression; typed loosely like the paint expressions above.
          const plotFilter = plotFilterExpression(plotFiltersRef.current) as any;
          const plotVis = visibleRef.current.plots ? "visible" : "none";
          map.addLayer({
            id: "plots-fill",
            type: "fill",
            source: "plots",
            filter: plotFilter,
            layout: { visibility: plotVis },
            paint: {
              "fill-color": fillColorExpression(colorByRef.current),
              "fill-opacity": ["case", ["==", ["get", "_id"], sel], 0.32, 0.2],
            },
          });
          map.addLayer({
            id: "plots-halo",
            type: "line",
            source: "plots",
            filter: plotFilter,
            layout: { visibility: plotVis },
            paint: { "line-color": HALO_COLOR, "line-opacity": 0.55, "line-width": 3.2 },
          });
          map.addLayer({
            id: "plots-line",
            type: "line",
            source: "plots",
            filter: plotFilter,
            layout: { visibility: plotVis },
            paint: {
              "line-color": fillColorExpression(colorByRef.current),
              "line-opacity": 1,
              "line-width": 1.4,
            },
          });
          // Blue highlight for whichever plot is currently open in the
          // detail deck — kept as separate layers (rather than folded into
          // plots-fill/plots-line's own paint) so the highlight color never
          // has to compete with the colorBy palette. Filter starts matching
          // nothing; the selectedPlot-keyed effect below keeps it in sync.
          map.addLayer({
            id: "plots-selected-fill",
            type: "fill",
            source: "plots",
            filter: ["==", ["get", "PlotID"], "__none__"],
            layout: { visibility: plotVis },
            paint: { "fill-color": "#ffffff", "fill-opacity": 0.22 },
          });
          map.addLayer({
            id: "plots-selected-line",
            type: "line",
            source: "plots",
            filter: ["==", ["get", "PlotID"], "__none__"],
            layout: { visibility: plotVis },
            paint: { "line-color": "#ffffff", "line-width": 3 },
          });
          ext(plots);

          map.on("click", "plots-fill", (e) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const id = String(feature.properties?.PlotID ?? "");
            if (!id) return;
            selectPlotRef.current(id, feature.properties ?? {});
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
              "circle-radius": ["case", ["==", ["get", "_id"], sel], 13, 10],
              "circle-color": millColorExpression(distinctRefineries),
              "circle-stroke-width": ["case", ["==", ["get", "_id"], sel], 3, 1.6],
              "circle-stroke-color": ["case", ["==", ["get", "_id"], sel], "#ffffff", HALO_COLOR],
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
              "icon-size": ["case", ["==", ["get", "_id"], sel], 0.75, 0.6],
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
              "text-color": "#ffffff",
              "text-halo-color": HALO_COLOR,
              "text-halo-width": 1.4,
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
          fitBoundsClamped(map, bounds, { padding: 48, minZoom: 3, maxZoom: 9 });
        }
        setMapReady((n) => n + 1);
      });
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [hasGeom, millGeom, areas, plots, distinctRefineries]);

  // The collapsed-map bug (feedback 2, B-02): MapLibre sizes its canvas once,
  // at construction, and never again on its own — a map built while its tab
  // was still laying out, or before the sidebar/dock settled, stayed at that
  // first (often ~0px) height. A ResizeObserver on the container catches
  // every later change: tab switch, group switch, language (longer strings
  // reflow the panels), sidebar/dock toggles, full-map mode, window resize.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => mapRef.current?.resize(), 150);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [hasGeom]);
  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [layoutKey]);

  // JRC forest cover sits directly above the basemap, below every data
  // layer. Added (or shown/hidden) here rather than in the mount effect so
  // the ~20 MB file loading late — or being switched on later — never
  // rebuilds the whole map and loses the camera.
  useEffect(() => {
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    if (!map || !mapReady) return;
    if (forest && forest.features.length && !map.getSource("forest")) {
      map.addSource("forest", { type: "geojson", data: forest as GeoJSON.GeoJSON });
      const beforeId = ["areas-fill", "plots-fill", "plots-halo", "mills"].find((l) => map.getLayer(l));
      map.addLayer(
        {
          id: "forest-fill",
          type: "fill",
          source: "forest",
          layout: { visibility: forestOnRef.current ? "visible" : "none" },
          paint: { "fill-color": FOREST_COLOR, "fill-opacity": 0.42 },
        },
        beforeId,
      );
    }
    if (map.getLayer("forest-fill")) {
      map.setLayoutProperty("forest-fill", "visibility", forestOn ? "visible" : "none");
    }
  }, [forest, forestOn, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    const sel = selectedMillId ?? "";
    if (map.getLayer("plots-fill")) {
      map.setPaintProperty("plots-fill", "fill-opacity", [
        "case",
        ["==", ["get", "_id"], sel],
        0.32,
        0.2,
      ]);
    }
    if (map.getLayer("mills")) {
      map.setPaintProperty("mills", "circle-radius", ["case", ["==", ["get", "_id"], sel], 13, 10]);
    }
    if (map.getLayer("mills-icon")) {
      map.setLayoutProperty("mills-icon", "icon-size", [
        "case",
        ["==", ["get", "_id"], sel],
        0.75,
        0.6,
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

  // Legend-as-filter (map) and column-header filters (workspace.tsx's plot
  // table) share this one `plotFilters` state — repaint the plot layers'
  // filter whenever either surface changes it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("plots-fill")) return;
    const expr = plotFilterExpression(plotFilters) as any;
    for (const layer of ["plots-fill", "plots-halo", "plots-line"]) {
      if (map.getLayer(layer)) map.setFilter(layer, expr);
    }
  }, [plotFilters]);

  // Keeps the blue highlight layers matched to whichever plot is open in
  // the detail deck (or matching nothing once it's closed).
  useEffect(() => {
    const map = mapRef.current;
    // Not gated on map.loaded() like the other reactive effects below —
    // selecting a plot always fires a fitBoundsClamped() camera move in the
    // same tick (focusOnPlotFeature), and loaded() reports false while that
    // animation is fetching tiles. getLayer() existing already proves the
    // style/layer is ready, which is all setFilter needs.
    if (!map || !map.getLayer("plots-selected-fill")) return;
    const filter = ["==", ["get", "PlotID"], selectedPlot?.id ?? "__none__"];
    map.setFilter("plots-selected-fill", filter);
    if (map.getLayer("plots-selected-line")) map.setFilter("plots-selected-line", filter);
  }, [selectedPlot]);

  // The side list's search drives the map too (feedback 3, M-1): matches
  // stay bright, the rest fade, and the camera goes to the matches.
  useEffect(() => {
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    const maplibregl = maplibreRef.current;
    if (!map || !mapReady || !maplibregl || !map.getLayer("mills")) return;
    const dim = (on: number, off: number) =>
      matchMillIds ? ["case", ["in", ["get", "_id"], ["literal", matchMillIds]], on, off] : on;
    map.setPaintProperty("mills", "circle-opacity", dim(1, 0.25));
    map.setPaintProperty("mills", "circle-stroke-opacity", dim(1, 0.25));
    map.setPaintProperty("mills-icon", "icon-opacity", dim(1, 0.25));
    map.setPaintProperty("mills-label", "text-opacity", dim(1, 0));
    if (!matchMillIds || !millGeom) return;
    const ids = new Set(matchMillIds);
    const hits = millGeom.features.filter((f) => ids.has(String(f.properties?._id)));
    if (hits.length === 0) return;
    if (hits.length === 1) {
      const [lng, lat] = (hits[0]!.geometry as { coordinates: [number, number] }).coordinates;
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 10), duration: 700 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const f of hits) bounds.extend((f.geometry as { coordinates: [number, number] }).coordinates);
    fitBoundsClamped(map, bounds, { padding: 80, minZoom: 3, maxZoom: 10, duration: 700 });
  }, [matchMillIds, mapReady, millGeom]);

  // Basemap switch — live-swap the raster source's tiles instead of
  // map.setStyle(), which would wipe every custom layer added since load.
  // Keyed on mapReady too, so a stored basemap that differs from the one
  // the style was built with is still applied after a remount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const mlMap = map as unknown as import("maplibre-gl").Map;
    if (appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    armTileWatch();
    setBasemap(mlMap, basemap);
    // Picking a dated layer while zoomed out past where it serves tiles
    // would otherwise look like nothing happened (only the Esri underlay
    // shows) — ease in to the first zoom it covers.
    const minzoom = BASEMAPS[basemap].minzoom;
    if (minzoom != null && mlMap.getZoom() < minzoom) mlMap.easeTo({ zoom: minzoom, duration: 600 });
  }, [basemap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    if (map.getLayer("mills")) {
      map.setLayoutProperty("mills", "visibility", visible.mills ? "visible" : "none");
      map.setLayoutProperty("mills-icon", "visibility", visible.mills ? "visible" : "none");
      map.setLayoutProperty("mills-label", "visibility", visible.mills ? "visible" : "none");
    }
    if (map.getLayer("plots-fill")) {
      for (const layer of ["plots-fill", "plots-halo", "plots-line", "plots-selected-fill", "plots-selected-line"]) {
        map.setLayoutProperty(layer, "visibility", visible.plots ? "visible" : "none");
      }
    }
    if (map.getLayer("areas-fill")) {
      map.setLayoutProperty("areas-fill", "visibility", visible.areas ? "visible" : "none");
      map.setLayoutProperty("areas-line", "visibility", visible.areas ? "visible" : "none");
    }
  }, [visible]);

  const entries = useMemo(() => legendEntries(colorBy, plots, labels, typeNames), [colorBy, plots, labels, typeNames]);
  // Key for the traceability colours of mill points and areas (feedback 3,
  // M-3) — only the classes actually on the map.
  const traceKey = useMemo(() => {
    const seen = new Set<string>();
    for (const f of millGeom?.features ?? []) seen.add(String(f.properties?._trace ?? ""));
    for (const f of areas?.features ?? []) seen.add(String(f.properties?._kind ?? ""));
    const out: { label: string; color: string }[] = [];
    if (seen.has("village")) out.push({ label: labels.legendVillage, color: TRACE_COLORS.village });
    if (seen.has("buffer")) out.push({ label: labels.legendBuffer, color: TRACE_COLORS.buffer });
    if ([...seen].some((v) => v !== "village" && v !== "buffer")) out.push({ label: t.traceUnknown, color: MILL_UNKNOWN_COLOR });
    return out;
  }, [millGeom, areas, labels, t]);
  const searchResults = useMemo(() => matchingPlots(plots, plotQuery), [plots, plotQuery]);
  const hasPlots = !!plots && plots.features.length > 0;

  function selectSearchResult(feature: Fc["features"][number]) {
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    if (!map) return;
    focusOnPlotFeature(map, feature, (id, props) => setSelectedPlot({ id, props }));
    setPlotQuery("");
  }

  // Driven by workspace.tsx's plot table (row click).
  useEffect(() => {
    if (!focusPlot || !plots) return;
    const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
    if (!map) return;
    const feature = plots.features[focusPlot.index];
    if (!feature) return;
    focusOnPlotFeature(map, feature, (id, props) => setSelectedPlot({ id, props }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plots` intentionally excluded: re-running this on every plot-set change would re-fly the map without a new click.
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
      const id = String(hit.properties?.PlotID ?? "");
      if (id) setSelectedPlot({ id, props: hit.properties ?? {} });
      return;
    }
    const marker = new maplibregl.Marker({ color: "#1d1d1f" })
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
  const bm = BASEMAPS[basemap];
  const datedWindow = bm.year === 2020 ? t.s2Window2020 : bm.year === 2026 ? t.s2Window2026 : "";
  const millCount = millGeom?.features.length ?? 0;
  const loadingText =
    millTotal != null && millTotal > millCount
      ? t.mapLoadingPartial
          .replace("{n}", formatCount(millCount, lang))
          .replace("{total}", formatCount(millTotal, lang))
      : t.mapLoading.replace("{n}", formatCount(millCount, lang));
  // The one to offer when the current basemap won't load: another provider.
  const fallbackBasemap: BasemapId = basemap === "esri" ? "google" : "esri";

  return (
    <div className="map-wrap">
      <div ref={root} className="map-root" />
      {!tilesReady ? (
        // A skeleton instead of a solid block of colour while the first
        // basemap tiles arrive (feedback 2, §4.7).
        <div className="map-skeleton" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </div>
      ) : null}
      {tilesReady && tileTrouble ? (
        <div className="map-tile-notice" role="status">
          <span>{t.mapTilesTrouble}</span>
          <span className="map-tile-notice-actions">
            <button
              type="button"
              onClick={() => {
                const map = mapRef.current as unknown as import("maplibre-gl").Map | null;
                if (!map) return;
                armTileWatch();
                setBasemap(map, basemap);
              }}
            >
              {t.mapTilesRetry}
            </button>
            <button type="button" onClick={() => setBasemapState(fallbackBasemap)}>
              {t.mapTilesSwitch.replace("{name}", BASEMAPS[fallbackBasemap].label)}
            </button>
          </span>
        </div>
      ) : null}
      <div className="map-panels">
        <div className="map-find map-card">
          <button
            type="button"
            className="map-layers-header"
            aria-expanded={findOpen}
            onClick={() => setFindOpen(!findOpen)}
          >
            <span>{labels.findTitle}</span>
            <span className={`nav-tree-chevron ${findOpen ? "open" : ""}`} aria-hidden="true" />
          </button>
          {findOpen ? (
            <div className="map-layers-body">
              {hasPlots ? (
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
                  inputMode="decimal"
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
        <div className="map-layers map-card">
          <button
            type="button"
            className="map-layers-header"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <span>{labels.layersTitle}</span>
            <span className={`nav-tree-chevron ${panelOpen ? "open" : ""}`} aria-hidden="true" />
          </button>
          {panelOpen ? (
            <div className="map-layers-body">
              {/* One group per question (feedback 2, Doc 2 §7): Earthline's
                  own verdicts, the supply chain itself, and public EUDR
                  context — never mixed in one toggle. */}
              <section className="map-layer-group">
                <p className="map-layers-kicker">{t.layerGroupAnalysis}</p>
                <label className="map-layer-toggle">
                  <input
                    type="checkbox"
                    checked={visible.plots}
                    onChange={(ev) => setVisible((v) => ({ ...v, plots: ev.target.checked }))}
                  />
                  {labels.legendPlots}
                </label>
                {hasPlots ? (
                  <>
                    <p className="map-layers-sub">{labels.colorBy}</p>
                    <div className="map-color-by">
                      {colorByOptions.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          className={colorBy === opt.key ? "on" : ""}
                          aria-pressed={colorBy === opt.key}
                          onClick={() => setColorBy(opt.key)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <ul className="map-legend-list">
                      {entries.map((e) => {
                        const set = plotFilters[colorBy];
                        const isOn = !set || set.has(e.value);
                        return (
                          <li key={e.value}>
                            <button
                              type="button"
                              className={`map-legend-item ${isOn ? "" : "off"}`}
                              aria-pressed={isOn}
                              onClick={() =>
                                onPlotFiltersChange(
                                  toggleFilterValue(plotFilters, colorBy, e.value, filterUniverse(colorBy)),
                                )
                              }
                            >
                              <i className="swatch" style={{ background: e.color }} />
                              <span>{e.label}</span>
                              <b className="tabular-nums">{formatCount(e.count, lang)}</b>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {isPlotFilterActive(plotFilters) ? (
                      <div className="map-filter-summary">
                        <span>{labels.filtersActive.replace("{n}", String(activePlotFilterCount(plotFilters)))}</span>
                        <button
                          type="button"
                          className="map-filter-clear"
                          onClick={() => onPlotFiltersChange(EMPTY_PLOT_FILTERS)}
                        >
                          {labels.clearFilters}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  // No mill selected yet — plots load per mill, so the legend
                  // would read "Compliant 0 · Non-compliant 0" next to a
                  // summary of a million plots (feedback 2, B-03). Say what
                  // to do instead.
                  <p className="map-layers-hint">{plotsLoading ? t.loadingPlots : t.selectMillForPlots}</p>
                )}
              </section>

              <section className="map-layer-group">
                <p className="map-layers-kicker">{t.layerGroupChain}</p>
                <label className="map-layer-toggle">
                  <input
                    type="checkbox"
                    checked={visible.mills}
                    onChange={(ev) => setVisible((v) => ({ ...v, mills: ev.target.checked }))}
                  />
                  {labels.legendMills}
                  <b className="tabular-nums">{formatCount(millCount, lang)}</b>
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
                {distinctRefineries.length <= 1 && traceKey.length ? (
                  <>
                    <p className="map-layers-sub">{t.traceKeyTitle}</p>
                    <ul className="map-legend-list">
                      {traceKey.map((k) => (
                        <li key={k.label} className="map-legend-static">
                          <i className="swatch round" style={{ background: k.color }} />
                          <span>{k.label}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {distinctRefineries.length > 1 ? (
                  <>
                    <p className="map-layers-sub">{labels.millsByRefinery}</p>
                    <ul className="map-legend-list">
                      {distinctRefineries.map((r) => (
                        <li key={r} className="map-legend-static">
                          <i
                            className="swatch round"
                            style={{ background: refineryColorFor(r, distinctRefineries) }}
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>

              <section className="map-layer-group">
                <p className="map-layers-kicker">{t.layerGroupContext}</p>
                <label className="map-layer-toggle">
                  <input
                    type="checkbox"
                    checked={forestOn}
                    onChange={(ev) => onForestOnChange(ev.target.checked)}
                  />
                  <i className="swatch" style={{ background: FOREST_COLOR }} />
                  {labels.legendForest}
                  {forestLoading ? <span className="spinner small" aria-hidden="true" /> : null}
                </label>
                <p className="map-layers-note">{t.jrcNote.replace("{version}", JRC_LAYER.version)}</p>
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mini key on the canvas while the Layers card is closed (feedback 3,
          M-3): mill colours, then the plot colours once plots are on. */}
      {!panelOpen && (visible.mills || (hasPlots && visible.plots)) ? (
        <div className="map-mini-legend" aria-label={t.legendTitle}>
          {visible.mills ? (
            distinctRefineries.length > 1 ? (
              <ul>
                {distinctRefineries.slice(0, 6).map((r) => (
                  <li key={r}>
                    <i className="swatch round" style={{ background: refineryColorFor(r, distinctRefineries) }} />
                    {r}
                  </li>
                ))}
                {distinctRefineries.length > 6 ? <li>+{formatCount(distinctRefineries.length - 6, lang)}</li> : null}
              </ul>
            ) : (
              <ul>
                {traceKey.map((k) => (
                  <li key={k.label}>
                    <i className="swatch round" style={{ background: k.color }} />
                    {k.label}
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {hasPlots && visible.plots ? (
            <ul>
              {entries.map((e) => (
                <li key={e.value}>
                  <i className="swatch" style={{ background: e.color }} />
                  {e.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Always-visible basemap chip (feedback 2, Doc 2 §4.1) — the switcher
          used to live at the bottom of the Layers panel and vanished
          whenever that collapsed. */}
      <div className="basemap-chip">
        {basemapMenuOpen ? (
          <div className="basemap-menu" role="menu">
            {BASEMAP_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={basemap === id}
                className={basemap === id ? "on" : ""}
                onClick={() => {
                  setBasemapState(id);
                  setBasemapMenuOpen(false);
                }}
              >
                {BASEMAPS[id].label}
              </button>
            ))}
            {datedWindow ? (
              <p className="map-layers-note">{labels.basemapDatedNote.replace("{window}", datedWindow)}</p>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="basemap-chip-btn"
          aria-haspopup="menu"
          aria-expanded={basemapMenuOpen}
          onClick={() => setBasemapMenuOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5" strokeLinejoin="round" />
          </svg>
          <span className="basemap-chip-label">
            <small>{labels.basemap}</small>
            {bm.label}
          </span>
        </button>
      </div>

      {selectedPlot ? (
        <PlotDetailDeck
          // Remounts (resetting back to slide 1) whenever the selected plot
          // actually changes, rather than persisting whichever slide was
          // open across an unrelated re-render — selectPlot() already
          // treats re-clicking the *same* plot as toggling closed, so this
          // key only ever changes for a genuinely different plot.
          key={selectedPlot.id}
          detail={buildPlotDetail(selectedPlot.props, labels, lang, typeNames)}
          labels={labels}
          lang={lang}
          onClose={() => setSelectedPlot(null)}
        />
      ) : null}
    </div>
  );
}

/** Right-side card replacing the old plot popup — see focusOnPlotFeature's
 * comment for why. Closes via its own × button or by re-clicking the same
 * plot (handled in selectPlot, above); clicking a different plot swaps this
 * card's content in place rather than closing and reopening it. */
function PlotDetailDeck({
  detail,
  labels,
  lang,
  onClose,
}: {
  detail: PlotDetail;
  labels: ChainMapLabels;
  lang: Lang;
  onClose: () => void;
}) {
  // Slide 2 only ever exists for a non-compliant plot with actual detail to
  // show (see buildNonComplyDetail) — reset to slide 1 happens for free
  // since this component remounts (its call site keys it by plot id) each
  // time a different plot is selected.
  const [slide, setSlide] = useState<1 | 2>(1);
  const showDetailSlide = slide === 2 && detail.nonComplyDetail;

  return (
    <div className="plot-detail map-card" role="dialog" aria-label={detail.title}>
      <div className="plot-detail-header">
        <span className="truncate">{detail.title}</span>
        <button type="button" className="plot-detail-close" aria-label={labels.close} onClick={onClose}>
          ×
        </button>
      </div>
      {showDetailSlide && detail.nonComplyDetail ? (
        <div className="plot-detail-body">
          <button type="button" className="plot-detail-seemore" onClick={() => setSlide(1)}>
            ‹ {labels.back}
          </button>
          <p className="plot-detail-subhead">{labels.nonComplyDetailTitle}</p>
          {/* The specific evidence behind *this* plot's flagged issue comes
              first (deforestation-by-year, forest/protected-area overlap —
              whichever actually applies), ahead of the broader Physical/Social
              Risk narrative below it, which for a Village Level plot describes
              the whole village rather than this polygon (see project memory:
              village-level-risk-methodology). */}
          {detail.nonComplyDetail.deforestationByYear.length > 0 ? (
            <div className="plot-detail-breakdown">
              <span>{labels.deforestationByYearLabel}</span>
              {detail.nonComplyDetail.deforestationByYear.map((d) => (
                <div className="plot-detail-row" key={d.year}>
                  <span>{d.year}</span>
                  <b>{formatHa(d.ha, lang)}</b>
                </div>
              ))}
            </div>
          ) : null}
          {detail.nonComplyDetail.overlapBreakdown.length > 0 ? (
            <div className="plot-detail-breakdown">
              <span>{labels.forestOverlapLabel}</span>
              {detail.nonComplyDetail.overlapBreakdown.map((o) => (
                <div className="plot-detail-row" key={o.label}>
                  <span>{o.label}</span>
                  <b>{formatHa(o.ha, lang)}</b>
                </div>
              ))}
            </div>
          ) : null}
          {detail.nonComplyDetail.physicalReason ? (
            <p className="plot-detail-note bad">
              <span>{labels.physicalReasonLabel}</span>
              {detail.nonComplyDetail.physicalReason}
            </p>
          ) : null}
          {detail.nonComplyDetail.socialReason ? (
            <p className="plot-detail-note">
              <span>{labels.socialReasonLabel}</span>
              {detail.nonComplyDetail.socialReason}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="plot-detail-body">
          {detail.rows.map((r) => (
            <div className="plot-detail-row" key={r.label}>
              <span>{r.label}</span>
              <b className={r.cls ?? ""}>{r.value}</b>
            </div>
          ))}
          {detail.coordinates ? (
            <div className="plot-detail-row">
              <span>{labels.coordinates}</span>
              <a
                href={`https://www.google.com/maps?q=${detail.coordinates.lat},${detail.coordinates.lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {detail.coordinates.lat.toFixed(5)}, {detail.coordinates.lon.toFixed(5)}
              </a>
            </div>
          ) : null}
          <p className="plot-detail-note">
            <span>{detail.mitigation.label}</span>
            {detail.mitigation.text}
          </p>
          {detail.nonComplyReason ? (
            <p className="plot-detail-note bad">
              <span>{labels.nonComplyReason}</span>
              {detail.nonComplyReason}
              {/\.\s*$/.test(detail.nonComplyReason) ? "" : "."}
              {detail.nonComplyDetail ? (
                <>
                  {" "}
                  <button type="button" className="plot-detail-seemore" onClick={() => setSlide(2)}>
                    {labels.seeMore} »
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      )}
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
