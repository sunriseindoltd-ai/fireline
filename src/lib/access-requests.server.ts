import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Access requests from the public contact form (feedback 3, A-15). The form
 * used to open the visitor's mail app — nothing reached Earthline unless
 * they pressed send there. Now each request is stored as one JSON object in
 * the palm R2 bucket (`inbox/access-requests/`, never under a tenant or a
 * path /data serves) and listed on the admin-only Requests page.
 *
 * Without R2 credentials (local dev) requests go to `.dev-inbox/` at the
 * repo root — deliberately outside private-data/, which is bundled into the
 * server and partly served under /data.
 */

export const COMMODITIES = ["palm", "soy", "coffee", "other"] as const;
export const CHAIN_SIZES = ["1-10", "11-50", "51-200", "200+", "unsure"] as const;
export const TIMELINES = ["now", "3m", "12m", "exploring"] as const;
export const ROLES = ["sustainability", "procurement", "refinery", "mill", "consultant", "other"] as const;
export const STATUSES = ["new", "contacted", "closed"] as const;

export type AccessRequestStatus = (typeof STATUSES)[number];
export type AccessRequest = {
  id: string;
  receivedAt: string;
  status: AccessRequestStatus;
  name: string;
  email: string;
  organisation: string;
  role: string;
  commodities: string[];
  chainSize: string;
  regions: string;
  timeline: string;
  message: string;
  earlyAccess: boolean;
  /** Which product page the visitor came from, and their site language. */
  product: string;
  lang: string;
};

const PREFIX = "inbox/access-requests/";
const DEV_DIR = path.join(process.cwd(), ".dev-inbox", "access-requests");

function store() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey }),
    base: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | "" =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : "";

/** Checks and normalises a form body; returns the error field name if invalid. */
export function parseAccessRequest(body: Record<string, unknown>): { ok: true; value: Omit<AccessRequest, "id" | "receivedAt" | "status"> } | { ok: false; field: string } {
  const name = str(body.name, 120);
  const email = str(body.email, 160).toLowerCase();
  const organisation = str(body.organisation, 160);
  if (!name) return { ok: false, field: "name" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, field: "email" };
  if (!organisation) return { ok: false, field: "organisation" };
  if (body.consent !== true) return { ok: false, field: "consent" };
  const commodities = Array.isArray(body.commodities)
    ? [...new Set(body.commodities.map((c) => oneOf(c, COMMODITIES)).filter(Boolean))]
    : [];
  return {
    ok: true,
    value: {
      name,
      email,
      organisation,
      role: oneOf(body.role, ROLES),
      commodities,
      chainSize: oneOf(body.chainSize, CHAIN_SIZES),
      regions: str(body.regions, 300),
      timeline: oneOf(body.timeline, TIMELINES),
      message: str(body.message, 4000),
      earlyAccess: body.earlyAccess === true,
      product: oneOf(body.product, ["palm", "soy"] as const),
      lang: oneOf(body.lang, ["en", "id"] as const),
    },
  };
}

function newId(at: Date) {
  // Sortable by time, unguessable enough for an admin-only listing.
  return `${at.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

async function put(key: string, request: AccessRequest) {
  const s = store();
  const body = JSON.stringify(request);
  if (!s) {
    await mkdir(DEV_DIR, { recursive: true });
    await writeFile(path.join(DEV_DIR, `${request.id}.json`), body);
    return;
  }
  const res = await s.client.fetch(`${s.base}/${key}`, {
    method: "PUT",
    body,
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`R2 put ${res.status}`);
}

export async function saveAccessRequest(value: Omit<AccessRequest, "id" | "receivedAt" | "status">) {
  const at = new Date();
  const request: AccessRequest = { id: newId(at), receivedAt: at.toISOString(), status: "new", ...value };
  await put(`${PREFIX}${request.id}.json`, request);
  return request.id;
}

/** Newest first, at most `limit`. */
export async function listAccessRequests(limit = 200): Promise<AccessRequest[]> {
  const s = store();
  if (!s) {
    const files = await readdir(DEV_DIR).catch(() => [] as string[]);
    const out: AccessRequest[] = [];
    for (const f of files.sort().reverse().slice(0, limit)) {
      out.push(JSON.parse(await readFile(path.join(DEV_DIR, f), "utf8")) as AccessRequest);
    }
    return out;
  }
  const keys: string[] = [];
  let token = "";
  for (;;) {
    const q = new URLSearchParams({ "list-type": "2", prefix: PREFIX, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const res = await s.client.fetch(`${s.base}?${q}`);
    if (!res.ok) throw new Error(`R2 list ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]!);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!next) break;
    token = next[1]!;
  }
  const newest = keys.sort().reverse().slice(0, limit);
  const out = await Promise.all(
    newest.map(async (key) => {
      const res = await s.client.fetch(`${s.base}/${key}`);
      return res.ok ? ((await res.json()) as AccessRequest) : null;
    }),
  );
  return out.filter((r): r is AccessRequest => !!r);
}

export async function setAccessRequestStatus(id: string, status: AccessRequestStatus) {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad id");
  const s = store();
  let current: AccessRequest;
  if (!s) {
    current = JSON.parse(await readFile(path.join(DEV_DIR, `${id}.json`), "utf8")) as AccessRequest;
  } else {
    const res = await s.client.fetch(`${s.base}/${PREFIX}${id}.json`);
    if (!res.ok) throw new Error(`R2 get ${res.status}`);
    current = (await res.json()) as AccessRequest;
  }
  await put(`${PREFIX}${id}.json`, { ...current, status });
}
