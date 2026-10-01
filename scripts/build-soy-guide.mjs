#!/usr/bin/env node
/**
 * Builds the internal SoyTrace data guide (Indonesian, for Earthline's team):
 * what the client's ADM_SOY.gdb holds, a glossary of every attribute, what
 * SoyTrace derives from it, the method, how to use the workspace and how to
 * refresh the data. Figures come from private-data/tenants/adm-soy/supply.json;
 * screenshots are taken fresh from a running dev server.
 *
 * Usage (dev server on 8096 with the soy data on disk, see CLAUDE.md):
 *   node scripts/build-soy-guide.mjs [--base http://127.0.0.1:8096] [--out "<pdf>"] [--no-shots]
 * --html <file> also writes the HTML (for checking the layout).
 * Default output: Data Storage/ADM Soy/SoyTrace_Panduan_Data_Quincy.pdf
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg("--base", "http://127.0.0.1:8096");
const OUT = arg("--out", path.join(ROOT, "Data Storage", "ADM Soy", "SoyTrace_Panduan_Data_Quincy.pdf"));
const SHOTS = !process.argv.includes("--no-shots");
const SHOT_DIR = path.join(os.tmpdir(), "soy-guide-shots");
const supply = JSON.parse(readFileSync(path.join(ROOT, "private-data", "tenants", "adm-soy", "supply.json"), "utf8"));
const soy = JSON.parse(readFileSync(path.join(ROOT, "private-data", "tenants", "adm-soy", "soy.json"), "utf8"));

const HA = 0.40468564224;
const nf = (n, d = 0) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: d });
const ha = (acres) => `${nf(acres * HA)} ha`;
const pct = (a, b) => (b > 0 ? `${nf((a / b) * 100, a / b < 0.001 ? 3 : 2)}%` : "—");
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const K = Object.fromEntries(supply.catchments.map((c) => [c.id, c]));
const sites = supply.admElevators.filter((e) => e.radiusM);

// ------------------------------------------------------------ screenshots
async function takeShots(browser) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const rows = readFileSync(path.join(ROOT, "artifacts", "akun-adm-soy.csv"), "utf8").split(/\r?\n/);
  const cols = rows.find((l) => l.split(/[;,]/).includes("adm-soy-1")).split(/[;,]/);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("__g")) return;
    sessionStorage.setItem("__g", "1");
    for (const k of Object.keys(localStorage)) if (k.startsWith("soytrace.")) localStorage.removeItem(k);
    localStorage.setItem("soytrace.tourDone", "1");
    localStorage.setItem("kanopi.lang", "id");
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?product=soy`, { waitUntil: "networkidle" });
  await p.fill('input[name="username"]', "adm-soy-1");
  await p.fill('input[name="password"]', cols[cols.indexOf("adm-soy-1") + 1]);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/app/, { timeout: 120000 });
  // Signing in re-arms the reading guide; these checks skip it.
  await p.evaluate(() => localStorage.setItem("soytrace.tourDone", "1"));
  await p.addLocatorHandler(p.locator(".tour-card"), async () => { await p.keyboard.press("Escape"); });
  await p.waitForSelector(".app-tabs button", { timeout: 60000 });
  const shot = async (name) => {
    await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: "jpeg", quality: 82 });
  };
  const loaded = () =>
    p.waitForFunction(
      () => /dimuat/.test(document.querySelector(".soy-load-note")?.textContent ?? "") && !/Memuat/.test(document.querySelector(".soy-load-note")?.textContent ?? ""),
      null,
      { timeout: 120000 },
    );
  await shot("summary");
  await p.locator(".app-tabs button").nth(1).click();
  await p.waitForSelector(".soy-mapview .side-panel");
  await shot("l1");
  await p.locator(".side-panel .mill-row").nth(0).click();
  await shot("l2-direct");
  await p.locator(".side-panel .back-link").click();
  await p.locator(".side-panel .mill-row").nth(1).click();
  await shot("l2-adm");
  await p.locator(".side-panel .mill-row").first().click();
  await loaded();
  await shot("l3-adm");
  await p.locator(".side-panel .btn-primary.block").click();
  await p.waitForSelector(".soy-drawer tbody tr");
  await p.locator(".soy-drawer tbody tr").first().click();
  await shot("l3-table");
  await p.locator(".app-tabs button").nth(2).click();
  await p.waitForSelector(".soy-corr-controls");
  await shot("corridor");
  await ctx.close();
}

// ---------------------------------------------------------------- content
const img = (name, caption) => {
  const f = path.join(SHOT_DIR, `${name}.jpg`);
  if (!existsSync(f)) return "";
  const b64 = readFileSync(f).toString("base64");
  return `<figure><img src="data:image/jpeg;base64,${b64}" alt=""><figcaption>${esc(caption)}</figcaption></figure>`;
};
const table = (head, rows, cls = "") =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
const code = (s) => `<code>${esc(s)}</code>`;

const LAYERS = [
  ["Crushing_Plant_Quincy", "Titik", 1, "Pabrik crushing ADM Quincy, IL", "Titik pabrik, level 1"],
  ["Buffer_Quincy_40NM", "Poligon", 1, "Buffer 40 NM (74.080 m) dari pabrik", "Radius catchment Quincy 0–40 NM"],
  ["Buffer_Quincy_80NM", "Poligon", 1, "Buffer 80 NM (148.160 m)", "Radius catchment Quincy 0–80 NM"],
  ["Point_Elevator_ADM", "Titik", 15, "Elevator ADM (13 lokasi; Evansville 3 titik)", "Titik elevator ADM"],
  ["Buffer_Elevator_ADM_20NM", "Poligon", 13, "Buffer 20 NM (37.065 m) per lokasi elevator", "Radius catchment elevator ADM"],
  ["Point_ThirdParty_Polygons", "Titik", 98, "Elevator pihak ketiga (31 perusahaan, 22 negara bagian)", "Titik pihak ketiga"],
  ["Point_ThirdParty_Elevator_3_Estate", "Titik", 56, "Subset 56 pihak ketiga di IL, IA, MO, KY, MN, IN", "Penanda '6 negara bagian'"],
  ["Buffer_ThirdParty_Elevator_20NM", "Poligon", 98, "Buffer 20 mil biasa (32.187 m) — nama layer menyebut NM", "Radius catchment pihak ketiga (apa adanya)"],
  ["Buffer_ThirdParty_Elevator_3_Estate", "Poligon", 56, "Buffer subset 56", "Tidak dipakai langsung"],
  ["CP_Compliant_Polygons_40NM", "Poligon", 31635, "Ladang kedelai 2025 comply dalam buffer 40 NM", "Tidak dipakai langsung (tercakup 80 NM)"],
  ["CP_Compliant_Polygons_80NM", "Poligon", 112202, "Ladang kedelai 2025 comply dalam buffer 80 NM", "Kumpulan ladang untuk catchment Quincy"],
  ["Compliant_Elevator_ADM_Polygons", "Poligon", 67108, "Ladang comply dalam buffer elevator ADM", "Kumpulan ladang catchment elevator ADM"],
  ["ThirdParty_Compliant_Polygons", "Poligon", 295773, "Ladang comply dalam buffer pihak ketiga", "Kumpulan ladang catchment pihak ketiga"],
  ["Non_Compliant_Polygons", "Poligon", 1065, "Ladang non-comply (batas ladang)", "Ladang non-comply, ukuran asli"],
  ["Point_Non_Compliant", "Titik", 1073, "Titik non-comply + atribut perubahan", "Luas perubahan, F2026_Soy; 16 titik datang tanpa poligon"],
  ["Non_Compliant_Tambahan (shapefile, 1 Okt 2026)", "Poligon", 8, "Batas ladang untuk 8 dari 16 titik tanpa poligon. Proyeksi Albers lintang asal 23° (EPSG:5070) — beda dengan gdb (37,5°), diproyeksikan ulang", "Ditambahkan ke ladang non-comply"],
  ["RailWay", "Garis", 43774, "Jalur rel FRA 07/2025 (7 negara bagian)", "Layer rel + jarak ke rel"],
  ["River", "Poligon 3D", 29959, "Area sungai NHD (7 negara bagian)", "Layer sungai + jarak ke sistem sungai utama"],
  ["State_Boundary", "Poligon", 56, "Batas negara bagian AS (geoBoundaries ADM1)", "Tidak dipakai"],
];

const GLOSS = [
  {
    title: "Pabrik crushing — Crushing_Plant_Quincy (juga di Buffer_Quincy_*)",
    rows: [
      ["Buyer", "Pembeli / pemilik pabrik (ADM)."],
      ["Field2", "Nama kota pabrik (Quincy). Nama kolom bawaan impor Excel."],
      ["State, Field5", "Negara bagian (Illinois); Field5 duplikat State."],
      ["Country", "Negara (United States)."],
      ["Address", "Alamat pabrik."],
      ["F50, F100", "Yes/No — arti belum terdokumentasi (dugaan: dalam 50/100 mil dari sesuatu). Pertanyaan ke ADM."],
      ["BUFF_DIST", "Hanya di layer buffer: radius buffer dalam meter (74.080 = 40 NM; 148.160 = 80 NM)."],
      ["ORIG_FID, Shape_Length, Shape_Area", "Hasil geoprocessing ArcGIS: ID fitur asal, keliling (m), luas (m²)."],
    ],
  },
  {
    title: "Elevator ADM — Point_Elevator_ADM, Buffer_Elevator_ADM_20NM",
    rows: [
      ["Facility_N", "Nama fasilitas (mis. 'ADM Grain - Burlington'). Ada salah ketik 'St. Lousi'."],
      ["Facility", "Nama kota / lokasi."],
      ["Address", "Alamat (1 titik kosong)."],
      ["County", "County — hanya 3 dari 15 terisi."],
      ["State", "Negara bagian; campur nama penuh dan singkatan (MN, KY), satu berisi 'Iowa\\r\\n'."],
      ["Country", "USA (1 kosong)."],
      ["River", "Sungai tempat elevator berada (Mississippi, Ohio, Tennessee) — 5 kosong."],
      ["Type_of_fa", "Jenis: Elevator; Terminal (rail/barge); Grain terminal (Evansville)."],
      ["F50, F100", "Yes/No — arti belum diketahui (lihat pabrik)."],
      ["Latitude, Longitude", "Koordinat WGS84 dalam atribut (1 titik kosong; geometrinya tetap ada)."],
      ["BUFF_DIST", "Di layer buffer: 37.065 m = 20 mil laut."],
    ],
  },
  {
    title: "Pihak ketiga — Point_ThirdParty_Polygons, *_3_Estate, Buffer_ThirdParty_*",
    rows: [
      ["TRACT_Naming_Convention", "Kode unik fasilitas, format ST-Perusahaan-Kota-Negara bagian (mis. ST-Bunge-Cairo-IL). 3 kode muncul dua kali."],
      ["Company_Name", "Perusahaan (CGB 22, Cargill 15, Bunge 11, …; total 31). Beberapa sebenarnya pabrik crushing (Platinum Crush, Norfolk Crush, Oxbow, NDSP/SDSP)."],
      ["County, State", "County dan negara bagian (singkatan)."],
      ["Address", "Alamat."],
      ["Type_of_facility", "Selalu 'Elevator'."],
      ["Latitude, Longitude", "Koordinat WGS84."],
      ["BUFF_DIST", "Di layer buffer: 32.187 m = 20 mil biasa (walaupun nama layer '20NM')."],
    ],
  },
  {
    title: "Ladang (USDA Crop Sequence Boundaries) — CP_Compliant_*, Compliant_Elevator_ADM_Polygons, ThirdParty_Compliant_Polygons, Non_Compliant_Polygons",
    rows: [
      ["CSBID", "ID ladang unik dari USDA CSB (15 digit; 2 digit awal = kode FIPS negara bagian, lalu '1825' = periode 2018–2025)."],
      ["CSBYEARS", "Periode CSB, selalu '1825' (2018–2025)."],
      ["CSBACRES", "Luas ladang (acre). 1 acre = 0,4047 ha."],
      ["CDL2018 … CDL2025", "Kode kelas USDA Cropland Data Layer per tahun (angka; lihat tabel kode CDL). Semua ladang comply = 5 (kedelai) di 2025."],
      ["STATEFIPS", "Kode FIPS negara bagian (17 = IL, 19 = IA, 29 = MO, …)."],
      ["STATEASD, ASD", "Agricultural Statistics District: STATEASD = FIPS + ASD (mis. 1730); ASD = kode distrik 10–90."],
      ["CNTY, CNTYFIPS", "Nama county dan kode FIPS county (3 digit)."],
      ["INSIDE_X, INSIDE_Y", "Titik di dalam ladang, koordinat proyeksi (meter) dari USDA."],
      ["ORIG_FID", "ID fitur asal (hampir selalu kosong)."],
      ["Shape_Length, Shape_Area", "Keliling (m) dan luas (m²) di proyeksi ESRI:102003."],
    ],
  },
  {
    title: "Titik non-comply — Point_Non_Compliant",
    rows: [
      ["CSBID", "ID ladang (sama dengan Non_Compliant_Polygons; 1.057 cocok dengan Non_Compliant_Polygons, 8 dengan poligon tambahan 1 Okt, 8 masih tanpa poligon)."],
      ["State, County", "Nama negara bagian dan county."],
      ["Longitude, Latitude", "Koordinat titik."],
      ["Change_Acr", "Luas bagian ladang yang berubah (acre), 1,24–26,16 per ladang; total 3.480 acre dari 16.352 acre luas ladang. Inilah dasar penandaan non-comply."],
      ["CSBACRES", "Luas seluruh ladang (acre)."],
      ["CDL2018 … CDL2025", "Kelas CDL per tahun — di layer ini berupa NAMA kelas (teks), bukan kode."],
      ["F2026_Soy", "Selalu 'Y' — arti belum pasti (rencana/prediksi kedelai 2026?). Pertanyaan ke ADM."],
    ],
  },
  {
    title: "Rel — RailWay (Federal Railroad Administration, 07/2025)",
    rows: [
      ["railusage", "M = jalur utama (45.265 km), O = lainnya: yard, siding, spur (16.145 km), X = kemungkinan tidak aktif (1.433 km, tidak dihitung di analisis jarak)."],
      ["fcode", "20200 = rel; 20201 = rel yard/siding."],
      ["name", "Nama (umumnya nama yard, mis. KIRK YARD)."],
      ["railowner, railownerc", "Pemilik rel dan kodenya."],
      ["railsubdiv", "Subdivisi jalur."],
      ["railclassi", "Kelas rel (selalu 0 di data ini)."],
      ["lengthkm", "Panjang segmen (km)."],
      ["loaddate, source_*", "Tanggal muat dan sumber (FRA Rail Lines 07/2025)."],
      ["MERGE_SRC", "File asal per negara bagian (hasil Merge)."],
    ],
  },
  {
    title: "Sungai — River (USGS National Hydrography Dataset, NHDArea)",
    rows: [
      ["ftype", "Jenis area: 460 StreamRiver (dipakai), 336 CanalDitch, 398 LockChamber, 343 DamWeir, 403 Inundation, 484 Wash, 364 Foreshore, 431 Rapids, 455 Spillway, 461 SubmergedStream, 537 AreaToBeSubmerged, 307 AreaOfComplexChannels, 568 Levee, 312 BayInlet."],
      ["fcode", "Kode rinci (ftype × 100 + subtipe)."],
      ["gnis_id, gnis_name", "Nama geografis (hanya 127 dari 29.959 terisi — mis. lock and dam)."],
      ["areasqkm, elevation", "Luas (km²) dan elevasi."],
      ["visibility, resolution, fdate, permanent_", "Atribut NHD: skala tampil, resolusi, tanggal, ID permanen."],
      ["MERGE_SRC", "File asal per negara bagian."],
    ],
  },
];

const CDL = [5, 26, 1, 24, 36, 37, 176, 61, 2, 3, 4, 141, 142, 143, 190, 195, 152, 111, 121, 122, 123, 124];
const GROUP_OF = (c) =>
  [5, 26, 239, 240, 241, 254].includes(c)
    ? "Kedelai"
    : [1, 12, 13, 225, 226, 228, 237].includes(c)
      ? "Jagung"
      : [36, 37, 58, 59, 60, 62, 176, 224].includes(c)
        ? "Rumput/jerami/padang"
        : c === 61
          ? "Bera"
          : [141, 142, 143, 190].includes(c)
            ? "Hutan / lahan basah berpohon"
            : [63, 64, 65, 81, 82, 83, 87, 88, 92, 111, 112, 121, 122, 123, 124, 131, 152, 195].includes(c)
              ? "Bukan lahan tanam"
              : "Tanaman lain";

const DERIVED_FIELD = [
  ["id", "CSBID"],
  ["a", "Luas ladang (acre)"],
  ["y", "Jumlah musim kedelai 2018–2025 (1–8)"],
  ["c", "Kode CDL 2018–2025, dipisah koma"],
  ["k", "Semua catchment tempat ladang ini masuk, dipisah '|': q40 atau q80r, adm1…, tp1…"],
  ["f", "Bit keanggotaan: 1 = Quincy 0–40 NM, 2 = Quincy 0–80 NM, 4 = elevator ADM mana pun, 8 = pihak ketiga mana pun, 16 = pihak ketiga 6 negara bagian, 32 = juga ada di daftar non-comply"],
  ["r, v", "Jarak (mil) dari titik tengah ladang ke rel aktif terdekat / sistem sungai utama; kosong di luar 7 negara bagian"],
  ["s, n", "Negara bagian (singkatan), county"],
];
const DERIVED_NC = [
  ["id, a, s, n, c, k, f", "Sama dengan ladang comply"],
  ["ch", "Luas perubahan (Change_Acr, acre)"],
  ["b", "Tutupan 2018–2020 di tingkat ladang: treed (hutan/lahan basah berpohon), natural (rumput/semak/lahan basah), crop (sudah lahan tanam)"],
  ["y", "Tahun pertama ladang (tingkat ladang) berubah jadi lahan tanam, 2021–2025"],
  ["s26", "F2026_Soy sesuai kiriman"],
  ["c24, c25", "Nama kelas CDL 2024 dan 2025 dari titik non-comply"],
  ["po", "true = hanya titik, tanpa batas ladang"],
  ["sy", "Jumlah musim kedelai 2018–2025 (kosong untuk titik)"],
  ["r, v", "Jarak (mil) ke rel aktif / sistem sungai utama (kosong di luar 7 negara bagian)"],
  ["ex", "Bagian ladang yang berubah: whole (≥ 90% luas ladang), most (50–90%), part (< 50%) — dari Change_Acr ÷ CSBACRES"],
  ["u", "Penggunaan lahan 2025: crop (lahan tanam), pasture (padang rumput/jerami), nonag (bukan pertanian) — dari kode CDL 2025"],
];

function levelTable() {
  const row = (id, name) => {
    const k = K[id];
    return [esc(name), nf(k.compliant.fields), ha(k.compliant.acres), nf(k.nonCompliant.fields), ha(k.nonCompliant.acres), pct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres)];
  };
  return table(
    ["Cakupan", "Ladang comply", "Luas comply", "Non-comply", "Luas non-comply", "Porsi"],
    [
      row("all", "Level 1 · Quincy, semua pemasok"),
      row("direct", "Level 2 · Langsung ke Quincy (0–80 NM)"),
      row("q40", "   Level 3 · Quincy 0–40 NM"),
      row("q80", "   Level 3 · Quincy 0–80 NM"),
      row("adm", `Level 2 · Elevator ADM (${sites.length} lokasi)`),
      row("tp", `Level 2 · Pihak ketiga (${supply.thirdParty.length})`),
      row("tpcore", "   (subset) Pihak ketiga 6 negara bagian"),
    ],
    "num",
  );
}

function html() {
  const all = K.all;
  const cov = all.compliant.coverageAcres;
  const c5 = all.compliant.corridor["5"];
  const c10 = all.compliant.corridor["10"];
  const ncAll = supply.nonCompliantAll;
  const dated = "30 September 2026";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, "Segoe UI", sans-serif; color: #1d1d1f; font-size: 10pt; line-height: 1.5; margin: 0; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
  .cover .brand { color: #8a5a12; font-weight: 600; font-size: 13pt; }
  .cover h1 { font-size: 30pt; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 12pt; }
  .cover p { color: #424245; font-size: 12pt; max-width: 130mm; }
  .cover .meta { font-size: 9.5pt; color: #6e6e73; }
  h2 { font-size: 16pt; letter-spacing: -0.01em; margin: 18pt 0 6pt; page-break-after: avoid; }
  h2 .n { color: #8a5a12; margin-right: 6pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p { margin: 0 0 6pt; }
  ul { margin: 0 0 6pt 14pt; padding: 0; }
  li { margin: 0 0 2pt; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 8.8pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { text-align: left; font-weight: 600; color: #424245; border-bottom: 1.2pt solid #1d1d1f; padding: 4pt 5pt; }
  td { border-bottom: 0.5pt solid #d2d2d7; padding: 3.5pt 5pt; vertical-align: top; }
  table.num td:not(:first-child), table.num th:not(:first-child) { text-align: right; white-space: nowrap; }
  td:first-child { white-space: pre-wrap; }
  code { font-family: Consolas, "SF Mono", monospace; font-size: 8.6pt; background: #f5f5f7; padding: 0 2pt; border-radius: 2pt; }
  .box { background: #f6eedf; border-radius: 4pt; padding: 8pt 10pt; margin: 6pt 0 10pt; }
  .box.grey { background: #f5f5f7; }
  figure { margin: 6pt 0 12pt; page-break-inside: avoid; }
  figure img { width: 100%; border: 0.5pt solid #d2d2d7; border-radius: 4pt; }
  figcaption { font-size: 8.5pt; color: #6e6e73; margin-top: 3pt; }
  .tree { font-family: Consolas, monospace; font-size: 9pt; background: #f5f5f7; border-radius: 4pt; padding: 8pt 10pt; white-space: pre; line-height: 1.45; }
  .page { page-break-before: always; }
</style></head><body>

<section class="cover">
  <div>
    <p class="brand">SoyTrace · Earthline — dokumen internal</p>
    <h1>Panduan Data<br>Rantai Pasok Kedelai Quincy</h1>
    <p>Isi data kiriman ADM (ADM_SOY.gdb), glossary tiap atribut, data turunan yang dipakai SoyTrace, metode, cara memakai workspace, dan cara memperbarui data.</p>
  </div>
  <div class="meta">
    Versi ${dated} · untuk tim Earthline (bukan untuk dikirim ke klien apa adanya)<br>
    Sumber: ADM_SOY.gdb (diterima 30 Sep 2026) · USDA NASS Crop Sequence Boundaries 2018–2025 · FRA Rail Lines 07/2025 · USGS NHD<br>
    Dibuat otomatis oleh <code>scripts/build-soy-guide.mjs</code> dari <code>supply.json</code>
  </div>
</section>

<h2><span class="n">1</span>Gambaran singkat</h2>
<p>ADM ingin melihat dari mana kedelai untuk pabrik crushing <b>Quincy, Illinois</b> berasal, dan seberapa besar ladang yang <b>tidak comply EUDR</b> dibanding seluruh pasokan. Masalah awalnya: tim GIS internal ADM menggambar ladang non-comply sebagai titik, sehingga di layout terlihat jauh lebih besar dari luas sebenarnya. SoyTrace menggambar setiap ladang dengan batas aslinya dan membandingkan luas secara langsung.</p>
<p>Pabrik Quincy menerima kedelai dari tiga arah, dan SoyTrace menyusunnya bertingkat seperti PalmTrace (portofolio → grup → PKS → plot):</p>
<div class="tree">Level 1  ADM Quincy (pabrik crushing)
│
├─ Level 2  Langsung ke Quincy ........ catchment 40 & 80 NM dari pabrik
│   ├─ Level 3  Quincy 0–40 NM
│   └─ Level 3  Quincy 0–80 NM
├─ Level 2  Elevator ADM (${sites.length} lokasi) ... catchment 20 NM per lokasi
│   └─ Level 3  satu elevator (mis. ADM Grain - Burlington)
└─ Level 2  Pihak ketiga (${supply.thirdParty.length}) ........ catchment 32 km (20 mil) per fasilitas
    └─ Level 3  satu fasilitas (mis. Cargill, Lauderdale TN)

Ladang hanya dimuat dan digambar di level 3 (satu catchment = satu file).</div>
<div class="box"><b>Angka kunci.</b> ${nf(all.compliant.fields)} ladang kedelai comply (${ha(all.compliant.acres)}) di seluruh catchment; ${nf(all.nonCompliant.fields)} ladang non-comply (${ha(all.nonCompliant.acres)}, luas yang benar-benar berubah ${ha(all.nonCompliant.changeAcres)}) = <b>${pct(all.nonCompliant.acres, all.compliant.acres + all.nonCompliant.acres)}</b> dari luas. Daftar non-comply ADM total ${nf(ncAll.fields)} ladang di ${ncAll.byState.length} negara bagian; ${nf(ncAll.fields - all.nonCompliant.fields)} di antaranya berada di luar semua catchment.</div>

<h2><span class="n">2</span>Satuan jarak — keputusan penting</h2>
<p>ADM meminta catchment dalam <b>mil laut (NM)</b>, sesuai buffer kirimannya (keputusan 1 Okt 2026, menggantikan keputusan mil biasa sehari sebelumnya). SoyTrace memakai radius buffer ADM persis (BUFF_DIST):</p>
${table(
  ["Catchment", "Buffer ADM", "Radius SoyTrace", "Keterangan"],
  [
    ["Quincy 40", "40 NM · 74,1 km", "40 NM · 74,1 km", "sama"],
    ["Quincy 80", "80 NM · 148,2 km", "80 NM · 148,2 km", "sama"],
    ["Elevator ADM", "20 NM · 37,1 km", "20 NM · 37,1 km", "sama"],
    ["Pihak ketiga", "“20NM” · 32,2 km", "17,4 NM · 32,2 km (= 20 mil biasa)", "nama layer NM, buffer mil biasa"],
  ],
)}
<p>Layer pihak ketiga bernama “20NM” tapi buffernya 32.187 m = 20 mil biasa, dan ladang pihak ketiga yang dikirim hanya sampai jarak itu — lingkaran 20 NM (37 km) tidak bisa diisi dari data ini, jadi dipakai apa adanya (perlu dikonfirmasi ke ADM). Jarak ke rel dan sungai (transport) tetap dalam mil biasa. Keanggotaan ladang dihitung ulang dengan aturan §6: pihak ketiga ${nf(K.tp.compliant.fields)} ladang vs 295.773 di set klien.</p>

<h2 class="page"><span class="n">3</span>Isi ADM_SOY.gdb</h2>
<p>Lokasi: <code>Kanopi 0.0.13\\Data Storage\\ADM Soy\\Data Backup\\ADM_SOY.gdb</code>. Proyeksi semua layer: <b>USA Contiguous Albers Equal Area Conic (ESRI:102003)</b>, satuan meter.</p>
${table(["Layer", "Geometri", "Jumlah", "Isi", "Dipakai di SoyTrace"], LAYERS.map(([a, b, n, d, u]) => [code(a), esc(b), nf(n), esc(d), esc(u)]))}

<h2 class="page"><span class="n">4</span>Glossary atribut</h2>
${GLOSS.map((g) => `<h3>${esc(g.title)}</h3>${table(["Atribut", "Arti"], g.rows.map(([a, b]) => [code(a), esc(b)]))}`).join("")}
<h3>Kode kelas CDL yang sering muncul</h3>
<p>CDL (Cropland Data Layer, USDA NASS) memberi satu kelas tutupan lahan per piksel 30 m per tahun; CSB merangkumnya per ladang. Pengelompokan di kolom kanan adalah yang dipakai grafik SoyTrace.</p>
${table(["Kode", "Nama (USDA)", "Kelompok di SoyTrace"], CDL.map((k) => [String(k), esc(soy.cdlNames[String(k)] ?? "—"), GROUP_OF(k)]))}

<h2 class="page"><span class="n">5</span>Data turunan di SoyTrace</h2>
<p>Dibangun oleh <code>scripts/prepare-adm-soy-supply.py</code> (Python sistem: fiona, shapely, pyproj) ke <code>private-data/tenants/adm-soy/</code>, lalu diunggah ke bucket R2 soy.</p>
${table(
  ["File", "Isi"],
  [
    [code("supply.json"), "Titik pabrik/elevator, radius (mil) + buffer klien, statistik tiap catchment (ladang, luas, riwayat tanaman, musim kedelai, county, jarak rel/sungai, non-comply), grid kepadatan, daftar file unit. Dibundel di server."],
    [code("fields/units/<id>.geojson"), `Ladang satu catchment (seperti file plot per PKS): q40, q80r, adm&lt;n&gt;, tp&lt;n&gt; — ${supply.units.length} file. 0–80 NM tidak punya file sendiri: dimuat dari q40 + q80r. Satu ladang bisa ada di beberapa file.`],
    [code("fields/noncomply.geojson"), `Semua ladang non-comply (batas asli, termasuk 8 poligon tambahan 1 Okt) + ${nf(supply.nonCompliantAll.pointOnly)} titik yang masih tanpa poligon.`],
    [code("layers/rail.geojson, rivers.geojson"), "Rel FRA dan area sungai NHD (disederhanakan untuk web)."],
    [code("layers/corridors.geojson"), "Pita 5 dan 10 mil di sekitar rel aktif dan sistem sungai utama."],
  ],
)}
<h3>Atribut ladang di file unit</h3>
${table(["Atribut", "Arti"], DERIVED_FIELD.map(([a, b]) => [code(a), esc(b)]))}
<h3>Atribut ladang non-comply</h3>
${table(["Atribut", "Arti"], DERIVED_NC.map(([a, b]) => [code(a), esc(b)]))}
<h3>ID catchment</h3>
${table(
  ["ID", "Level", "Arti"],
  [
    [code("all"), "1", "Quincy — semua pemasok (gabungan semua catchment)"],
    [code("direct"), "2", "Langsung ke Quincy, 0–80 NM"],
    [code("adm"), "2", "Semua elevator ADM"],
    [code("tp"), "2", "Semua pihak ketiga"],
    [code("tpcore"), "2 (statistik saja)", "Pihak ketiga di IL, IA, MO, KY, MN, IN (56)"],
    [code("q40"), "3", "Quincy 0–40 NM"],
    [code("q80r"), "—", "Hanya file bahan (ladang 40–80 NM) untuk memuat 0–80 NM; tidak ditampilkan sebagai cakupan"],
    [code("q80"), "3", "Quincy 0–80 NM (gabungan q40 + q80r; statistiknya = direct)"],
    [code("adm1 … adm15"), "3", "Satu lokasi elevator ADM (Evansville: 3 titik, 1 catchment)"],
    [code("tp1 … tp98"), "3", "Satu fasilitas pihak ketiga"],
  ],
)}

<h2 class="page"><span class="n">6</span>Metode</h2>
<ul>
  <li><b>Catchment</b> = lingkaran buffer ADM dari titik fasilitas: Quincy 40 / 80 NM, elevator ADM 20 NM, pihak ketiga 32,2 km (proyeksi ESRI:102003).</li>
  <li><b>Keanggotaan ladang</b>: ladang masuk catchment bila batas ladangnya menyentuh lingkaran, diambil dari set klien untuk tier-nya (Quincy dari CP_Compliant_Polygons_80NM, elevator dari Compliant_Elevator_ADM_Polygons, pihak ketiga dari ThirdParty_Compliant_Polygons). Ladang non-comply dengan cara yang sama (titik tanpa poligon: bila di dalam lingkaran).</li>
  <li><b>0–80 NM</b> dimuat dari dua file: 0–40 NM dan sisanya (q80r). Angka 40–80 NM sendiri tidak ditampilkan (keputusan 1 Okt) supaya tidak rancu.</li>
  <li><b>Gabungan cakupan</b> (statistik per cakupan, “Susun gabungan sendiri”, peta <code>combo:…</code>): ladang dikelompokkan menurut kombinasi catchment-nya (<code>supply.combos</code>), jadi gabungan apa pun dihitung tanpa ladang dobel.</li>
  <li><b>Comply / non-comply</b> adalah klasifikasi ADM; SoyTrace tidak menilai ulang. Luas non-comply = seluruh ladang; luas perubahan (Change_Acr) ditampilkan di sampingnya. 172 ladang non-comply sudah berupa lahan tanam di tingkat ladang sejak 2018 — mereka ditandai karena sebagian kecil ladangnya berubah.</li>
  <li><b>Tutupan 2018–2020 dan tahun pertama ditanami</b> dihitung dari seri CDL tingkat ladang (hutan/lahan basah berpohon: 141, 142, 143, 190; alami lain: 152, 176, 195, 62, 64).</li>
  <li><b>Jarak ke rel</b>: garis lurus dari titik tengah ladang ke rel aktif terdekat (railusage M dan O; X tidak dihitung).</li>
  <li><b>Jarak ke sungai</b>: ke <i>sistem sungai utama</i> — setiap kumpulan area sungai NHD (StreamRiver, kanal, lock, dam) yang saling tersambung seluas ≥ 50 km²: ${supply.network.riverSystems ?? 12} sistem, ${nf(supply.network.riverSystemKm2)} km² (Mississippi, Missouri, Ohio, Illinois, Tennessee, dll.). Danau/waduk di sungai (mis. Lake Pepin) adalah NHD Waterbody, bukan area sungai, sehingga memutus sungai jadi beberapa sistem.</li>
  <li><b>Cakupan data rel/sungai</b>: hanya IL, IN, IA, KY, MN, MO, WI. Ladang di negara bagian lain tidak punya jarak dan tidak dihitung di analisis rel & sungai.</li>
</ul>

<h2><span class="n">7</span>Angka per level</h2>
${levelTable()}
<p>Rel & sungai (semua catchment, ${ha(cov)} ladang comply di 7 negara bagian): dalam 5 mil dari rel ${pct(c5.rail, cov)}, dari sungai ${pct(c5.river, cov)}, dari salah satunya ${pct(c5.either, cov)}; dalam 10 mil dari salah satunya ${pct(c10.either, cov)}. Dari ${supply.admElevators.length} titik elevator ADM, ${supply.admElevators.filter((e) => e.railMi <= 1).length} berada ≤ 1 mil dari rel aktif dan ${supply.admElevators.filter((e) => e.riverMi <= 1).length} ≤ 1 mil dari sistem sungai utama; pabrik Quincy ${nf(supply.plant.railMi, 1)} mil dari rel dan ${nf(supply.plant.riverMi, 1)} mil dari sungai.</p>

<h2 class="page"><span class="n">8</span>Cara memakai SoyTrace</h2>
<p>Buka <code>kanopi-ochre.vercel.app/login?product=soy</code>, masuk dengan akun ADM Soy (<code>adm-soy-1..3</code>, lihat <code>artifacts/akun-adm-soy.csv</code>) atau akun admin Earthline lalu pilih klien “ADM Soy” di header.</p>
<h3>Header</h3>
<ul>
  <li><b>Tab</b>: Ringkasan · Peta & data · Rel & sungai · Data & metode · Wilayah 40 mil (tampilan lama: lima pabrik ADM, kiriman sebelumnya).</li>
  <li><b>Presentasi</b>: menyembunyikan pemilih bahasa/klien dan catatan internal (pertanyaan ke ADM) — pakai saat berbagi layar ke klien.</li>
  <li>Pilihan cakupan berlaku di semua tab (disimpan di browser).</li>
  <li><b>Panduan singkat</b> (8 langkah) muncul sekali setiap login, tidak saat refresh; bisa dilewati, dan diputar ulang lewat tombol <b>?</b> di header.</li>
  <li>Persentase selalu dua sisi: porsi comply dan porsi non-comply (luas maupun jumlah poligon).</li>
</ul>
<ul>
  <li><b>Satuan</b>: luas dalam <b>acre</b> (ha hanya sebagai angka kedua), jarak dalam mil — sesuai permintaan ADM.</li>
  <li><b>Mengapa non-comply</b> (Ringkasan): berapa ladang yang berubah seluruhnya / sebagian besar / sebagian kecil, total luas berubah dibanding luas ladang, dan penggunaan lahan 2025 (pertanian atau bukan).</li>
  <li><b>Susun gabungan sendiri</b> dan <b>Statistik per cakupan</b> (Ringkasan): Quincy 0–40 / 0–80 NM, elevator ADM (semua atau pilih), gabungannya, pihak ketiga. Klik baris untuk membuka rinciannya (per catchment, ladang non-comply: seluruh/sebagian, penggunaan 2025, negara bagian) lalu “Buka di peta” — peta menampilkan catchment-catchment itu beserta semua ladangnya (pihak ketiga: daftar, karena terlalu banyak ladang).</li>
  <li><b>Comply vs non-comply per fasilitas</b> (Ringkasan): seluruh rantai pasok, pabrik Quincy (0–80 dan 0–40 NM), 13 elevator ADM dan 98 pihak ketiga — jumlah poligon dan acre comply/non-comply, % masing-masing, acre terdeforestasi; filter tipe, cari, unduh CSV.</li>
</ul>
${img("summary", "Ringkasan: KPI cakupan terpilih, tabel perbandingan luas dengan skala sebenarnya, analisis non-comply.")}
<h3>Peta & data — navigasi bertingkat</h3>
<ul>
  <li><b>Level 1</b> (Quincy): panel kanan menampilkan KPI total dan tiga tipe pemasok. Peta menampilkan titik, lingkaran catchment dan grid kepadatan kedelai (porsi luas tiap sel; makin di-zoom makin rapat: 0,2° → 0,1° → 0,05° → 0,025°) — belum ada ladang.</li>
  <li><b>Kartu Layer</b> (kiri atas): satu kartu untuk menyalakan/mematikan layer sekaligus legendanya. Ladang non-comply saat zoom jauh ditandai titik merah berpijar (penanda lokasi, bukan ukuran); semua 1.081 ladang di daftar ADM selalu tampil; batas aslinya muncul mulai zoom 11.</li>
  <li><b>Level 2</b> (klik tipe pemasok): hanya lingkaran tipe itu yang tampil; daftar catchment di panel (pihak ketiga bisa dicari dan difilter “6 negara bagian”).</li>
  <li><b>Level 3</b> (klik satu catchment): file ladangnya dimuat — hanya ladang catchment itu yang digambar. Panel berisi KPI, fakta (radius mil + buffer klien, jarak rel/sungai), tombol tabel ladang dan unduhan.</li>
  <li>Kembali ke atas dengan tautan “‹ …” di panel.</li>
</ul>
${img("l1", "Level 1 — Quincy dan tiga tipe pemasok.")}
${img("l2-direct", "Level 2 — Langsung ke Quincy: lingkaran 40 & 80 NM; pilihan 0–40 dan 0–80 NM.")}
${img("l3-adm", "Level 3 — satu elevator ADM: hanya ladangnya yang tampil.")}
<h3>Tabel ladang, kartu detail, cari, unduh</h3>
<ul>
  <li><b>Buka tabel ladang</b>: laci di bawah peta; filter Semua / Non-comply / Comply, cari ID ladang atau county, 100 baris per halaman. Klik baris → peta terbang ke ladang dan kartu detail terbuka.</li>
  <li><b>Dalam tampilan peta</b> (bawah tengah peta): luas kedelai, luas terdeforestasi (Change_Acr) dan porsinya untuk area yang sedang terlihat — dihitung ulang tiap peta digeser/di-zoom. Level 1–2: seluruh rantai pasok, luas kedelai dari grid (≈); level 3: angka persis catchment itu.</li>
  <li><b>Kartu detail</b>: luas (acre · ha), catchment, musim kedelai, jarak rel/sungai, koordinat (tautan Google Maps), tanaman per tahun; untuk non-comply juga luas perubahan, tutupan 2018–2020, tahun pertama ditanami, F2026_Soy, bagian yang berubah (seluruh/sebagian, acre dan %), penggunaan 2025.</li>
  <li><b>Cari</b> (kiri atas): ID ladang (di catchment yang sedang dimuat) atau koordinat “lat, lon”.</li>
  <li><b>Peta dasar</b> (kiri bawah): Esri, Google, OSM, Sentinel-2 2020 dan 2026 — bandingkan kondisi sebelum/sesudah batas EUDR.</li>
  <li><b>Unduh</b> (panel): ladang non-comply (CSV/GeoJSON) cakupan terpilih, ladang comply yang dimuat (CSV, level 3), ringkasan semua catchment (CSV).</li>
</ul>
${img("l3-table", "Tabel ladang dan kartu detail.")}
<h3>Rel & sungai</h3>
<p>Tata letaknya sama dengan Peta & data (peta penuh, panel bertingkat). Di panel: pilih jarak (≤ 5 / 10 / 20 mil) dan dasar (rel atau sungai / rel / sungai); KPI menunjukkan luas kedelai comply dalam jarak itu, dan tiap baris daftar menampilkan persentasenya. Di level 3 ladang diwarnai menurut jarak. Hanya 7 negara bagian yang dicakup data rel/sungai.</p>
${img("corridor", "Tab Rel & sungai.")}

<h2 class="page"><span class="n">9</span>Memperbarui data</h2>
<ol>
  <li>Taruh gdb baru di <code>Data Storage\\ADM Soy\\Data Backup\\ADM_SOY.gdb</code> (nama layer sama).</li>
  <li><code>python scripts/prepare-adm-soy-supply.py</code> (±17 menit; Python sistem — ArcGIS Python sedang bermasalah).</li>
  <li><code>node --env-file=.env.local scripts/upload-soy-fields-to-r2.mjs</code> (bucket R2 soy di akun Cloudflare terpisah; file yang tidak berubah dilewati, file usang dihapus).</li>
  <li><code>npm run build</code> lalu deploy (preview dulu; production hanya setelah persetujuan).</li>
  <li>Dev lokal: kosongkan <code>R2_*</code> dan <code>R2_ADM_SOY_*</code> saat menjalankan vite supaya data dibaca dari disk.</li>
  <li>Dokumen ini: <code>node scripts/build-soy-guide.mjs</code> (butuh dev server untuk screenshot; <code>--no-shots</code> tanpa gambar).</li>
</ol>

<h2><span class="n">10</span>Catatan data & pertanyaan ke ADM</h2>
<ul>
  <li>Buffer pihak ketiga: nama layer “20NM” tapi radius 32,2 km (20 mil biasa). Apakah seharusnya 20 NM (37 km)? Kalau ya, ADM perlu mengirim ulang ladang pihak ketiga sampai 37 km.</li>
  <li>8 titik non-comply datang tanpa poligon; 3 sudah ditemukan di CSB nasional (kedelai 2025), 5 sisanya (jagung 2025) perlu poligon dari ADM atau CSB nasional lengkap.</li>
  <li>Arti <code>F50</code> / <code>F100</code> (pabrik & elevator) dan <code>F2026_Soy</code> (titik non-comply).</li>
  <li><code>railusage = X</code> (1.433 km): benarkah jalur tidak aktif?</li>
  <li>${nf(ncAll.alsoCompliant)} ID ladang ada di daftar comply sekaligus non-comply; ${nf(ncAll.pointOnly)} titik non-comply tanpa poligon.</li>
  <li>Sebagian “pihak ketiga” sebenarnya pabrik crushing (Platinum Crush, Norfolk Crush, Oxbow Crush, NDSP/SDSP) — apakah memasok Quincy?</li>
  <li>Data kotor kecil: “St. Lousi”, “Iowa\\r\\n”, singkatan & nama negara bagian campur, satu elevator ADM tanpa atribut koordinat, County elevator ADM hampir kosong.</li>
  <li>Tab “Wilayah 40 mil” berasal dari kiriman ADM sebelumnya (lima pabrik); angkanya tidak sama dengan data Quincy ini.</li>
</ul>
</body></html>`;
}

const browser = await chromium.launch();
try {
  if (SHOTS) {
    console.log("[soy-guide] screenshots from", BASE);
    await takeShots(browser);
  }
  const page = await browser.newPage();
  const doc = html();
  if (arg("--html")) writeFileSync(arg("--html"), doc);
  await page.setContent(doc, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({
    path: OUT,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font:8px Inter,Segoe UI,sans-serif;color:#86868b;padding:0 16mm;display:flex;justify-content:space-between"><span>SoyTrace · Panduan data Quincy · internal</span><span class="pageNumber"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
  });
  console.log("[soy-guide]", path.relative(ROOT, OUT));
} finally {
  await browser.close();
}
