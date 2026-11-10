# FireLine — catatan untuk sesi baru

Terakhir diperbarui: 10 November 2026 (siang). Khusus FireLine. PalmTrace/SoyTrace ada di `..\PalmTrace\` dan catatannya di
`..\CLAUDE.md`. Log rinci ruang Indonesia: `docs/fireline-indonesia-NOTES.md`.

## Apa ini

FireLine = pemantauan karhutla di kebun sawit, salah satu produk di bawah **Earthline Trace** (setara PalmTrace dan SoyTrace).
Titik panas NASA FIRMS VIIRS, citra Sentinel-1/2 per kejadian (gaya QuickFire), verifikasi lapangan lewat tautan WhatsApp
bertanda tangan. Aplikasi sendiri (TanStack Start kecil), repo sendiri, deployment sendiri, login sendiri.

## Alamat dan deployment

| Hal | Isi |
|---|---|
| Alamat utama | **https://fireline.earthline-trace.info** (sejak 9 Nov 2026; Let's Encrypt s/d Feb 2027) |
| Alamat lain | `fireline-earthline.vercel.app` (tetap hidup, tautan WhatsApp lama), `fireline-swart.vercel.app` → 307 ke sana |
| Vercel | tim **monitoring9**, project `fireline` (`.vercel/project.json`), akun **sunriseindoltd-ai**, Hobby |
| DNS | Cloudflare akun kantor, zona `earthline-trace.info`: CNAME `fireline` → `34e53e42bf17db4c.vercel-dns-017.com` (DNS only) + TXT `_vercel` (verifikasi, karena domain induk dipegang akun Vercel lain) |
| GitHub | `sunriseindoltd-ai/fireline`; lokal `main` melacak **`origin/standalone`** (sudah sampai `d25047e`). `origin/main` masih berisi commit platform lama `637fe5e` (ikut kode PalmTrace/SoyTrace) — menimpanya = force push, keputusan user |

- **Deploy tanpa ganti login** (sejak 10 Nov): login FireLine disimpan di folder konfigurasi terpisah
  `C:\Users\VICTUS\AppData\Roaming\vercel-fireline` → `npx vercel <perintah> -Q "C:/Users/VICTUS/AppData/Roaming/vercel-fireline"`
  (whoami = sunriseindoltd-ai), sementara CLI biasa tetap generalhostings untuk PalmTrace. Login ulang kalau kedaluwarsa:
  `npx vercel login -Q "<folder itu>"` → buka tautan perangkat yang dicetak, setujui sebagai sunriseindoltd-ai.
- **Deploy terakhir: 10 Nov 2026 `fireline-lrus4hdst` = commit `fe0c037`** (PWA + notifikasi + karmauzco); env VAPID_* + FIRE_CRON_SECRET
  dipasang di project; cek singkat live: manifest/sw/ikon 200, `/fire/push/run` & `/fire/push/key` tanpa izin 401, run dengan rahasia
  `ok` (`first: true`, 540 kasus dicatat sebagai titik awal). Worker cron Cloudflare: lihat bagian notifikasi.
- **Cara lama** (selalu tanya user dulu sebelum deploy): CLI Vercel di mesin ini biasanya login sebagai `generalhostings` (akun PalmTrace) →
  untuk FireLine user harus `npx vercel login` sebagai sunriseindoltd-ai, lalu `npx vite build` dan
  `npx vercel deploy --prebuilt --prod --yes` dari folder ini. Sesudahnya login balik ke generalhostings untuk PalmTrace.
- Kode FireLine tidak perlu tahu domainnya: tautan verifikasi dibuat dari `window.location.origin`, cek Origin di POST berbasis host.
- Deploy terakhir yang tercatat di catatan: `fireline-cgtuw8zws` (19 Okt). Commit `ee70a3e` (29 Okt) dan `d25047e` (2 Nov)
  sudah di-push, tapi apakah sudah di-deploy **tidak tercatat** → cek di dashboard Vercel monitoring9 sebelum deploy berikutnya.

## Ruang kerja dan peran (`src/lib/auth.ts`)

| Peran | Melihat |
|---|---|
| `admin` | Ruang **Indonesia** + ruang **Company** (semua kasus, kontak sales, laporan lapangan) |
| `viewer` | Hanya ruang Indonesia (semua titik panas daratan Indonesia, per provinsi/kabupaten/perusahaan) |
| `company` | Hanya kasus perusahaannya sendiri (cocok nama lewat `match`), plot dinomori per perusahaan, tanpa ID plot/grup rantai pasok |

Akun (password HANYA sebagai hash scrypt di `auth.ts`; teks jelas di `artifacts/akun-fireline.csv`, gitignored):
admin `earthlineadmin`, `karmauzco` (9 Nov, **belum di-deploy**); viewer `demo-indonesia`; company `berkatnabati`, `sumberenim`,
`merbaujaya`, `lonsum`, `permatalestari`. Sesi = JWT cookie `fireline_session` 12 jam, throttle 10 gagal / 10 menit.
Login FireLine TERPISAH dari Earthline Trace (`kanopi_gate`); login sekali untuk semua produk belum dibuat.

## Data

- R2 bucket **`dashboard`** (akun Cloudflare FireLine), prefiks `fire/`. Env: `R2_FIRE_*`, `FIRMS_MAP_KEY`, `FIRE_LINK_SECRET`,
  `FIRE_SESSION_SECRET` (`.env.local`, gitignored).
- Plot = plot PalmTrace (ADM) semua tipe kecuali Independent Smallholder, geometri utuh: `node scripts/prepare-fire-plots.mjs`
  (membaca `..\PalmTrace\private-data\`) → `private-data/fire/v2/` → `node --env-file=.env.local scripts/upload-fire-to-r2.mjs --only=v2/`.
  **Jalankan ulang setiap plot ADM berubah**, lalu bangun cache di lokal dan unggah `fire/v2/cache/latest.json` ke R2
  (kalau tidak, fungsi Vercel membangun dari nol dan bisa kena batas 300 dtk).
- Lapisan: `prepare-fire-layers.py` (RSPO, grid plot, area terbakar KLHK, kontak sales = DATA PRIBADI), `prepare-fire-national.py`
  (ruang Indonesia), `prepare-fire-mills.py` (PKS Universal Mill List), `prepare-mill-points.mjs` (titik rute PKS),
  `prepare-idn-mask.py` (laut + luar Indonesia digelapkan). Upload `--only=layers/`, `--only=national/`, `--only=sales/`.
- `private-data/fire` = junction ke `..\PalmTrace\private-data\fire` (hilang setelah pindah folder 19 Okt → buat ulang dengan `mklink /J`).
- Batas kebun klien: `Customer_Boundary_Updated_January 2026/` (gitignored, jangan dibagikan); plot company dari gisdb di `Data Storage/`.

## Lokal dan uji

- Dev **lokal penuh** (tidak menulis ke R2 production), port **8097**:
  `FIRE_SESSION_SECRET= FIRE_LINK_SECRET= R2_FIRE_ACCOUNT_ID= R2_FIRE_ACCESS_KEY_ID= R2_FIRE_SECRET_ACCESS_KEY= R2_FIRE_BUCKET= node --env-file=.env.local node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 8097 --strictPort`
  (data ke `.dev-inbox/fire/`; muat pertama ±100 dtk). Jalankan dari bash, bukan PowerShell (`$env:X=''` menghapus variabel).
- Token dev: `node .dev-inbox/mint-token.mjs > .dev-inbox/token.txt` (berlaku 12 jam).
- Smoke: `FIRELINE_URL=http://127.0.0.1:8097 FIRELINE_TOKEN=… node scripts/smoke.mjs`. **Uji hanya di lokal**; smoke ke production
  hanya kalau user minta (kuota Vercel Hobby).
- QA Playwright lebih lengkap ada di `..\PalmTrace\scratchpad\tmp-scripts\` (`_tmp-qa-fl2.mjs`, `_fl-round.sh`, dll).
  `_tmp-qa-fire.mjs` lama mengirim laporan uji sungguhan ke R2 — jangan jalankan bagian submit.

## Hubungan dengan Earthline Trace (repo PalmTrace)

- Ubin FireLine di beranda `earthline-trace.info` dan launcher, halaman produk `earthline-trace.info/fireline`, dan tombol
  "Buka FireLine" ada di repo PalmTrace (`src/lib/launcher.ts` `FIRELINE_URL` = `https://fireline.earthline-trace.info`, LIVE 9 Nov).
- Tombol "Masuk" di halaman FireLine Earthline Trace mengarah ke `https://fireline.earthline-trace.info/login`.
- Logo: tiga lingkaran merah (#B3261E/#E5322D/#F4A08C), tulisan "Fire" merah + "Line" abu-abu.

## Aplikasi terpasang (PWA) + notifikasi kebakaran (10 Nov 2026)

- **PWA** (sesi folder FireLine): `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `public/icons/`, `src/lib/pwa.ts`,
  `src/components/install-app.tsx` (tombol "Pasang aplikasi" di header ruang Indonesia, Company, login; iPhone/iPad = petunjuk Share → Add to
  Home Screen). Service worker: build cache-first, ikon/gambar dari cache lalu diperbarui, halaman dari jaringan, **data/API `/fire/…` tidak
  pernah di-cache**, `/fire/verify` yang pernah dibuka tetap terbuka tanpa sinyal. Ubah aturan cache → naikkan `VERSION` di `sw.js`.
- **Notifikasi kebakaran** (Web Push standar, VAPID; user: admin + akun perusahaan, pemicu Cloudflare Worker cron):
  - Tombol "Notifikasi" (`src/components/push-toggle.tsx`) di header; viewer tidak mendapat kunci → tombol tidak tampil. iPhone/iPad hanya
    bisa setelah FireLine dipasang di Layar Utama (tombolnya menjelaskan). Panel: kirim tes, matikan di perangkat ini.
  - Server `src/lib/push.server.ts` + rute `src/routes/fire/push/{key,subscribe,unsubscribe,test,run}.ts`. Langganan di R2 `fire/push/subs.json`
    (hanya nama user; hak akses dibaca ulang saat kirim lewat `inScope`), status `fire/push/state.json` (waktu titik panas terakhir per kasus).
    Endpoint langganan hanya ke layanan push dikenal (FCM, Mozilla, Apple, Windows).
  - `POST /fire/push/run` (header `Authorization: Bearer <FIRE_CRON_SECRET>`): segarkan FIRMS → kasus dengan titik panas lebih baru dari
    pengecekan sebelumnya (dan ≤24 jam) → satu notifikasi per perangkat (beberapa kasus digabung; ketuk = buka `/#inbox/<kasus>`). Admin =
    semua kasus; akun perusahaan = kasus perusahaannya saja (diuji: lonsum tidak menerima kasus perusahaan lain). Pengecekan pertama hanya
    mencatat (tanpa banjir kasus lama). Langganan yang ditolak layanan (404/410) dihapus.
  - Pemicu: `scripts/push-cron-worker.js` = Cloudflare Worker dengan Cron Trigger `*/30 * * * *` + secret `FIRE_CRON_SECRET` (tempel di
    dashboard Cloudflare). Vercel Hobby hanya boleh cron 1×/hari.
  - Env (lokal `.env.local`, production project Vercel `fireline`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
    (`https://fireline.earthline-trace.info`), `FIRE_CRON_SECRET`. Mengganti kunci VAPID = semua langganan lama mati (pengguna harus menyalakan lagi).
  - Uji lokal (port 8098; 8097 sering dipakai sesi FireLine lain): `..\PalmTrace\scratchpad\tmp-scripts\_tmp-qa-fl-push.mjs` (16/16, Chrome
    sungguhan `channel: "chrome"` supaya langganan lewat FCM; notifikasi tes + "2 kasus baru" benar-benar tampil) dan `_tmp-qa-fl-push-company.mjs`
    (akun perusahaan hanya kasusnya sendiri). Smoke lokal 25/25. Dependensi baru: `web-push` 3.6.7 (4.0.0 terlalu baru saat itu).

## Belum di-commit

Tak terlacak dan sengaja tidak di-commit: `FireLine-draft flyer.pptx`, `SHP COMPANY.zip` (batas perusahaan).

## Terbuka

1. Deploy commit 10 Nov (PWA + notifikasi + `karmauzco`): butuh login Vercel sunriseindoltd-ai, env VAPID_* + FIRE_CRON_SECRET di project
   `fireline`, lalu Worker cron di Cloudflare.
2. Ganti password `earthlineadmin` (lemah; sejak 9 Nov juga membuka seluruh Earthline Trace) → perbarui hash di sini DAN di
   `..\PalmTrace\src\lib\gate.ts` (`ADMIN_HASHED_ACCOUNTS`).
3. Nama perusahaan klien Earthline tampil ke semua pemegang akun di ruang Indonesia — perlu izin user.
4. Akun GAPKI/klien, batas blok per perusahaan (tim sales), PBPH/HTI sebagai batas.
5. Tampilan "x" (gelap) vs klasik: mana yang bawaan, tombol klasik tetap ada atau tidak (lihat NOTES bagian 29 Okt).
6. Login sekali untuk semua produk Earthline Trace (tiket bertanda tangan) — belum diputuskan.
