import { createFileRoute } from "@tanstack/react-router";
import { validateGroupSearch } from "@/lib/app-search";

// Group summary. UI lives in the /app layout (workspace.tsx reads the path).
export const Route = createFileRoute("/app/$group/")({
  validateSearch: validateGroupSearch,
  component: () => null,
});
