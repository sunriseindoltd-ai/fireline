import { createFileRoute, redirect } from "@tanstack/react-router";

// Indonesian alias (feedback 2, Doc 3 §3) — one page, one canonical URL.
export const Route = createFileRoute("/metodologi")({
  beforeLoad: () => {
    throw redirect({ to: "/method", statusCode: 301 });
  },
});
