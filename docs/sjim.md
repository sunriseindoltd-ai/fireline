# Catatan Khusus — SJIM

Ringkasan kerja rekonsiliasi & ingest data SJIM ke Kanopi. **Update tiap ada
progres baru** — terutama soal 3 mill yang masih belum match (lihat Status
di bawah).

## Kenapa SJIM ribet

SJIM itu grup mill terbesar yang pernah diintegrasikan ke Kanopi. Datanya:

- 192 mill di master list, sempat salah hitung jadi 214 (gara-gara data
  umum belum di-cross-check ke sumber SJIM sendiri).
- Drop file plot-nya beda format dari YORGO/DOMAS — nggak ada PlotID/NodeID
  bawaan sama sekali (pre-TRACT master export), jadi keduanya harus
  di-generate.
- UML_ID di dalam masing-masing file plot nggak bisa dipercaya — 27 file
  ternyata salah UML_ID kalau dicross-check ke mills.json (known issue, ada
  catatannya sendiri di `SJIM_PIPELINE_NOTES.md` sumbernya: "ID yang mulai
  dari 8" nggak reliable di salah satu tracking sheet).

## Tahap 1 — Reconciliation buat upload TRACT (di luar repo ini)

Sebelum masuk fase ingest-ke-Kanopi, ada investigasi terpisah buat
mill-mill SJIM yang "kelewat" (belum sempat di-upload user ke TRACT):
identifikasi gap antara data Kanopi vs sumber GIS master
(`SJIM_17092026.gdb`, `11. SJIM - All Plot.gdb`,
`SJIM_MasterData_NodeID_List.xlsx`), benerin mill yang UML_ID-nya
salah/nggak cocok, lalu siapin file GeoJSON + Excel master-data yang
siap-upload buat tiap mill yang kelewat itu.

**Hasil: 10 dari 10 mill "kelewat" selesai** (GeoJSON + master-data file
per mill).

*Detail nama mill spesifik dari tahap ini ada di histori percakapan
sebelumnya, bukan di file repo ini — kalau butuh direkonstruksi, cek ulang
transkrip percakapan itu.*

## Tahap 2 — Ingest ke Kanopi (tercatat di git, 2026-09-14 s/d 2026-09-18)

### `74502f2` — Rebuild mill-list dari sumber otoritatif SJIM sendiri

Sebelumnya cuma nge-patch field `refinery` dari Data B di atas 214 baris
SJIM dari Data A. Diganti total: mill-list sekarang dibangun dari Data B
("Sinarjaya Agro - Master Mill") sebagai sumber utama, di-join ke Data A
(via NodeID) buat UML ID/Traceability Level/Port/Group/Lat-Lon, lalu ke
`UML.xlsx` (Universal Mill List) sebagai fallback terakhir.

Hasil: **198 mill** (dari 214) — 146 match langsung ke Data A, 46 lagi cuma
ketemu lewat UML.xlsx, 6 mill genuinely nggak match sama sekali di manapun
(dibiarkan tanpa lat/lon/traceability/port, nggak ditebak).

### `64c82b3` — Ingest plot (188 dari 192 mill) + 2 bug nyata ketemu

- Setiap file plot di-cross-check ke roster SJIM di mills.json by
  normalized mill name — **27 file punya UML_ID yang salah**, jadi
  identitas plot (UML_ID, Mill_Name) di-overwrite pakai punya mills.json,
  bukan pakai punya file itu sendiri.
- 4 file nggak ketemu match sama sekali di mills.json (kemungkinan mill
  baru yang belum di-onboard) — di-skip, bukan ditebak.
- Total **1.350.493 plot**, 1.299 duplikat exact di-drop.
- 17 baris SJIM di mills.json yang belum punya NodeID di-generate
  (`2026-IDN-<Mill ID>-1`) — spreadsheet sumbernya sendiri masih ke-lock
  proses lain jadi belum bisa ditulis-balik ke sana.

**2 bug produksi yang ketauan & di-fix gara-gara data SJIM:**

1. `src/lib/ledger-geo.ts` + `prepare-eudr-stats.mjs` — SJIM pakai nama
   field `ha` buat hectarage (varian ketiga selain `HECTARAGE`-nya Permata
   dan `Hectarage`-nya DOMAS) — ditambahin ke fallback chain yang sama.
2. `src/components/eudr-summary.tsx` — nama refinery SJIM ada koma literal
   di dalamnya ("SINAR TAYAN INTI MULYA, KALBAR"). Effect fetch EUDR
   summary nge-stabilin dependency-nya dengan join millIds pakai "," terus
   split lagi — buat mill SJIM manapun ini secara diam-diam mencacah 1 id
   gabungan jadi 2 entry sampah, jadi tiap request EUDR summary yang
   nyentuh SJIM selalu balik kosong. Di-fix pakai `JSON.stringify` buat
   dependency key + kirim array asli langsung, nggak ada round-trip string
   lagi. Cache key di `eudr-aggregates.server.ts` juga dikerasin dengan
   cara yang sama buat jaga-jaga.

### `35ea330` — Fix deploy gagal gara-gara ukuran data SJIM

`private-data/plots` ternyata nggak pernah benar-benar dikecualikan dari
upload source Vercel (cuma dikecualikan dari SSR bundle glob — data
dilayani dari R2 saat runtime). Nggak ketauan pas foldernya masih kecil;
begitu SJIM masuk (2.6GB), upload deploy mulai gagal ("fetch failed" di
tengah jalan). Di-fix.

### `afbc9e6` — AGRO ANDALAN ketemu, 189/192

File `DHARMA SATYA NUSANTARA MILL 8 (AGRO ANDALAN).geojson` sempat ke-skip
karena `Mill_Name` internalnya nggak cocok nama sama `AGRO ANDALAN`
(PO1000010802) di mills.json. Dikonfirmasi lewat GDB sumber
(`SJIM_17092026.gdb` + `PLOT_SJIM_MASTER`) kalau UML_ID-nya persis sama —
mill yang benar, cuma beda nama tampilan. Ditambahin ke `NAME_OVERRIDES`,
re-ingest: 22.384 plot, **189/192 mill match**.

### 2026-09-24 — Semua port SJIM jadi "Panjang" (langsung ke production)

Instruksi user (urgent): port semua mill SJIM diseragamkan jadi `Panjang`.
181 dari 198 baris SJIM di `private-data/mills.json` diubah (sebelumnya
campur Balikpapan/Pontianak/Kotabaru/dll., 71 kosong); nggak ada field lain
yang berubah. `scripts/rebuild-sjim-mills.mjs` juga di-hardcode `port =
"Panjang"` supaya nggak ketimpa kalau mill-list di-rebuild. Typecheck + build
lolos, di-deploy prebuilt ke production (`kanopi-i2wh7lr5n`, 15:19 WIB);
smoke test lokal dilewati atas permintaan user karena urgent.

## Status saat ini

- **189 dari 192 mill SJIM** sudah ke-ingest ke Kanopi.
- **3 mill masih belum match** — belum ada catatan lanjutan soal ini di
  repo; kalau mau ditutup, pola investigasinya sama seperti kasus AGRO
  ANDALAN (cek nama alternatif/UML_ID di GDB master, bukan cuma normalized
  name match ke mills.json).
- Semua perubahan di atas sudah diverifikasi end-to-end (typecheck, build,
  e2e smoke suite, cek browser langsung) per commit masing-masing.

## Referensi terkait

- Kasus MULTIAGRO SUMATERAJAYA (PULAU DOGOM) — bukan SJIM, tapi pola
  investigasinya mirip (mill sama muncul di beberapa chain: lihat commit
  `da6da28`/`1b7da3f` dan memory `multiagro_pulau_dogom_mill`).
- [docs/perjalanan-kanopi-palmtrace.md](perjalanan-kanopi-palmtrace.md) —
  konteks lebih luas, timeline gabungan Kanopi & PalmTrace.
