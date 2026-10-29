/** Route helpers: map-app links, straight-line distance and compass direction. */

export const gmapsRoute = (lat: number, lon: number, from?: { lat: number; lon: number } | null) =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lon}` : ""}&destination=${lat},${lon}&travelmode=driving`;
export const wazeRoute = (lat: number, lon: number) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0–359). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** Index into an 8-point compass list (N, NE, E, …). */
export const compass8 = (deg: number) => Math.round(deg / 45) % 8;

/** "850 m" / "12,4 km" in the page language. */
export function formatDistance(m: number, lang: "en" | "id") {
  const loc = lang === "id" ? "id-ID" : "en-US";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString(loc, { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
}
