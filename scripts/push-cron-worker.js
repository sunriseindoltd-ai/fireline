// Cloudflare Worker that wakes FireLine's fire notifications (10 Nov 2026).
// Vercel Hobby allows one cron a day, so this Worker's Cron Trigger calls the app instead, every 30 minutes.
//
// Set up in the Cloudflare dashboard: Workers & Pages → Create → Worker → paste this file → Deploy;
// Settings → Variables and Secrets → add Secret FIRE_CRON_SECRET (same value as on the Vercel project fireline);
// Settings → Triggers → Cron Triggers → add "*/30 * * * *".
// Test: the Worker's own URL with ?run=1 runs it once and shows the answer (same secret required as a header).

const TARGET = "https://fireline.earthline-trace.info/fire/push/run";

async function run(env) {
  const res = await fetch(TARGET, { method: "POST", headers: { authorization: `Bearer ${env.FIRE_CRON_SECRET}` } });
  const text = await res.text();
  console.log(`[fireline push] ${res.status} ${text.slice(0, 300)}`);
  return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("run") === "1" && request.headers.get("authorization") === `Bearer ${env.FIRE_CRON_SECRET}`) return run(env);
    return new Response("FireLine push scheduler. Nothing to see here.", { status: 200 });
  },
};
