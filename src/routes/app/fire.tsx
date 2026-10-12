import { createFileRoute } from "@tanstack/react-router";

// FireLine page — rendered by the /app layout (FirePage) for palm tenants.
export const Route = createFileRoute("/app/fire")({
  component: () => null,
});
