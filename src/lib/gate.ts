import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie } from "@tanstack/react-start/server";

export const GATE_COOKIE = "kanopi_gate";
const MAX_AGE = 60 * 60 * 12;

function secretKey() {
  const s =
    process.env.KANOPI_SESSION_SECRET ||
    "kanopi-preview-session-key-change-on-cloudflare";
  return new TextEncoder().encode(s);
}

export type GateRole = "admin" | "client" | "supplier" | "auditor";
const KNOWN_ROLES: readonly GateRole[] = ["admin", "client", "supplier", "auditor"];

type GateAccount = { user: string; password: string };

/**
 * One or more login pairs per role. "client" carries three separate pairs
 * (one per ADM Team member) so each person signs in with their own
 * credential instead of a shared login — all three still resolve to the
 * same "client" role/permissions.
 *
 * Every fallback password below is a generated 15-character string, kept
 * only as the always-on live-preview default (same contract the original
 * admin/client pair already had). Override every one of these via its env
 * var in any real deployment — especially KANOPI_AUDITOR_PASSWORD, since
 * that role is meant for people outside the company. Supplier logins aren't
 * here — see SUPPLIER_ACCOUNTS below.
 */
export function gateCredentials(): Record<Exclude<GateRole, "supplier">, GateAccount[]> {
  return {
    admin: [
      {
        user: process.env.KANOPI_ADMIN_USER || process.env.KANOPI_USER || "earthline",
        password:
          process.env.KANOPI_ADMIN_PASSWORD || process.env.KANOPI_PASSWORD || "r^M3C%KtGM69q!t",
      },
      {
        user: process.env.KANOPI_ADMIN_USER_2 || "karmauzco",
        password: process.env.KANOPI_ADMIN_PASSWORD_2 || "5l3nd312m4N!",
      },
    ],
    client: [
      {
        user: process.env.KANOPI_CLIENT_USER_1 || "adm-1",
        password: process.env.KANOPI_CLIENT_PASSWORD_1 || "5=VyVRm^AV6x3ZM",
      },
      {
        user: process.env.KANOPI_CLIENT_USER_2 || "adm-2",
        password: process.env.KANOPI_CLIENT_PASSWORD_2 || "Jw@dc+e8EmFN*aD",
      },
      {
        user: process.env.KANOPI_CLIENT_USER_3 || "adm-3",
        password: process.env.KANOPI_CLIENT_PASSWORD_3 || "59g=GVKjKutFaXx",
      },
    ],
    auditor: [
      {
        user: process.env.KANOPI_AUDITOR_USER || "auditor",
        password: process.env.KANOPI_AUDITOR_PASSWORD || "k3iRhK6ctehXz^f",
      },
    ],
  };
}

type SupplierAccount = { user: string; group: string; salt: string; hash: string };

/**
 * One login per supplier group (mills.json `group`), each confined to its
 * own group's mills across every refinery/KCP that group runs. Only a scrypt
 * hash is kept here, never the password: these go to people outside the
 * company, and a plaintext fallback in the repo would let anyone who can
 * read it sign in as any supplier. Each plaintext was handed out once;
 * scripts/hash-gate-password.mjs issues a new one (and its salt/hash) to add
 * a group or rotate a password.
 */
const SUPPLIER_ACCOUNTS: readonly SupplierAccount[] = [
  {
    user: "bns",
    group: "BNS",
    salt: "e49e1d1000d1d143900d65f114a7f395",
    hash: "768a0118cb7318e988507fe7b59862cda543bcdbef990cce94010c8677adf232",
  },
  {
    user: "domas",
    group: "DOMAS",
    salt: "ec970325942f62c6668c4a6f07a650de",
    hash: "8971ef34e82cbf266dfbe50940f66fae1a9a7f13176d100595b0fe8e488069ae",
  },
  {
    user: "fgv",
    group: "FGV",
    salt: "c508fdf99eca03408e955903fc4fd311",
    hash: "933213d962c5173c1dc37c109014196a35d69b996c0c4d0c2fa0c82552479439",
  },
  {
    user: "hok-huat",
    group: "HOK HUAT",
    salt: "e191ebc39839c1ac281b5b1824da44c6",
    hash: "d142bd5a35e662ae2d9b8e0a5900905f4cf1922701f69d2a39e5fc08d5d3c609",
  },
  {
    user: "jinlee",
    group: "JINLEE",
    salt: "cea4a583a4a8f4b8d38c47e60159d8b9",
    hash: "c46761b768684c14c6ea2644ccd058db4076e8773f14c22ce8283236deca56fb",
  },
  {
    user: "nam-lts",
    group: "NAM & LTS",
    salt: "211ad923ce859702f83ee7736327e038",
    hash: "d4f94e48551b1be40c51bf637af2acacf37c55d713c4d9407c22468a4da4568a",
  },
  {
    user: "permata",
    group: "Permata",
    salt: "eaa510bfc2a9e9cdcba3fd5f5f430c5d",
    hash: "943a1f52d1eef9dfc11464417988ec5c84eb2cef7ac083e7a063aaa351eb6839",
  },
  {
    user: "sehcom",
    group: "SEHCOM",
    salt: "c02cd86c85ca279aea863d78ced2d7f7",
    hash: "a620739567d2fd6bf551433679d90af6283c332c6b6debaaeec5ef31cdcb39e1",
  },
  {
    user: "sjim",
    group: "SJIM",
    salt: "5610f29630427f14429affdb296d746b",
    hash: "f0fdd236c74609f6e2cfe5e5022d308eae7e6693a9f54beb0c35c6fb3803fd80",
  },
  {
    user: "sunrise",
    group: "SUNRISE",
    salt: "3d49c1711409a41affaa76718b04f12d",
    hash: "ae83f54c77205525381dbe1dac48b2d354dc99a4d895e63e1e7285996be7d53e",
  },
  {
    user: "yorgo",
    group: "YORGO",
    salt: "441c889a8bcbb2d3077d3be255f600b5",
    hash: "0d901cdc1436a15e599255e3eddb4a616efea98736da67ded0c9424ef5aeb903",
  },
];

function supplierAccount(user: string) {
  return SUPPLIER_ACCOUNTS.find((a) => a.user === user);
}

function matchesSupplierHash(password: string, account: SupplierAccount) {
  const hash = scryptSync(password, Buffer.from(account.salt, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(account.hash, "hex"));
}

/**
 * What a restricted session may see: a mill is in scope when its supplier
 * group or its refinery/KCP is listed. Enforced server-side in
 * kanopi-data.server.ts (mills.json filtered, plot/area file access checked
 * against it) and the EUDR summary route rather than only hidden in the UI,
 * since supplier and auditor accounts are meant for people outside the
 * company who should never receive other suppliers' data over the wire.
 */
export type DataScope = { groups?: readonly string[]; refineries?: readonly string[] };

/** `null` (admin/client) means unrestricted — every group and refinery. */
export function dataScopeForSession(session: GateSession): DataScope | null {
  if (session.role === "auditor") return { refineries: ["Permata KIM"] };
  if (session.role === "supplier") {
    // An unknown supplier user already fails readGateSession; an empty
    // scope here just keeps this fail-closed on its own too.
    const group = supplierAccount(session.user)?.group;
    return { groups: group ? [group] : [] };
  }
  return null;
}

export function millInScope(mill: { group?: string; refinery?: string }, scope: DataScope) {
  return (
    (!!mill.group && !!scope.groups?.includes(mill.group)) ||
    (!!mill.refinery && !!scope.refineries?.includes(mill.refinery))
  );
}

/** Match submitted credentials against every account of every role; null when none match. */
export function matchGateCredentials(username: string, password: string): GateRole | null {
  const user = username.trim();
  const creds = gateCredentials();
  for (const role of Object.keys(creds) as (keyof typeof creds)[]) {
    for (const pair of creds[role]) {
      if (safeEqual(user, pair.user) && safeEqual(password, pair.password)) {
        return role;
      }
    }
  }
  const supplier = supplierAccount(user);
  if (supplier && matchesSupplierHash(password, supplier)) return "supplier";
  return null;
}

function sha256(s: string) {
  return createHash("sha256").update(s).digest();
}

export function safeEqual(a: string, b: string) {
  return timingSafeEqual(sha256(a), sha256(b));
}

function cookieValue(source: string | undefined, name: string) {
  if (!source) return undefined;
  for (const part of source.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
}

export async function issueGateToken(username: string, role: GateRole) {
  return new SignJWT({ sub: username, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export type GateSession = { user: string; role: GateRole };

export async function readGateSession(request?: Request): Promise<GateSession | null> {
  let token: string | undefined;
  if (request) {
    token = cookieValue(request.headers.get("cookie") ?? undefined, GATE_COOKIE);
  }
  if (!token) {
    try {
      token = getCookie(GATE_COOKIE);
    } catch {
      token = undefined;
    }
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    // Older tokens (issued before roles existed) carry no `role` claim, and
    // any token signed by a since-removed role falls back the same way —
    // treat both as admin so an existing signed-in session isn't locked out.
    const role = KNOWN_ROLES.includes(payload.role as GateRole) ? (payload.role as GateRole) : "admin";
    // Supplier scope comes from the account itself, so a supplier token for
    // a login that no longer exists (e.g. the old shared "supplier" one) is
    // signed out rather than left holding an empty session.
    if (role === "supplier" && !supplierAccount(payload.sub)) return null;
    return { user: payload.sub, role };
  } catch {
    return null;
  }
}

/** Back-compat convenience: just the username, or null when signed out. */
export async function readGateUser(request?: Request): Promise<string | null> {
  const session = await readGateSession(request);
  return session?.user ?? null;
}

const cookieAttrs = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export function setGateCookie(token: string) {
  setCookie(GATE_COOKIE, token, { ...cookieAttrs, maxAge: MAX_AGE });
}

export function clearGateCookie() {
  setCookie(GATE_COOKIE, "", { ...cookieAttrs, maxAge: 0 });
}
