/**
 * The one place the brand names live (user decision, 29 Sep 2026):
 * "Earthline Trace" is the umbrella over one product per commodity. Renaming
 * the umbrella or a product is a change here, nowhere else.
 *
 *   Earthline Trace  (/)
 *   ├── PalmTrace    (/palm)  palm oil — supply chains, EUDR/NDPE; POME and
 *   │                          oleochemicals studies sit here too
 *   ├── SoyTrace     (/soy)   soybeans — crushing-plant sourcing areas
 *   └── CoffeeTrace           coming soon: listed, no page until it has data
 *
 * All products share one account system and one login (themed per product
 * via /login?product=…); an account lands in the workspace it has access to.
 */
export const UMBRELLA = { name: "Earthline Trace", company: "Earthline" } as const;

export type ProductId = "palm" | "soy";

export const PRODUCTS: Record<ProductId, { id: ProductId; name: string; path: "/palm" | "/soy" }> =
  {
    palm: { id: "palm", name: "PalmTrace", path: "/palm" },
    soy: { id: "soy", name: "SoyTrace", path: "/soy" },
  };

/** Each product has its own colour (wordmark + logo): PalmTrace keeps the
 * green/blue of the umbrella, SoyTrace is amber (ripe soybeans). The colour is
 * applied by `data-product` on the page wrapper (styles.css / site.css), the
 * logo by <BrandMark product>. */

/** Listed on the umbrella page as "coming soon" only. */
export const COMING_SOON = ["CoffeeTrace"] as const;

export function isProductId(v: unknown): v is ProductId {
  return v === "palm" || v === "soy";
}

/** Display name for a product, or the umbrella when none is given. */
export function brandName(product?: ProductId | null): string {
  return product ? PRODUCTS[product].name : UMBRELLA.name;
}

/** Existing copy says "PalmTrace" in places that are now per product (login
 * heading, contact subject…): swap in the right name. */
export function withBrand(text: string, product?: ProductId | null): string {
  return text.replaceAll("PalmTrace", brandName(product));
}
