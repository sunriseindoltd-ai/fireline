import { scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie } from "@tanstack/react-start/server";

/**
 * FireLine sign-in: one admin account (user decision, 13 Oct 2026). The
 * password is stored only as a scrypt hash. Sessions are a signed JWT in an
 * httpOnly cookie, valid 12 hours.
 */
const ACCOUNTS = [
  { user: "earthlineadmin", salt: "5f34d7f6b8368f9c050c1aaf4186ec2a", hash: "95eff4b331d73b6e63ce3d15427b6696a58ab752f942d0b91f4c9fa17617264c", role: "admin" as const },
];
export type Role = (typeof ACCOUNTS)[number]["role"];
export type Session = { user: string; role: Role };

const COOKIE = "fireline_session";
const MAX_AGE = 12 * 3600;

function secretKey() {
  const s = process.env.FIRE_SESSION_SECRET || process.env.FIRE_LINK_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("FIRE_SESSION_SECRET is not set");
    return new TextEncoder().encode("fireline-dev-only-secret");
  }
  return new TextEncoder().encode(s);
}

export function matchCredentials(user: string, password: string): Session | null {
  const a = ACCOUNTS.find((x) => x.user === user.trim().toLowerCase());
  if (!a) {
    // Same work either way, so a wrong user ID is not faster than a wrong password.
    scryptSync(password, Buffer.alloc(16), 32);
    return null;
  }
  const got = scryptSync(password, Buffer.from(a.salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(a.hash, "hex")) ? { user: a.user, role: a.role } : null;
}

export async function issueSession(s: Session) {
  const token = await new SignJWT({ role: s.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.user)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
  setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE });
}

export function clearSession() {
  setCookie(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0 });
}

function cookieValue(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function readSession(request?: Request): Promise<Session | null> {
  let token = request ? cookieValue(request.headers.get("cookie") ?? undefined, COOKIE) : undefined;
  if (!token) {
    try {
      token = getCookie(COOKIE);
    } catch {
      token = undefined;
    }
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const a = ACCOUNTS.find((x) => x.user === payload.sub);
    return a ? { user: a.user, role: a.role } : null;
  } catch {
    return null;
  }
}
