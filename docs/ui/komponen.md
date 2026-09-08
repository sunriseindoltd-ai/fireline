# Permukaan & komponen

## Radius

Konsentris: kartu luar lebih besar dari kontrol di dalamnya.

| Token | px | Pakai |
| --- | --- | --- |
| `--radius-sm` | 8 | Input, tombol drop, baris rantai |
| `--radius-md` | 12 | Statistik, drop zone, tombol Sign in |
| `--radius-lg` | 20 | — |
| `--radius-xl` | 28 | Kartu login (`padding` 32 → 8+24) |
| `999px` | pill | Chip, toggle bahasa, Sign out, filter All/Village/Buffer |

## Login

- Latar: `public/login-bg.jpg`, `cover`, `center right`.
- Kartu putih, tanpa teks “session lasts 12 hours”.
- Mark 32px + wordmark Plex 600.
- Tidak menampilkan petunjuk ID/password di UI.

File: `src/routes/login.tsx`, kelas `.login-shell` / `.login-card`.

## Mark

Komponen [`src/components/brand-mark.tsx`](../../src/components/brand-mark.tsx) memuat `/kanopi-mark.svg`.

- Login: 32px
- Header ledger: 28px
- Tab: `/favicon.svg`

Jangan ganti lagi dengan blob CSS (setengah lingkaran diputar) milik draft.

## Ledger (setelah masuk)

Header cream, wordmark + EarthLine, tick intake (Master / Areas / Plots / Points), EN|ID, Sign out.

Kiri: statistik 3 kolom, daftar rantai, empat drop zone bernomor.

Kanan: peta satellite (MapLibre, Esri imagery) atau empty state serif-free; dock tabel di bawah.

Empty state adalah produk: ledger memang kosong sampai atmin mengunggah master Excel.

## Intake

1. Mill master — `.xlsx` / `.csv` (parser di `src/lib/xlsx-lite.ts`, tanpa paket `xlsx`)
2. Traceability areas — GeoJSON desa atau buffer 20 km
3. Plot inventory — GeoJSON, join UML / NodeID
4. Mill locations — titik, opsional

Kolom master: lihat templat unduhan. `TRACEABILITY LEVEL` (`Village Level` / `Buffer 20KM`) menentukan saringan peta dan chip.

## Chip & filter

- Village → `.chip.ok` (foam + teal)
- Buffer 20 km → `.chip.warn` (amber)
- Retired → `.chip.bad`
- Segmented control All / Village / Buffer 20 km menyaring **tabel dan geometri** sekaligus

## Peta

`src/components/chain-map.tsx`. MapLibre di-import dinamis (aman SSR). Warna fill/stroke harus selaras [warna.md](./warna.md). Legenda overlay: Village boundary, Buffer 20 km, Plots, Mills.

## Gerak

Transisi pendek di hover/fokus. Hormati `prefers-reduced-motion` (sudah di `styles.css`). Jangan `transition: all`.

## File kunci

| Apa | Di mana |
| --- | --- |
| Token | `src/styles.css` |
| Salinan EN/ID | `src/lib/copy.ts` |
| Login | `src/routes/login.tsx` |
| Workspace | `src/components/workspace.tsx` |
| Mark | `public/kanopi-mark.svg`, `src/components/brand-mark.tsx` |
| Favicon | `public/favicon.svg` |
| Latar login | `public/login-bg.jpg` |
