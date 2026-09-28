# Permukaan & komponen

## Radius

| Token | px | Pakai |
| --- | --- | --- |
| `--radius-sm` | 8 | Kontrol kecil, baris legend |
| `--radius-md` | 12 | Input, kartu peta, baris daftar |
| `--radius-lg` | 18 | Kartu KPI, chart, tabel |
| `--radius-xl` | 28 | Citra hero, tile bento, kartu langkah |
| `999px` | pill | Semua tombol, tab, toggle bahasa, status |

## Situs publik (Layer 1)

`src/routes/index.tsx`, `method.tsx`, `about.tsx`, `contact.tsx`; chrome di `src/components/site/site-chrome.tsx`, citra hero di `src/components/site/hero-media.tsx`.

- Header putih tipis: mark + PalmTrace · Produk · Cara kerja · Metodologi · Tentang · Kontak · bahasa · "Masuk" (teks) · **Early Access** (pill hitam → `/contact?early=1`).
- Urutan beranda: hero → bukti → masalah + **showcase produk** (`product-showcase.tsx`) → 3 langkah → bento → untuk siapa (dengan pratinjau) → dibanding cara biasa → FAQ → produk lain Earthline → CTA.
- Citra: `public/img/field-2020.jpg` / `field-2026.jpg` — Sentinel-2 dengan outline plot asli (satu PKS, hanya plot patuh, tanpa nama/lokasi). Slider `compare-slider.tsx`.
- Layar showcase: `public/img/showcase/*-{en,id}.jpg`, dibuat oleh `scripts/capture-showcase.mjs` (dev server; nama/angka/ID/koordinat diganti; gagal bila ada kebocoran). Jalankan ulang setiap UI workspace berubah.
- Metodologi: isi di `src/lib/method-copy.ts` (dari dokumen EL Response, tanpa nama klien/nomor SOP/bobot).
- Dilarang di publik: angka portofolio, nama grup klien, "AI" sebagai subjek headline.

## Login (Layer 2)

Split: citra satelit di kiri (disembunyikan di HP), form di kanan. Tampil/sembunyikan sandi; sandi tidak dikosongkan saat gagal; `?next=` hanya `/app…`.

## Workspace (Layer 3)

- **Header** (tanpa sidebar): mark · `/` · **pemilih grup** (`scope-switcher.tsx`, bisa dicari, menampilkan jumlah PKS berplot) · tab Ringkasan / Peta & data · Present · bahasa · Keluar.
- **Portofolio** (`portfolio-view.tsx`): KPI + **sankey** (`portfolio-sankey.tsx`, grup → kilang → ketertelusuran/cakupan; hover menyorot jalur, klik membuka) + tabel grup yang bisa diurutkan.
- **Ringkasan**: KPI Patuh EUDR dan irisan "Tidak patuh" bisa diklik → kartu "Di mana plot tidak patuh?" → `/app/<grup>/data?mill=…&plots=noncomply`.
- **Ringkasan**: judul grup, pemilih kilang, tombol ke peta, KPI bertooltip, grid chart. Grup tanpa plot → empty state.
- **Peta & data**: peta lebar + **panel kanan** 380px.
  - Tanpa PKS terpilih: daftar PKS (cari, filter ketertelusuran, pemilih kilang; titik hijau = berplot).
  - PKS terpilih: identitas, KPI ringkas, tombol **Buka tabel plot** (laci bawah di atas peta, bisa ditarik), fakta, unduhan CSV/GeoJSON.
  - Tombol peta penuh di pojok kanan atas peta.
- Di ≤860px: header membungkus tab ke baris kedua, panel pindah ke bawah peta, panel Layer mulai tertutup.

## Peta

`src/components/chain-map.tsx`. Kartu overlay putih semi-transparan. `ResizeObserver` pada kontainer — jangan dihapus (perbaikan bug peta 240px). Esri dibatasi `maxzoom: 17` (lebih dari itu tile abu). Ikon PKS digambar dengan path canvas, bukan emoji.

## Gerak

150–200 ms, hanya opacity/transform. Hormati `prefers-reduced-motion`.
