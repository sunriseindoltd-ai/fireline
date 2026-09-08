import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { serveKanopiData } = await import("@/lib/kanopi-data.server");
        return serveKanopiData(request);
      },
    },
  },
});
