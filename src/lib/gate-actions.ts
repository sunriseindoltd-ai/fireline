import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  clearGateCookie,
  issueGateToken,
  matchGateCredentials,
  readGateSession,
  setGateCookie,
} from "@/lib/gate";
import { TENANTS, type Tenant } from "@/lib/tenants";

export const getGateSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await readGateSession();
    return session
      ? { ok: true as const, user: session.user, role: session.role, tenant: session.tenant }
      : { ok: false as const };
  },
);

export const gateLogin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string(),
      password: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const match = matchGateCredentials(data.username, data.password);
    if (!match) {
      return { ok: false as const, error: "ID or password does not match." };
    }
    const username = data.username.trim();
    const token = await issueGateToken(username, match.role, match.tenant);
    setGateCookie(token);
    return { ok: true as const, user: username, role: match.role };
  });

/** Admins (Earthline) only: re-issue the session for another client's workspace. */
export const gateSwitchTenant = createServerFn({ method: "POST" })
  .validator(z.object({ tenant: z.enum(TENANTS.map((t) => t.id) as [Tenant, ...Tenant[]]) }))
  .handler(async ({ data }) => {
    const session = await readGateSession();
    if (!session || session.role !== "admin") return { ok: false as const };
    setGateCookie(await issueGateToken(session.user, session.role, data.tenant));
    return { ok: true as const, tenant: data.tenant };
  });

export const gateLogout = createServerFn({ method: "POST" }).handler(async () => {
  clearGateCookie();
  return { ok: true as const };
});
