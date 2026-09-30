import { createFileRoute, redirect } from "@tanstack/react-router";

// The spelled-out URL (feedback 3, A-02) — the Documents tab lives at /docs.
export const Route = createFileRoute("/app/$group/documents")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/app/$group/docs", params, statusCode: 301 });
  },
});
