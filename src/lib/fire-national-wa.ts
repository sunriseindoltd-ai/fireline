import type { Lang } from "@/lib/copy";
import { fill, formatCount } from "@/lib/format";
import { nationalCopy } from "@/lib/fire-national-copy";
import { gmaps, latestPts, unitsHit, type NatData } from "@/lib/fire-national";

/**
 * WhatsApp alert texts for FireLine Indonesia. Sent through wa.me (WhatsApp opens with the text filled in and the
 * sender picks the chat or group): no WhatsApp Business API, no cost (user, 27 Oct 2026: "yang penting WhatsApp").
 */
const when = (data: NatData, minutes: number, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(Date.parse(data.generated) - minutes * 60000),
  );
const provName = (data: NatData, i: number, lang: Lang) => (i < 0 ? "" : lang === "en" ? data.prov[i].en : data.prov[i].id);
const appUrl = (hash: string) => (typeof window === "undefined" ? "" : `${window.location.origin}/${hash}`);

/** One point (index into pts). */
export function pointAlert(data: NatData, i: number, lang: Lang): string {
  const f = nationalCopy[lang];
  const p = data.pts;
  const n = (v: number) => formatCount(v, lang);
  const unit = p[i + 6] >= 0 ? data.units[p[i + 6]] : null;
  const o = unit && unit.o >= 0 ? data.owners[unit.o] : null;
  const kab = p[i + 7] >= 0 ? data.kab[p[i + 7]] : null;
  const lat = p[i + 1] / 1e4, lon = p[i] / 1e4;
  return [
    f.waHead,
    o ? (o.group ? `${o.name} (${o.group})` : o.name) : f.popNone,
    unit?.u ? fill(f.waEstates, { list: unit.u }) : "",
    kab ? fill(f.waWhere, { where: `${kab.n}, ${provName(data, kab.p, lang)}` }) : "",
    fill(f.waLatest, { when: when(data, p[i + 8], lang), frp: n(p[i + 4]), conf: f.conf[p[i + 5]] }),
    fill(f.waMap, { url: gmaps(lat, lon) }),
    fill(f.waApp, { url: appUrl("#id/map") }),
    `\n${f.waFoot}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One company: where, which estates, how many hotspots, the newest one on Google Maps. */
export function ownerAlert(data: NatData, o: number, lang: Lang): string {
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const ow = data.owners[o];
  const p = data.pts;
  const newest = latestPts(data, "7", 1, o)[0] ?? latestPts(data, "28", 1, o)[0];
  const estates = [...unitsHit(data, "7", o).units.entries()]
    .filter(([u]) => data.units[u].u)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([u, v]) => `${data.units[u].u} (${n(v)})`);
  const where = [ow.kab >= 0 ? data.kab[ow.kab].n : "", provName(data, ow.prov, lang)].filter(Boolean).join(", ");
  return [
    f.waHead,
    ow.group ? `${ow.name} (${ow.group})` : ow.name,
    where ? fill(f.waWhere, { where }) : "",
    estates.length ? fill(f.waEstates, { list: estates.join(", ") }) : "",
    fill(f.waCounts, { h24: n(ow.h24), d7: n(ow.d.slice(-7).reduce((a, b) => a + b, 0)) }),
    newest !== undefined ? fill(f.waLatest, { when: when(data, p[newest + 8], lang), frp: n(p[newest + 4]), conf: f.conf[p[newest + 5]] }) : "",
    newest !== undefined ? fill(f.waMap, { url: gmaps(p[newest + 1] / 1e4, p[newest] / 1e4) }) : "",
    fill(f.waApp, { url: appUrl("#id/map") }),
    `\n${f.waFoot}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The day's summary for a management group: last 24 hours, top provinces, top companies. */
export function digestAlert(data: NatData, lang: Lang): string {
  const f = nationalCopy[lang];
  const n = (v: number) => formatCount(v, lang);
  const time = new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.generated));
  const provs = data.prov
    .map((p, i) => ({ i, v: p.h24 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((x) => `${provName(data, x.i, lang)} ${n(x.v)}`);
  const cos = data.owners
    .map((o) => o)
    .filter((o) => o.h24 > 0)
    .sort((a, b) => b.h24 - a.h24)
    .slice(0, 5)
    .map((o, k) => `${k + 1}. ${o.name}${o.prov >= 0 ? `, ${provName(data, o.prov, lang)}` : ""}: ${n(o.h24)}`);
  return [
    fill(f.waDigestHead, { time }),
    fill(f.waDigest24, { n: n(data.total.h24), p: n(data.total.p24) }),
    provs.length ? fill(f.waDigestProv, { list: provs.join(", ") }) : "",
    cos.length ? `\n${f.waDigestCos}` : "",
    ...cos,
    `\n${fill(f.waApp, { url: appUrl("#id") })}`,
    f.waFoot,
  ]
    .filter(Boolean)
    .join("\n");
}
