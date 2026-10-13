// Geometry helpers for hotspot ↔ plot attribution (pure, no deps).
export type Ring = [number, number][];
export type FirePlot = {
  id: string; mill: string; uml: string; group: string; company: string; type: string;
  village: string; district: string; province: string; ha: number;
  bbox: [number, number, number, number]; g: Ring[];
};

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in metres from point to a ring's edges (equirectangular, fine for < 5 km). */
export function distToRingM(x: number, y: number, ring: Ring): number {
  const kx = 111320 * Math.cos((y * Math.PI) / 180), ky = 110574;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - x) * kx, ay = (ring[j][1] - y) * ky;
    const bx = (ring[i][0] - x) * kx, by = (ring[i][1] - y) * ky;
    const dx = bx - ax, dy = by - ay;
    let t = dx || dy ? (-(ax * dx + ay * dy)) / (dx * dx + dy * dy) : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, py = ay + dy * t;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** 0 = inside the plot, else metres to the nearest edge (Infinity if beyond `maxM`). */
export function plotDistanceM(x: number, y: number, p: FirePlot, maxM: number): number {
  const pad = maxM / 100000; // ~1° ≈ 100 km, generous
  if (x < p.bbox[0] - pad || x > p.bbox[2] + pad || y < p.bbox[1] - pad || y > p.bbox[3] + pad) return Infinity;
  let best = Infinity;
  for (const r of p.g) {
    if (pointInRing(x, y, r)) return 0;
    const d = distToRingM(x, y, r);
    if (d < best) best = d;
  }
  return best <= maxM ? best : Infinity;
}

export const CELL = 0.05;
export const cellId = (x: number, y: number) => `${Math.floor(y / CELL)}_${Math.floor(x / CELL)}`;
/** Cell of the point plus neighbours within `radM` (so matches across cell edges are not missed). */
export function cellsAround(x: number, y: number, radM: number): string[] {
  const d = radM / 100000;
  const out = new Set<string>();
  for (const yy of [y - d, y, y + d]) for (const xx of [x - d, x, x + d]) out.add(cellId(xx, yy));
  return [...out];
}
