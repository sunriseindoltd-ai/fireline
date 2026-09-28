import { createFileRoute, redirect } from "@tanstack/react-router";

// Indonesian alias (feedback 2, Doc 3 §3) — one page, one canonical URL.
export const Route = createFileRoute("/tentang")({
  beforeLoad: () => {
    throw redirect({ to: "/about", statusCode: 301 });
  },
});
