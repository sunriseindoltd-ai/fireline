/**
 * Provenance shown next to every KPI and layer (feedback 2: "jejak audit
 * angka" / Pillar 2 "sumber terlihat"). Update DATA_AS_OF whenever a plot
 * ingest lands (prepare-plots → prepare-eudr-stats → upload:plots) — it is
 * the cut-off date clients see under the EUDR figures.
 */
export const DATA_AS_OF = "2026-09-30";

/** The JRC export behind private-data/forest (scripts/prepare-forest-cover.mjs). */
export const JRC_LAYER = {
  name: "JRC Global Forest Cover 2020 (GFC2020)",
  version: "V3",
  resolution: "10 m",
  source: "https://forobs.jrc.ec.europa.eu/GFC",
};

/** Sentinel-2 L2A mosaics served by Microsoft Planetary Computer (chain-map.tsx). */
export const S2_WINDOWS = {
  2020: { from: "2020-01-01", to: "2020-12-31" },
  // Open-ended: the 2026 mosaic takes the clearest scene per tile from the
  // start of the year up to whenever the tile is requested.
  2026: { from: "2026-01-01", to: null },
} as const;
