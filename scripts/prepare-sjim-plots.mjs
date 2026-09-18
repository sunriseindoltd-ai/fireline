#!/usr/bin/env node
/**
 * One-off admin step for the SJIM drop (Data Storage/SJIM - Plot (GeoJSON)/,
 * 192 mill files, see that folder's own SJIM_PIPELINE_NOTES.md for the full
 * GIS lineage). Unlike YORGO/DOMAS, this export has no PlotID/NodeID at all
 * (it's a pre-TRACT master export, not yet id-minted for any platform), so
 * this mints both — unlike prepare-plots.mjs, it does NOT re-derive UML_ID
 * from each feature's own properties, because that field is demonstrably
 * unreliable here.
 *
 * **Critical finding**: cross-checking all 192 files' own `UML_ID` property
 * against mills.json's SJIM roster (matched by mill name) found 27
 * mismatches — almost every "800…"-prefixed mill ID differs between the
 * two, plus one "PO…" case (BUMI HUTANI LESTARI). This matches a known,
 * already-flagged issue in the source spreadsheet ("Sinarjaya Agro - Master
 * Mill" is authoritative; a different sheet's own Mill ID/NodeID pairing is
 * known to be inconsistent for IDs starting with "8" — see
 * SJIM_PIPELINE_NOTES.md). So: **mills.json is treated as the source of
 * truth for identity here, matched by normalized mill name — every
 * feature's own UML_ID and Mill_Name are overwritten with mills.json's
 * values, not trusted from the raw file.**
 *
 * NodeID comes from mills.json's own `nodeId` field (a fixed value per
 * mill, confirmed elsewhere in this project) — 17 SJIM mills had a blank
 * NodeID in mills.json until this same round of work generated one
 * (`2026-IDN-<Mill ID>-1`, synced from the tracking spreadsheet).
 *
 * PlotID is minted with the same scheme as scripts/prepare-plots.mjs's
 * assignPlotIds() (grouped by ID_BPS_2020 prefix, sorted north-to-south/
 * west-to-east within each group) — reused verbatim, not reinvented.
 *
 * `HECTARAGE`/`Hectarage`/`ha`: this drop uses `ha` — see
 * src/lib/ledger-geo.ts's hectarage() for why this needed its own fallback
 * entry (same bug class as DOMAS's `Hectarage` vs `HECTARAGE`).
 *
 * Name-matching required a few manual overrides for spelling/spacing
 * variants between the file name and mills.json's millName (see
 * NAME_OVERRIDES) — everything else matches after normalizing (uppercase,
 * strip PT/CV, collapse non-alphanumerics). Files that still don't match
 * anything in mills.json's SJIM roster are skipped and reported — likely
 * genuinely new mills not yet onboarded, not a matching bug.
 *
 * Usage: node scripts/prepare-sjim-plots.mjs
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = path.join(ROOT, "Data Storage", "SJIM - Plot (GeoJSON)");
const OUT_DIR = path.join(ROOT, "private-data", "plots");
const PRECISION = 7;
const TARGET_PART_BYTES = 20 * 1024 * 1024;

// file basename (no .geojson) -> mills.json millName, for names that don't
// match after normalization (spacing/spelling variants, or an alternate
// name embedded in parentheses in mills.json).
const NAME_OVERRIDES = {
  "ADHYAKSA DHARMA SATYA": "ADHYAKSA DHARMASATYA",
  "UTAMA AGRINDO MAS": "UTAMA AGRINDOMAS",
  "SAMUDRA BIRU CEMERLANG": "SAMUDERA BIRU CEMERLANG (PT. PUTRA BONGAN JAYA)",
  "SAWTIMAS PARENGGEAN": "SAWITMAS PARENGGEAN",
  "ALAM RAYA KENCANA MAS": "SAWIT PERMAI LESTARI ( ALAM RAYA KENCANA MAS )",
  "DHARMA SATYA NUSANTARA MILL 8 (AGRO ANDALAN)": "AGRO ANDALAN",
};

function normName(s) {
  return String(s)
    .toUpperCase()
    .replace(/\b(PT|CV)\b\.?/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function roundCoords(coords, digits) {
  if (typeof coords[0] === "number") return coords.map((n) => Number(n.toFixed(digits)));
  return coords.map((c) => roundCoords(c, digits));
}
function roundGeometry(geometry, digits) {
  if (!geometry || !geometry.coordinates) return geometry;
  return { ...geometry, coordinates: roundCoords(geometry.coordinates, digits) };
}

/** Mirrors prepare-plots.mjs's dedupeExactDuplicates() exactly. */
function dedupeExactDuplicates(features) {
  const groups = new Map();
  for (const f of features) {
    const key = JSON.stringify(f.geometry?.coordinates);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  let removed = 0;
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    kept.push(group[0]);
    removed += group.length - 1;
  }
  return { kept, removed };
}

function bpsPrefix(idBps) {
  const digits = String(idBps ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits.padEnd(6, "0");
  return digits.slice(0, 6);
}

/** Mirrors prepare-plots.mjs's assignPlotIds() exactly, parameterized by
 * this mill's own (mills.json-authoritative) UML_ID instead of re-deriving
 * it from the feature properties. */
function assignPlotIds(features, millUmlId, yymm) {
  const byPrefix = new Map();
  features.forEach((f, index) => {
    const prefix = bpsPrefix(f.properties?.ID_BPS_2020);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(index);
  });

  const plotIds = new Array(features.length);
  for (const [prefix, indices] of byPrefix) {
    indices.sort((ia, ib) => {
      const a = features[ia].properties ?? {};
      const b = features[ib].properties ?? {};
      const latA = Number(a.LAT ?? 0);
      const latB = Number(b.LAT ?? 0);
      if (latB !== latA) return latB - latA;
      const lonA = Number(a.LON ?? 0);
      const lonB = Number(b.LON ?? 0);
      return lonA - lonB;
    });
    indices.forEach((featureIndex, i) => {
      const seq = String(i + 1).padStart(4, "0");
      plotIds[featureIndex] = `IDN${prefix}-${millUmlId}-${yymm}-${seq}`;
    });
  }
  return plotIds;
}

function splitBySize(features, targetBytes) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  for (const f of features) {
    const size = Buffer.byteLength(JSON.stringify(f)) + 1;
    if (current.length > 0 && currentBytes + size > targetBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(f);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function generatedYyMm(now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

async function main() {
  const mills = JSON.parse(await readFile(path.join(ROOT, "private-data", "mills.json"), "utf8"));
  const sjim = mills.filter((m) => m.group === "SJIM");
  const byNormName = new Map(sjim.map((m) => [normName(m.millName), m]));

  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".geojson"));
  console.log(`[prepare-sjim] ${files.length} file(s) in ${SRC_DIR}`);

  const yymm = generatedYyMm();
  let totalFeatures = 0;
  let totalDuped = 0;
  let millsWritten = 0;
  const unmatched = [];

  for (const [i, file] of files.entries()) {
    const start = Date.now();
    const base = file.replace(/\.geojson$/i, "");
    const overrideName = NAME_OVERRIDES[base];
    const mill = byNormName.get(normName(overrideName ?? base));
    if (!mill) {
      unmatched.push(base);
      console.warn(`[prepare-sjim] (${i + 1}/${files.length}) ${base}: no mills.json SJIM match, SKIPPED`);
      continue;
    }

    const raw = JSON.parse(await readFile(path.join(SRC_DIR, file), "utf8"));
    const features = raw.features ?? [];
    if (features.length === 0) {
      console.log(`[prepare-sjim] (${i + 1}/${files.length}) ${base}: no features, skipped`);
      continue;
    }

    const { kept, removed } = dedupeExactDuplicates(features);
    const authoritativeUml = mill.umlId;
    const plotIds = assignPlotIds(kept, authoritativeUml, yymm);
    const withIds = kept.map((f, idx) => ({
      type: "Feature",
      properties: {
        ...(f.properties ?? {}),
        UML_ID: authoritativeUml, // overwrite — the raw file's own value is unreliable (see header comment)
        Mill_Name: mill.millName,
        PlotID: plotIds[idx],
        NodeID: mill.nodeId,
      },
      geometry: roundGeometry(f.geometry, PRECISION),
    }));

    const chunks = splitBySize(withIds, TARGET_PART_BYTES);
    for (const [n, chunk] of chunks.entries()) {
      const suffix = n === 0 ? "" : `.part${n + 1}`;
      const outPath = path.join(OUT_DIR, `${mill.id}${suffix}.geojson`);
      await writeFile(outPath, JSON.stringify({ type: "FeatureCollection", features: chunk }));
    }

    totalFeatures += withIds.length;
    totalDuped += removed;
    millsWritten += 1;
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const dupNote = removed > 0 ? `, ${removed} exact dup(s) dropped` : "";
    const partNote = chunks.length > 1 ? `, split into ${chunks.length} parts` : "";
    console.log(
      `[prepare-sjim] (${i + 1}/${files.length}) ${mill.millName} [${mill.id}]: ${withIds.length} plots${dupNote}${partNote} in ${secs}s`,
    );
  }

  console.log(
    `\n[prepare-sjim] done — ${totalFeatures} plot(s) across ${millsWritten} mill(s), ${totalDuped} exact duplicate(s) dropped -> private-data/plots/`,
  );
  if (unmatched.length) {
    console.log(`[prepare-sjim] ${unmatched.length} file(s) had no mills.json SJIM match:`, unmatched);
  }
}

main().catch((err) => {
  console.error("[prepare-sjim] failed:", err?.message || err);
  process.exit(1);
});
