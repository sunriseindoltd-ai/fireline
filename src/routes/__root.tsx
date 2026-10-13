import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { LanguageProvider } from "@/lib/i18n";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "FireLine · Earthline" },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#FFFFFF" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap" },
    ],
  }),
  notFoundComponent: () => (
    <main className="not-found">
      <h1>Not found</h1>
      <p>
        <a href="/">FireLine</a>
      </p>
    </main>
  ),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <LanguageProvider>
          <Outlet />
        </LanguageProvider>
        <Scripts />
      </body>
    </html>
  ),
});
