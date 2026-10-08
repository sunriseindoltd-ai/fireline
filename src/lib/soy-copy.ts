import type { Lang } from "@/lib/copy";

/** Copy for the ADM Soy workspace (soy-workspace.tsx). Statistics and maps
 * only — no EUDR wording until that analysis exists. */
const en = {
  scopeLabel: "US soybean",
  title: "Soybean sourcing areas",
  oldBannerTitle: "Earlier delivery — not the figures in use.",
  oldBannerBody: "This tab is ADM's first data: five crushing plants with 40 statute-mile (64 km) areas, Decatur East and West as one, and 235 non-compliant points sent with the Quincy dataset. The current supply chain (7 Oct 2026: four plants, 40 / 80 NM, ADM's full list of 1,073 non-compliant fields) is on the other tabs. Decatur East is not in the 7 Oct delivery, which lists Decatur West only.",
  oldBannerCta: "Go to the current Summary",
  elevatorsRaw: "Raw data as delivered, not checked.",
  intro:
    "Fields planted with soybeans in 2025 within {miles} miles of each ADM crushing plant. Source: USDA NASS Crop Sequence Boundaries 2018–2025, as delivered by ADM.",
  allPlants: "All sourcing areas",
  plantsLabel: "Plants",
  plantsKpi: "Crushing plants",
  plantsHint:
    "ADM crushing facilities in this dataset. Decatur West and East share one sourcing area.",
  fieldsKpi: "Soybean fields",
  fieldsHint: "Fields planted with soybeans in 2025 inside the 40-mile sourcing area.",
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
  colPlant: "Sourcing area",
  colPlants: "Plants",
  colState: "State",
  colCounty: "County",
  colFields: "Fields",
  colArea: "Soybean area",
  colMedian: "Median size",
  compareTitle: "Sourcing areas compared",
  overlapNote:
    "Decatur has two ADM crushing plants, West and East, about 1 km apart; they share one sourcing area.",
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
  layersTitle: "Layers",
  layerFields: "Soybean fields",
  layerElevators: "Grain elevators",
  layerFlagged: "Non-compliant fields (ADM list)",
  layerRail: "Railways",
  layerRivers: "Rivers & streams",
  layerRoads: "Roads",
  layerLoading: "loading…",
  layerFailed: "couldn't load",
  elevator: "Grain elevator",
  elCapacity: "Capacity",
  elLicense: "License",
  elAddress: "Address",
  elMismatch: "The point lies in {at}, not in the listed state ({listed}) — check the coordinates.",
  flagged: "Non-compliant field (ADM list)",
  flChange: "Changed area",
  flFieldArea: "Field area",
  flCrops: "Crop 2024 → 2025",
  flSoy2026: "Soybeans in 2026",
  yes: "Yes",
  no: "No",
  flaggedTitle: "Non-compliant fields (ADM list)",
  flaggedNote:
    "Points delivered by ADM with the Quincy dataset. {inside} of {n} lie inside a sourcing area. Landowner names and tax addresses in the source are not shown.",
  flaggedKpi: "Points",
  flaggedChangeKpi: "Changed area",
  flaggedInside: "Inside a sourcing area",
  elevatorsTitle: "Grain elevators (ADM list, Illinois)",
  elevatorsNote:
    "{bad} of {n} have a point outside the state they are listed in; those are marked and need their coordinates checked.",
  colName: "Name",
  colCity: "City",
  colCapacity: "Capacity",
  checkCoords: "Check coordinates",
  none: "None in this sourcing area.",
};

export type SoyCopy = typeof en;

const id: SoyCopy = {
  scopeLabel: "Kedelai AS",
  title: "Wilayah pasokan kedelai",
  oldBannerTitle: "Kiriman lama — bukan angka yang dipakai sekarang.",
  oldBannerBody: "Tab ini data pertama dari ADM: lima pabrik crushing dengan wilayah 40 mil biasa (64 km), Decatur East dan West sebagai satu, dan 235 titik non-comply yang dikirim bersama dataset Quincy. Rantai pasok yang berlaku (7 Okt 2026: empat pabrik, 40 / 80 NM, daftar lengkap ADM 1.073 ladang non-comply) ada di tab lain. Decatur East tidak ada di kiriman 7 Okt — hanya Decatur West.",
  oldBannerCta: "Ke Ringkasan yang berlaku",
  elevatorsRaw: "Data mentah sesuai kiriman, belum dicek.",
  intro:
    "Ladang yang ditanami kedelai pada 2025 dalam radius {miles} mil dari tiap pabrik crushing ADM. Sumber: USDA NASS Crop Sequence Boundaries 2018–2025, sesuai kiriman ADM.",
  allPlants: "Semua wilayah pasokan",
  plantsLabel: "Pabrik",
  plantsKpi: "Pabrik crushing",
  plantsHint:
    "Fasilitas crushing ADM di data ini. Decatur West dan East berbagi satu wilayah pasokan.",
  fieldsKpi: "Ladang kedelai",
  fieldsHint: "Ladang yang ditanami kedelai pada 2025 di dalam wilayah pasokan 40 mil.",
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
  colPlant: "Wilayah pasokan",
  colPlants: "Pabrik",
  colState: "Negara bagian",
  colCounty: "County",
  colFields: "Ladang",
  colArea: "Luas kedelai",
  colMedian: "Median luas",
  compareTitle: "Perbandingan wilayah pasokan",
  overlapNote:
    "Decatur punya dua pabrik crushing ADM, West dan East, berjarak sekitar 1 km; keduanya berbagi satu wilayah pasokan.",
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
  layersTitle: "Layer",
  layerFields: "Ladang kedelai",
  layerElevators: "Elevator gandum",
  layerFlagged: "Ladang non-comply (daftar ADM)",
  layerRail: "Rel kereta",
  layerRivers: "Sungai & anak sungai",
  layerRoads: "Jalan",
  layerLoading: "memuat…",
  layerFailed: "gagal dimuat",
  elevator: "Elevator gandum",
  elCapacity: "Kapasitas",
  elLicense: "Lisensi",
  elAddress: "Alamat",
  elMismatch:
    "Titiknya berada di {at}, bukan di negara bagian yang tercatat ({listed}) — koordinat perlu dicek.",
  flagged: "Ladang non-comply (daftar ADM)",
  flChange: "Luas perubahan",
  flFieldArea: "Luas ladang",
  flCrops: "Tanaman 2024 → 2025",
  flSoy2026: "Kedelai 2026",
  yes: "Ya",
  no: "Tidak",
  flaggedTitle: "Ladang non-comply (daftar ADM)",
  flaggedNote:
    "Titik dari ADM bersama data Quincy. {inside} dari {n} berada di dalam wilayah pasokan. Nama pemilik lahan dan alamat pajak di data sumber tidak ditampilkan.",
  flaggedKpi: "Titik",
  flaggedChangeKpi: "Luas perubahan",
  flaggedInside: "Di dalam wilayah pasokan",
  elevatorsTitle: "Elevator gandum (daftar ADM, Illinois)",
  elevatorsNote:
    "{bad} dari {n} titiknya berada di luar negara bagian yang tercatat; ditandai dan koordinatnya perlu dicek.",
  colName: "Nama",
  colCity: "Kota",
  colCapacity: "Kapasitas",
  checkCoords: "Cek koordinat",
  none: "Tidak ada di wilayah pasokan ini.",
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
