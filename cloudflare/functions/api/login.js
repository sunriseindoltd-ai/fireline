/**
 * Cloudflare Pages function: POST { username, password } → HttpOnly JWT cookie.
 * Pair with /functions/_middleware.js. Same env as the TanStack gate.
 */
const COOKIE = "kanopi_gate";
const MAX_AGE = 60 * 60 * 12;

function b64url(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(sub, secret) {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ sub, iat: now, exp: now + MAX_AGE })));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

function timingSafeEqual(a, b) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let out = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) out |= (aa[i] || 0) ^ (bb[i] || 0);
  return out === 0;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const user = env.KANOPI_USER || "earthline";
  const pass = env.KANOPI_PASSWORD || "Kanopi2026";
  const secret = env.KANOPI_SESSION_SECRET;
  if (!secret) return Response.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  if (!timingSafeEqual(String(body.username || "").trim(), user) || !timingSafeEqual(String(body.password || ""), pass)) {
    return Response.json({ ok: false, error: "ID atau kata sandi tidak sesuai." }, { status: 401 });
  }
  const token = await signJwt(user, secret);
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers({ "content-type": "application/json" });
  headers.append(
    "set-cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`,
  );
  return new Response(JSON.stringify({ ok: true, user }), { headers });
}
