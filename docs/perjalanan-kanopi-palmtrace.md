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

## Status saat ini (per 2026-09-23)

- SJIM: 189/192 mill ke-ingest ke Kanopi (3 mill masih belum match).
- YORGO: 25/25 mill ke-ingest.
- BNS: 24/33 mill ke-ingest (9 sisanya belum ada file plot dari sumbernya).
- PalmTrace: belum ada progres yang tercatat di repo ini.

## Belum lengkap di catatan ini

- Detail eksperimen PalmTrace — apa yang sudah dicoba, hasilnya, dan
  relasinya ke roadmap Kanopi.
- Riwayat project sebelum `e5a466f` (initial snapshot).
