# FireLine (beta)

Fire monitoring on supply-chain plots by Earthline. Standalone build: NASA FIRMS VIIRS hotspots attributed
to Company and Scheme Smallholder plots, Sentinel-1/2 imagery per event (QuickFire view), and field
verification through a signed WhatsApp link.

## Run locally

```
npm install
node --env-file=.env.local node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 8097 --strictPort
```

`.env.local` needs `R2_FIRE_ACCOUNT_ID`, `R2_FIRE_ACCESS_KEY_ID`, `R2_FIRE_SECRET_ACCESS_KEY`, `R2_FIRE_BUCKET`,
`FIRMS_MAP_KEY`, `FIRE_LINK_SECRET`, `FIRE_SESSION_SECRET`.

## Deploy (Vercel, prebuilt)

```
npx vite build
npx vercel deploy --prebuilt
```

## Plot index

Built from PalmTrace plot files (outside this repo): `scripts/prepare-fire-plots.mjs` writes `private-data/fire/`,
`scripts/upload-fire-to-r2.mjs` uploads it to the bucket under `fire/`. Re-run both whenever the plots change.
Note: `prepare-fire-plots.mjs` reads `private-data/plots/` and `private-data/mills.json` from the PalmTrace workspace.
