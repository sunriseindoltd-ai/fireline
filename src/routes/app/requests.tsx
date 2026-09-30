import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGateSession } from "@/lib/gate-actions";

// Contact-form inbox (feedback 3, A-15). The page itself is rendered by the
// /app layout (AccessRequestsPage); only Earthline admins get this far.
export const Route = createFileRoute("/app/requests")({
  beforeLoad: async () => {
    const session = await getGateSession();
    if (!session.ok || session.role !== "admin") throw redirect({ to: "/app/portfolio" });
  },
  component: () => null,
});
