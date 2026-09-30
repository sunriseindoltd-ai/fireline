/**
 * Link-preview tags (Open Graph + Twitter card) for the public pages —
 * WhatsApp/LinkedIn/Slack need absolute URLs (feedback 3, A-08). The site
 * address comes from VITE_SITE_URL once Earthline's own domain is live;
 * until then the current production host. Images: scripts/render-og-images.mjs.
 */
const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || "https://kanopi-ochre.vercel.app").replace(/\/$/, "");

export type OgImage = "trace" | "palm" | "soy";

export function ogMeta({
  title,
  description,
  path,
  image,
}: {
  title: string;
  description: string;
  path: string;
  image: OgImage;
}) {
  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Earthline Trace" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: `${SITE_URL}${path}` },
    { property: "og:image", content: `${SITE_URL}/img/og/${image}.jpg` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}
