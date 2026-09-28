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
 */
export const TENANTS = [
  { id: "adm", label: "ADM" },
  { id: "brc", label: "Bakrie Renewable Chemicals" },
] as const;

export type Tenant = (typeof TENANTS)[number]["id"];

export const DEFAULT_TENANT: Tenant = "adm";

export function isTenant(v: unknown): v is Tenant {
  return TENANTS.some((t) => t.id === v);
}

/** Path prefix inside private-data/ (and the R2 bucket) for a tenant's own files. */
export function tenantPrefix(tenant: Tenant): string {
  return tenant === "adm" ? "" : `tenants/${tenant}/`;
}
