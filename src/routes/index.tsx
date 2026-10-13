import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-actions";
import { FirePage } from "@/components/fire-page";

// The FireLine dashboard. Signed-out visitors go to /login.
export const Route = createFileRoute("/")({
  loader: async () => {
    const s = await getSession();
    if (!s.ok) throw redirect({ to: "/login" });
    return s;
  },
  component: () => {
    const s = Route.useLoaderData();
    return <FirePage role={s.role} />;
  },
});
