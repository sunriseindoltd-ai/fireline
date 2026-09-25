// Retry delays (ms) for a transient failure — a network error or a 5xx.
// Serverless cold starts and the odd R2 hiccup both show up as a single
// failed request that succeeds a second later; before this, one of those
// surfaced straight to the user as "couldn't load plots" (and, for the
// mill summary, as the misleading "no plot data prepared yet").
const RETRY_DELAYS_MS = [800, 2000];

function isTransient(status: number) {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * `fetch` that quietly retries transient failures. A non-transient response
 * (2xx, 404, 401, 403, …) is returned on the first try — those are real
 * answers, not blips. The final attempt's response (or error) is what the
 * caller sees.
 */
export async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length;
    try {
      const res = await fetch(input, init);
      if (last || !isTransient(res.status)) return res;
    } catch (err) {
      if (last) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
