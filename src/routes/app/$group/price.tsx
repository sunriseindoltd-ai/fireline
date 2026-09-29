import { createFileRoute } from "@tanstack/react-router";
import { validateGroupSearch } from "@/lib/app-search";

// Palm oil price tab. UI lives in the /app layout (workspace.tsx reads the path).
export const Route = createFileRoute("/app/$group/price")({
  validateSearch: validateGroupSearch,
  component: () => null,
});
