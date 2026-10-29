import type { Case } from "@/lib/fire-ui";

/**
 * A fire event: hotspots of one case that fall within about 1 km of each other
 * and were seen on consecutive WIB days. One satellite pass can be a flare, a
 * hot roof or a cloud edge; heat at the same place day after day is a fire.
 */
export type FireEventRow = {
  id: string;
  caseId: string;
  name: string;
  kind: Case["kind"];
  plot: Case["plot"];
  mills: string[];
  groups: string[];
  /** First and last WIB day of the run, and every day in it. */
  start: string;
  end: string;
  days: string[];
  /** Hotspot points (≈450 m clusters) in the run and the strongest one. */
  pts: number;
  frp: number;
  lat: number;
  lon: number;
  plots: number;
  /** Hotspots today or yesterday (WIB): still burning as far as the satellites can tell. */
  ongoing: boolean;
  /** Nearest hotspot to a plot in the whole case (m, 0 = inside). */
  d: number;
};

/** Grid used to group points: 0.01° ≈ 1.1 km, merged with the 8 neighbouring squares. */
const GRID = 0.01;
const DAY = 86400000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const dayMinus = (d: string, n: number) => new Date(dayMs(d) - n * DAY).toISOString().slice(0, 10);

/** Events of every case, longest-running and most recent first. */
export function fireEvents(cases: Case[], minDays: number, today: string): FireEventRow[] {
  const out: FireEventRow[] = [];
  const yesterday = dayMinus(today, 1);
  for (const c of cases) {
    if (!c.pts.length || c.days.length < minDays) continue;
    // Union-find over grid squares.
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let x = k;
      while (parent.get(x) !== r) {
        const nx = parent.get(x)!;
        parent.set(x, r);
        x = nx;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const key = (lon: number, lat: number) => `${Math.floor(lat / GRID)}_${Math.floor(lon / GRID)}`;
    const ptKey = c.pts.map(([lon, lat]) => key(lon, lat));
    for (const k of ptKey) if (!parent.has(k)) parent.set(k, k);
    for (const k of parent.keys()) {
      const [y, x] = k.split("_").map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nk = `${y + dy}_${x + dx}`;
        if ((dy || dx) && parent.has(nk)) union(k, nk);
      }
    }
    const clusters = new Map<string, number[]>();
    ptKey.forEach((k, i) => {
      const r = find(k);
      const list = clusters.get(r);
      if (list) list.push(i);
      else clusters.set(r, [i]);
    });
    let ci = 0;
    for (const idxs of clusters.values()) {
      ci++;
      const byDay = new Map<string, number[]>();
      for (const i of idxs) {
        const d = c.days[c.pts[i][3]]?.day;
        if (!d) continue;
        const l = byDay.get(d);
        if (l) l.push(i);
        else byDay.set(d, [i]);
      }
      const days = [...byDay.keys()].sort();
      // Split into runs of consecutive days.
      let run: string[] = [];
      const flush = () => {
        if (run.length >= minDays) {
          const pts = run.flatMap((d) => byDay.get(d)!);
          const top = pts.reduce((a, i) => (c.pts[i][2] > c.pts[a][2] ? i : a), pts[0]);
          const end = run[run.length - 1];
          out.push({
            id: `${c.id}~${run[0]}~${ci}`,
            caseId: c.id,
            name: c.name,
            kind: c.kind,
            plot: c.plot,
            mills: c.mills,
            groups: c.groups,
            start: run[0],
            end,
            days: run.slice(),
            pts: pts.length,
            frp: c.pts[top][2],
            lat: c.pts[top][1],
            lon: c.pts[top][0],
            plots: c.plots.length,
            ongoing: end >= yesterday,
            d: c.d,
          });
        }
        run = [];
      };
      for (const d of days) {
        if (run.length && dayMs(d) - dayMs(run[run.length - 1]) !== DAY) flush();
        run.push(d);
      }
      flush();
    }
  }
  out.sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || (a.end < b.end ? 1 : a.end > b.end ? -1 : 0) || b.days.length - a.days.length || b.frp - a.frp);
  return out;
}
