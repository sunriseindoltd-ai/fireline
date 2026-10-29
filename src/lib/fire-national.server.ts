/**
 * FireLine Indonesia — server side of the national view: every VIIRS hotspot on Indonesian land over the
 * last SPAN_DAYS, not only those near our plots.
 *
 * Detections are grouped like the supply-chain cases (one group per UTC day per CLUSTER_DEG cell, same ids)
 * and each group gets
 *  - a kabupaten/kota and province (point in polygon, geoBoundaries / BPS 2020, 34 provinces); groups that
 *    land in none (sea, Malaysia, Timor-Leste, Papua New Guinea) are left out of every count;
 *  - a named boundary, the first that holds it in this order: Earthline customer boundaries (company +
 *    estate), RSPO concessions (company + management unit), GFW 2014 oil palm concessions, else none.
 * Owners (companies) are merged by normalised name across the three sources. The ADM supply-chain plots are
 * not used here: that data belongs to the supply-chain space.
 *
 * The cache holds one bucket per WIB day, so a refresh re-fetches only FETCH_RECENT_DAYS and keeps the
 * older days. Map points are 0.01° cells per WIB day.
 */
import {
  CLUSTER_DEG,
  CONF_RANK,
  FETCH_RECENT_DAYS,
  LOCAL_DIR,
  OPEN_MAX_MS,
  REFRESH_MIN_MS,
  SPAN_DAYS,
  fetchFirmsShared,
  getJson,
  isoDay,
  putObject,
  type Detection,
} from "@/lib/fire.server";

// v2: points carry the detections of their own boundary (estate counts add up to the company total).
const CACHE_KEY = "fire/v2/cache/national-v2.json";
const INDEX_KEY = "fire/national/index.json";
const WIB_MS = 7 * 3600000;
const PT_DEG = 0.01;

// ------------------------------------------------------------------ lookup

type IndexFile = {
  generated: string;
  prov: { id: string; en: string }[];
  kab: { n: string; p: number; g: number[][][][] }[];
  /** s: el = Earthline customer boundary; c company, gr group, u estate / management unit. */
  conc: { s: "el" | "rspo" | "gfw"; c: string; gr: string; u: string; ha?: number; g: number[][][][] }[];
};

/** Polygons on a grid: `find` returns the lowest item index whose polygon holds the point (so list order = priority). */
class PolyIndex {
  private parts: { item: number; bb: number[]; rings: Float64Array[] }[] = [];
  private grid = new Map<number, number[]>();
  constructor(
    items: { g: number[][][][] }[],
    private cell: number,
  ) {
    items.forEach((it, item) => {
      for (const poly of it.g) {
        const rings = poly.map((r) => Float64Array.from(r.flat()));
        const o = rings[0];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < o.length; i += 2) {
          if (o[i] < x0) x0 = o[i];
          if (o[i] > x1) x1 = o[i];
          if (o[i + 1] < y0) y0 = o[i + 1];
          if (o[i + 1] > y1) y1 = o[i + 1];
        }
        const pi = this.parts.push({ item, bb: [x0, y0, x1, y1], rings }) - 1;
        for (let iy = Math.floor(y0 / cell); iy <= Math.floor(y1 / cell); iy++)
          for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
            const k = iy * 100000 + ix;
            const list = this.grid.get(k);
            if (list) list.push(pi);
            else this.grid.set(k, [pi]);
          }
      }
    });
  }
  find(x: number, y: number): number {
    const list = this.grid.get(Math.floor(y / this.cell) * 100000 + Math.floor(x / this.cell));
    if (!list) return -1;
    let best = -1;
    for (const pi of list) {
      const p = this.parts[pi];
      if (best !== -1 && p.item >= best) continue;
      if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) continue;
      if (inRing(x, y, p.rings[0]) && !p.rings.slice(1).some((h) => inRing(x, y, h))) best = p.item;
    }
    return best;
  }
}
function inRing(x: number, y: number, r: Float64Array) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type Lookup = { file: IndexFile; kab: PolyIndex; conc: PolyIndex };
let lookupP: Promise<Lookup | null> | undefined;
function lookup(): Promise<Lookup | null> {
  lookupP ??= getJson<IndexFile>(INDEX_KEY, LOCAL_DIR).then((file) => (file ? { file, kab: new PolyIndex(file.kab, 0.25), conc: new PolyIndex(file.conc, 0.05) } : null));
  lookupP.catch(() => (lookupP = undefined));
  return lookupP;
}

/** "PT. Rimba Harapan Sakti" and "PT RIMBA HARAPAN SAKTI" are the same owner. */
export const ownerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(pt|tbk|cv|persero)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ------------------------------------------------------------------- cache

/** Owner sources as bits. */
export const SRC = { el: 1, rspo: 2, gfw: 4 } as const;
type Owner = { key: string; name: string; group: string; src: number };
/**
 * One WIB day. Points: stride PT_STRIDE = [lonE4, latE4, n, frp, conf 0–2, boundary (index.json conc, −1 none), kab,
 * latest acquisition (epoch minutes), detections inside that boundary].
 */
const PT_STRIDE = 9;
type DayAgg = {
  c: [number, number, number];
  /** Detections in the bounding box outside Indonesian land (left out of every other number). */
  out: number;
  /** Detections inside a named owner. */
  inO: number;
  prov: Record<number, [number, number]>;
  kab: Record<number, number>;
  own: Record<number, [number, number]>;
  pts: number[];
};
type Recent = [number, number]; // last 24 h, the 24 h before
type NationalCache = {
  generated: string;
  span: number;
  /** index.json `generated` the kab/owner numbers refer to. */
  index: string;
  owners: Owner[];
  days: Record<string, DayAgg>;
  /** Last 24 h / the 24 h before, from acquisition times; `in24` = last 24 h inside a named boundary (total, per province). */
  recent: { total: Recent; conf: [number, number, number]; in24: number; prov: Record<number, Recent>; provIn24: Record<number, number>; own: Record<number, Recent> };
  refreshFailed?: boolean;
};

const wibDay = (ms: number) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
const detMs = (d: Detection) => Date.parse(`${d.date}T${d.time.slice(0, 2)}:${d.time.slice(2)}:00Z`);

function build(dets: Detection[], lk: Lookup, generated: string): NationalCache {
  const now = Date.parse(generated);

  const owners: Owner[] = [];
  const ownerIdx = new Map<string, number>();
  const ownerOf = (name: string, group: string, src: number) => {
    const key = ownerKey(name);
    if (!key) return -1;
    let i = ownerIdx.get(key);
    if (i === undefined) {
      i = owners.push({ key, name, group, src: 0 }) - 1;
      ownerIdx.set(key, i);
    }
    const o = owners[i];
    o.src |= src;
    if (!o.group && group) o.group = group;
    // Earthline spelling first, then RSPO (normal case) over the GFW all-caps.
    if (src === SRC.el || (src === SRC.rspo && !(o.src & SRC.el))) o.name = name;
    return i;
  };

  // Group attribution, once per group.
  type G = { kab: number; ci: number; owner: number };
  const groups = new Map<string, G>();
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (const d of dets) {
    const id = `${d.date.replace(/-/g, "")}_${Math.floor(d.lat / CLUSTER_DEG)}_${Math.floor(d.lon / CLUSTER_DEG)}`;
    const s = sums.get(id);
    if (s) {
      s.x += d.lon;
      s.y += d.lat;
      s.n++;
    } else sums.set(id, { x: d.lon, y: d.lat, n: 1 });
  }
  for (const [id, s] of sums) {
    const x = s.x / s.n, y = s.y / s.n;
    const kab = lk.kab.find(x, y);
    const ci = kab >= 0 ? lk.conc.find(x, y) : -1;
    const owner = ci >= 0 ? ownerOf(lk.file.conc[ci].c, lk.file.conc[ci].gr, SRC[lk.file.conc[ci].s]) : -1;
    groups.set(id, { kab, ci, owner });
  }

  const days: Record<string, DayAgg> = {};
  const cells = new Map<string, { day: string; x: number; y: number; n: number; frp: number; conf: number; kab: number; own: Map<number, number>; t: number }>();
  const recent: NationalCache["recent"] = { total: [0, 0], conf: [0, 0, 0], in24: 0, prov: {}, provIn24: {}, own: {} };
  for (const d of dets) {
    const g = groups.get(`${d.date.replace(/-/g, "")}_${Math.floor(d.lat / CLUSTER_DEG)}_${Math.floor(d.lon / CLUSTER_DEG)}`)!;
    const t = detMs(d);
    const day = wibDay(t);
    const a = (days[day] ??= { c: [0, 0, 0], out: 0, inO: 0, prov: {}, kab: {}, own: {}, pts: [] });
    if (g.kab < 0) {
      a.out++;
      continue;
    }
    const conf = CONF_RANK[d.conf] ?? 1;
    const prov = lk.file.kab[g.kab].p;
    a.c[conf]++;
    const pr = (a.prov[prov] ??= [0, 0]);
    pr[0]++;
    a.kab[g.kab] = (a.kab[g.kab] ?? 0) + 1;
    if (g.owner >= 0) {
      a.inO++;
      pr[1]++;
      const o = (a.own[g.owner] ??= [0, 0]);
      o[0]++;
      if (d.frp > o[1]) o[1] = d.frp;
    }
    const age = now - t;
    const slot = age < 86400000 ? 0 : age < 2 * 86400000 ? 1 : null;
    if (slot !== null) {
      recent.total[slot]++;
      if (slot === 0) {
        recent.conf[conf]++;
        if (g.owner >= 0) {
          recent.in24++;
          recent.provIn24[prov] = (recent.provIn24[prov] ?? 0) + 1;
        }
      }
      (recent.prov[prov] ??= [0, 0])[slot]++;
      if (g.owner >= 0) (recent.own[g.owner] ??= [0, 0])[slot]++;
    }
    const ck = `${day}_${Math.floor(d.lat / PT_DEG)}_${Math.floor(d.lon / PT_DEG)}`;
    let c = cells.get(ck);
    if (!c) cells.set(ck, (c = { day, x: 0, y: 0, n: 0, frp: 0, conf: 0, kab: g.kab, own: new Map(), t: 0 }));
    c.x += d.lon;
    c.y += d.lat;
    c.n++;
    if (d.frp > c.frp) c.frp = d.frp;
    if (conf > c.conf) c.conf = conf;
    if (t > c.t) c.t = t;
    if (g.ci >= 0) c.own.set(g.ci, (c.own.get(g.ci) ?? 0) + 1);
  }
  for (const c of cells.values()) {
    let ci = -1, best = 0;
    for (const [o, k] of c.own) if (k > best) [ci, best] = [o, k];
    days[c.day].pts.push(Math.round((c.x / c.n) * 1e4), Math.round((c.y / c.n) * 1e4), c.n, Math.round(c.frp), c.conf, ci, c.kab, Math.round(c.t / 60000), best);
  }
  return { generated, span: SPAN_DAYS, index: lk.file.generated, owners, days, recent };
}

/** Older days from `old`, the rest from `fresh` (owner indices re-mapped onto one table). */
function merge(old: NationalCache, fresh: NationalCache, keepUpTo: string): NationalCache {
  const owners = fresh.owners.slice();
  const idx = new Map(owners.map((o, i) => [o.key, i]));
  const remap = (i: number) => {
    if (i < 0) return -1;
    const o = old.owners[i];
    let j = idx.get(o.key);
    if (j === undefined) {
      j = owners.push({ ...o }) - 1;
      idx.set(o.key, j);
    } else {
      owners[j].src |= o.src;
      if (!owners[j].group && o.group) owners[j].group = o.group;
    }
    return j;
  };
  const days: Record<string, DayAgg> = {};
  const oldest = wibDay(Date.parse(fresh.generated) - (SPAN_DAYS - 1) * 86400000);
  for (const [day, a] of Object.entries(old.days)) {
    if (day > keepUpTo || day < oldest) continue;
    const own: DayAgg["own"] = {};
    for (const [k, v] of Object.entries(a.own)) own[remap(Number(k))] = v;
    days[day] = { ...a, own };
  }
  for (const [day, a] of Object.entries(fresh.days)) if (day > keepUpTo) days[day] = a;
  return { ...fresh, owners, days };
}

let memo: { at: number; data: Promise<NationalCache> } | null = null;

export async function loadNationalData(opts: { refresh?: boolean } = {}): Promise<NationalCache> {
  const maxAge = opts.refresh ? REFRESH_MIN_MS : OPEN_MAX_MS;
  if (memo && Date.now() - memo.at < maxAge) {
    const d = await memo.data.catch(() => null);
    if (d && Date.now() - Date.parse(d.generated) < maxAge) return d;
  }
  const p = (async () => {
    const [cached, lk] = await Promise.all([getJson<NationalCache>(CACHE_KEY).catch(() => null), lookup()]);
    if (!lk) throw new Error("national index missing (scripts/prepare-fire-national.py)");
    if (cached && cached.index === lk.file.generated && Date.now() - Date.parse(cached.generated) < maxAge) return cached;
    const quick = !!cached && cached.index === lk.file.generated && cached.span === SPAN_DAYS;
    let dets: Detection[];
    try {
      dets = await fetchFirmsShared(quick ? FETCH_RECENT_DAYS : SPAN_DAYS);
    } catch (e) {
      if (cached && cached.index === lk.file.generated) {
        console.error("[fire-national] FIRMS fetch failed, serving cached data", e);
        return { ...cached, refreshFailed: true };
      }
      throw e;
    }
    const generated = new Date().toISOString();
    const fresh = build(dets, lk, generated);
    // A refresh fetched UTC days from `from`; WIB days after it are complete, earlier ones come from the cache.
    const from = isoDay(new Date(Date.now() - (FETCH_RECENT_DAYS - 1) * 86400000));
    const data = quick ? merge(cached!, fresh, from) : fresh;
    await putObject(CACHE_KEY, JSON.stringify(data), "application/json").catch((e) => console.error("[fire-national] cache write failed", e));
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

// -------------------------------------------------------------------- wire

/**
 * Per-day arrays run over `days` (oldest first). Points: stride 10 = [lonE4, latE4, day, n, frp, conf 0–2,
 * unit (index into `units`, −1 = no named boundary), kab (index into `kab`), minutes before `generated`,
 * detections inside that unit (≤ n: a 0.01° cell can straddle boundaries)].
 * A unit is one estate / management unit of an owner.
 */
export type NationalWire = {
  generated: string;
  days: string[];
  prov: { id: string; en: string; d: number[]; inO: number[]; h24: number; p24: number; in24: number }[];
  kab: { n: string; p: number; d: number[] }[];
  total: { l: number[]; n: number[]; h: number[]; inO: number[]; h24: number; p24: number; c24: [number, number, number]; in24: number };
  owners: { name: string; group: string; src: number; prov: number; kab: number; d: number[]; frp: number[]; h24: number; p24: number }[];
  /** o owner, u estate / unit name, s source bit, ha area of the boundary. */
  units: { o: number; u: string; s: number; ha: number }[];
  pts: number[];
  ptsFrom: string;
  outside: number;
  refreshFailed: boolean;
};

export async function nationalWire(data: NationalCache, ptsDays: number): Promise<NationalWire> {
  const lk = await lookup();
  if (!lk) throw new Error("national index missing");
  const end = Date.parse(data.generated);
  const days = Array.from({ length: SPAN_DAYS }, (_, i) => wibDay(end - (SPAN_DAYS - 1 - i) * 86400000));
  const at = new Map(days.map((d, i) => [d, i]));
  const z = () => new Array<number>(days.length).fill(0);
  const total = { l: z(), n: z(), h: z(), inO: z(), h24: data.recent.total[0], p24: data.recent.total[1], c24: data.recent.conf, in24: data.recent.in24 ?? 0 };
  const prov = lk.file.prov.map((p, i) => ({ ...p, d: z(), inO: z(), h24: data.recent.prov[i]?.[0] ?? 0, p24: data.recent.prov[i]?.[1] ?? 0, in24: data.recent.provIn24?.[i] ?? 0 }));
  const kabD = new Map<number, number[]>();
  const own = new Map<number, { d: number[]; frp: number[]; kab: Map<number, number> }>();
  const ownerAt = new Map(data.owners.map((o, i) => [o.key, i]));
  const ownerOfCi = new Map<number, number>();
  const ciOwner = (ci: number) => {
    let o = ownerOfCi.get(ci);
    if (o === undefined) ownerOfCi.set(ci, (o = ownerAt.get(ownerKey(lk.file.conc[ci].c)) ?? -1));
    return o;
  };
  const ptsFrom = days[Math.max(0, days.length - ptsDays)];
  const raw: number[] = [];
  let outside = 0;
  for (const [day, a] of Object.entries(data.days)) {
    const di = at.get(day);
    if (di === undefined) continue;
    outside += a.out;
    total.l[di] += a.c[0];
    total.n[di] += a.c[1];
    total.h[di] += a.c[2];
    total.inO[di] += a.inO;
    for (const [k, [n, inO]] of Object.entries(a.prov)) {
      prov[Number(k)].d[di] += n;
      prov[Number(k)].inO[di] += inO;
    }
    for (const [k, n] of Object.entries(a.kab)) {
      let d = kabD.get(Number(k));
      if (!d) kabD.set(Number(k), (d = z()));
      d[di] += n;
    }
    for (const [k, [n, frp]] of Object.entries(a.own)) {
      let o = own.get(Number(k));
      if (!o) own.set(Number(k), (o = { d: z(), frp: z(), kab: new Map() }));
      o.d[di] += n;
      if (frp > o.frp[di]) o.frp[di] = frp;
    }
    for (let i = 0; i < a.pts.length; i += PT_STRIDE) {
      const ci = a.pts[i + 5];
      const r = ci >= 0 ? own.get(ciOwner(ci)) : undefined;
      if (r) r.kab.set(a.pts[i + 6], (r.kab.get(a.pts[i + 6]) ?? 0) + a.pts[i + 2]);
      if (day >= ptsFrom) raw.push(a.pts[i], a.pts[i + 1], di, a.pts[i + 2], a.pts[i + 3], a.pts[i + 4], ci, a.pts[i + 6], Math.max(0, Math.round(end / 60000) - a.pts[i + 7]), a.pts[i + 8]);
    }
  }
  // Owners: most hotspots first; index = position in this list.
  const sum = (d: number[]) => d.reduce((x, y) => x + y, 0);
  const order = [...own.entries()].filter(([, o]) => sum(o.d) > 0).sort((a, b) => sum(b[1].d) - sum(a[1].d));
  const wireIdx = new Map(order.map(([k], i) => [k, i]));
  // Kabupaten: only those with hotspots, in index order; points and owners refer to this list.
  const kab = [...kabD.entries()].sort((a, b) => a[0] - b[0]);
  const kabIdx = new Map(kab.map(([k], i) => [k, i]));
  const owners = order.map(([k, o]) => {
    let top = -1, best = 0;
    for (const [ki, n] of o.kab) if (n > best) [top, best] = [ki, n];
    const meta = data.owners[k];
    return {
      name: meta.name, group: meta.group, src: meta.src, prov: top >= 0 ? lk.file.kab[top].p : -1, kab: kabIdx.get(top) ?? -1,
      d: o.d, frp: o.frp, h24: data.recent.own[k]?.[0] ?? 0, p24: data.recent.own[k]?.[1] ?? 0,
    };
  });
  // Units: the boundaries the shipped points fall in.
  const units: NationalWire["units"] = [];
  const unitIdx = new Map<number, number>();
  for (let i = 6; i < raw.length; i += 10) {
    const ci = raw[i];
    if (ci < 0) continue;
    let u = unitIdx.get(ci);
    if (u === undefined) {
      const c = lk.file.conc[ci];
      u = units.push({ o: wireIdx.get(ciOwner(ci)) ?? -1, u: c.u, s: SRC[c.s], ha: c.ha ?? 0 }) - 1;
      unitIdx.set(ci, u);
    }
    raw[i] = u;
  }
  for (let i = 7; i < raw.length; i += 10) raw[i] = kabIdx.get(raw[i]) ?? -1;
  return {
    generated: data.generated,
    days,
    prov,
    kab: kab.map(([k, d]) => ({ n: lk.file.kab[k].n, p: lk.file.kab[k].p, d })),
    total,
    owners,
    units,
    pts: raw,
    ptsFrom,
    outside,
    refreshFailed: !!data.refreshFailed,
  };
}
