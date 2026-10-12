import { createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import { getGateSession } from "@/lib/gate-actions";
import { LedgerProvider } from "@/lib/ledger-context";
import { isSoyTenant } from "@/lib/tenants";
import { Workspace } from "@/components/workspace";
import { SoyWorkspace } from "@/components/soy-workspace";
import { AccessRequestsPage } from "@/components/access-requests";
import { FirePage } from "@/components/fire-page";

/**
 * Layer 3 — the authenticated workspace shell. The workspace itself renders
 * here once and reads which view to show from the URL (child routes below
 * carry no UI of their own), so switching group/tab/mill never tears down
 * the ledger or re-fetches mills.json.
 */
export const Route = createFileRoute("/app")({
  loader: async ({ location }) => {
    const session = await getGateSession();
    if (!session.ok) {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    return session;
  },
  head: () => ({ meta: [{ title: "Workspace · Earthline Trace" }, { name: "robots", content: "noindex" }] }),
  component: AppShell,
});

function AppShell() {
  const session = Route.useLoaderData();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  // The contact-form inbox (feedback 3, A-15) — Earthline admins only; the
  // child route redirects everyone else.
  if (pathname.startsWith("/app/requests") && session.role === "admin") return <AccessRequestsPage />;
  // The soy workspace has no mill roster/ledger — its own view, whatever the
  // child route (/app/portfolio etc. all land here).
  if (isSoyTenant(session.tenant)) return <SoyWorkspace role={session.role} tenant={session.tenant} />;
  // FireLine (fire monitoring, one page for every group in scope).
  if (pathname.startsWith("/app/fire")) return <FirePage role={session.role} tenant={session.tenant} />;
  return (
    <LedgerProvider>
      <Workspace role={session.role} tenant={session.tenant} />
    </LedgerProvider>
  );
}
