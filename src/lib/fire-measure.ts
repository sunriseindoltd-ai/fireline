/** Geometry and formatting for the map's measuring tools (ruler, area, coordinates, radius). */
import { distanceM } from "@/lib/fire-route";

export type LngLat = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Length of a path in metres (great-circle segments). */
export function pathLengthM(pts: LngLat[]) {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += distanceM({ lon: pts[i - 1][0], lat: pts[i - 1][1] }, { lon: pts[i][0], lat: pts[i][1] });
  return m;
}

/** Spherical area of a ring in m² (same formula as turf.area; sign ignored). */
export function ringAreaM2(ring: LngLat[]) {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs((total * R * R) / 2);
}

/** Point `distM` metres from `from` along `bearing` degrees. */
export function destination(from: LngLat, distM: number, bearing: number): LngLat {
  const lat1 = rad(from[1]), lon1 = rad(from[0]), b = rad(bearing), d = distM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((deg(lon2) + 540) % 360) - 180, deg(lat2)];
}

/** A closed ring approximating a circle of `radiusM` around `center`. */
export function circleRing(center: LngLat, radiusM: number, steps = 72): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) ring.push(destination(center, radiusM, (i * 360) / steps));
  ring.push(ring[0]);
  return ring;
}

/** Plain average of the vertices: good enough to place a label. */
export function centroid(pts: LngLat[]): LngLat {
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / pts.length, s[1] / pts.length];
}

const loc = (lang: "en" | "id") => (lang === "id" ? "id-ID" : "en-US");

/** "850 m" / "1,25 km" / "12,4 km" / "120 km". */
export function formatLength(m: number, lang: "en" | "id") {
  if (m < 1000) return `${m.toLocaleString(loc(lang), { maximumFractionDigits: m < 100 ? 1 : 0 })} m`;
  const km = m / 1000;
  return `${km.toLocaleString(loc(lang), { maximumFractionDigits: km < 10 ? 2 : km < 100 ? 1 : 0 })} km`;
}

/** "640 m²" below a hectare, otherwise hectares ("2,45 ha", "128 ha", "12.400 ha"). */
export function formatArea(m2: number, lang: "en" | "id") {
  if (m2 < 10000) return `${m2.toLocaleString(loc(lang), { maximumFractionDigits: 0 })} m²`;
  const ha = m2 / 10000;
  return `${ha.toLocaleString(loc(lang), { maximumFractionDigits: ha < 10 ? 2 : ha < 100 ? 1 : 0 })} ha`;
}

/** Decimal degrees, 5 places: "-3.12345, 104.56789" (Google Maps order, dot decimal). */
export const formatDD = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/** Degrees-minutes-seconds: 3°07'24.4"S 104°34'04.4"E. */
export function formatDMS(lat: number, lon: number) {
  const one = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const mFull = (a - d) * 60;
    const m = Math.floor(mFull);
    const s = (mFull - m) * 60;
    return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${v < 0 ? neg : pos}`;
  };
  return `${one(lat, "N", "S")} ${one(lon, "E", "W")}`;
}
