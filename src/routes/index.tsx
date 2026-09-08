import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGateSession } from "@/lib/gate-actions";
import { LedgerProvider } from "@/lib/ledger-context";
import { Workspace } from "@/components/workspace";

export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getGateSession();
    if (!session.ok) throw redirect({ to: "/login" });
    return session;
  },
  component: Home,
});

function Home() {
  const session = Route.useLoaderData();
  return (
    <LedgerProvider>
      <Workspace role={session.role} />
    </LedgerProvider>
  );
}
