import { createFileRoute } from "@tanstack/react-router";
import { validateGroupSearch } from "@/lib/app-search";

// Documents tab. UI lives in the /app layout (workspace.tsx reads the path).
export const Route = createFileRoute("/app/$group/docs")({
  validateSearch: validateGroupSearch,
  component: () => null,
});
