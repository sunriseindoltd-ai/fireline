import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { LanguageProvider } from "@/lib/i18n";
import appCss from "../styles.css?url";
import flxCss from "../styles-flx.css?url";
import { SKIN_BOOT } from "@/lib/skin";
import { PwaBoot } from "@/components/install-app";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "FireLine · Earthline" },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#FFFFFF" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "FireLine" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: flxCss },
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
        <script dangerouslySetInnerHTML={{ __html: SKIN_BOOT }} />
        <HeadContent />
      </head>
      <body className="antialiased">
        <LanguageProvider>
          <Outlet />
          <PwaBoot />
        </LanguageProvider>
        <Scripts />
      </body>
    </html>
  ),
});
