# Perjalanan Kanopi & PalmTrace

Catatan berjalan (living document) untuk melacak evolusi project Kanopi dari
waktu ke waktu, termasuk PalmTrace. **Update setiap ada milestone baru** —
jangan biarkan basi.

## Apa ini

- **Kanopi** — platform traceability rantai pasok sawit ("Satellite Powered
  Traceability with AI Analytics" per tagline saat ini), fokus ke kepatuhan
  EUDR: pemetaan plot, status compliance per plot/mill, risk level, mitigasi.
- **PalmTrace** — bagian eksperimental dari Kanopi. Belum ditemukan jejaknya
  di kode atau git history per catatan ini ditulis (2026-09-22). *Bagian ini
  perlu diisi manual: cakupan eksperimennya apa, tujuannya, dan relasi
  persisnya ke roadmap Kanopi.*

## Garis waktu

### 2026-09-08 — Titik awal repo
- `e5a466f` Initial snapshot: baseline produksi yang cocok dengan yang live
  di Vercel — repo Git-nya baru dimulai dari titik ini, bukan dari awal mula
  project (histori sebelumnya ada, tapi di luar apa yang bisa dilacak dari
  git repo ini).
- Perbaikan menyusul cepat: PWA manifest name, alasan non-compliance di
  popup plot (Desc_Issue → label kode hutan yang bisa dibaca), lokasi plot
  (Desa/Kecamatan/Kabupaten + link Google Maps) di popup & tabel, popup plot
  diganti jadi detail deck di sisi kanan + pagination & filter kolom tabel.

### 2026-09-14 — Data quality & rebuild mill-list SJIM
- `efae481` Chart EUDR sekarang warning dulu (bukan nampilin chart
  kosong/menyesatkan) kalau data plot belum lengkap.
- `74502f2` **Rebuild total mill-list SJIM** dari sumber otoritatifnya
  sendiri (bukan nge-patch field refinery doang di atas data umum). Hasil:
  198 mill (dari 214), 5 nama crusher asli (sebelumnya 4 kode, salah
  satunya — "SJIM" — ternyata gabungan 2 crusher berbeda: Lampung & Sampit).
  Detail lengkap: [sjim.md](sjim.md).

### 2026-09-15 — Platform & storage
- `896fe73` App dilepas dari platform Grok App Builder (decouple).
- `1fbc1f0` Storage plot pindah dari Vercel Blob ke Cloudflare R2.
- `b0e7890` Data plot di-key per mill id sendiri, keluar dari SSR bundle.
- `860c52d` Tagline resmi: "Satellite Powered Traceability with AI
  Analytics".
- `496c422` Tambah akun admin kedua.

### 2026-09-16 — Polish UI
Carousel ringkasan mill di sidebar, loading overlay saat plot mill lagi
dimuat, animasi masuk untuk panel/card, tabel plot & panel data jadi
resizable, smoke test regresi persisten buat data plot + role scoping, fix
DOMAS yang area-nya kebaca nol (masalah casing `Hectarage`), UI membedakan
"belum ada data plot" vs "gagal dimuat".

### 2026-09-17 — Ingest YORGO + MULTIAGRO/PULAU DOGOM
- `a367c40` Ingest data plot YORGO (22 dari 25 mill).
- `5e009b5` PlotID YORGO yang collision di-resolve (bukan nahan 2 mill itu).
- `da6da28` / `1b7da3f` MULTIAGRO SUMATERAJAYA (PULAU DOGOM) — mill yang
  sama muncul di 3 chain (Permata/DOMAS/YORGO); data DOMAS-nya di-ingest
  lalu di-mirror ke slot YORGO karena batch asli YORGO ternyata salah
  atribusi.
- Semua 25 mill YORGO di mills.json sekarang punya data plot.

### 2026-09-18 — SJIM: ingest plot + tutup gap
- `64c82b3` **Ingest plot SJIM (188 dari 192 mill)** — drop data SJIM beda
  dari YORGO/DOMAS (nggak ada PlotID/NodeID bawaan), plus nemu & fix 2 bug
  produksi nyata di sepanjang jalan.
- `35ea330` Deploy Vercel sempat gagal ("fetch failed") karena
  `private-data/plots` (2.6GB gara-gara SJIM) ternyata belum benar-benar
  dikecualikan dari upload source — di-fix.
- `afbc9e6` **AGRO ANDALAN** (mill SJIM yang sempat kelewat) berhasil
  di-match via cross-check GDB master → 189/192 mill SJIM matched.

Detail lengkap ketiga commit di atas: [sjim.md](sjim.md).

### 2026-09-23 — Ingest BNS
- `scripts/prepare-bns-plots.mjs` — drop `Data Storage/BNS - Plot (GeoJSON)/`
  (24 file, roster BNS di mills.json ada 33 mill). Beda dari SJIM: file BNS
  sendiri sudah bawa `UML_ID`/`Mill_name` yang bisa dipercaya (cross-check ke
  mills.json ketemu 0 mismatch, basename file juga match langsung ke
  `millName` tanpa perlu NAME_OVERRIDES) — tapi tetap nggak ada `PlotID`/
  `NodeID` bawaan, jadi keduanya di-mint dengan skema yang sama seperti SJIM.
  Hectarage-nya pakai `ha` (fallback yang sama dengan SJIM, sudah ada di
  `ledger-geo.ts`).
- Hasil: **67.699 plot** across 24 mill, 661 duplikat exact di-drop. 9 mill
  BNS sisanya di mills.json memang belum ada file plot-nya (normal — belum
  di-upload, bukan gap yang perlu diinvestigasi kayak kasus SJIM).
- Di-upload ke R2 (`npm run upload:plots`) bareng seluruh isi
  `private-data/plots/` yang sudah ada (idempotent, PUT re-overwrite key yang
  sama) — total korpus plot sekarang ~4.2GB/406 file lintas semua grup
  (Permata/DOMAS/YORGO/SJIM/BNS).

### 2026-09-24 — Paket upload TRACT buat BNS
- `scripts/export-bns-tract.py` — bikin paket siap-upload TRACT dari plot BNS
  yang sudah ada di Kanopi (`private-data/plots/*__BNS__*`), output ke
  `Data Storage/BNS - TRACT Upload - Ready/` (`GeoJSON/<mill>.geojson` +
  `Master Data/farmer_group_master_data_<mill>_BNS.xlsx` + `_export_report.csv`).
  Aturannya disamain dengan ronde TRACT SJIM (`SJIM_PIPELINE_NOTES.md`): cuma
  plot `EUDR_Comply = YES`, geometri lewat cleaner "brutal" yang sama (isi
  hole, buang part < 0,02 ha / sliver < 1,5 m / nested / fitur < 0,1 ha),
  ring dipaksa counter-clockwise, data Excel di row 3. Template Excel TRACT
  (v5) yang bersih disimpan di `Data Storage/TRACT Templates/`.
- PlotID tetap PlotID Kanopi, jadi error report / laporan defo dari TRACT
  bisa langsung dipetakan balik ke plot Kanopi.
- **KENANGA MILL** (PO1000016377) sudah terdaftar di TRACT sebagai node SJIM
  (`2026-IDN-1000016377-1`). Per keputusan user: NodeID itu dipakai apa
  adanya (nggak bikin `-2`), dan master data-nya **nggak** dibuat/di-upload
  karena node-nya sudah ada — cuma GeoJSON plotnya yang diekspor. Jadi paket
  ini isinya 24 GeoJSON + 23 master data.
- Hasil: 24 mill, 56.763 plot patuh → **50.332 plot diekspor, 469.667 ha**
  (99,8% luas patuh; yang kebuang hampir semuanya plot < 0,1 ha, total cuma
  ~141 ha).
- Ronde upload pertama (10 mill pertama, urut nama): 8 file ditolak TRACT,
  84 plot "Boundary has self-intersections", padahal valid menurut shapely.
  Ketemu penyebabnya: **TRACT ngecek geometri di presisi 6 desimal** —
  83/84 plot itu jadi self-intersect kalau dibulatkan ke 6 desimal (leher/
  spike sempit, sisi berseberangan cuma ~2 cm), sementara 0 dari 320 plot yang
  lolos begitu. Fix: koordinat di-snap-round ke grid 6 desimal pakai GEOS
  `set_precision` + tiap ring diverifikasi di grid itu. Semua 84 plot
  keperbaiki (0 dibuang), 50.332 plot tetap. Catatan: `GeometryIndex` di error
  report TRACT itu 1-based.
- Ronde 2 (upload ulang 8 file tadi): 14 plot masih ditolak, dan **semuanya
  MultiPolygon yang bagian-bagiannya saling nempel** (efek samping snap: leher
  yang lebih sempit dari grid kebelah jadi 2 bagian yang share 1 vertex) —
  TRACT juga nganggep itu self-intersection. Ternyata ke-33 MultiPolygon di
  seluruh output kena masalah yang sama. Closing (dilate→erode) nggak mempan
  (nggak ngelebarin leher, pas di-snap kebelah lagi); fix-nya bagian yang
  lebih kecil dipotong 0,5 m di sekitar bagian yang lebih besar, jadi ada
  celah jelas (min 0,44 m). 0 plot dibuang, luas praktis nggak berubah.
- Ronde 3: lolos validasi geometri, tapi tahap analisis TRACT nolak 1 plot
  BANYUASIN — "Insufficient area ... geometry 2: 0.0000 ha < 0.001 ha"
  (serpihan sisa snap/potong di bagian ke-2 MultiPolygon). Report tahap ini
  formatnya beda: `final_error_report_<uuid>.csv`, kolom `PlotId`/`NodeId`,
  nama file-nya nggak bawa nama mill (mill-nya ketahuan dari UML_ID di
  PlotID). Fix: setelah snap/potong, bagian < 0,02 ha (batas part cleaner
  sendiri) dibuang lagi — ada 7 bagian begitu (3 di bawah 0,001 ha). 0 plot
  dibuang, luas turun 0,02 ha.
- Laporan deforestasi TRACT (`Deforestation Report/Defo Report.html`, format
  sama dengan SJIM): **5.116 plot ditandai** di 23/24 mill (cuma BUMI
  KHATULISTIWA yang bersih), ±48.877 ha. Script ekspor sekarang baca semua
  HTML di folder itu dan ngeluarin PlotID yang ditandai dari GeoJSON + luas
  master data (daftarnya di `_tract_defo_excluded.csv`), jadi tetap berlaku
  tiap re-run. Hasil: **45.216 plot, 420.790 ha**.
- **Catatan buat keputusan ambang 0,5 ha:** 2.772 dari plot yang ditandai
  TRACT itu plot yang di data kita cuma punya deforestasi < 0,5 ha/tahun
  (yang di-flip jadi compliant oleh `apply-bns-defo-threshold.mjs`) — 77%
  dari semua plot ekspor yang punya Def > 0. Jadi TRACT nggak sepakat sama
  ambang itu. 2.344 sisanya di data kita malah Def = 0 (TRACT pakai sumber
  deforestasi sendiri).
- Keputusan user: drop plot yang ditandai defo TRACT itu **khusus buat
  paket TRACT** — Kanopi tetap pakai data lengkap (67.699 plot BNS, termasuk
  plot yang ditandai; di Kanopi masih tampil sesuai `EUDR_Comply` hasil
  analisis kita sendiri).
- Riwayat upload TRACT (`Upload Report.html`, halaman 1 dari tabel file
  history) dipakai buat ngisi sheet `BNS` di `Temporary Database\TRACT
  Recap.xlsx` (tanggal, ID on TRACT, nama file master data/GeoJSON yang
  terakhir SUCCESS, status defo per mill, upload status); 4 mill yang
  belum ada di sheet (HAMITA, KENANGA, SURYA BUMI, TENGKALAT) ditambahin.
  Ketauan juga master data **GARUDA BUMI PERKASA & SAWINDO KENCANA FAILED**
  — dua-duanya ternyata sudah jadi node SJIM di TRACT sejak 2026-09-18
  (mills.json nggak nyatet NodeID SJIM-nya), jadi diperlakukan sama kayak
  KENANGA: node lama dipakai, master data BNS nggak dibuat. Paket TRACT
  sekarang 24 GeoJSON + 21 master data.
- 2026-09-25 — **Reuse plot buat mill BNS yang nggak punya data plot**
  (instruksi user): buffer 20 km dari koordinat mill (`D:\000 Work\000
  Databases\UML.xlsx`), plot paket TRACT BNS yang masuk penuh ke buffer
  disalin, lalu UML_ID/nama mill/NodeID diganti ke mill itu dan PlotID
  di-mint ulang (skema sama, `2609`; PlotID asal disimpan di
  `Source_PlotID`). Hasil: TAMA BUANA JAYA 312 plot/947 ha, BANKA AGRO
  PLANTARI 1.624/5.882 ha, BHUMI PALMINDO KENCANA 2.576/16.820 ha (semua
  dari BUMI SAWIT + PUTERA BANGKA TANI). **MANGSANG** nggak punya plot
  apa pun dalam 20 km (scan semua 406 file plot Kanopi; terdekat 23 km), jadi
  per user pakai **30 km**: satu-satunya plot di radius itu punya SJIM AGRO
  SINERGI SUKSES ABADI — sumbernya file SJIM yang *sudah di TRACT* (versi
  `Dropped_Deforestation`, setelah drop defo TRACT 10/09; disalin ke
  `Data Storage/TRACT Reuse Sources/`), lewat `clean()` yang sama →
  **234 plot, 2.924 ha**. Filter defo sekarang juga ngecek PlotID baru hasil
  reuse. Paket sekarang 28 GeoJSON + 25 master data (`_reuse_report.csv`).

### 2026-09-25 — Akun login per grup supplier
- Akun `supplier` bersama (dulu cuma lihat Permata KIM) diganti **11 akun,
  satu per grup** (`group` di mills.json): `bns`, `domas`, `fgv`,
  `hok-huat`, `jinlee`, `nam-lts`, `permata`, `sehcom`, `sjim`, `sunrise`,
  `yorgo`. Tiap akun lihat semua refinery/KCP grupnya sendiri (mis.
  `permata` = KIM + PAA Duri + HUTALOMBANG + NBK), nggak bisa lihat grup
  lain — dicek di server (mills.json, file plot/area, EUDR summary).
- Password supplier **nggak** disimpan di repo, cuma hash scrypt-nya di
  `src/lib/gate.ts`. Password asli dikasih sekali (file lokal
  `artifacts/akun-supplier.csv`, di luar git & deploy). Tambah grup /
  ganti password: `node scripts/hash-gate-password.mjs <username>`.
- Total akun sekarang 17: 2 admin, 3 client (ADM), 11 supplier, 1 auditor
  (auditor masih Permata KIM saja).
- Nama platform di tampilan diganti dari "Kanopi" jadi **"Earthline's
  PalmTrace"**: judul tab, halaman login, header, share card, nama app saat
  di-install ke HP, dan nama file unduhan (`palmtrace-<mill>-…`). Nama
  internal di kode (folder, fungsi, env var `KANOPI_*`, cookie, key
  localStorage) sengaja nggak diubah biar sesi & preferensi user tetap jalan.

### 2026-09-25 — Feedback ADM #1 (Roland Sinulingga)
Email balasan ADM atas akun per grup (`Feedback/Feedback - 1.pdf`), 6 poin +
1 ide. Yang dikerjakan di ronde ini: poin 2, 3, 5.
- **(1) SUNRISE kosong** — memang belum di-ingest, dijadwalkan minggu ini.
- **(2) Plot ID nimpa kolom Company** di tabel plot: sel Plot ID nggak
  dipotong, jadi ID panjang (`IDN…-PO…-2609-0498`) tumpah ke kolom sebelah.
  Kolom dilebarkan ke 260px + sel dipotong "…" (ID lengkap di tooltip). Key
  lebar kolom di localStorage naik ke `-v2`, karena lebar lama (190px) sudah
  tersimpan di tiap browser.
- **(3) BNS "Couldn't load plots"** (BUMI KHATULISTIWA MANDIRI, akun `bns`):
  data & scope-nya ternyata benar — file ada di R2 (upload 23/09), dan smoke
  test lewat server lokal yang baca R2 lolos (akun `bns` → 633 plot, summary
  ada). Log Vercel (Hobby) nggak nyimpen riwayat sejauh itu, jadi penyebab
  persisnya di production nggak bisa dipastikan; paling mungkin request
  gagal sesaat. Fix: fetch plot & EUDR summary sekarang retry otomatis
  (5xx/network, 3 percobaan — `src/lib/fetch-retry.ts`); ringkasan mill yang
  gagal dimuat sekarang bilang "gagal dimuat" + Coba lagi (dulu salah
  tampil "belum ada data plot"); 401 dapat pesan "sesi berakhir". Cek BNS
  ditambahkan ke `scripts/e2e-smoke.mjs`.
- **(5) Citra 2020 & 2026**: Esri Wayback **nggak bisa** dipakai — tanggal
  rilisnya bukan tanggal foto; di BUMI KHATULISTIWA versi "2020" dan "2026"
  sama-sama foto 10/09/2015. Diganti **Sentinel-2 L2A** (10 m, Copernicus —
  boleh komersial) lewat Microsoft Planetary Computer (tanpa API key):
  basemap baru "Sentinel-2 2020" (median 10 scene tercerah 2020 + mosaik
  scene tercerah 2020 di bawahnya buat isi celah) dan "Sentinel-2 2026"
  (scene tercerah per tile). Tampil mulai zoom 10 (peta otomatis zoom ke
  situ); di bawah itu Esri jadi latar konteks. Keterbatasan: tile dibuat
  on-demand (~2–6 detik per tile saat pertama), dan server membatasi ~5
  detik per tile, jadi di tepi jalur orbit kadang ada petak kecil tanpa
  citra (tampil latar polos, bukan citra tahun lain). Search ID mosaiknya
  deterministik — cara register ulang ada di komentar `chain-map.tsx`.
- Belum dikerjakan: (4) satu mill SJIM di Afrika, (6) layer Peta Kawasan
  Hutan 2026, dan ide klik "EUDR Comply 92%" → daftar lokasi non-comply.

### 2026-09-27 — Feedback 2: bugs, tampilan, landing (branch `feedback-2-palmtrace`)
Tiga dokumen audit di `Feedback/Feedback 2/` (Dok. 1 bugs & tampilan, Dok. 2
data publik, Dok. 3 branding). Yang dikerjakan di ronde ini:
- **B-01 (data publik tanpa auth) ternyata false positive**: di produksi,
  `/data/mills.json` dan `forest-cover.geojson` tanpa cookie sudah 401 —
  auditor mengetesnya dari browser yang masih login. Tetap ditambah
  `robots.txt` (disallow `/app`, `/data/`, `/coverage`, dll).
- **B-02 peta 240px**: shell workspace sekarang tinggi tetap (100dvh), peta
  mengisi kanvas secara absolut + `ResizeObserver` → ~52vh di desktop, penuh
  di mode "Perluas peta". Penyebab tambahan: CSS MapLibre
  (`.maplibregl-map{position:relative}`) menimpa `inset:0`.
- **B-03 legend 0**: plot memang dimuat per PKS; legend sekarang menampilkan
  petunjuk "pilih PKS" alih-alih "Patuh 0 · Tidak patuh 0".
- **B-04/B-05 rute**: `/` = landing publik; `/login?next=`; workspace di
  `/app/portfolio`, `/app/<grup>`, `/app/<grup>/data?refinery=&mill=`
  (deep link, refresh, Back jalan). Halaman publik `/method`, `/about`,
  `/contact` (+ alias `/metodologi`, `/tentang`, `/kontak`).
- **B-06/B-07**: kata "on development" hilang dari UI; nama grup seragam
  kapital; slug terpisah untuk URL.
- **U-02/U-04/U-08**: kamus ID/EN lengkap (ID diketik terhadap kunci EN),
  istilah PKS / Kilang / tingkat desa / "Buffer 20 km"; mitigasi A–F dan kode
  kawasan hutan dwibahasa; satu helper format angka (`src/lib/format.ts`, tanpa
  "k": 6.283,1k ha → 6,28 juta ha).
- **U-05/U-06/U-07**: empty state grup tanpa plot + tombol ke peta; KPI
  sidebar dobel dihapus, KPI kanvas punya tooltip definisi + "Data per";
  pill status Plot siap / Sebagian / Master saja (endpoint baru `/coverage`);
  chart overlap kawasan hutan diskalakan ke nilai terbesarnya, dipisah
  tegas dari JRC.
- **Sistem visual Opsi A** (ink navy + teal + emas hemat), Plus Jakarta Sans +
  IBM Plex; mark/favicon/og.png baru; nama tampil "PalmTrace" + "by Earthline".
- **Peta**: chip peta dasar selalu terlihat & diingat, rentang akuisisi
  Sentinel-2, atribusi Esri lengkap, panel layer bergrup (Analisis Earthline /
  Rantai pasok / Konteks EUDR), JRC default mati & dimuat lazy (~20 MB) dengan
  catatan "tidak mengikat", halo di outline plot, skeleton saat memuat.
- **Mode Present** (admin/klien), mobile (drawer, kartu PKS, peta 58vh), login
  dengan tampil/sembunyikan sandi dan sandi tidak dikosongkan saat gagal.
- `DATA_AS_OF` di `src/lib/data-meta.ts` **wajib diperbarui tiap ingest**.
- Belum dikerjakan (butuh keputusan/data/infra): domain `palmtrace.earthline.info`
  (DNS), layer KLHK/BIG/gambut/hotspot, rekonsiliasi UML, logo klien,
  backend email untuk form kontak, vector tiles untuk plot & JRC.

### 2026-09-27 — Redesign 2: "terang dan tenang"
Setelah preview feedback 2, desain dinilai masih terasa template. Referensi
yang dinilai terbaik: samsung.com/id, apple.com/id, asianagri.com,
apicalgroup.com (good: locatorlogic, preferredbynature, mapid; just ok:
bvarta — yang ternyata paling mirip desain sebelumnya: hero gelap, teal,
Plus Jakarta Sans). Brief warna: hindari warna Kanopi dan warna "berani".
- Sistem visual baru: putih/#F5F5F7, teks #1D1D1F, Inter, pill hitam,
  satu nada tautan hijau-abu redup, warna data diredupkan. Mark monokrom.
- Situs publik ditulis ulang (copy + struktur): hero citra Sentinel-2 asli
  (`public/img/sentinel2-riau-2020.jpg`, 2020, skala regional, plot contoh
  berlabel), bukti, masalah, 3 langkah, bento, untuk siapa, perbandingan,
  FAQ. CTA utama "Minta Early Access" → `/contact?early=1`.
- Workspace: sidebar dihapus; pemilih grup di header (bisa dicari);
  portofolio jadi tabel yang bisa diurutkan dengan kolom cakupan; peta +
  panel kanan (daftar PKS → detail PKS + KPI + unduhan); tabel plot jadi
  laci bawah; login split dengan citra.
- Perbaikan ikut: Esri dibatasi zoom 17 (tile abu di atasnya), ikon PKS
  tanpa emoji, panel Layer tertutup default di HP.
- Skill pihak ketiga yang dipakai: ui-ux-pro-max, copywriting (dipasang di
  `Kanopi Project/.claude/skills/`, di luar repo).

### 2026-09-28 — Redesign 2, ronde masukan + Feedback ADM #1 sisa
- Citra publik sekarang memakai **plot asli** (atas izin user, cakupan kecil):
  satu PKS YORGO, hanya plot patuh, tanpa nama/label/koordinat, dibakar ke
  JPG Sentinel-2 2020 dan 2026 (`public/img/field-2020.jpg`,
  `field-2026.jpg`). Dipakai di hero, login, tile peta, dan slider
  perbandingan 2020↔2026 (menggantikan garis waktu yang tidak jelas gunanya).
- Showcase produk di beranda (ala Samsung): 4 layar workspace yang berganti
  otomatis. Layar diambil oleh `scripts/capture-showcase.mjs` dari dev server
  dengan nama, lokasi, angka (diskalakan), ID, dan koordinat diganti, plus
  cek kebocoran otomatis. **Jalankan ulang skrip itu kalau UI berubah.**
- Beranda: A–F tidak terpotong lagi (arti + ritme pemantauan dari
  metodologi), tile akses/tautan/format standar diisi, kartu "untuk siapa"
  diberi pratinjau, ikon di bagian masalah, bagian **produk lain Earthline**
  (citra, terrain, drone, survei, sensor Agrowing).
- **Metodologi** ditulis ulang dari dokumen *EL Response — SRS EUDR
  Information Requests* (24/09/2026): dua uji (bebas deforestasi + legal),
  risiko desa, matriks A–F dengan pemantauan, baseline, alert & validasi,
  model spasial, aturan geometri, QA/QC, format DDS, pemantauan ulang. Nama
  klien, nomor SOP internal, dan bobot variabel **tidak** dimuat (dokumennya
  confidential dan bobotnya indikatif per penugasan).
- Workspace: **sankey** di Portofolio (grup → kilang → ketertelusuran /
  cakupan plot, hover + klik); KPI Patuh EUDR & irisan donut bisa diklik →
  daftar **"Di mana plot tidak patuh?"** per PKS → peta PKS dengan tabel plot
  tersaring tidak patuh (`?plots=noncomply`) — ide dari email ADM. Donut
  bereaksi saat hover.
- Bug: peta tidak lagi ikut ter-scroll/terpotong saat menggulir daftar PKS.
- Feedback ADM #1 poin 4: PKS SJIM "di Afrika" = INTI SAWIT SEJAHTERA
  MAKMUR dengan koordinat **0,0** di master. Sekarang 0,0 dianggap "tidak ada
  koordinat" (tidak digambar, ada catatan di detail PKS). **Koordinat aslinya
  masih perlu dikirim/diperbaiki di master data.**
- Belum: SUNRISE (data plot belum ada), Peta Kawasan Hutan 2026 (file belum
  ada di Data Storage).

### 2026-09-28 — Ingest SUNRISE + Kanopi production jadi PalmTrace
- Sumber: `04. SUNRISE\SUNRISE.gdb` (281.849 plot, sudah bawa PlotID).
  Diproses dengan pipeline YORGO/BNS (overlay 21 layer, EUDR_Comply,
  Desc_Issue, join desa, kelas mitigasi, LAT/LON) → master
  `ANALISIS\SUNRISE_28092026.gdb`. Detail lengkap:
  `Data Storage/SUNRISE - Plot (GeoJSON)/SUNRISE_PIPELINE_NOTES.md`.
- 519 PlotID dobel = baris duplikat persis (semua ADOLINA), di-drop. NodeID
  diganti pakai `mills.json` (instruksi user). PlotID dipertahankan.
- **Bug roster:** kolom UML ID di workbook ADM geser satu baris untuk 15 mill
  SUNRISE (SAWIT LANGKAT … SOSA). Diperbaiki di `mills.json` lewat
  `scripts/fix-sunrise-mill-ids.mjs`. Workbook ADM sendiri masih salah.
- Hasil: **272.215 plot, 40/40 mill** (`scripts/prepare-sunrise-plots.mjs`),
  96% patuh EUDR. 9.063 plot >100 km dari PKS (MAYANG, BERANGIR, TINJOWAN,
  TIMUR) ditahan di `NEEDS VERIFICATION/`.
- Kanopi production (kanopi-ochre) di-deploy dengan tampilan PalmTrace.
  Daftar "Where are the non-compliant plots?" dirapikan (kolom sejajar lewat
  subgrid). Login di kanopi-ochre **tetap password lama** untuk semua akun
  (sudah dikirim ke ADM via email) — password CSV hanya berlaku di
  palmtrace-one.
- Role **auditor** tidak lagi melihat tombol download (CSV/GeoJSON PKS) di
  workspace (`canDownload` di `workspace.tsx`).
- Go-live: 56 file plot SUNRISE di-upload ke R2
  (`upload-plots-to-r2.mjs __SUNRISE__` — script sekarang bisa difilter),
  lalu deploy ke kanopi-ochre (`kanopi-7s0c30scg`). Dicek di production:
  SUNRISE 40/40, plot terbaca dari R2, auditor tanpa download, login lama OK.

### 2026-09-28 — Multi-klien: ruang BRC (Bakrie Renewable Chemicals)
- PalmTrace sekarang **multi-tenant** (`src/lib/tenants.ts`): tiap sesi
  membawa klien (`adm`/`brc`), server memilih data sesuai klien di sesi —
  frontend tetap memanggil `/data/…`, `/coverage`, `/eudr-summary` yang sama.
  ADM tidak berubah (file & path lama). Data klien lain di
  `private-data/tenants/<id>/` dan R2 `tenants/<id>/`; path `tenants/…`
  langsung selalu 404.
- Akun BRC `brc-1..3` (hash di `gate.ts`, password di
  `artifacts/akun-brc.csv`), terkunci ke BRC. Admin Earthline dapat pemilih
  "Klien" di header. Auditor & supplier tetap di ADM.
- Data BRC: versi dashboard BRC 24 Sep (basis DOMAS) — 34 mill disalin dari
  plot DOMAS yang sudah diproses, 10 mill diproses pipeline baru. Detail:
  `Data Storage/BRC - Plot (GeoJSON)/BRC_PIPELINE_NOTES.md`. Hasil 373.769
  plot, 44/44 mill, 96,1% patuh. Plot >100 km dari PKS **tetap ditampilkan** untuk
  BRC (keputusan user: BRC memberi data begitu dan tidak mau verifikasi).
- Script baru/diubah: `build-brc-roster.mjs`, `prepare-brc-plots.mjs`,
  `prepare-eudr-stats.mjs --tenant`, `upload-plots-to-r2.mjs --tenant`.
  `e2e-smoke.mjs` +13 cek isolasi klien — 25/25 lolos di production.
- Web lama BRC (Cloudflare `brc-eudr-portfolio`) tidak disentuh.

### 2026-09-28 — Teks A–F mengikuti data
- Kartu "Kategori A sampai F" di beranda dan tabel A–F di Metodologi sekarang
  diturunkan langsung dari `MITIGATION_DESCRIPTIONS(_ID)` (= teks atribut
  `Risk_Mitigation_Class` di data), bukan narasi dokumen SRS. Alasan (user):
  narasi lama menyebut C "verifikasi segera / ditahan" sehingga plot C — yang
  **patuh** — terbaca tidak patuh. Kolom "Pemantauan" dihapus.

### 2026-09-28 — NAM & LTS, tab Dokumen/Monitoring/Harga sawit
- **NAM & LTS** masuk: `Data Storage/NAM - Plot/OPI_NAM.gdb` (sudah dianalisis
  user) → `ANALISIS\NAM_pipeline\07_export_to_kanopi.py` → `prepare-nam-plots.mjs`
  (PlotID baru, NodeID dari mills.json). 47.530 plot, 5 mill, 0 plot >100 km.
  DJAYA GLOBALINDO SENTOSA (PO1000004266) ditambahkan ke mills.json dari
  UML.xlsx. Detail: `Data Storage/NAM - Plot (GeoJSON)/NAM_PIPELINE_NOTES.md`.
- **Port** (user): SUNRISE — 12 mill PPKO Tandun → Dumai, sisanya Belawan;
  NAM semua Belawan (`scripts/fix-sunrise-nam-ports.mjs`; SEI MERANTI (PN)
  pindah Dumai → Belawan).
- Tab baru per grup: **Monitoring** (placeholder "segera hadir"; laporan PDF =
  link Google Drive dan layer deteksi diisi di `src/lib/monitoring.ts`),
  **Dokumen** (SOP EL-SOP-EUDR-001 v1.1 EN+ID, netral klien, untuk semua
  tenant; `/docs/…` wajib login, auditor hanya lihat; production: redirect ke
  URL R2 presigned karena PDF > batas respons Vercel), **Harga sawit** (hanya
  grup SUNRISE di ADM: admin/klien ADM + login `sunrise`; halaman dari
  `Palm Oil Forecast/…/sunrise-poi.html` di-reskin oleh
  `scripts/build-sunrise-price.mjs` → `src/content/sunrise-price.html`,
  dijalankan ulang tiap harga diperbarui).

## Status saat ini (per 2026-09-23)

- SJIM: 189/192 mill ke-ingest ke Kanopi (3 mill masih belum match).
- YORGO: 25/25 mill ke-ingest.
- BNS: 24 mill ke-ingest (9 mill tanpa file plot sudah dihapus dari roster); paket upload TRACT 45.216 plot setelah plot yang ditandai defo TRACT di-drop (24 GeoJSON + 21 master data; KENANGA, GARUDA, SAWINDO pakai node SJIM yang sudah ada).
- PalmTrace: belum ada progres yang tercatat di repo ini.

## Belum lengkap di catatan ini

- Detail eksperimen PalmTrace — apa yang sudah dicoba, hasilnya, dan
  relasinya ke roadmap Kanopi.
- Riwayat project sebelum `e5a466f` (initial snapshot).
