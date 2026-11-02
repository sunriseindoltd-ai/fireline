import type maplibregl from "maplibre-gl";

/**
 * Sea and land outside Indonesia drawn darker on every map (user, 2 Nov 2026), so the eye stays on Indonesia.
 * One world polygon with Indonesia's land as holes (public/geo/idn-mask.json, scripts/prepare-idn-mask.py), kept
 * right above the last raster layer: over the basemap and any Sentinel / Esri imagery, under plots and hotspots.
 */
const ID = "idn-mask";
let cache: Promise<GeoJSON.FeatureCollection> | null = null;
const load = () => (cache ??= fetch("/geo/idn-mask.json").then((r) => r.json()));

export function addOutsideMask(map: maplibregl.Map) {
  const place = () => {
    if (!map.getLayer(ID)) return;
    const layers = map.getStyle()?.layers ?? [];
    let lastRaster = -1;
    layers.forEach((l, i) => {
      if (l.type === "raster") lastRaster = i;
    });
    const at = layers.findIndex((l) => l.id === ID);
    if (at === lastRaster + 1) return;
    const before = layers[lastRaster + 1]?.id;
    if (before === ID) return;
    map.moveLayer(ID, before);
  };
  const add = () => {
    void load().then((data) => {
      if (!map.getStyle()) return;
      if (!map.getSource(ID)) map.addSource(ID, { type: "geojson", data });
      if (!map.getLayer(ID)) map.addLayer({ id: ID, type: "fill", source: ID, paint: { "fill-color": "#05070a", "fill-opacity": 0.6 } });
      place();
    });
  };
  if (map.isStyleLoaded()) add();
  else map.once("load", add);
  map.on("style.load", add);
  // imagery added later (Sentinel, Esri overlays) lands on top of the rasters: put the mask back over it
  map.on("styledata", place);
}
