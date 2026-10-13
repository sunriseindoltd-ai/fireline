import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { readSession } = await import("@/lib/auth");
  const s = await readSession();
  return s ? { ok: true as const, user: s.user, role: s.role } : { ok: false as const };
});

// Simple per-instance throttle: 10 failed attempts per 10 minutes per user ID.
const fails = new Map<string, number[]>();

export const login = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string().max(80), password: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { issueSession, matchCredentials } = await import("@/lib/auth");
    const key = data.username.trim().toLowerCase();
    const now = Date.now();
    const recent = (fails.get(key) ?? []).filter((t) => now - t < 600000);
    if (recent.length >= 10) return { ok: false as const, error: "locked" as const };
    const s = matchCredentials(data.username, data.password);
    if (!s) {
      fails.set(key, [...recent, now]);
      return { ok: false as const, error: "invalid" as const };
    }
    fails.delete(key);
    await issueSession(s);
    return { ok: true as const };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearSession } = await import("@/lib/auth");
  clearSession();
  return { ok: true as const };
});
