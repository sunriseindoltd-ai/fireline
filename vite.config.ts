import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// FireLine — standalone build (fire monitoring only; no PalmTrace/SoyTrace data).
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "127.0.0.1", port: 8097, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), ...(command === "build" || isPreview ? [nitro({ preset: "vercel", vercel: { functions: { maxDuration: 300 } } })] : []), viteReact()],
}));
