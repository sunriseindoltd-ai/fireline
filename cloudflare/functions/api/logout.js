const COOKIE = "kanopi_gate";

export async function onRequestPost({ request }) {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers({ "content-type": "application/json" });
  headers.append(
    "set-cookie",
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
  return new Response(JSON.stringify({ ok: true }), { headers });
}
