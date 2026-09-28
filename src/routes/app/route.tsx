import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGateSession } from "@/lib/gate-actions";
import { LedgerProvider } from "@/lib/ledger-context";
import { Workspace } from "@/components/workspace";

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
  head: () => ({ meta: [{ title: "Workspace · PalmTrace" }, { name: "robots", content: "noindex" }] }),
  component: AppShell,
});

function AppShell() {
  const session = Route.useLoaderData();
  return (
    <LedgerProvider>
      <Workspace role={session.role} tenant={session.tenant} />
    </LedgerProvider>
  );
}
