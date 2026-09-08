import { createHash, timingSafeEqual } from "node:crypto";
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
 * var in any real deployment — especially KANOPI_SUPPLIER_PASSWORD and
 * KANOPI_AUDITOR_PASSWORD, since those two roles are meant for people
 * outside the company.
 */
export function gateCredentials(): Record<GateRole, GateAccount[]> {
  return {
    admin: [
      {
        user: process.env.KANOPI_ADMIN_USER || process.env.KANOPI_USER || "earthline",
        password:
          process.env.KANOPI_ADMIN_PASSWORD || process.env.KANOPI_PASSWORD || "r^M3C%KtGM69q!t",
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
    supplier: [
      {
        user: process.env.KANOPI_SUPPLIER_USER || "supplier",
        password: process.env.KANOPI_SUPPLIER_PASSWORD || "BWmGuQGM3TKuf@-",
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

/**
 * Refinery/KCP names a role is confined to — enforced server-side in
 * kanopi-data.server.ts (mills.json filtered, plot/area file access
 * checked against it) rather than only hidden in the UI, since supplier and
 * auditor accounts are meant for people outside the company who should
 * never receive other refineries' data over the wire at all.
 * `null` (admin/client) means unrestricted — every refinery.
 */
const ROLE_REFINERY_SCOPE: Partial<Record<GateRole, readonly string[]>> = {
  supplier: ["Permata KIM"],
  auditor: ["Permata KIM"],
};

export function refineryScopeForRole(role: GateRole): readonly string[] | null {
  return ROLE_REFINERY_SCOPE[role] ?? null;
}

/** Match submitted credentials against every account of every role; null when none match. */
export function matchGateCredentials(username: string, password: string): GateRole | null {
  const creds = gateCredentials();
  for (const role of KNOWN_ROLES) {
    for (const pair of creds[role]) {
      if (safeEqual(username.trim(), pair.user) && safeEqual(password, pair.password)) {
        return role;
      }
    }
  }
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
