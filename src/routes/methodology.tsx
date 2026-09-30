import { createFileRoute, redirect } from "@tanstack/react-router";

// The URL people guess first (feedback 3, A-05) — same page as /method.
export const Route = createFileRoute("/methodology")({
  beforeLoad: () => {
    throw redirect({ to: "/method", statusCode: 301 });
  },
});
