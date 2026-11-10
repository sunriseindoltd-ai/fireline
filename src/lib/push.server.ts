import { createHash } from "node:crypto";
import webpush from "web-push";
import { inScope, sessionForUser, type Session } from "@/lib/auth";
import { getJson, loadFireIncidents, putObject, type FireIncident } from "@/lib/fire.server";

/**
 * Fire notifications on the phone, also when FireLine is closed (user, 10 Nov 2026): standard Web Push (VAPID).
 *
 * - A signed-in admin or company account turns them on in the app; the browser's push subscription is kept in the
 *   FireLine bucket (`fire/push/subs.json`), with the user name only — what the user may see is read fresh at send time.
 * - An outside scheduler (Cloudflare Worker cron, every 30 min; Vercel Hobby allows one cron a day) calls
 *   POST /fire/push/run with FIRE_CRON_SECRET. That refreshes the FIRMS data and notifies each subscriber of the
 *   cases with a hotspot newer than the last run (`fire/push/state.json`): admins every case, company accounts their
 *   own company's (same rule as the app, `inScope`). Several cases in one run = one notification.
 * - The first run only records what is there (no flood of old cases). Subscriptions the push service has dropped
 *   (404/410) are removed.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a URL or mailto:), FIRE_CRON_SECRET.
 */

const SUBS = "fire/push/subs.json";
const STATE = "fire/push/state.json";
/** A case counts as news only while its latest hotspot is this recent (FIRMS lands ±3 h after the pass). */
const FRESH_MS = 24 * 3600 * 1000;
const KEEP_STATE_MS = 35 * 24 * 3600 * 1000;
const MAX_SUBS_PER_USER = 10;
/** Push services we send to; anything else is refused at subscribe time (no requests to arbitrary hosts). */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string }; user: string; lang: "en" | "id"; at: string };
type Subs = Record<string, PushSub>;
type State = { init?: boolean; ran?: string; cases: Record<string, string> };

let configured: boolean | undefined;
export function pushConfigured(): boolean {
  if (configured !== undefined) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY,
    priv = process.env.VAPID_PRIVATE_KEY;
  configured = !!(pub && priv);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://fireline.earthline-trace.info", pub!, priv!);
  return configured;
}
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";

const subKey = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

/** The subscription as the browser gives it, checked; null when it is not one we will send to. */
export function parseSubscription(v: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof o.endpoint !== "string" || o.endpoint.length > 1000) return null;
  let u: URL;
  try {
    u = new URL(o.endpoint);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !PUSH_HOSTS.some((r) => r.test(u.hostname))) return null;
  const p256dh = o.keys?.p256dh,
    auth = o.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: o.endpoint, keys: { p256dh, auth } };
}

const loadSubs = async () => (await getJson<Subs>(SUBS)) ?? {};
const saveSubs = (s: Subs) => putObject(SUBS, JSON.stringify(s), "application/json");

export async function addSubscription(session: Session, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, lang: "en" | "id") {
  const subs = await loadSubs();
  subs[subKey(sub.endpoint)] = { ...sub, user: session.user, lang, at: new Date().toISOString() };
  // keep the newest few per user (old phones, cleared browsers)
  const mine = Object.entries(subs)
    .filter(([, s]) => s.user === session.user)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
  for (const [k] of mine.slice(MAX_SUBS_PER_USER)) delete subs[k];
  await saveSubs(subs);
}

export async function removeSubscription(session: Session, endpoint: string) {
  const subs = await loadSubs();
  const k = subKey(endpoint);
  if (subs[k]?.user !== session.user) return;
  delete subs[k];
  await saveSubs(subs);
}

const COPY = {
  en: {
    one: (c: FireIncident) => `New fire: ${c.name}`,
    many: (n: number) => `${n} new fire cases`,
    inside: "inside a plot",
    near: (m: number) => `${m} m from a plot`,
    hotspots: (n: number) => `${n} hotspot${n === 1 ? "" : "s"}`,
    more: (n: number) => `+${n} more`,
    testTitle: "FireLine notifications are on",
    testBody: "You will get a message here when a new fire is detected on or near your plots.",
  },
  id: {
    one: (c: FireIncident) => `Kebakaran baru: ${c.name}`,
    many: (n: number) => `${n} kasus kebakaran baru`,
    inside: "di dalam plot",
    near: (m: number) => `${m} m dari plot`,
    hotspots: (n: number) => `${n} titik panas`,
    more: (n: number) => `+${n} lainnya`,
    testTitle: "Notifikasi FireLine aktif",
    testBody: "Anda akan menerima pesan di sini saat kebakaran baru terdeteksi di atau dekat plot Anda.",
  },
};

const where = (c: FireIncident, t: (typeof COPY)["en"]) => (c.d === 0 ? t.inside : t.near(Math.round(c.d)));

/** One notification for the cases of one run, in the subscriber's language. */
export function messageFor(cases: FireIncident[], lang: "en" | "id") {
  const t = COPY[lang];
  if (cases.length === 1) {
    const c = cases[0];
    const place = [c.plot.district, c.plot.province].filter(Boolean).join(", ");
    return {
      title: t.one(c),
      body: [t.hotspots(c.n), where(c, t), place].filter(Boolean).join(" · "),
      url: `/#inbox/${encodeURIComponent(c.id)}`,
      tag: `fl-${c.id}`,
    };
  }
  const top = cases.slice(0, 3).map((c) => `${c.name} (${where(c, t)})`);
  if (cases.length > 3) top.push(t.more(cases.length - 3));
  return { title: t.many(cases.length), body: top.join(", "), url: "/#inbox", tag: "fl-batch" };
}

type SendResult = "ok" | "gone" | "error";
async function send(sub: PushSub, msg: { title: string; body: string; url: string; tag: string }): Promise<SendResult> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" });
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return "gone";
    console.warn("[push] send failed", code ?? (e as Error).message);
    return "error";
  }
}

/** A test message to every device of this user. */
export async function sendTest(session: Session): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = await loadSubs();
  let sent = 0;
  for (const [k, s] of Object.entries(subs)) {
    if (s.user !== session.user) continue;
    const t = COPY[s.lang];
    const r = await send(s, { title: t.testTitle, body: t.testBody, url: "/", tag: "fl-test" });
    if (r === "ok") sent++;
    if (r === "gone") delete subs[k];
  }
  await saveSubs(subs);
  return sent;
}

/** The scheduler's call: refresh, find cases with new hotspots, notify. */
export async function runPush(now = Date.now()) {
  if (!pushConfigured()) return { ok: false as const, reason: "push not configured" };
  const { data, incidents } = await loadFireIncidents({ refresh: true });
  const state: State = (await getJson<State>(STATE)) ?? { cases: {} };
  const fresh = incidents.filter((c) => now - Date.parse(c.last) < FRESH_MS);
  const news = state.init ? fresh.filter((c) => !state.cases[c.id] || c.last > state.cases[c.id]) : [];
  for (const c of incidents) if (!state.cases[c.id] || c.last > state.cases[c.id]) state.cases[c.id] = c.last;
  for (const [id, last] of Object.entries(state.cases)) if (now - Date.parse(last) > KEEP_STATE_MS) delete state.cases[id];
  const first = !state.init;
  state.init = true;
  state.ran = new Date(now).toISOString();
  await putObject(STATE, JSON.stringify(state), "application/json");

  let sent = 0,
    gone = 0,
    failed = 0;
  if (news.length) {
    const subs = await loadSubs();
    for (const [k, s] of Object.entries(subs)) {
      const who = sessionForUser(s.user);
      if (!who || who.role === "viewer") continue;
      const mine = news.filter((c) => inScope(who, c)).sort((a, b) => a.d - b.d || b.n - a.n);
      if (!mine.length) continue;
      const r = await send(s, messageFor(mine, s.lang));
      if (r === "ok") sent++;
      else if (r === "gone") {
        gone++;
        delete subs[k];
      } else failed++;
    }
    if (gone) await saveSubs(subs);
  }
  return { ok: true as const, data: data.generated, first, cases: incidents.length, news: news.length, sent, gone, failed };
}
