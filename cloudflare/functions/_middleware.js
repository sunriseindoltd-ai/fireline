/**
 * Drop-in Cloudflare Pages middleware for a later static host of Kanopi.
 * Protects /data/* with the same HttpOnly HMAC-JWT cookie the TanStack gate issues.
 *
 * Env (set in Cloudflare dashboard — never commit secrets):
 *   KANOPI_USER, KANOPI_PASSWORD, KANOPI_SESSION_SECRET
 *
 * Copy this folder to /functions at the Pages project root.
 */
const COOKIE = "kanopi_gate";

function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return typeof payload.sub === "string" ? payload.sub : null;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isData = url.pathname.startsWith("/data/");
  if (!isData) return context.next();

  const secret = context.env.KANOPI_SESSION_SECRET;
  if (!secret) {
    return new Response("KANOPI_SESSION_SECRET is not set", { status: 500 });
  }
  const token = cookieValue(context.request.headers.get("cookie"), COOKIE);
  const user = token ? await verifyJwt(token, secret) : null;
  if (!user) return new Response("Unauthorized", { status: 401 });
  return context.next();
}
