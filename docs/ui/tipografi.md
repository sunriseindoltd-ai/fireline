# Tipografi

Satu keluarga **IBM Plex**: Sans untuk UI, Mono untuk identitas teknis (UML, NodeID). Tidak memakai serif.

## Pasangan

| Peran | Font | Bobot | Token |
| --- | --- | --- | --- |
| Isi, label, tombol | IBM Plex Sans | 400 / 500 / 600 | `--font-sans` |
| Judul, wordmark, angka statistik | IBM Plex Sans | 500 / 600 | `--font-display` (sama keluarga, bukan serif) |
| UML ID, NodeID, badge hitungan | IBM Plex Mono | 400 / 500 | `--font-mono` |

Dimuat di `src/routes/__root.tsx` dari Google Fonts:

`IBM+Plex+Sans:wght@400;500;600` dan `IBM+Plex+Mono:wght@400;500`.

## Kenapa Plex

- Kohesif dengan Plex Mono yang sudah dipakai untuk kode/ID.
- Terasa teknis (ledger, UML, EUDR) tanpa kaku seperti font sistem saja.
- Bukan Fraunces/serif editorial, bukan Space Grotesk/Inter draft lama.

## Skala yang dipakai

| Permukaan | Ukuran | Bobot | Tracking |
| --- | --- | --- | --- |
| Wordmark “Kanopi” | 22px | 600 | −0.02em |
| Judul login / empty state | `clamp(1.8rem … 2.4rem)` | 500 | −0.03em |
| Angka statistik | 22px | 500 | 0, `tabular-nums` |
| Isi, hint drop zone | 13–15px | 400 | 0 |
| Kicker / label form | 11px | 600 | 0.08–0.14em, uppercase |
| Mono ID | 11.5px | 400 | 0 |

Angka rantai/pabrik/refinery memakai `font-variant-numeric: tabular-nums`.

Jangan naik ke 700/900. Plex di 600 sudah cukup tegas.

## Bahasa

Salinan UI ada di `src/lib/copy.ts`. Default `en`. Jangan campur kalimat ID di string `en` atau sebaliknya. Toggle EN | ID menyimpan `localStorage` kunci `kanopi.lang`.
