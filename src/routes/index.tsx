import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-actions";
import { FireShell } from "@/components/fire-shell";

// The FireLine dashboard (FireLine Indonesia; Earthline staff also the supply chain). Signed-out visitors go to /login.
export const Route = createFileRoute("/")({
  loader: async () => {
    const s = await getSession();
    if (!s.ok) throw redirect({ to: "/login" });
    return s;
  },
  component: () => {
    const s = Route.useLoaderData();
    return <FireShell role={s.role} />;
  },
});
