# Tipografi

Redesign 2: **satu keluarga netral, Inter**, untuk display dan UI (paling dekat dengan SF Pro/SamsungOne di referensi), plus **IBM Plex Mono** untuk ID. Plus Jakarta Sans ditinggalkan — itu font yang juga dipakai bvarta, referensi yang dinilai "just ok".

| Peran | Font | Bobot | Token |
| --- | --- | --- | --- |
| Judul, wordmark, angka KPI | Inter | 600 / 700 | `--font-display` |
| Isi, label, tombol, tabel | Inter | 400 / 500 / 600 | `--font-sans` |
| UML ID, Node ID, Plot ID | IBM Plex Mono | 400 / 500 | `--font-mono` |

Dimuat di `src/routes/__root.tsx` dari Google Fonts.

## Skala

| Permukaan | Ukuran | Bobot | Tracking |
| --- | --- | --- | --- |
| Hero publik | `clamp(2.6rem … 5rem)` | 700 | −0.04em |
| Judul bagian publik | `clamp(2rem … 3.4rem)` | 700 | −0.035em |
| Isi publik | 16–17px | 400 | −0.005em |
| Wordmark | 16px | 600 | −0.015em |
| Angka KPI | 26px (19px ringkas) | 600 | −0.025em, `tabular-nums` |
| Eyebrow | 13–17px | 600 | 0, huruf biasa (bukan kapital) |

## Angka

Semua angka lewat `src/lib/format.ts` (`formatCount`, `formatHa`, `formatPct`, `formatLarge`):

- Locale mengikuti bahasa: `id-ID` (1.372.877 · 6,28 juta ha) atau `en-US` (1,372,877 · 6.28 million ha).
- **Tidak pernah** sufiks "k" pada angka yang sudah dilokalkan.
- Di bawah sejuta: angka penuh. Mulai sejuta: "juta" / "million" tertulis.

## Bahasa

Salinan workspace di `src/lib/copy.ts`, situs publik di `src/lib/site-copy.ts`. Kamus `id` diketik terhadap kunci `en`, jadi kunci yang hilang = error TypeScript. Register industri: PKS, Kilang / KCP, grup rantai pasok, tingkat desa, "Buffer 10 km" (spasi, huruf kecil). Nama produk: "PalmTrace", byline "by Earthline" / "oleh Earthline". Nama internal tidak pernah muncul di UI.
