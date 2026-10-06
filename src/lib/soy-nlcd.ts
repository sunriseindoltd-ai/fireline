import type { Lang } from "@/lib/copy";

/**
 * USGS Annual NLCD land cover shown in SoyTrace (layer "Land cover (NLCD)").
 * Tiles are cut to the catchments by scripts/prepare-soy-nlcd.py and served
 * from the soy bucket at /data/layers/nlcd/<year>/<z>/<x>/<y>.png. Colours are
 * the official NLCD legend — kept in step with COLORS in that script.
 */
export const NLCD_YEARS = ["2025", "2020"] as const;
export type NlcdYear = (typeof NLCD_YEARS)[number];
export const NLCD_MAX_ZOOM = 12;
export const NLCD_MIN_ZOOM = 5;

export const NLCD_CLASSES: { code: number; color: string; en: string; id: string }[] = [
  { code: 82, color: "#ab6c28", en: "Cultivated crops", id: "Lahan tanam" },
  { code: 81, color: "#dcd939", en: "Pasture / hay", id: "Padang rumput / jerami" },
  { code: 71, color: "#dfdfc2", en: "Grassland", id: "Padang rumput alami" },
  { code: 52, color: "#ccb879", en: "Shrub / scrub", id: "Semak belukar" },
  { code: 41, color: "#68ab5f", en: "Deciduous forest", id: "Hutan gugur" },
  { code: 42, color: "#1c5f2c", en: "Evergreen forest", id: "Hutan selalu hijau" },
  { code: 43, color: "#b5c58f", en: "Mixed forest", id: "Hutan campuran" },
  { code: 90, color: "#b8d9eb", en: "Woody wetlands", id: "Lahan basah berpohon" },
  { code: 95, color: "#6c9fb8", en: "Herbaceous wetlands", id: "Lahan basah herba" },
  { code: 11, color: "#466b9f", en: "Open water", id: "Perairan" },
  { code: 21, color: "#dec5c5", en: "Developed, open space", id: "Terbangun, ruang terbuka" },
  { code: 22, color: "#d99282", en: "Developed, low intensity", id: "Terbangun, kepadatan rendah" },
  { code: 23, color: "#eb0000", en: "Developed, medium intensity", id: "Terbangun, kepadatan sedang" },
  { code: 24, color: "#ab0000", en: "Developed, high intensity", id: "Terbangun, kepadatan tinggi" },
  { code: 31, color: "#b3ac9f", en: "Barren land", id: "Lahan terbuka" },
  { code: 12, color: "#d1def8", en: "Perennial ice / snow", id: "Es / salju abadi" },
];

/** The map legend: short labels, the four developed classes on one line. */
export const NLCD_LEGEND: { colors: string[]; en: string; id: string }[] = [
  { colors: ["#ab6c28"], en: "Crops", id: "Lahan tanam" },
  { colors: ["#dcd939"], en: "Pasture / hay", id: "Rumput / jerami" },
  { colors: ["#dfdfc2"], en: "Grassland", id: "Rumput alami" },
  { colors: ["#ccb879"], en: "Shrub", id: "Semak" },
  { colors: ["#68ab5f"], en: "Deciduous forest", id: "Hutan gugur" },
  { colors: ["#1c5f2c"], en: "Evergreen forest", id: "Hutan hijau" },
  { colors: ["#b5c58f"], en: "Mixed forest", id: "Hutan campuran" },
  { colors: ["#b8d9eb"], en: "Woody wetland", id: "Rawa berpohon" },
  { colors: ["#6c9fb8"], en: "Herbaceous wetland", id: "Rawa herba" },
  { colors: ["#466b9f"], en: "Water", id: "Perairan" },
  { colors: ["#dec5c5", "#d99282", "#eb0000", "#ab0000"], en: "Developed", id: "Terbangun" },
  { colors: ["#b3ac9f"], en: "Barren", id: "Lahan terbuka" },
];

export const nlcdLabel =(code: number, lang: Lang) => NLCD_CLASSES.find((c) => c.code === code)?.[lang] ?? String(code);

export const nlcdTiles = (year: NlcdYear) => `/data/layers/nlcd/${year}/{z}/{x}/{y}.png`;
