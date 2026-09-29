import type { Tenant } from "@/lib/tenants";

/**
 * Earthline's deforestation monitoring, per supply chain. The section exists
 * on every chain already; it shows "not yet published" until an entry lands
 * here.
 *
 * - `reports`: monitoring report PDFs, kept on Google Drive (link only — the
 *   files are never copied into the app). Newest first.
 * - `detections`: set once the detection layer is prepared (planned: served
 *   like plots, per tenant, via /data/monitoring/<file>.geojson and drawn on
 *   the chain map).
 *
 * Keyed by tenant, then by mills.json `group`, so one client's reports can
 * never appear in another client's workspace.
 */
export type MonitoringReport = { title: string; period: string; url: string; publishedOn: string };
export type MonitoringEntry = {
  reports: MonitoringReport[];
  detections?: { file: string; asOf: string };
};

const MONITORING: Partial<Record<Tenant, Record<string, MonitoringEntry>>> = {
  adm: {},
  brc: {},
};

export function monitoringFor(tenant: Tenant, group: string): MonitoringEntry {
  return MONITORING[tenant]?.[group] ?? { reports: [] };
}
