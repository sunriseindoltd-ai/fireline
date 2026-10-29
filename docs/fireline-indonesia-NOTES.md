# FireLine Indonesia — catatan (mulai 27 Okt 2026)

## Arah produk (user, 27 Okt 2026)

FireLine dibagi dua ruang kerja dalam satu aplikasi:

| Ruang | Siapa | Isi |
|---|---|---|
| **Indonesia** | Semua pemegang akun (peran `viewer` dan `admin`). Juga untuk demo di GAPKI. | Semua titik panas VIIRS di daratan Indonesia, per provinsi/kabupaten/perusahaan, batas kebun Earthline + RSPO + GFW 2014. |
| **Company** (ID: Perusahaan; dulu "Rantai pasok") | Admin Earthline saja (`admin`). | FireLine yang lama: kasus per perusahaan di plot rantai pasok ADM, verifikasi lapangan (WhatsApp), Company profile/kontak sales. |
| *Per perusahaan* (belum) | Klien langganan | Batas estate/afdeling/blok dari klien → alert per blok, status, laporan. Menunggu data dari tim sales. |

Plot rantai pasok ADM **tidak** dipakai di ruang Indonesia (data klien). Atribusi "Earthline" di ruang Indonesia
memakai **Customer Boundary** (shapefile milik Earthline), bukan plot PalmTrace.

## Sumber data

- Titik panas: NASA FIRMS VIIRS (NOAA-21, NOAA-20, Suomi NPP), bbox Indonesia, 28 hari. Satu pengambilan
  dipakai bersama ruang rantai pasok (`fetchFirmsShared`, 90 dtk).
- Batas kebun, urutan prioritas (batas pertama yang memuat titik panas menang):
  1. `Customer_Boundary_Updated_January 2026.shp` (folder FireLine, diberikan user 27 Okt; gitignored). **CROP berisi
     "oil palm" saja** (user): 2.741 dari 2.975 poligon; 2.727 dipakai.
  2. RSPO GeoRSPO Grower + Scheme (`private-data/fire/layers/rspo.geojson`, 23.833 poligon).
  3. GFW oil palm concessions 2014 (1.855 poligon Indonesia).
- Provinsi/kabupaten: geoBoundaries IDN ADM1/ADM2 (BPS 2020, 34 provinsi, 519 kab/kota; nama provinsi diterjemahkan
  ke bahasa Indonesia). Poligon kabupaten diperlebar ±1 km supaya titik di pantai yang disederhanakan tetap masuk.

## Langkah

1. `python scripts/prepare-fire-national.py ["<customer boundary .shp>"]` (±10 dtk) →
   `private-data/fire/national/index.json` (23 MB) + `private-data/fire/layers/provinces.geojson`.
   **Jalankan ulang setiap Customer Boundary / RSPO / GFW berubah** (cache nasional otomatis dibangun ulang penuh
   karena `index.generated` berubah).
2. Server `src/lib/fire-national.server.ts`: titik panas → kelompok 0,004°/hari UTC (sama dengan rantai pasok) →
   kabupaten + batas → agregat per hari WIB, cache `fire/v2/cache/national.json`; Perbarui = ambil 10 hari terbaru,
   hari lama dari cache. Rute `POST /fire/national {refresh?, pts?: 7|28}` (semua akun).
3. UI `src/components/fire-national*.tsx` + `fire-shell.tsx` (pemilih ruang kerja, admin saja).
4. Deploy (belum): upload `--only=national/` dan `--only=layers/` ke R2 fire, build, deploy.

## Angka lokal 27 Okt 2026 (data per 17:40 WIB)

| | |
|---|---|
| Deteksi 28 hari di daratan Indonesia | 634.415 |
| Deteksi di luar daratan (laut, MY, TL, PNG), tidak dihitung | 32.568 |
| 24 jam terakhir / 24 jam sebelumnya | 5.016 / 6.533 (turun 23%) |
| 7 hari / 7 hari sebelumnya | 131.213 / 157.091 |
| Di dalam batas kebun (28 hari) | 78.489 dari 634.415 (12,4%) |
| Perusahaan dengan titik panas (28 hari) | 850, 217 di antaranya dari batas Earthline |
| Provinsi terbanyak (28 hari) | Kalimantan Tengah 206.121 |
| Build pertama (FIRMS 28 hari) / Perbarui | ±31 dtk / ±14 dtk |
| Respons `/fire/national` (7 hari titik peta) | 496 kB gzip |

QA: `qa-nat.mjs` (scratchpad sesi 27 Okt) 24/24 — viewer/admin, desktop/HP, EN/ID; ronde rantai pasok
(`_fl-round.sh`) 72/72 + uji asap lokal 25/25.

## Keputusan teknis

- Nama perusahaan Customer Boundary: COMPANY dipakai apa adanya (485 nama). Hanya **11 kode pendek** (SAM, MPE,
  PHS, BPP, BHL, APL — proyek drone Multi Prima Entakai, 1.134 poligon; AWL/KMS/ABCK Goodhope; KAM/SMM MHC) diganti
  nama GROUP, kodenya masuk ke baris estate ("SAM · Balhar").
- Perusahaan digabung lintas sumber lewat nama yang dinormalkan (tanpa "PT", "Tbk", tanda baca).
- Grafik keyakinan: 89% deteksi VIIRS bernilai "nominal" (data NASA), jadi grafik tren punya pilihan warna
  "Lokasi" (di dalam / di luar batas kebun).
- Akun admin baru pertama kali masuk ke ruang Company (pekerjaan harian tim); pilihan terakhir diingat.
- Label (user, 27 Okt): jangan pakai "supply chain" / "rantai pasok" di tampilan. Pemilih ruang = "Indonesia | Company" (ID "Perusahaan"); kolom/filter grup NAM, DOMAS, … = "Group"/"Grup"; teks login = "pemantauan kebakaran di perkebunan se-Indonesia".
- Akun `demo-indonesia` (viewer) dibuat untuk uji lokal; kredensial di `artifacts/akun-fireline.csv` (gitignored).

## Anomali data Customer Boundary (bukan blocker)

- **14 baris tanpa nama yang bisa dipakai** (dibuang dari atribusi): indeks 1023, 1032 (semua kosong), 1030–1031,
  1035–1038, 1040–1043 (GROUP berisi angka luas: 350.804, 2049.91, …, COMPANY kosong), 1039 (GROUP
  "PT. CBBIntiMuara LakitanAFD 0303.E14"), 1385 (GROUP "0", ID "1963 - HBD Riau -").
- **242 baris Dharma Satya Nusantara bergeser kolom**: GROUP = nomor urut (1–242), ESTATE = luas (4.1225, …), kode
  blok (A17, A18, …) di kolom PUBLIC_LIS. Dipakai: COMPANY apa adanya, GROUP dikosongkan, estate = "Blok A17".
- GROUP berisi **nama orang** ("Mohandas Nair", untuk Dewi Indah Lestari dan Agro Palma Jaya) → dikosongkan (data
  pribadi tidak ditampilkan). GROUP "area1" (Agincourt Resources) juga dikosongkan.
- "Agincourt Resources" (tambang emas Martabe) tercatat CROP = Oil Palm — perlu dicek.
- 362 geometri tidak valid (diperbaiki `make_valid`), ring berlawanan arah (diperbaiki otomatis saat dibaca).
- CROP tidak seragam ("Oil Palm", "OIl Palm", "Oil Palm & Rubber", "Accacia"/"Acacia"); filter memakai "mengandung oil palm".

## Tambahan 27 Okt malam (mockup "yang ga bisa, dibisakan")

- **Luas kebun yang terkena titik panas** (KPI + per perusahaan + per estate): total luas batas (estate/konsesi) yang punya
  ≥1 titik panas, luas dihitung dari geometrinya sendiri (Eckert IV, `prepare-fire-national.py`). Bukan luas terbakar.
- **Tingkat perhatian** (pengganti "risk level" di mockup): tinggi = titik panas 24 jam terakhir DAN ≥3 dari 7 hari
  terakhir; sedang = salah satunya; rendah = tidak keduanya. Definisi tertulis di Cara kerja dan tooltip.
- **WhatsApp tanpa API berbayar** (user: "pake cara lain, yang penting WhatsApp"): tautan wa.me berisi pesan siap kirim
  (perusahaan, estate, lokasi, jumlah 24 jam/7 hari, titik terbaru + Google Maps) di detail perusahaan, popup titik, dan
  "Bagikan ringkasan ke WhatsApp" (24 jam, provinsi & perusahaan teratas). `src/lib/fire-national-wa.ts`.
- Tabel **Deteksi terbaru**, **label perusahaan teratas di peta** (angka = angka daftar), **citra Sentinel-2/1** untuk
  perusahaan terpilih (kartu Imagery yang sama dengan ruang Company), layer **Jalan** dan **Sungai** (tile Esri World
  Transportation + Esri Hydro Reference Overlay, juga di ruang Company), ruang Company: tabel **Peringatan terbaru** + status.
- Titik peta kini membawa jumlah deteksi milik batasnya sendiri → jumlah per estate tidak pernah melebihi total perusahaan
  (cache `fire/v2/cache/national-v2.json`). Mode 28 hari: penanda "Menggambar titik panas…" selama peta memproses ±240 rb titik.
- QA nasional 34/34 (WhatsApp, label, citra, jalan/sungai, tabel peringatan terbaru).
- Paket GAPKI: `D:\Earthline\04 Reporting\GAPKI 2026 - Wall & Flyer\` (screenshot tersamarkan + teks EN/ID, lihat NOTES di sana).

## Tambahan 28–29 Okt

- Label **BETA** di header dihapus (user 28 Okt), juga kalimat "versi beta ini" di Metode.
- Layer **PKS (Universal Mill List)** di peta Indonesia dan Company (user 29 Okt): 1.492 PKS Indonesia dari UML Rainforest
  Alliance (`python scripts/prepare-fire-mills.py` → `layers/mills-uml.geojson`; rute `/fire/layer?name=mills-uml`, juga
  untuk viewer = data publik). Biru = bersertifikat RSPO, putih = belum; digambar di atas titik panas (klik PKS menang atas
  titik panas, `onMill`); popup = grup, induk, RSPO, kabupaten, ketepatan lokasi, UML ID, titik panas dalam 20 km pada
  periode peta. Catatan data + temuan: `D:\Earthline\02 Data\Referensi\UML Rainforest Alliance 2026-10-29\NOTES.md`.
- Titik "rute dari PKS" (`prepare-mill-points.mjs`) memakai titik UML bila UML ID cocok dan ≤1 km (8 PKS bergeser 18–247 m).
- QA `scratchpad/qa-mills.mjs` 20/20 (Indonesia EN/ID, Company, HP), tsc bersih. **Sebelum deploy: upload
  `--only=layers/` (kini juga mills-uml.geojson) ke R2 fire.**

## Tampilan baru "x" (29 Okt, LOKAL saja — user: "jangan langsung production")

- Referensi user: aplikasi Xbox di PC. Konsep di kanvas https://claude.ai/artifact/BTttgrq75gAVyXQMpNFwoL (3 layar).
- Dipasang sebagai **kulit** yang bisa dimatikan: kelas `flx` di `<html>` (`src/lib/skin.ts`, skrip `SKIN_BOOT` di `__root.tsx`,
  tombol "Tampilan klasik / Tampilan baru" di header = `skin-toggle.tsx`, simpan di `localStorage fireline.skin`). Semua aturan di
  `src/styles-flx.css`, terbatas di `.fl-app` → halaman login dan `/fire/verify` (HP lapangan) tetap terang.
- Isi: tema gelap (token warna di-override), header jadi rel kiri di desktop (≥761 px; HP tetap header + nav bawah), ikon tab
  (`.fl-tab-ic`, `data-k`), tombol utama oranye `#ff6a3d`, pil pilihan putih, kartu/popup/kontrol peta gelap.
- Ruang Indonesia: banner besar = peta nasional ringkas (`NationalMap compact padLeft`) + angka besar periode + "Buka peta penuh" +
  WhatsApp; deretan kartu **Perlu perhatian** (`FlxTiles`: 12 perusahaan teratas, cuplikan Esri World Imagery `export` di sekitar
  titik panas terbaru + titik panas periode digambar di atasnya). Kotak peta + daftar batang lama disembunyikan di tampilan x.
- QA: smoke lokal 25/25, qa-mills 20/20, cek tombol klasik (pindah + tetap setelah reload + kembali), tsc bersih, tanpa error konsol.
- Sebelum ke production: putuskan bawaan (x atau klasik) dan apakah tombol klasik tetap ada.

## Terbuka (keputusan user)

1. Nama perusahaan di ruang Indonesia tampil untuk **semua pemegang akun** (termasuk di GAPKI) — termasuk perusahaan
   yang batasnya dari Customer Boundary (klien Earthline). Poligon Customer Boundary sendiri tidak dikirim ke browser;
   yang terlihat hanya titik panas + nama + estate. Perlu dipastikan boleh.
2. Akun untuk GAPKI / klien: nama akun dan siapa yang dapat.
3. Batas blok untuk versi per perusahaan: menunggu tim sales.
4. PBPH/HTI (KLHK) belum dipakai sebagai batas (data vektor PBPH tidak bisa ditarik penuh, lihat NOTES Konsesi Sawit).
