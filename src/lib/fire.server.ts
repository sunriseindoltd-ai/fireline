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
 * OPEN_MAX_MS (page open) or REFRESH_MIN_MS (Refresh button).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { CELL, cellsAround, plotDistanceM, type FirePlot } from "@/lib/fire-geo";

export const ATTRIB_M = 500;
/** Shortest operational case window (days), and the value stored in the cache. */
export const DAYS = 7;
/** Days of data kept for History and fire events (4 weeks). */
export const SPAN_DAYS = 28;
/**
 * Start of the operational case window (inbox, map, summary): the 2026 haze season, from 1 October
 * (Singapore's haze ran from 5 Oct). FIRE_WINDOW_FROM overrides it; the window is never shorter than
 * DAYS nor longer than SPAN_DAYS.
 */
const WINDOW_FROM = process.env.FIRE_WINDOW_FROM || "2026-10-01";
export function caseWindow(generated: string): { from: string; days: number } {
  const t = Date.parse(generated);
  const back = (n: number) => isoDay(new Date(t - (n - 1) * 86400000)); // first day of an n-day window ending today (event dates are FIRMS dates)
  let from = WINDOW_FROM < back(DAYS) ? WINDOW_FROM : back(DAYS);
  if (from < back(SPAN_DAYS)) from = back(SPAN_DAYS);
  return { from, days: Math.round((Date.parse(back(1)) - Date.parse(from)) / 86400000) + 1 };
}
/** A refresh with a full-span cache re-fetches only this many latest days; older events are carried over. */
export const FETCH_RECENT_DAYS = 10;
export const CLUSTER_DEG = 0.004;
const BBOX = "95,-11,141,6"; // Indonesia (west,south,east,north)
const SOURCES = ["VIIRS_NOAA21_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"] as const;

/** A plot's description without its geometry (shapes travel once, in FireData.shapes). */
export type PlotMeta = Omit<FirePlot, "g" | "bbox">;

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
  plot: PlotMeta;
};

/** One affected plot inside a case. */
export type CasePlot = { id: string; d: number; n: number; last: string };

/**
 * What the dashboard works with: one *case* per company (or, for plots with no
 * company name, per plot type and village) over the whole period — every
 * hotspot and every plot of that company together, so one estate is one
 * alert, one field visit and one report (user decision, 19 Oct 2026).
 * Derived from FireData.events on read.
 */
export type FireIncident = {
  /** `c_<company slug>`: stable across days, so reports stay with the company. */
  id: string;
  /** Company name, or "<type> · <village>" when the plots carry none. */
  name: string;
  kind: "company" | "area";
  /** WIB day of the latest detection. */
  day: string;
  /** Hotspots per WIB day, oldest first. */
  days: { day: string; n: number }[];
  first: string;
  last: string;
  /** The strongest hotspot of the latest day: where to send people. */
  lat: number;
  lon: number;
  /** Detections, and the events (≈450 m clusters) they formed. */
  n: number;
  events: number;
  /** Every event point: [lon, lat, frp, index into days]. */
  pts: [number, number, number, number][];
  /** Event ids folded in (old alert links carry one of these). */
  ev: string[];
  sats: string[];
  frp: number;
  conf: "l" | "n" | "h";
  /** Closest hotspot to a plot (m, 0 = inside). */
  d: number;
  near: number;
  /** The plot of the strongest latest hotspot (mill, group, place). */
  plot: PlotMeta;
  /** Every affected plot, nearest/most detections first. */
  plots: CasePlot[];
  mills: string[];
  groups: string[];
};

export type FireVerification = {
  at: string;
  status: "active" | "extinguished" | "false_alarm";
  note: string;
  by: string;
  lat?: number;
  lon?: number;
  /** First photo (older reports have only this); `photos` lists all, up to 3. */
  photo?: string;
  photos?: string[];
  /** Recorded at the office (phoned in), not from the field link. */
  office?: boolean;
};

export type FireData = {
  generated: string;
  days: number;
  /** Days of data held (SPAN_DAYS); absent in caches written before 19 Oct 2026. */
  span?: number;
  /** All detections in the bounding box (not shown: only plots ≤ ATTRIB_M count). */
  detections: number;
  events: FireEvent[];
  /** Exact PalmTrace geometry of every plot an event is attributed to. */
  shapes: Record<string, FirePlot["g"]>;
  /** cells-index.json `generated` the events were attributed against. */
  plots?: string;
  /** Set when FIRMS could not be reached and this is the last good result. */
  refreshFailed?: boolean;
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
export const LOCAL_DIR = path.join(process.cwd(), "private-data", "fire");
let localIndex: boolean | undefined;
function hasLocalIndex() {
  localIndex ??= existsSync(path.join(LOCAL_DIR, "v2", "cells-index.json"));
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
/**
 * Read-modify-write of one key, one at a time on this instance, so two reports
 * arriving together don't overwrite each other's index entry.
 */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

/** POSTs that use the session cookie must come from this site. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers, curl
  try {
    return new URL(origin).host === new URL(request.url).host || new URL(origin).host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

/** JPEG / PNG / WebP by their first bytes; anything else is refused. */
export function photoType(b: Buffer): "jpg" | "png" | "webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const s = fireStore();
  if (!s) {
    const abs = path.join(DEV_DIR, key.replace(/^fire\//, ""));
    await mkdir(path.dirname(abs), { recursive: true });
    // Write then rename, so a reader never sees a half-written file.
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, abs);
    return;
  }
  const res = await s.client.fetch(`${s.base}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: typeof body === "string" ? body : new Uint8Array(body),
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new Error(`fire store PUT ${key}: ${res.status}`);
}
export const getJson = async <T>(key: string, local?: string): Promise<T | null> => {
  const b = await getObject(key, local);
  return b ? (JSON.parse(b.toString("utf8")) as T) : null;
};

// ------------------------------------------------------------- plot index

type CellIndex = { cell: number; generated: string; plots: number; cells: Record<string, { n: number; bbox: number[] }> };
let cellIndexP: Promise<CellIndex | null> | undefined;
function cellIndex() {
  cellIndexP ??= getJson<CellIndex>("fire/v2/cells-index.json", LOCAL_DIR);
  return cellIndexP;
}
const cellCache = new Map<string, Promise<FirePlot[]>>();
function cellPlots(id: string): Promise<FirePlot[]> {
  let p = cellCache.get(id);
  if (!p) {
    p = getJson<FirePlot[]>(`fire/v2/cells/${id}.json`, LOCAL_DIR).then((v) => v ?? []);
    cellCache.set(id, p);
    if (cellCache.size > 1500) cellCache.delete(cellCache.keys().next().value!);
  }
  return p;
}

// ------------------------------------------------------------------ FIRMS

export type Detection = { lat: number; lon: number; date: string; time: string; sat: string; conf: string; frp: number };

export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchFirms(days: number): Promise<Detection[]> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new Error("FIRMS_MAP_KEY not configured");
  const today = new Date();
  // The area API allows at most 5 days per call ("Expects [1..5]"): the latest
  // block without a date, then 5-day blocks backwards with an explicit start.
  const calls: string[] = [];
  for (const src of SOURCES) {
    let covered = 0;
    while (covered < days) {
      const n = Math.min(5, days - covered);
      const start = new Date(today.getTime() - (covered + n - 1) * 86400000);
      calls.push(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${BBOX}/${n}${covered ? `/${isoDay(start)}` : ""}`);
      covered += n;
    }
  }
  const seen = new Set<string>();
  const out: Detection[] = [];
  // FIRMS is sometimes slow: at most 4 calls at once, 60 s each, one retry.
  const one = async (u: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
        const text = await res.text();
        if (!res.ok || !text.startsWith("latitude")) throw new Error(`FIRMS ${res.status}: ${text.slice(0, 120)}`);
        return text;
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };
  const texts: string[] = new Array(calls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < calls.length) {
        const i = next++;
        texts[i] = await one(calls[i]);
      }
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

/**
 * The national view and the supply-chain cases refresh together: the second asks for the same days within
 * a minute and a half and gets the same fetch instead of calling FIRMS again.
 */
const firmsMemo = new Map<number, { at: number; p: Promise<Detection[]> }>();
export function fetchFirmsShared(days: number): Promise<Detection[]> {
  const hit = firmsMemo.get(days);
  if (hit && Date.now() - hit.at < 90000) return hit.p;
  const p = fetchFirms(days);
  firmsMemo.set(days, { at: Date.now(), p });
  p.catch(() => firmsMemo.delete(days));
  return p;
}

export const CONF_RANK: Record<string, number> = { l: 0, n: 1, h: 2 };
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * `prev` (the last cached result, same plot index) lets a refresh reuse every
 * event whose detections did not change, so only new or grown events need
 * plot cells fetched from storage.
 */
async function buildEvents(dets: Detection[], prev: FireEvent[] = [], prevShapes: FireData["shapes"] = {}): Promise<{ events: FireEvent[]; shapes: FireData["shapes"] }> {
  const idx = await cellIndex();
  if (!idx) throw new Error("fire plot index missing");
  const reuse = new Map(prev.map((e) => [e.id, e]));
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
  const kept: FireEvent[] = [];
  const todo = [...groups.values()].filter((g) => {
    const old = reuse.get(g.id);
    if (old && old.n === g.dets.length) {
      kept.push(old);
      return false;
    }
    return true;
  });
  const centred = todo.map((g) => {
    const lat = g.dets.reduce((a, d) => a + d.lat, 0) / g.dets.length;
    const lon = g.dets.reduce((a, d) => a + d.lon, 0) / g.dets.length;
    return { g, lat, lon, ids: cellsAround(lon, lat, ATTRIB_M).filter((i) => idx.cells[i]) };
  });
  const wanted = [...new Set(centred.flatMap((c) => c.ids))].filter((id) => !cellCache.has(id));
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (wanted.length) await cellPlots(wanted.shift()!);
  }));
  const events: FireEvent[] = [];
  const shapes: FireData["shapes"] = {};
  for (const e of kept) if (prevShapes[e.plot.id]) shapes[e.plot.id] = prevShapes[e.plot.id];
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
    shapes[plot.id] = ring;
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
      plot,
    });
  }
  events.push(...kept);
  events.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  return { events, shapes };
}

// ------------------------------------------------------------------ cache

let memo: { at: number; data: Promise<FireData> } | null = null;
/** v2 = exact plot geometry + shapes map (the old key belongs to the previous build). */
const CACHE_KEY = "fire/v2/cache/latest.json";

/** Events for the last DAYS days. */
/** Minimum age before a manual refresh may hit FIRMS again. */
export const REFRESH_MIN_MS = 2 * 60 * 1000;

/**
 * Opening the page uses the stored result while it is under OPEN_MAX_MS old
 * (the header shows its time); the Refresh button fetches FIRMS again once
 * the data is over REFRESH_MIN_MS old. Nothing refreshes on a timer.
 */
// FIRE_OPEN_MAX_H (optional, dev): keep using the stored result longer, e.g. to recompute deck numbers from a fixed snapshot.
export const OPEN_MAX_MS = (Number(process.env.FIRE_OPEN_MAX_H) || 3) * 3600 * 1000;

export async function loadFireData(opts: { refresh?: boolean } = {}): Promise<FireData> {
  const maxAge = opts.refresh ? REFRESH_MIN_MS : OPEN_MAX_MS;
  // Judge freshness by the data's own timestamp, not by when it was read.
  if (memo && Date.now() - memo.at < maxAge) {
    const d = await memo.data.catch(() => null);
    if (d && Date.now() - Date.parse(d.generated) < maxAge) return d;
  }
  const p = (async () => {
    const cached = await getJson<FireData>(CACHE_KEY).catch(() => null);
    if (cached && Date.now() - Date.parse(cached.generated) < maxAge) return cached;
    let dets: Detection[];
    const idx = await cellIndex().catch(() => null);
    const sameIndex = !!cached && !!idx && cached.plots === idx.generated;
    // Same plots and a full-span cache: fetch only the latest days; the older events are carried over below.
    const quick = sameIndex && cached!.span === SPAN_DAYS;
    try {
      dets = await fetchFirmsShared(quick ? FETCH_RECENT_DAYS : SPAN_DAYS);
    } catch (e) {
      // FIRMS down or slow: keep showing the last good result, flagged.
      if (cached) {
        console.error("[fire] FIRMS fetch failed, serving cached data", e);
        return { ...cached, refreshFailed: true };
      }
      throw e;
    }
    const { events, shapes } = await buildEvents(dets, sameIndex ? cached!.events : [], sameIndex ? cached!.shapes : {});
    let detections = dets.length;
    if (quick) {
      const t = Date.now();
      const fetchedFrom = isoDay(new Date(t - (FETCH_RECENT_DAYS - 1) * 86400000));
      const oldest = isoDay(new Date(t - (SPAN_DAYS - 1) * 86400000));
      for (const e of cached!.events) {
        if (e.date >= fetchedFrom || e.date < oldest) continue;
        events.push(e);
        detections += e.n;
        if (!shapes[e.plot.id] && cached!.shapes[e.plot.id]) shapes[e.plot.id] = cached!.shapes[e.plot.id];
      }
    }
    const data: FireData = { generated: new Date().toISOString(), days: DAYS, span: SPAN_DAYS, detections, events, shapes, plots: idx?.generated };
    await putObject(CACHE_KEY, JSON.stringify(data), "application/json").catch((e) => console.error("[fire] cache write failed", e));
    return data;
  })();
  memo = { at: Date.now(), data: p };
  p.then(
    (d) => {
      if (d.refreshFailed) memo = null;
    },
    () => {
      memo = null;
    },
  );
  return p;
}

/** Only the groups a session may see (null = everything). (Unused by the single-account build.) */
export function filterFireEvents(events: FireEvent[], allowed: { groups?: readonly string[]; umls?: readonly string[] } | null) {
  if (!allowed) return events;
  const groups = new Set(allowed.groups ?? []);
  const umls = new Set(allowed.umls ?? []);
  return events.filter((e) => groups.has(e.plot.group) || umls.has(e.plot.uml));
}

// -------------------------------------------------------------- incidents

const WIB_MS = 7 * 3600000;
export const wibDayOf = (iso: string) => new Date(Date.parse(iso) + WIB_MS).toISOString().slice(0, 10);

/** Case key: the company, else plot type + village (smallholder plots often carry no company). */
export function caseKey(p: PlotMeta): { key: string; name: string; kind: FireIncident["kind"] } {
  const company = p.company.replace(/\s+/g, " ").trim();
  if (company && company !== "-" && !/^\?+$/.test(company)) return { key: company.toUpperCase(), name: company, kind: "company" };
  const place = p.village || p.district || p.mill || "—";
  const name = `${p.type || "Plot"} · ${place}`;
  return { key: name.toUpperCase(), name, kind: "area" };
}
const caseId = (key: string) => `c_${key.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60);

export function toIncidents(events: FireEvent[]): FireIncident[] {
  const by = new Map<string, { k: ReturnType<typeof caseKey>; list: FireEvent[] }>();
  for (const e of events) {
    const k = caseKey(e.plot);
    const id = caseId(k.key);
    const g = by.get(id);
    if (g) g.list.push(e);
    else by.set(id, { k, list: [e] });
  }
  const out: FireIncident[] = [];
  for (const [id, { k, list }] of by) {
    const dayOf = (e: FireEvent) => wibDayOf(e.first);
    const dayN = new Map<string, number>();
    for (const e of list) dayN.set(dayOf(e), (dayN.get(dayOf(e)) ?? 0) + e.n);
    const days = [...dayN.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, n]) => ({ day, n }));
    const lastDay = days[days.length - 1].day;
    const latest = list.filter((e) => dayOf(e) === lastDay);
    const top = latest.reduce((a, e) => (e.frp > a.frp ? e : a), latest[0]);
    const plots = new Map<string, CasePlot>();
    for (const e of list) {
      const cp = plots.get(e.plot.id);
      if (!cp) plots.set(e.plot.id, { id: e.plot.id, d: e.d, n: e.n, last: e.last });
      else {
        cp.d = Math.min(cp.d, e.d);
        cp.n += e.n;
        if (e.last > cp.last) cp.last = e.last;
      }
    }
    const dayIdx = new Map(days.map((d, i) => [d.day, i]));
    out.push({
      id,
      name: k.name,
      kind: k.kind,
      day: lastDay,
      days,
      first: list.reduce((a, e) => (e.first < a ? e.first : a), list[0].first),
      last: list.reduce((a, e) => (e.last > a ? e.last : a), list[0].last),
      lat: top.lat,
      lon: top.lon,
      n: list.reduce((a, e) => a + e.n, 0),
      events: list.length,
      pts: list.map((e) => [e.lon, e.lat, e.frp, dayIdx.get(dayOf(e)) ?? 0] as [number, number, number, number]),
      ev: list.map((e) => e.id),
      sats: [...new Set(list.flatMap((e) => e.sats))].sort(),
      frp: Math.max(...list.map((e) => e.frp)),
      conf: list.reduce<"l" | "n" | "h">((a, e) => (CONF_RANK[e.conf] > CONF_RANK[a] ? e.conf : a), "l"),
      d: Math.min(...list.map((e) => e.d)),
      near: Math.max(...list.map((e) => e.near)),
      plot: top.plot,
      plots: [...plots.values()].sort((a, b) => a.d - b.d || b.n - a.n),
      mills: [...new Set(list.map((e) => e.plot.mill).filter(Boolean))].sort(),
      groups: [...new Set(list.map((e) => e.plot.group).filter(Boolean))].sort(),
    });
  }
  out.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  return out;
}

let incMemo: { generated: string; list: FireIncident[]; history: FireIncident[]; meta: Record<string, PlotMeta> } | null = null;
/**
 * Cases of the current data (memoised per FIRMS fetch): `incidents` = the case
 * window (caseWindow: since 1 Oct, inbox, map, summary), `history` = the same companies over the whole
 * SPAN_DAYS (History tab, fire events). Same ids, so reports apply to both.
 */
export async function loadFireIncidents(opts: { refresh?: boolean } = {}): Promise<{ data: FireData; incidents: FireIncident[]; history: FireIncident[]; meta: Record<string, PlotMeta> }> {
  const data = await loadFireData(opts);
  if (!incMemo || incMemo.generated !== data.generated) {
    const meta: Record<string, PlotMeta> = {};
    for (const e of data.events) meta[e.plot.id] ??= e.plot;
    const { from } = caseWindow(data.generated);
    incMemo = { generated: data.generated, list: toIncidents(data.events.filter((e) => e.date >= from)), history: toIncidents(data.events), meta };
  }
  return { data, incidents: incMemo.list, history: incMemo.history, meta: incMemo.meta };
}

// ---------------------------------------------------------- verifications

type VerificationFile = { eventId: string; entries: FireVerification[] };
/** What the incident was, kept with its reports so they outlive the 7-day FIRMS window. */
export type IncidentSnapshot = Pick<FireIncident, "name" | "kind" | "day" | "days" | "first" | "last" | "lat" | "lon" | "n" | "frp" | "d" | "mills" | "groups"> & {
  plot: PlotMeta;
  plots: number;
};
export type VerificationIndex = Record<string, { status: FireVerification["status"]; at: string; n: number; by: string; s?: IncidentSnapshot }>;
export function snapshotOf(i: FireIncident): IncidentSnapshot {
  return {
    name: i.name, kind: i.kind, day: i.day, days: i.days, first: i.first, last: i.last, lat: i.lat, lon: i.lon,
    n: i.n, frp: i.frp, d: i.d, mills: i.mills, groups: i.groups, plot: i.plot, plots: i.plots.length,
  };
}

/** A context layer GeoJSON (fire/layers/<name>.geojson) as raw bytes, or null. */
export async function loadFireLayer(name: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  return getObject(`fire/layers/${name}.geojson`, LOCAL_DIR);
}
/** Sales-team attribution file (fire/sales/contacts.json), or null. */
export async function loadSalesContacts(): Promise<Buffer | null> {
  return getObject("fire/sales/contacts.json", LOCAL_DIR);
}

export async function loadVerificationIndex(): Promise<VerificationIndex> {
  return (await getJson<VerificationIndex>("fire/verifications/_index.json")) ?? {};
}
export async function loadVerifications(eventId: string): Promise<FireVerification[]> {
  return (await getJson<VerificationFile>(`fire/verifications/${safeId(eventId)}.json`))?.entries ?? [];
}
export async function addVerification(eventId: string, v: FireVerification, snap?: IncidentSnapshot): Promise<void> {
  const id = safeId(eventId);
  const n = await withLock(`v:${id}`, async () => {
    const file = (await getJson<VerificationFile>(`fire/verifications/${id}.json`)) ?? { eventId: id, entries: [] };
    file.entries.push(v);
    await putObject(`fire/verifications/${id}.json`, JSON.stringify(file), "application/json");
    return file.entries.length;
  });
  await withLock("v:_index", async () => {
    const index = await loadVerificationIndex();
    const s = snap ?? index[id]?.s;
    index[id] = { status: v.status, at: v.at, n, by: v.by, ...(s ? { s } : {}) };
    await putObject("fire/verifications/_index.json", JSON.stringify(index), "application/json");
  });
}
const PHOTO_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export async function savePhoto(eventId: string, bytes: Buffer): Promise<string | null> {
  const kind = photoType(bytes);
  if (!kind) return null;
  const name = `${safeId(eventId)}/${Date.now()}.${kind}`;
  await putObject(`fire/photos/${name}`, bytes, PHOTO_MIME[kind]);
  return name;
}
export async function loadPhoto(name: string): Promise<{ bytes: Buffer; type: string } | null> {
  const m = /^[\w-]+\/\d+\.(jpg|png|webp)$/.exec(name);
  if (!m) return null;
  const bytes = await getObject(`fire/photos/${name}`);
  return bytes ? { bytes, type: PHOTO_MIME[m[1] as keyof typeof PHOTO_MIME] } : null;
}

// ------------------------------------------------------------- dispatches

/** Who sent an incident to the field, when, how, and how many times. */
export type DispatchIndex = Record<string, { at: string; by: string; ch: "whatsapp" | "link"; n: number }>;
export async function loadDispatchIndex(): Promise<DispatchIndex> {
  return (await getJson<DispatchIndex>("fire/dispatch/_index.json")) ?? {};
}
/** Log one send covering one or more incidents (a mill message carries several). */
export async function addDispatch(ids: string[], by: string, ch: "whatsapp" | "link"): Promise<DispatchIndex> {
  const keys = [...new Set(ids.map(safeId).filter(Boolean))].slice(0, 50);
  return withLock("d:_index", async () => {
    const index = await loadDispatchIndex();
    const at = new Date().toISOString();
    const out: DispatchIndex = {};
    for (const k of keys) out[k] = index[k] = { at, by, ch, n: (index[k]?.n ?? 0) + 1 };
    await putObject("fire/dispatch/_index.json", JSON.stringify(index), "application/json");
    return out;
  });
}

export function safeId(id: string) {
  return id.replace(/[^\w-]/g, "").slice(0, 60);
}

/**
 * The incident behind a signed link (no session). Links sent before incidents
 * existed carry an event id: resolve it to the incident that holds the event.
 */
export async function findFireIncident(id: string): Promise<FireIncident | null> {
  const loaded = await loadFireIncidents();
  const incidents = [...loaded.incidents, ...loaded.history];
  // Older links carry an event id, or a per-plot-per-day id (`yyyymmdd_<plot>`).
  const plotId = /^\d{8}_(.+)$/.exec(id)?.[1];
  return (
    incidents.find((i) => i.id === id) ??
    incidents.find((i) => i.ev.includes(id)) ??
    (plotId ? incidents.find((i) => i.plots.some((p) => safeId(p.id) === plotId)) : undefined) ??
    null
  );
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

// ----------------------------------------------------------------- imagery

/**
 * Sentinel-1 / Sentinel-2 scenes over an event, from Microsoft Planetary
 * Computer (STAC search + mosaic tiles, no key). No cloud filter: smoke or
 * cloud on the day of a fire is itself information, so every pass is listed
 * with its cloud cover and the user picks the day.
 */
const PC = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic";
const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const day = (iso: string, deltaDays: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + deltaDays * 86400000).toISOString().slice(0, 10);

export type FireScene = { day: string; cloud?: number };
export type FireScenes = { s2: FireScene[]; s1: FireScene[] };

async function stacDays(collection: string, lon: number, lat: number, from: string, to: string): Promise<FireScene[]> {
  const res = await fetch(STAC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      collections: [collection],
      intersects: { type: "Point", coordinates: [lon, lat] },
      datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
      limit: 100,
      sortby: [{ field: "datetime", direction: "desc" }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { features?: { properties: { datetime: string; "eo:cloud_cover"?: number } }[] };
  const byDay = new Map<string, FireScene>();
  for (const f of j.features ?? []) {
    const d = f.properties.datetime.slice(0, 10);
    const c = f.properties["eo:cloud_cover"];
    const prev = byDay.get(d);
    if (!prev) byDay.set(d, { day: d, ...(c != null ? { cloud: Math.round(c) } : {}) });
    else if (c != null && (prev.cloud == null || c < prev.cloud)) prev.cloud = Math.round(c);
  }
  return [...byDay.values()];
}

const scenesMemo = new Map<string, { at: number; p: Promise<FireScenes> }>();
/** Pass days over the event point: Sentinel-2 from 60 days before, Sentinel-1 from 45 days before, to today. */
export function fireScenes(lat: number, lon: number, date: string): Promise<FireScenes> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${date}`;
  const hit = scenesMemo.get(key);
  if (hit && Date.now() - hit.at < 3600000) return hit.p;
  const today = new Date().toISOString().slice(0, 10);
  const p = Promise.all([
    stacDays("sentinel-2-l2a", lon, lat, day(date, -60), today),
    stacDays("sentinel-1-rtc", lon, lat, day(date, -45), today),
  ]).then(([s2, s1]) => ({ s2, s1 }));
  scenesMemo.set(key, { at: Date.now(), p });
  if (scenesMemo.size > 500) scenesMemo.delete(scenesMemo.keys().next().value!);
  p.catch(() => scenesMemo.delete(key));
  return p;
}

const registerMemo = new Map<string, Promise<string | null>>();
function registerDay(collection: string, d: string, lon: number, lat: number): Promise<string | null> {
  // One day, a 1° box around the event: the mosaic holds only that pass.
  const bx = [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5].map((v) => Math.round(v * 10) / 10);
  const key = `${collection}|${d}|${bx.join(",")}`;
  let p = registerMemo.get(key);
  if (!p) {
    p = fetch(`${PC}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "filter-lang": "cql2-json",
        filter: {
          op: "and",
          args: [
            { op: "=", args: [{ property: "collection" }, collection] },
            { op: "anyinteracts", args: [{ property: "datetime" }, { interval: [`${d}T00:00:00Z`, `${d}T23:59:59Z`] }] },
            {
              op: "s_intersects",
              args: [
                { property: "geometry" },
                { type: "Polygon", coordinates: [[[bx[0], bx[1]], [bx[2], bx[1]], [bx[2], bx[3]], [bx[0], bx[3]], [bx[0], bx[1]]]] },
              ],
            },
          ],
        },
        sortby: collection === "sentinel-2-l2a" ? [{ field: "eo:cloud_cover", direction: "asc" }] : [{ field: "datetime", direction: "desc" }],
      }),
      signal: AbortSignal.timeout(15000),
    })
      .then(async (r) => (r.ok ? ((await r.json()) as { searchid?: string; id?: string }) : null))
      .then((j) => j?.searchid ?? j?.id ?? null)
      .catch(() => null);
    registerMemo.set(key, p);
    p.then((v) => v ?? registerMemo.delete(key));
    if (registerMemo.size > 2000) registerMemo.delete(registerMemo.keys().next().value!);
  }
  return p;
}

/**
 * QuickFire V1.0.0 by Pierre Markuse (CC BY 4.0), Copernicus Browser version,
 * translated to a titiler band expression: natural colour lifted with a little
 * SWIR, plus a hot-spot boost where B12 + B11 reflectance is high (active
 * flame fronts glow orange-red, even under thin smoke). The original's
 * cloud-avoidance test is left out (no per-pixel cloud band here).
 */
function quickFireExpression() {
  const R = (b: string) => `((${b}-1000)/10000)`; // L2A DN → reflectance (baseline ≥ 04.00)
  const br = 1.4,
    off = -0.007;
  const sq = (x: string) => `sqrt(abs(${x}))`;
  const ch = (urban: string, swir: string, nat: string) => `(0.1*${sq(urban)}+0.1*${sq(swir)}+0.9*${sq(nat)})`;
  const vR = ch(`${br}*1.2*${R("B12")}+${off}`, `${br}*${R("B12")}+${off}`, `${br}*${R("B04")}+${off}`);
  const vG = ch(`${br}*1.4*${R("B11")}+${off}`, `${br}*${R("B8A")}+${off}`, `${br}*${R("B03")}+${off}`);
  const vB = ch(`${br}*${R("B04")}+${off}`, `${br}*${R("B04")}+${off}`, `${br}*${R("B02")}+${off}`);
  const avg = `((${vR}+${vG}+${vB})/3)`;
  const st = (v: string, corr: number) => `(((${avg}*(-0.1)+${v}*1.1)-0.15)/0.84+${corr})`;
  const hs = `(${R("B12")}+${R("B11")})`;
  const gBoost = `where(${hs}>2.0,0.6*${R("B11")},where(${hs}>1.5,0.24*${R("B11")},where(${hs}>1.25,0.12*${R("B11")},0)))`;
  return [
    `(${st(vR, 0.04)}+where(${hs}>1.0,0.6*${R("B12")},0))*255`,
    `(${st(vG, 0)}+where(${hs}>1.0,${gBoost},0))*255`,
    `(${st(vB, -0.05)})*255`,
  ].join(";");
}
const S2_STYLES = {
  quickfire: `collection=sentinel-2-l2a&expression=${encodeURIComponent(quickFireExpression())}&asset_as_band=true&rescale=0,255&nodata=0&format=png`,
  // Short-wave infrared (B12·B8A·B4): burn scars dark red-brown, vegetation green.
  swir: "collection=sentinel-2-l2a&assets=B12&assets=B8A&assets=B04&rescale=0,4500&nodata=0&format=png",
  true: "collection=sentinel-2-l2a&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png",
} as const;
const S1_STYLE = "collection=sentinel-1-rtc&assets=vv&assets=vh&assets=vv&rescale=0,0.35&rescale=0,0.08&rescale=0,0.35&format=png";

export type FireSceneTiles = { quickfire?: string; swir?: string; true?: string; sar?: string };

/** Tile URL templates for one pass day over the event. */
export async function fireSceneTiles(kind: "s2" | "s1", d: string, lat: number, lon: number): Promise<FireSceneTiles | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const id = await registerDay(kind === "s2" ? "sentinel-2-l2a" : "sentinel-1-rtc", d, lon, lat);
  if (!id) return null;
  const base = `${PC}/${id}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?`;
  return kind === "s2" ? { quickfire: base + S2_STYLES.quickfire, swir: base + S2_STYLES.swir, true: base + S2_STYLES.true } : { sar: base + S1_STYLE };
}
