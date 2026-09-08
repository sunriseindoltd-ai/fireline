# Warna

Kanopi memakai **satu aksen teal** di atas netral cream. Teal dipilih sebagai jembatan hijau–biru: cukup “hutan / kanopi” untuk sawit dan ketertelusuran, tidak hijau zaitun yang terasa template GIS, tidak navy seperti draft lama.

## Token

Didefinisikan di `@theme` pada `src/styles.css`. Jangan menaruh hex ad-hoc di JSX.

| Token | Hex | Peran |
| --- | --- | --- |
| `--color-bg` | `#F4EFE6` | Kertas / cream. Menyelaraskan login-bg dan permukaan app. |
| `--color-fg` | `#1A2423` | Tinta. Agak kehijauan, bukan hitam murni. |
| `--color-muted` | `#5E6A68` | Label, kicker, teks sekunder. |
| `--color-surface` | `#FAF7F1` | Header, panel kiri. |
| `--color-elevated` | `#FFFFFF` | Kartu login, sel statistik, drop zone. |
| `--color-line` | `#E2DDD4` | Hairline, tabel, segmented control. |
| `--color-accent` | `#0F4C4A` | Teal gelap. Aksi primer, mark, theme-color, tab browser. |
| `--color-accent-2` | `#1C7A72` | Teal terang. Hover tombol, pucuk mark paling atas. |
| `--color-foam` | `#D5EBE8` | Chip Village, highlight ringan di atas cream. |
| `--color-warn` | `#8A6A3A` | Buffer 20 km, status hati-hati. **Bukan** aksen merek. |
| `--color-danger` | `#9A3F32` | Retired, error login, hapus ledger. |

`theme-color` HTML dan `src/lib/og/site.json` memakai `#0F4C4A`.

## Mark (tiga pucuk)

[`public/kanopi-mark.svg`](../../public/kanopi-mark.svg) — tajuk hutan dari atas, tiga lingkaran bertumpuk:

| Hex | Letak |
| --- | --- |
| `#0F4C4A` | Pucuk kiri (sama dengan `--color-accent`) |
| `#0B3E3B` | Pucuk bawah, paling gelap |
| `#1C7A72` | Pucuk kanan-atas (sama dengan `--color-accent-2`) |

Favicon (`public/favicon.svg`) menaruh mark yang sama di atas kotak cream `#F4EFE6`.

## Kenapa bukan hijau hutan / navy

- **Navy + biru** adalah bahasa visual draft Kanopi 0.0.12. Sengaja ditinggalkan.
- **Hijau `#2C4A3E`** (versi kertas sebelumnya) terlalu “dashboard GIS generik”.
- **Teal** tetap terbaca sustainability, tapi lebih teknikal dan selaras dengan mark.

Aksen merek hanya keluarga teal. Amber (`warn`) dan merah (`danger`) khusus status, area kecil (chip, baris retired), bukan panel penuh.

## Semantik di data

| Makna | Warna | Di mana |
| --- | --- | --- |
| Village Level | teal / foam | Chip `.ok`, isi polygon desa di peta `#0F4C4A` |
| Buffer 20 km | amber | Chip `.warn`, polygon buffer `#8A6A3A` |
| Plot (village) | teal sedang `#4A9B94` | Fill plot di MapLibre |
| Plot (buffer) | pasir `#C4A574` | Fill plot di MapLibre |
| Retired | danger | Chip `.bad`, baris tabel redup |
| Available | teks biasa / “Available” | Tanpa chip warna merek |

Peta satellite gelap: garis desa memakai foam terang agar kontras di citra.

## Latar login

`public/login-bg.jpg` — cream dengan garis lengkung teal tipis di kanan. Kartu login tetap `--color-elevated` agar form kebaca. Jangan overlay grid atau blob gradien di atas gambar ini.

## Aturan

1. Maksimal satu keluarga aksen (teal) + netral + status.
2. Latar berganti → teks ikut diganti (kontras AA).
3. Tombol primer: `accent` di atas `bg`/cream, hover `accent-2`.
4. Toggle bahasa aktif: isi `accent`, teks cream.
5. Hex baru hanya lewat token, kecuali paint MapLibre (API peta butuh string warna).
