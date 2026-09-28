import { createFileRoute } from "@tanstack/react-router";

// UI lives in the /app layout (workspace.tsx reads the path).
export const Route = createFileRoute("/app/portfolio")({
  component: () => null,
});
