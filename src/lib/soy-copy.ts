import type { Lang } from "@/lib/copy";

/** Copy for the ADM Soy workspace (soy-workspace.tsx). Statistics and maps
 * only — no EUDR wording until that analysis exists. */
const en = {
  scopeLabel: "US soybean",
  title: "Soybean sourcing areas",
  intro:
    "Fields planted with soybeans in 2025 within {miles} miles of each ADM crushing plant. Source: USDA NASS Crop Sequence Boundaries 2018–2025, as delivered by ADM.",
  allPlants: "All plants",
  plantsLabel: "Plants",
  plantsKpi: "Crushing plants",
  plantsHint: "ADM crushing facilities in this dataset, each with its own 40-mile sourcing area.",
  fieldsKpi: "Soybean fields",
  fieldsHint:
    "Fields planted with soybeans in 2025 inside the sourcing area. A field inside two overlapping areas counts once in the all-plants total.",
  areaKpi: "Soybean area 2025",
  areaHint: "Total area of those fields (USDA field boundaries).",
  medianKpi: "Median field size",
  medianHint: "Half of the fields are smaller than this, half larger.",
  statesKpi: "States",
  statesHint: "States the sourcing area's fields lie in.",
  acres: "{n} acres",
  mapTitle: "Map",
  mapPickPlant: "Select a plant above to load its fields on the map.",
  mapLoading: "Loading {n} fields…",
  mapError: "The fields couldn't be loaded just now. Try again.",
  retry: "Try again",
  legendTitle: "Years in soybeans, 2018–2025",
  legendNote: "Out of 8 seasons. Most fields rotate corn and soybeans (4 of 8).",
  legendPlant: "Crushing plant",
  legendBuffer: "40-mile sourcing area",
  basemapImagery: "Imagery",
  basemapMap: "Map",
  cropHistoryTitle: "What these fields grew, 2018–2025",
  cropHistoryNote:
    "Area of the 2025 soybean fields by the crop each grew that year (USDA Cropland Data Layer). It describes these fields' rotation, not total soybean area in earlier years.",
  sizeTitle: "Field size",
  sizeNote: "Number of fields by size (hectares).",
  soyYearsTitle: "How often the same field grows soybeans",
  soyYearsNote: "Number of fields by seasons in soybeans out of the last 8 (2018–2025).",
  yearsN: "{n} of 8",
  countiesTitle: "Top counties",
  statesTitle: "By state",
  colPlant: "Plant",
  colState: "State",
  colCounty: "County",
  colFields: "Fields",
  colArea: "Soybean area",
  colMedian: "Median size",
  compareTitle: "Plants compared",
  overlapNote:
    "Decatur (West) and Decatur (East) are about 1 km apart, so their sourcing areas almost fully overlap and most Decatur fields appear under both.",
  groups: {
    soy: "Soybeans",
    corn: "Corn",
    other: "Other crops",
    grass: "Grass, hay & pasture",
    fallow: "Fallow / idle",
    noncrop: "Non-crop",
  },
  fieldId: "Field ID",
  fieldArea: "Area",
  fieldLocation: "Location",
  fieldHistory: "Crop by year",
  loadError: "The soybean data couldn't be loaded just now.",
};

export type SoyCopy = typeof en;

const id: SoyCopy = {
  scopeLabel: "Kedelai AS",
  title: "Wilayah pasokan kedelai",
  intro:
    "Ladang yang ditanami kedelai pada 2025 dalam radius {miles} mil dari tiap pabrik crushing ADM. Sumber: USDA NASS Crop Sequence Boundaries 2018–2025, sesuai kiriman ADM.",
  allPlants: "Semua pabrik",
  plantsLabel: "Pabrik",
  plantsKpi: "Pabrik crushing",
  plantsHint: "Fasilitas crushing ADM di data ini, masing-masing dengan wilayah pasokan 40 mil.",
  fieldsKpi: "Ladang kedelai",
  fieldsHint:
    "Ladang yang ditanami kedelai pada 2025 di dalam wilayah pasokan. Ladang yang masuk dua wilayah yang tumpang-tindih dihitung sekali di total semua pabrik.",
  areaKpi: "Luas kedelai 2025",
  areaHint: "Total luas ladang tersebut (batas ladang USDA).",
  medianKpi: "Median luas ladang",
  medianHint: "Separuh ladang lebih kecil dari angka ini, separuh lebih besar.",
  statesKpi: "Negara bagian",
  statesHint: "Negara bagian tempat ladang di wilayah pasokan ini berada.",
  acres: "{n} acre",
  mapTitle: "Peta",
  mapPickPlant: "Pilih salah satu pabrik di atas untuk memuat ladangnya di peta.",
  mapLoading: "Memuat {n} ladang…",
  mapError: "Ladang gagal dimuat barusan. Coba lagi.",
  retry: "Coba lagi",
  legendTitle: "Musim tanam kedelai, 2018–2025",
  legendNote: "Dari 8 musim. Sebagian besar ladang bergiliran jagung–kedelai (4 dari 8).",
  legendPlant: "Pabrik crushing",
  legendBuffer: "Wilayah pasokan 40 mil",
  basemapImagery: "Citra",
  basemapMap: "Peta",
  cropHistoryTitle: "Tanaman di ladang ini, 2018–2025",
  cropHistoryNote:
    "Luas ladang kedelai 2025 menurut tanaman yang ditanam di tahun itu (USDA Cropland Data Layer). Ini menggambarkan rotasi ladang tersebut, bukan total luas kedelai di tahun-tahun sebelumnya.",
  sizeTitle: "Luas ladang",
  sizeNote: "Jumlah ladang menurut luas (hektare).",
  soyYearsTitle: "Seberapa sering ladang yang sama ditanami kedelai",
  soyYearsNote: "Jumlah ladang menurut musim tanam kedelai dari 8 musim terakhir (2018–2025).",
  yearsN: "{n} dari 8",
  countiesTitle: "County teratas",
  statesTitle: "Per negara bagian",
  colPlant: "Pabrik",
  colState: "Negara bagian",
  colCounty: "County",
  colFields: "Ladang",
  colArea: "Luas kedelai",
  colMedian: "Median luas",
  compareTitle: "Perbandingan pabrik",
  overlapNote:
    "Decatur (West) dan Decatur (East) hanya berjarak sekitar 1 km, jadi wilayah pasokannya hampir berimpit dan sebagian besar ladang Decatur muncul di keduanya.",
  groups: {
    soy: "Kedelai",
    corn: "Jagung",
    other: "Tanaman lain",
    grass: "Rumput, jerami & padang",
    fallow: "Bera / tidak ditanami",
    noncrop: "Bukan lahan tanam",
  },
  fieldId: "ID ladang",
  fieldArea: "Luas",
  fieldLocation: "Lokasi",
  fieldHistory: "Tanaman per tahun",
  loadError: "Data kedelai gagal dimuat barusan.",
};

export const soyCopy: Record<Lang, SoyCopy> = { en, id };

export type SoyGroup = keyof SoyCopy["groups"];
export const SOY_GROUPS: SoyGroup[] = ["soy", "corn", "other", "grass", "fallow", "noncrop"];

/** Crop-history colours: soybeans in the brand green, corn a muted gold, the
 * rest greys — calm, no loud accents (PalmTrace style). */
export const SOY_GROUP_COLORS: Record<SoyGroup, string> = {
  soy: "#2f8552",
  corn: "#d2b77a",
  other: "#8c9db8",
  grass: "#a9c89a",
  fallow: "#c9c4b8",
  noncrop: "#86868b",
};

/** Field fill by seasons in soybeans (1…8), light → dark green. */
export const SOY_YEARS_COLORS = [
  "#e3f0e3",
  "#c6e2c8",
  "#a3cfa8",
  "#7cb88a",
  "#58a06e",
  "#3b8757",
  "#256e44",
  "#155433",
];

/** Mirrors scripts/prepare-adm-soy.py's groups, for the field popup. */
const SOY = new Set([5, 26, 239, 240, 241, 254]);
const CORN = new Set([1, 12, 13, 225, 226, 228, 237]);
const GRASS = new Set([36, 37, 58, 59, 60, 62, 176, 224]);
const NON_CROP = new Set([
  63, 64, 65, 81, 82, 83, 87, 88, 92, 111, 112, 121, 122, 123, 124, 131, 141, 142, 143, 152, 190,
  195,
]);
export function soyGroupOf(code: number | null): SoyGroup {
  if (code == null) return "noncrop";
  if (SOY.has(code)) return "soy";
  if (CORN.has(code)) return "corn";
  if (GRASS.has(code)) return "grass";
  if (code === 61) return "fallow";
  if (NON_CROP.has(code)) return "noncrop";
  return "other";
}
