import { scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie } from "@tanstack/react-start/server";

/**
 * FireLine sign-in. Passwords are stored only as scrypt hashes (credentials: artifacts/akun-fireline.csv,
 * not in git). Sessions are a signed JWT in an httpOnly cookie, valid 12 hours.
 *  - admin: Earthline staff — FireLine Indonesia plus the supply-chain cases, field reports and sales contacts;
 *  - viewer: FireLine Indonesia only (every account holder; e.g. the GAPKI demo, user decision 27 Oct 2026);
 *  - company: a plantation company using FireLine for its own estates (example accounts, 2 Nov 2026): FireLine
 *    Indonesia plus the cases of its own company only (`match`, see inScope), with dispatch and field reports;
 *    no other company's cases, no sales contacts, no Earthline plot coverage.
 */
export type Role = "admin" | "viewer" | "company";
type Account = { user: string; salt: string; hash: string; role: Role; org?: string; match?: string[] };
const ACCOUNTS: Account[] = [
  { user: "earthlineadmin", salt: "5f34d7f6b8368f9c050c1aaf4186ec2a", hash: "95eff4b331d73b6e63ce3d15427b6696a58ab752f942d0b91f4c9fa17617264c", role: "admin" },
  { user: "demo-indonesia", salt: "23c14e755ee32e359e332caf38c523ca", hash: "41ce28380113e160f4eea4d82084566caa7841f3b895d95b0e67e019102ef1ef", role: "viewer" },
  // match: words of the company name as written in the plot data, any spelling ("PT. PP London Sumatra Indonesia Tbk.",
  // "PT. London sumatra Indonesia", "(Sei Rumbiya Estate)"…), plasma / KUD carrying the company name included.
  { user: "berkatnabati", salt: "9d74142dc690d31e094befe52f657b51", hash: "a8cbc5b6f64663121aae8287437ae47d7eb39c1fd2647a526993c9e014d6a6a6", role: "company", org: "PT Berkat Nabati Sejahtera", match: ["BERKAT NABATI SEJAHTERA"] },
  { user: "sumberenim", salt: "a6a98f2e1a1f4d25b0cf5465acf3556b", hash: "40866d0afd2951369a249056d2c23b30df0e521bfd39d71985160bcc67c9503f", role: "company", org: "PT Sumber Enim Alam Lestari", match: ["SUMBER ENIM ALAM LESTARI"] },
  { user: "merbaujaya", salt: "852d81903180a10dca567217fa5d3ba9", hash: "784a7c35dd0f6bbe4cd394a044c6c833f85ddb08a4c3a2500fcb6471d03b0df8", role: "company", org: "PT Merbaujaya Indahraya", match: ["MERBAUJAYA INDAHRAYA"] },
  { user: "lonsum", salt: "2c92637f423ce90f07d2e21d224d5919", hash: "ebc93b7b8b1d1fb96ccb9db760cbb7702be40979bcda023e65b7884efb150a87", role: "company", org: "PT PP London Sumatra Indonesia Tbk", match: ["LONDON SUMATRA","LONSUM"] },
  { user: "permatalestari", salt: "19136cbbac705e2a3e7ee384e70b775c", hash: "705eb3d60834abb9fb583828e3800469f0ff76e993d7e2759436b75ccf1ac7ec", role: "company", org: "PT Permata Lestari Jaya", match: ["PERMATA LESTARI JAYA"] },
];
export type Session = { user: string; role: Role; org?: string; match?: string[] };

const toSession = (a: Account): Session => ({ user: a.user, role: a.role, org: a.org, match: a.match });

/** Company name for matching: upper case, legal forms and punctuation out ("PT. Sumber Enim Alam Lestari" -> "SUMBER ENIM ALAM LESTARI"). */
const LEGAL = new Set(["PT", "TBK", "CV", "KUD", "PLASMA"]);
export function normCompany(name: string) {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && !LEGAL.has(w))
    .join(" ");
}

/** May this session see this case? Staff: every case; company accounts: their own company's; viewers: none. */
export function inScope(s: Session, c: { name: string; kind: string }) {
  if (s.role === "admin") return true;
  if (s.role !== "company" || c.kind !== "company") return false;
  const n = normCompany(c.name);
  return (s.match ?? []).some((m) => n.includes(m));
}

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
  return timingSafeEqual(got, Buffer.from(a.hash, "hex")) ? toSession(a) : null;
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
    return a ? toSession(a) : null;
  } catch {
    return null;
  }
}
