# Warna

**Redesign 2 (27 Sep 2026) — "terang dan tenang".** Arah diambil dari referensi yang dinilai terbaik oleh tim (Apple, Samsung, Asian Agri, Apical): permukaan putih dan abu netral, teks hampir hitam, tanpa ornamen. Warna datang dari **citra satelit** dan **data**, bukan dari chrome UI.

Dua larangan dari brief:
1. **Tidak memakai warna bawaan Kanopi** (teal `#0F4C4A`/`#1C7A72`, krem `#F4EFE6`) — termasuk turunannya di redesign 1 (teal sinyal, emas).
2. **Tidak ada warna "berani"** — tidak ada biru/oranye/ungu jenuh, tidak ada gradasi atau glow. Aksi utama = pill hitam.

## Token

Semua di `@theme` / `:root` pada `src/styles.css`. Jangan menaruh hex mentah di komponen — kecuali paint MapLibre di `chain-map.tsx` (API peta tidak membaca CSS variable; nilainya disalin dan diberi komentar).

| Token | Hex | Peran |
| --- | --- | --- |
| `--color-bg` | `#FFFFFF` | Halaman publik, kartu, panel |
| `--color-bg-2` | `#F5F5F7` | Band alternatif publik, kanvas workspace, isian input |
| `--color-bg-3` | `#ECECEF` | Track bar, skeleton |
| `--color-fg` / `--color-ink` | `#1D1D1F` | Teks utama, tombol utama (pill hitam) |
| `--color-fg-2` | `#424245` | Teks isi sekunder |
| `--color-muted` / `--color-faint` | `#6E6E73` / `#86868B` | Label, keterangan |
| `--color-line` / `-soft` | `#D2D2D7` / `#E8E8ED` | Garis, border |
| `--color-link` | `#3E5C4E` | Satu-satunya nada warna UI: tautan & fokus (hijau-abu redup) |
| `--color-link-soft` | `#EEF3F0` | Baris/opsi terpilih |
| `--color-warn` + `-bg` | `#7A5716` / `#F7F0E2` | "Sebagian", risiko sedang |
| `--color-danger` + `-bg` | `#9E3F35` / `#F9ECEA` | Error, tidak patuh, deforestasi |

## Data (diredupkan)

| Makna | UI (di atas putih) | Peta (di atas citra) |
| --- | --- | --- |
| Patuh | `#5A9E78`, teks `#2F6B4B` | `#9ED7B1` |
| Tidak patuh | `#C9695E`, teks `#9E3F35` | `#F0A197` |
| Risiko rendah / sedang / tinggi | `#6FA88A` / `#D2A95B` / `#C9695E` | `#A9D6C3` / `#ECC98A` / `#F0A197` |
| Mitigasi A–F | `#5A9E78` → `#8DB57A` → `#C4BD74` → `#D2A95B` → `#CE8A66` → `#C9695E` | versi pastel di `MIT_COLORS` |
| Kawasan hutan HL / HP / HPT / HPK | `#3F6B4E` / `#C98761` / `#D4B870` / `#B9849B` | — |
| Tutupan hutan JRC 2020 | — | `#3F6B4E` @ 42% |

Setiap outline plot di peta punya halo gelap `#111114` di bawahnya supaya tetap terbaca di atas kanopi.

## Citra

Warna situs publik berasal dari satu citra: `public/img/sentinel2-riau-2020.jpg` — Sentinel-2 L2A median 2020 (Copernicus, bebas dipakai dengan atribusi "contains modified Copernicus Sentinel data 2020"), lanskap skala regional di Riau tanpa kebun yang bisa dikenali. Plot di atasnya digambar tangan dan diberi label "data contoh".
