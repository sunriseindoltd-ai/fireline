import { Link, createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import appCss from "../styles.css?url";

// Product name first, firm second (feedback 2, Doc 3 §2) — and never the
// internal code name.
const APP_NAME = "Earthline Trace";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#FFFFFF" },
      { name: "application-name", content: "Earthline Trace" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  notFoundComponent: NotFound,
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

function NotFound() {
  const { s } = useI18n();
  return (
    <main className="not-found">
      <h1>{s.notFoundTitle}</h1>
      <p>{s.notFoundBody}</p>
      <Link to="/" className="btn-primary">
        {s.home}
      </Link>
    </main>
  );
}
