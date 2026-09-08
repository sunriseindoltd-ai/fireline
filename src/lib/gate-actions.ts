import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  clearGateCookie,
  issueGateToken,
  matchGateCredentials,
  readGateSession,
  setGateCookie,
} from "@/lib/gate";

export const getGateSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await readGateSession();
    return session
      ? { ok: true as const, user: session.user, role: session.role }
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
    const role = matchGateCredentials(data.username, data.password);
    if (!role) {
      return { ok: false as const, error: "ID or password does not match." };
    }
    const username = data.username.trim();
    const token = await issueGateToken(username, role);
    setGateCookie(token);
    return { ok: true as const, user: username, role };
  });

export const gateLogout = createServerFn({ method: "POST" }).handler(async () => {
  clearGateCookie();
  return { ok: true as const };
});
