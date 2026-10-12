/**
 * Fire monitoring (FireLine) — server side.
 *
 * Detections come from NASA FIRMS (VIIRS 375 m, three satellites) for the
 * Indonesia bounding box, seven days back. Detections from different
 * satellites/passes of the same fire are grouped into one *event* per UTC day
 * per ~0.004° (≈ 450 m) grid cell. Each event is then attributed to the
 * nearest Company / Scheme Smallholder plot within ATTRIB_M, using the
 * cell-partitioned plot index written by scripts/prepare-fire-plots.mjs
 * (private-data/fire/, uploaded to the fire bucket under fire/).
 *
 * Storage: the fire bucket (R2_FIRE_* env; local dev without it reads
 * private-data/fire/ and writes to .dev-inbox/fire/). Results are cached for
 * CACHE_MS so a page open does not hit FIRMS every time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { CELL, cellsAround, plotDistanceM, type FirePlot } from "@/lib/fire-geo";

export const ATTRIB_M = 500;
export const DAYS = 7;
const CACHE_MS = 15 * 60 * 1000;
const CLUSTER_DEG = 0.004;
const BBOX = "95,-11,141,6"; // Indonesia (west,south,east,north)
const SOURCES = ["VIIRS_NOAA21_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"] as const;

export type FireEvent = {
  id: string;
  /** UTC day of acquisition (YYYY-MM-DD). */
  date: string;
  /** First and last acquisition, ISO UTC. */
  first: string;
  last: string;
  lat: number;
  lon: number;
  /** Detections grouped into this event, and the satellites that saw it. */
  n: number;
  sats: string[];
  /** Max fire radiative power (MW) and the best confidence seen (l/n/h). */
  frp: number;
  conf: "l" | "n" | "h";
  /** Metres from the event centre to the attributed plot (0 = inside it). */
  d: number;
  /** Distinct plots within ATTRIB_M. */
  near: number;
  plot: Omit<FirePlot, "g" | "bbox"> & { g: FirePlot["g"] };
};

export type FireVerification = {
  at: string;
  status: "active" | "extinguished" | "false_alarm";
  note: string;
  by: string;
  lat?: number;
  lon?: number;
  photo?: string;
};

export type FireData = {
  generated: string;
  days: number;
  /** All detections in the bounding box (context only). */
  detections: number;
  events: FireEvent[];
};

// ---------------------------------------------------------------- storage

type Store = { client: AwsClient; base: string };
let store: Store | null | undefined;
function fireStore(): Store | null {
  if (store !== undefined) return store;
  const acc = process.env.R2_FIRE_ACCOUNT_ID,
    key = process.env.R2_FIRE_ACCESS_KEY_ID,
    secret = process.env.R2_FIRE_SECRET_ACCESS_KEY,
    bucket = process.env.R2_FIRE_BUCKET;
  store =
    acc && key && secret && bucket
      ? { client: new AwsClient({ accessKeyId: key, secretAccessKey: secret }), base: `https://${acc}.r2.cloudflarestorage.com/${bucket}` }
      : null;
  return store;
}
const DEV_DIR = path.join(process.cwd(), ".dev-inbox", "fire");
const LOCAL_DIR = path.join(process.cwd(), "private-data", "fire");
let localIndex: boolean | undefined;
function hasLocalIndex() {
  localIndex ??= existsSync(path.join(LOCAL_DIR, "cells-index.json"));
  return localIndex;
}

async function getObject(key: string, local = DEV_DIR): Promise<Buffer | null> {
  const s = fireStore();
  // Local dev: the plot index on disk wins over the bucket (same files,
  // no 1,000 round trips per refresh). Production has no private-data/.
  if (!s || (local === LOCAL_DIR && hasLocalIndex())) {
    try {
      return await readFile(path.join(local, key.replace(/^fire\//, "")));
    } catch {
      return null;
    }
  }
  const res = await s.client.fetch(`${s.base}/${key.split("/").map(encodeURIComponent).join("/")}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fire store GET ${key}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const s = fireStore();
  if (!s) {
    const abs = path.join(DEV_DIR, key.replace(/^fire\//, ""));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
    return;
  }
  const res = await s.client.fetch(`${s.base}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: typeof body === "string" ? body : new Uint8Array(body),
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new Error(`fire store PUT ${key}: ${res.status}`);
}
const getJson = async <T>(key: string, local?: string): Promise<T | null> => {
  const b = await getObject(key, local);
  return b ? (JSON.parse(b.toString("utf8")) as T) : null;
};

// ------------------------------------------------------------- plot index

type CellIndex = { cell: number; generated: string; plots: number; cells: Record<string, { n: number; bbox: number[] }> };
let cellIndexP: Promise<CellIndex | null> | undefined;
function cellIndex() {
  cellIndexP ??= getJson<CellIndex>("fire/cells-index.json", LOCAL_DIR);
  return cellIndexP;
}
const cellCache = new Map<string, Promise<FirePlot[]>>();
function cellPlots(id: string): Promise<FirePlot[]> {
  let p = cellCache.get(id);
  if (!p) {
    p = getJson<FirePlot[]>(`fire/cells/${id}.json`, LOCAL_DIR).then((v) => v ?? []);
    cellCache.set(id, p);
    if (cellCache.size > 1500) cellCache.delete(cellCache.keys().next().value!);
  }
  return p;
}

// ------------------------------------------------------------------ FIRMS

type Detection = { lat: number; lon: number; date: string; time: string; sat: string; conf: string; frp: number };

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchFirms(): Promise<Detection[]> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new Error("FIRMS_MAP_KEY not configured");
  const today = new Date();
  const earlier = new Date(today.getTime() - 6 * 86400000);
  // The area API allows at most 5 days per call: today back 5 days, plus two
  // days starting six days ago.
  const calls: string[] = [];
  for (const src of SOURCES) {
    calls.push(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${BBOX}/5`);
    calls.push(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${BBOX}/2/${isoDay(earlier)}`);
  }
  const seen = new Set<string>();
  const out: Detection[] = [];
  const texts = await Promise.all(
    calls.map(async (u) => {
      const res = await fetch(u, { signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("latitude")) throw new Error(`FIRMS ${res.status}: ${text.slice(0, 120)}`);
      return text;
    }),
  );
  for (const text of texts) {
    const lines = text.trim().split("\n");
    const head = lines[0].split(",");
    const ix = (k: string) => head.indexOf(k);
    const iLat = ix("latitude"), iLon = ix("longitude"), iDate = ix("acq_date"), iTime = ix("acq_time"), iSat = ix("satellite"), iConf = ix("confidence"), iFrp = ix("frp");
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      const d: Detection = { lat: +c[iLat], lon: +c[iLon], date: c[iDate], time: c[iTime].padStart(4, "0"), sat: c[iSat], conf: c[iConf], frp: +c[iFrp] || 0 };
      const k = `${d.lat},${d.lon},${d.date},${d.time},${d.sat}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}

const CONF_RANK: Record<string, number> = { l: 0, n: 1, h: 2 };
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

async function buildEvents(dets: Detection[]): Promise<FireEvent[]> {
  const idx = await cellIndex();
  if (!idx) throw new Error("fire plot index missing");
  type Group = { id: string; date: string; dets: Detection[] };
  const groups = new Map<string, Group>();
  for (const d of dets) {
    const ky = Math.floor(d.lat / CLUSTER_DEG), kx = Math.floor(d.lon / CLUSTER_DEG);
    const id = `${d.date.replace(/-/g, "")}_${ky}_${kx}`;
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, date: d.date, dets: [] }));
    g.dets.push(d);
  }
  // Centre each group once, collect the cells it touches, and fetch those
  // cells with bounded concurrency before the (sequential) attribution loop.
  const centred = [...groups.values()].map((g) => {
    const lat = g.dets.reduce((a, d) => a + d.lat, 0) / g.dets.length;
    const lon = g.dets.reduce((a, d) => a + d.lon, 0) / g.dets.length;
    return { g, lat, lon, ids: cellsAround(lon, lat, ATTRIB_M).filter((i) => idx.cells[i]) };
  });
  const wanted = [...new Set(centred.flatMap((c) => c.ids))].filter((id) => !cellCache.has(id));
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (wanted.length) await cellPlots(wanted.shift()!);
  }));
  const events: FireEvent[] = [];
  for (const { g, lat, lon, ids } of centred) {
    if (!ids.length) continue;
    let best: { d: number; p: FirePlot } | null = null;
    const nearIds = new Set<string>();
    for (const cid of ids) {
      for (const p of await cellPlots(cid)) {
        const d = plotDistanceM(lon, lat, p, ATTRIB_M);
        if (d === Infinity) continue;
        nearIds.add(p.id);
        if (!best || d < best.d) best = { d, p };
      }
    }
    if (!best) continue;
    const times = g.dets.map((d) => `${d.date}T${d.time.slice(0, 2)}:${d.time.slice(2)}:00Z`).sort();
    const { g: ring, bbox: _b, ...plot } = best.p;
    void _b;
    events.push({
      id: g.id,
      date: g.date,
      first: times[0],
      last: times[times.length - 1],
      lat: r5(lat),
      lon: r5(lon),
      n: g.dets.length,
      sats: [...new Set(g.dets.map((d) => d.sat))].sort(),
      frp: Math.max(...g.dets.map((d) => d.frp)),
      conf: g.dets.reduce<"l" | "n" | "h">((a, d) => (CONF_RANK[d.conf] > CONF_RANK[a] ? (d.conf as "l" | "n" | "h") : a), "l"),
      d: Math.round(best.d),
      near: nearIds.size,
      plot: { ...plot, g: ring },
    });
  }
  events.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  return events;
}

// ------------------------------------------------------------------ cache

let memo: { at: number; data: Promise<FireData> } | null = null;

/** Events for the last DAYS days, from cache when fresh (CACHE_MS). */
export async function loadFireData(): Promise<FireData> {
  if (memo && Date.now() - memo.at < CACHE_MS) return memo.data;
  const p = (async () => {
    const cached = await getJson<FireData>("fire/cache/latest.json").catch(() => null);
    if (cached && Date.now() - Date.parse(cached.generated) < CACHE_MS) return cached;
    const dets = await fetchFirms();
    const events = await buildEvents(dets);
    const data: FireData = { generated: new Date().toISOString(), days: DAYS, detections: dets.length, events };
    await putObject("fire/cache/latest.json", JSON.stringify(data), "application/json").catch((e) => console.error("[fire] cache write failed", e));
    return data;
  })();
  memo = { at: Date.now(), data: p };
  p.catch(() => {
    memo = null;
  });
  return p;
}

/** Only the groups a session may see (null = everything). */
export function filterFireEvents(events: FireEvent[], allowed: { groups?: readonly string[]; umls?: readonly string[] } | null) {
  if (!allowed) return events;
  const groups = new Set(allowed.groups ?? []);
  const umls = new Set(allowed.umls ?? []);
  return events.filter((e) => groups.has(e.plot.group) || umls.has(e.plot.uml));
}

// ---------------------------------------------------------- verifications

type VerificationFile = { eventId: string; entries: FireVerification[] };
export type VerificationIndex = Record<string, { status: FireVerification["status"]; at: string; n: number; by: string }>;

export async function loadVerificationIndex(): Promise<VerificationIndex> {
  return (await getJson<VerificationIndex>("fire/verifications/_index.json")) ?? {};
}
export async function loadVerifications(eventId: string): Promise<FireVerification[]> {
  return (await getJson<VerificationFile>(`fire/verifications/${safeId(eventId)}.json`))?.entries ?? [];
}
export async function addVerification(eventId: string, v: FireVerification): Promise<void> {
  const id = safeId(eventId);
  const file = (await getJson<VerificationFile>(`fire/verifications/${id}.json`)) ?? { eventId: id, entries: [] };
  file.entries.push(v);
  await putObject(`fire/verifications/${id}.json`, JSON.stringify(file), "application/json");
  const index = await loadVerificationIndex();
  index[id] = { status: v.status, at: v.at, n: file.entries.length, by: v.by };
  await putObject("fire/verifications/_index.json", JSON.stringify(index), "application/json");
}
export async function savePhoto(eventId: string, bytes: Buffer): Promise<string> {
  const name = `${safeId(eventId)}/${Date.now()}.jpg`;
  await putObject(`fire/photos/${name}`, bytes, "image/jpeg");
  return name;
}
export async function loadPhoto(name: string): Promise<Buffer | null> {
  if (!/^[\w-]+\/\d+\.jpg$/.test(name)) return null;
  return getObject(`fire/photos/${name}`);
}

export function safeId(id: string) {
  return id.replace(/[^\w-]/g, "").slice(0, 60);
}

/** Event summary for the verification page (no session: the link is signed). */
export async function findFireEvent(eventId: string): Promise<FireEvent | null> {
  const data = await loadFireData();
  return data.events.find((e) => e.id === eventId) ?? null;
}

// ------------------------------------------------------------ signed links

function secret() {
  return process.env.FIRE_LINK_SECRET || process.env.R2_FIRE_SECRET_ACCESS_KEY || "fireline-dev-secret";
}
export const LINK_TTL_MS = 7 * 86400000;

/** `e=<id>&x=<exp>&s=<sig>` — valid for LINK_TTL_MS, no login needed. */
export function signVerifyLink(eventId: string, now = Date.now()): { e: string; x: string; s: string } {
  const e = safeId(eventId);
  const x = String(now + LINK_TTL_MS);
  const s = createHmac("sha256", secret()).update(`${e}.${x}`).digest("hex").slice(0, 32);
  return { e, x, s };
}
export function verifyLink(e: string, x: string, s: string): boolean {
  if (!/^\d+$/.test(x) || Number(x) < Date.now()) return false;
  const want = createHmac("sha256", secret()).update(`${safeId(e)}.${x}`).digest("hex").slice(0, 32);
  return s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want));
}
