// Esri World Imagery base layer (the one FireLine uses), same source as PalmTrace.
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

export function basemapStyle(_id: "esri" = "esri") {
  return {
    version: 8 as const,
    glyphs: GLYPHS_URL,
    sources: {
      sat: {
        type: "raster" as const,
        tileSize: 256,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxzoom: 17,
      },
    },
    layers: [{ id: "sat", type: "raster" as const, source: "sat" }],
  };
}
