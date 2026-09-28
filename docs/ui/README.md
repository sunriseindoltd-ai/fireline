# PalmTrace UI

Catatan desain untuk PalmTrace oleh Earthline (nama kode internal: Kanopi). Sumber kebenaran token ada di [`src/styles.css`](../../src/styles.css) (`@theme` / `:root`); gaya situs publik di [`src/site.css`](../../src/site.css). Ubah token dulu, baru komponen.

| File | Isi |
| --- | --- |
| [warna.md](./warna.md) | Palet redesign 2 (terang dan tenang), warna data, citra |
| [tipografi.md](./tipografi.md) | Inter + IBM Plex Mono, format angka, bahasa |
| [komponen.md](./komponen.md) | Situs publik, login, workspace (header, panel, laci plot), peta |

## Lapisan

| URL | Lapisan | Isi |
| --- | --- | --- |
| `/`, `/method`, `/about`, `/contact` | 1 — publik | Janji, metode, kontak. Tanpa angka portofolio, tanpa nama klien. |
| `/login?next=` | 2 — penjaga | Early Access / masuk |
| `/app/portfolio`, `/app/<grup>`, `/app/<grup>/data?refinery=&mill=` | 3 — workspace | Data, peta, unduhan |

Alias ID: `/metodologi`, `/tentang`, `/kontak` → 301 ke URL kanonik.

Bahasa default mengikuti browser (ID untuk browser Indonesia, selain itu EN); pilihan disimpan di `localStorage` `kanopi.lang`.
