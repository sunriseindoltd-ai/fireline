/**
 * Clients ("tenants") of the one PalmTrace deployment. Every session belongs
 * to exactly one tenant, and each tenant has its own mill roster, EUDR stats
 * and plot files — never mixed, since the same physical mill can supply more
 * than one client and who-buys-from-whom is confidential. ADM's data keeps
 * its original, unprefixed locations; every other tenant lives under
 * `private-data/tenants/<id>/` (and `tenants/<id>/` in R2).
 *
 * Enforced server-side (kanopi-data.server.ts, /coverage, /eudr-summary):
 * the tenant comes from the signed session, never from the request.
 *
 * `commodity` picks the workspace: palm tenants get the supply-chain/EUDR
 * workspace, the soy one its own statistics + map view (soy-workspace.tsx),
 * with its field files in a separate R2 bucket on another Cloudflare account.
 */
export const TENANTS = [
  { id: "adm", label: "ADM", commodity: "palm" },
  { id: "brc", label: "Bakrie Renewable Chemicals", commodity: "palm" },
  { id: "adm-soy", label: "ADM Soy", commodity: "soy" },
] as const;

export type Tenant = (typeof TENANTS)[number]["id"];

export const DEFAULT_TENANT: Tenant = "adm";

export function isTenant(v: unknown): v is Tenant {
  return TENANTS.some((t) => t.id === v);
}

export function isSoyTenant(tenant: Tenant): boolean {
  return TENANTS.some((t) => t.id === tenant && t.commodity === "soy");
}

/** Path prefix inside private-data/ (and the R2 bucket) for a tenant's own files. */
export function tenantPrefix(tenant: Tenant): string {
  return tenant === "adm" ? "" : `tenants/${tenant}/`;
}
