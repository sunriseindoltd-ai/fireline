import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BrandMark } from "@/components/brand-mark";
import { CROP_COLORS, Columns, GroupedColumns, HBars, NET_COLORS, ShareBar, StackColumns } from "@/components/soy-report-charts";
import { basemapStyle } from "@/components/chain-map";
import { catchmentLabel } from "@/components/soy-supply";
import { loadNonCompliant, loadUnit, type SoyFeature } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { fill, formatAcres, formatCount, formatHa, formatLarge } from "@/lib/format";
import { SOY_GROUPS, type SoyCopy } from "@/lib/soy-copy";
import { soyReportCopy, type SoyReportCopy } from "@/lib/soy-report-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  FIELD_COLOR,
  NC_COLOR,
  NC_INK,
  NC_MARK,
  PLANT_COLOR,
  TP_COLOR,
  circle,
  comboMembers,
  comboTotals,
  inScope,
  isCombo,
  levelOf,
  pct,
  scopeBounds,
  stateName,
  unitParts,
  type Catchment,
  type SupplyData,
} from "@/lib/soy-supply";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * SoyTrace's printable report: a document laid out for A4 paper (browser
 * print → "Save as PDF"), built for the catchment selected in the workspace —
 * not a print of the screen. Sections: cover, summary (with a written
 * summary from the figures), map (rendered off-screen and captured as an
 * image), facilities, non-compliant fields (summary + list, never owners),
 * fields and crop history, rail and river, data and method. Every figure
 * comes from the same supply.json / field files as the workspace.
 */

type Basemap = "esri" | "osm";
type Sections = { map: boolean; facilities: boolean; nc: boolean; ncList: boolean; crops: boolean; transport: boolean; method: boolean };
type FacRow = { id: string; name: string; kind: string; radius: string; cf: number; nf: number; ca: number; na: number; total?: boolean };
type NcProps = Record<string, unknown>;

const MAP_W = 1400;
const MAP_H = 900;
const NC_LIST_MAX = 400;
const FAC_CHART_MAX = 12;
/** "Unknown" in the share bars: a neutral grey, always labelled. */
const UNKNOWN_COLOR = "#b9b9bd";

function useNow(lang: Lang) {
  return useMemo(() => new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "long", year: "numeric" }), [lang]);
}

/** "20 NM · 37 km" / "20 mi · 32 km", in the unit the client's buffer came in. */
function radiusText(x: { m: number; unit: string } | null, lang: Lang) {
  if (!x) return "—";
  const loc = lang === "id" ? "id-ID" : "en-US";
  const v = x.unit === "NM" ? x.m / 1852 : x.m / 1609.344;
  return `${v.toLocaleString(loc, { maximumFractionDigits: Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1 })} ${x.unit === "NM" ? "NM" : "mi"} · ${Math.round(x.m / 1000).toLocaleString(loc)} km`;
}

function scopeRadius(id: string, data: SupplyData): { m: number; unit: string } | null {
  const d = data.delivered;
  if (id === "q40") return d.q40;
  if (id === "q80" || id === "direct") return d.q80;
  if (id === "adm" || data.admElevators.some((e) => e.id === id)) return d.adm;
  if (id === "tp" || id === "tpcore" || data.thirdParty.some((e) => e.id === id)) return d.tp;
  return null;
}

function scopeName(id: string, data: SupplyData, c: SoySupplyCopy): string {
  if (isCombo(id)) return comboMembers(id).map((m): string => scopeName(m, data, c)).join(" + ");
  if (id === "q40" || id === "q80") return `${data.plant.name} · ${catchmentLabel(id, data, c)}`;
  return catchmentLabel(id, data, c);
}

function kindOf(id: string, data: SupplyData, c: SoySupplyCopy) {
  if (["all", "direct", "adm", "tp", "tpcore"].includes(id)) return c.kindTier;
  if (id === "q40" || id === "q80") return c.kindPlant;
  if (data.admElevators.some((e) => e.id === id)) return c.kindAdm;
  return c.kindTp;
}

/** One or two words for the facilities table's Type column. */
function shortKind(id: string, data: SupplyData, r: SoyReportCopy) {
  if (["all", "direct", "adm", "tp", "tpcore"].includes(id)) return r.kindGroup;
  if (id === "q40" || id === "q80") return r.kindPlant;
  if (data.admElevators.some((e) => e.id === id)) return r.kindAdm;
  return r.kindTp;
}

/** The rows of the facilities table for a scope (its own row first). */
function facilityIds(scope: string, data: SupplyData): string[] {
  const adm = data.admElevators.filter((e) => e.radiusM).map((e) => e.id);
  if (isCombo(scope)) return comboMembers(scope);
  if (scope === "all") return ["all", "q80", "q40", ...adm, ...data.thirdParty.map((e) => e.id)];
  if (scope === "direct" || scope === "q80") return ["q80", "q40"];
  if (scope === "adm") return ["adm", ...adm];
  if (scope === "tp") return ["tp", ...data.thirdParty.map((e) => e.id)];
  if (scope === "tpcore") return ["tpcore", ...data.thirdParty.filter((e) => e.core).map((e) => e.id)];
  return [scope];
}

/** Non-compliant summaries counted from the field list (combined scopes have no stored ones). */
function ncStatsFrom(list: NcProps[]) {
  const by = (key: string, map: (v: unknown) => string) => {
    const m = new Map<string, number>();
    for (const p of list) m.set(map(p[key]), (m.get(map(p[key])) ?? 0) + 1);
    return m;
  };
  return {
    byState: [...by("s", (v) => String(v ?? "—"))].map(([state, fields]) => ({ state, fields })).sort((a, b) => b.fields - a.fields),
    byUse: Object.fromEntries(by("u", (v) => String(v ?? "unknown"))),
    byYear: [...by("y", (v) => (v == null ? "" : String(v)))].filter(([y]) => y).map(([y, fields]) => ({ year: Number(y), fields })).sort((a, b) => a.year - b.year),
    byBefore: Object.fromEntries(by("b", (v) => String(v ?? "unknown"))),
  };
}

// ------------------------------------------------------------------ map
type MapShot = { url: string; scaleMi: number; scalePct: number } | "failed";

/** Draws the scope off-screen at a fixed size and returns it as an image. */
function useMapShot(opts: {
  enabled: boolean;
  data: SupplyData;
  scope: string;
  basemap: Basemap;
  fields: SoyFeature[] | null;
  nc: SoyFeature[] | null;
  waitFields: boolean;
}) {
  const { enabled, data, scope, basemap, fields, nc, waitFields } = opts;
  const [shot, setShot] = useState<MapShot | null>(null);
  useEffect(() => {
    setShot(null);
    if (!enabled || !nc || (waitFields && !fields)) return;
    let cancelled = false;
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-${MAP_W * 3}px;top:0;width:${MAP_W}px;height:${MAP_H}px;`;
    document.body.appendChild(host);
    let map: import("maplibre-gl").Map | null = null;
    const done = (s: MapShot) => {
      if (!cancelled) setShot(s);
      map?.remove();
      map = null;
      host.remove();
    };
    // Big catchments (0–80 NM, ~110k fields) can take a while on a slow line.
    const timer = window.setTimeout(() => done("failed"), 90_000);
    void (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled) return;
        const bounds = scopeBounds(scope, data) ?? scopeBounds("all", data)!;
        map = new maplibregl.Map({
          container: host,
          style: basemapStyle(basemap) as never,
          bounds,
          fitBoundsOptions: { padding: 36 },
          interactive: false,
          attributionControl: false,
          preserveDrawingBuffer: true,
          pixelRatio: 2,
          fadeDuration: 0,
        });
        const ink = basemap === "esri" ? "#ffffff" : "#1d1d1f";
        map.on("load", () => {
          if (!map) return;
          const member = (id: string) => (isCombo(scope) ? comboMembers(scope).includes(id) : false);
          const strong = (id: string, kind: "plant" | "adm" | "tp", core = false) =>
            scope === "all" ||
            scope === id ||
            member(id) ||
            (kind === "plant" && (scope === "direct" || scope === "q80" || scope === "q40" || member("q80") || member("q40"))) ||
            (kind === "adm" && scope === "adm") ||
            (kind === "tp" && (scope === "tp" || (scope === "tpcore" && core)));
          const ring = (lon: number, lat: number, r: number, props: object) => ({
            type: "Feature" as const,
            properties: props,
            geometry: { type: "Polygon" as const, coordinates: [circle(lon, lat, r)] },
          });
          const point = (lon: number, lat: number, props: object) => ({ type: "Feature" as const, properties: props, geometry: { type: "Point" as const, coordinates: [lon, lat] } });
          const rings = [
            ...data.rings.map((r) => ring(data.plant.lon, data.plant.lat, r.radiusM, { kind: "plant", on: strong(r.id, "plant") })),
            ...data.admElevators.filter((e) => e.radiusM).map((e) => ring(e.lon, e.lat, e.radiusM!, { kind: "adm", on: strong(e.id, "adm") })),
            ...data.thirdParty.map((e) => ring(e.lon, e.lat, e.radiusM, { kind: "tp", on: strong(e.id, "tp", e.core) })),
          ];
          const ncIn = (f: SoyFeature) => inScope(scope, { flags: Number(f.properties.f ?? 0), k: String(f.properties.k ?? "") });
          const ncFeatures = (nc ?? []).map((f) => ({ ...f, properties: { ...f.properties, in: ncIn(f) } as Record<string, unknown> }));
          const label = levelOf(scope) === 3 || scope === "adm";
          map.addSource("fields", { type: "geojson", data: { type: "FeatureCollection", features: fields ?? [] } as never });
          map.addSource("rings", { type: "geojson", data: { type: "FeatureCollection", features: rings } as never });
          map.addSource("nc", { type: "geojson", data: { type: "FeatureCollection", features: ncFeatures } as never });
          map.addSource("nc-pts", {
            type: "geojson",
            data: { type: "FeatureCollection", features: ncFeatures.map((f) => point(Number(f.properties._x), Number(f.properties._y), { in: f.properties.in })) } as never,
          });
          map.addSource("fac", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                point(data.plant.lon, data.plant.lat, { kind: "plant", name: data.plant.name, label: true }),
                ...data.admElevators.map((e) => point(e.lon, e.lat, { kind: "adm", name: e.city ?? e.name, label: label && strong(e.id, "adm") })),
                ...data.thirdParty.map((e) => point(e.lon, e.lat, { kind: "tp", name: e.company ?? "", label: levelOf(scope) === 3 && strong(e.id, "tp", e.core) })),
              ],
            } as never,
          });
          map.addLayer({ id: "fields", type: "fill", source: "fields", paint: { "fill-color": FIELD_COLOR, "fill-opacity": 0.82 } });
          map.addLayer({
            id: "rings",
            type: "line",
            source: "rings",
            paint: {
              "line-color": ["match", ["get", "kind"], "tp", TP_COLOR, ink] as never,
              "line-width": ["case", ["get", "on"], ["match", ["get", "kind"], "plant", 2.4, 1.6], 0.8] as never,
              "line-opacity": ["case", ["get", "on"], 0.95, 0.35] as never,
              "line-dasharray": [3, 2],
            },
          });
          map.addLayer({ id: "nc-fill", type: "fill", source: "nc", filter: ["!=", ["geometry-type"], "Point"], paint: { "fill-color": NC_COLOR, "fill-opacity": 0.9 } });
          map.addLayer({ id: "nc-line", type: "line", source: "nc", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": NC_INK, "line-width": 1 } });
          map.addLayer({
            id: "nc-dot",
            type: "circle",
            source: "nc-pts",
            paint: {
              "circle-radius": ["case", ["get", "in"], 4.2, 2.6] as never,
              "circle-color": NC_MARK,
              "circle-opacity": ["case", ["get", "in"], 1, 0.55] as never,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": ["case", ["get", "in"], 1.4, 0.6] as never,
            },
          });
          map.addLayer({
            id: "fac",
            type: "circle",
            source: "fac",
            paint: {
              "circle-radius": ["match", ["get", "kind"], "plant", 7, "adm", 5, 3.6] as never,
              "circle-color": ["match", ["get", "kind"], "plant", PLANT_COLOR, "adm", "#ffffff", TP_COLOR] as never,
              "circle-stroke-color": ["match", ["get", "kind"], "adm", "#1d1d1f", "#ffffff"] as never,
              "circle-stroke-width": 1.6,
            },
          });
          map.addLayer({
            id: "fac-label",
            type: "symbol",
            source: "fac",
            filter: ["==", ["get", "label"], true],
            layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
            paint: { "text-color": "#1d1d1f", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
          });
          map.once("idle", () => {
            if (!map || cancelled) return;
            window.clearTimeout(timer);
            try {
              const url = map.getCanvas().toDataURL("image/jpeg", 0.9);
              // A round number of miles about a fifth of the map wide.
              const lat = map.getCenter().lat;
              const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
              const want = (MAP_W * 0.2 * mPerPx) / 1609.344;
              const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
              const scaleMi = steps.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), 1);
              done({ url, scaleMi, scalePct: ((scaleMi * 1609.344) / mPerPx / MAP_W) * 100 });
            } catch {
              done("failed");
            }
          });
        });
        map.on("error", () => undefined);
      } catch {
        done("failed");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      map?.remove();
      host.remove();
    };
  }, [enabled, data, scope, basemap, fields, nc, waitFields]);
  return shot;
}

// --------------------------------------------------------------- pieces
function Kpi({ value, label, sub, tone }: { value: string; label: string; sub?: string; tone?: "nc" | "ok" }) {
  return (
    <div className={`rpt-kpi ${tone ?? ""}`}>
      <b>{value}</b>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

/** Sections run on after one another (only the cover has a page to itself); blocks avoid splitting across pages. */
function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rpt-section">
      <h2>
        <span>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SimpleTable({ head, rows, num = [] }: { head: string[]; rows: (string | number)[][]; num?: number[] }) {
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h + i} className={num.includes(i) ? "num" : ""}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((v, i) => (
              <td key={i} className={num.includes(i) ? "num" : ""}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --------------------------------------------------------------- report
export function SoyReport({
  data,
  scope,
  lang,
  c,
  sc,
  onClose,
}: {
  data: SupplyData;
  scope: string;
  lang: Lang;
  c: SoySupplyCopy;
  sc: SoyCopy;
  onClose: () => void;
}) {
  const r: SoyReportCopy = soyReportCopy[lang];
  const date = useNow(lang);
  const [sections, setSections] = useState<Sections>({ map: true, facilities: true, nc: true, ncList: true, crops: true, transport: true, method: true });
  const [basemap, setBasemap] = useState<Basemap>("esri");
  const [nc, setNc] = useState<SoyFeature[] | null>(null);
  const [fields, setFields] = useState<SoyFeature[] | null>(null);
  const catchments = useMemo(() => new Map(data.catchments.map((k) => [k.id, k])), [data]);
  const combo = isCombo(scope);
  const k: Catchment | null = combo ? null : (catchments.get(scope) ?? catchments.get("all")!);
  const name = scopeName(scope, data, c);
  const countF = (n: number) => formatCount(n, lang);
  const acF = (n: number) => formatAcres(n, lang);
  const haF = (acres: number) => formatHa(acres * AC_TO_HA, lang);
  const pctF = (p: number) => formatSharePct(p, lang);
  const parts = levelOf(scope) === 3 ? unitParts(scope, data) : null;

  useEffect(() => {
    let off = false;
    loadNonCompliant()
      .then((fc) => !off && setNc(fc.features))
      .catch(() => !off && setNc([]));
    return () => {
      off = true;
    };
  }, []);
  useEffect(() => {
    let off = false;
    setFields(null);
    if (!parts || !sections.map) return;
    Promise.all(parts.map((id) => loadUnit(id)))
      .then((lists) => {
        if (off) return;
        const seen = new Set<string>();
        setFields(lists.flat().filter((f) => !seen.has(String(f.properties.id)) && !!seen.add(String(f.properties.id))));
      })
      .catch(() => !off && setFields([]));
    return () => {
      off = true;
    };
    // parts is derived from scope/data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, data, sections.map]);
  const shot = useMapShot({ enabled: sections.map, data, scope, basemap, fields, nc, waitFields: !!parts });

  // Page footer and numbers: CSS margin boxes, filled in per report.
  useEffect(() => {
    const el = document.createElement("style");
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    el.textContent = `@page { size: A4; margin: 14mm 14mm 16mm; @bottom-left { content: "${esc(fill(r.footer, { scope: name, date }))}"; font: 8pt system-ui, sans-serif; color: #6e6e73; } @bottom-right { content: counter(page) " / " counter(pages); font: 8pt system-ui, sans-serif; color: #6e6e73; } } @page :first { @bottom-left { content: none; } @bottom-right { content: none; } }`;
    document.head.appendChild(el);
    document.documentElement.classList.add("soy-report-open");
    return () => {
      el.remove();
      document.documentElement.classList.remove("soy-report-open");
    };
  }, [r.footer, name, date]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ----------------------------------------------------------- figures
  const tot = combo ? comboTotals(data, comboMembers(scope)) : null;
  const cf = k ? k.compliant.fields : (tot?.fields ?? 0);
  const ca = k ? k.compliant.acres : (tot?.acres ?? 0);
  const nf = k ? k.nonCompliant.fields : (tot?.ncFields ?? 0);
  const na = k ? k.nonCompliant.acres : (tot?.ncAcres ?? 0);
  const ns = pct(na, ca + na);
  const ncIn = useMemo(
    () => (nc ?? []).filter((f) => inScope(scope, { flags: Number(f.properties.f ?? 0), k: String(f.properties.k ?? "") })).map((f) => f.properties),
    [nc, scope],
  );
  // The workspace's cards for the whole chain show the client's whole list (also outside every catchment).
  const ncStats = k ? (scope === "all" ? data.nonCompliantAll : k.nonCompliant) : ncStatsFrom(ncIn);
  const outside = data.nonCompliantAll.fields - (catchments.get("all")?.nonCompliant.fields ?? 0);
  const facRows: FacRow[] = facilityIds(scope, data)
    .map((id) => {
      const x = catchments.get(id);
      if (!x) return null;
      return {
        id,
        name: scopeName(id, data, c),
        kind: shortKind(id, data, r),
        radius: radiusText(scopeRadius(id, data), lang),
        cf: x.compliant.fields,
        nf: x.nonCompliant.fields,
        ca: x.compliant.acres,
        na: x.nonCompliant.acres,
      };
    })
    .filter((x): x is FacRow => !!x);
  if (combo && tot) facRows.push({ id: "total", name: r.facTotal, kind: "", radius: "", cf: tot.fields, nf: tot.ncFields, ca: tot.acres, na: tot.ncAcres, total: true });

  const facNcRows = facRows
    .filter((x) => !x.total && !["all", "adm", "tp", "tpcore"].includes(x.id) && x.nf > 0)
    .sort((a, b) => b.na - a.na)
    .slice(0, FAC_CHART_MAX)
    .map((x) => ({
      key: x.id,
      label: x.name,
      value: x.na,
      text: acF(x.na),
      sub: `${fill(r.fieldsN, { n: countF(x.nf) })} · ${pctF(pct(x.na, x.ca + x.na))}`,
    }));
  // Non-compliant fields by state: the largest ten, the rest folded into "Other".
  const ncStateRows = (() => {
    const list = [...ncStats.byState].sort((a, b) => b.fields - a.fields);
    const head = list.slice(0, 10).map((s) => ({ key: s.state, label: stateName(s.state), value: s.fields, text: countF(s.fields) }));
    const rest = list.slice(10);
    const restN = rest.reduce((a, s) => a + s.fields, 0);
    return rest.length ? [...head, { key: "other", label: fill(r.chOther, { n: rest.length }), value: restN, text: countF(restN) }] : head;
  })();
  const states = k?.compliant.states ?? [];
  // Soybean area by state: the largest ten, the rest folded into "Other".
  const stateRows = (() => {
    const total = states.reduce((a, s) => a + s.acres, 0);
    const row = (key: string, label: string, acres: number) => ({ key, label, value: pct(acres, total), text: formatSharePct(pct(acres, total), lang), sub: formatAcres(acres, lang) });
    const sorted = [...states].sort((a, b) => b.acres - a.acres);
    const rest = sorted.slice(10);
    const head = sorted.slice(0, 10).map((s) => row(s.state, stateName(s.state), s.acres));
    return rest.length ? [...head, row("other", fill(r.chOther, { n: rest.length }), rest.reduce((a, s) => a + s.acres, 0))] : head;
  })();
  const stateAcres = states.reduce((a, s) => a + s.acres, 0);
  const all8 = k?.compliant.soyYears.find((y) => y.years === 8)?.fields ?? 0;
  const near5 = k && k.compliant.coverageAcres > 0 ? pct(k.compliant.corridor["5"]?.either ?? 0, k.compliant.coverageAcres) : null;
  const facility = data.admElevators.find((e) => e.id === scope) ?? data.thirdParty.find((e) => e.id === scope) ?? null;
  const facilityName = facility ? scopeName(scope, data, c) : scope === "q40" || scope === "q80" || scope === "direct" ? data.plant.name : null;
  const facilityDist = facility ?? (facilityName ? data.plant : null);
  const miF = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 })} mi`);
  const useLabel = (u: unknown) => (u === "crop" ? fill(c.useCrop, { crop: "" }) : u === "pasture" ? fill(c.usePasture, { crop: "" }) : u === "nonag" ? fill(c.useNonAg, { crop: "" }) : "—");
  const ncList = [...ncIn].sort((a, b) => Number(b.a ?? 0) - Number(a.a ?? 0));

  let n = 0;
  const num = () => ++n;
  const mapReady = !sections.map || shot !== null;
  // Tables go to the appendix, after the map, charts and text.
  const appendixA = sections.facilities;
  const appendixB = sections.crops && !!k;
  const appendixC = sections.nc && sections.ncList && ncList.length > 0;

  const toggles: [keyof Sections, string][] = [
    ["map", r.secMap],
    ["facilities", r.secFacilities],
    ["nc", r.secNc],
    ["ncList", r.secNcList],
    ["crops", r.secCrops],
    ["transport", r.secTransport],
    ["method", r.secMethod],
  ];

  const report = (
    <div className="soy-report-root" data-product="soy" role="dialog" aria-label={r.title}>
      <div className="rpt-toolbar">
        <div className="rpt-toolbar-main">
          <b>{r.toolbarTitle}</b>
          <span className="rpt-scope">{name}</span>
        </div>
        <div className="rpt-toolbar-opts">
          <span className="rpt-opt-label">{r.sections}</span>
          {toggles.map(([key, label]) => (
            <label key={key} className="rpt-check">
              <input
                type="checkbox"
                checked={sections[key]}
                disabled={key === "ncList" && !sections.nc}
                onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
          {sections.map ? (
            <label className="rpt-check">
              {r.basemap}
              <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)}>
                <option value="esri">{r.basemapImagery}</option>
                <option value="osm">{r.basemapMap}</option>
              </select>
            </label>
          ) : null}
        </div>
        <div className="rpt-toolbar-actions">
          <button type="button" className="btn-primary" disabled={!mapReady} onClick={() => window.print()}>
            {mapReady ? r.print : r.printWait}
          </button>
          <button type="button" className="btn-text" onClick={onClose}>
            {r.close}
          </button>
        </div>
        <p className="rpt-toolbar-note">
          {r.scopeNote} {r.printTip}
        </p>
      </div>

      <article className="rpt-paper">
        {/* ---------------------------------------------------- cover */}
        <header className="rpt-cover">
          <div className="rpt-cover-brand">
            <BrandMark size={30} product="soy" />
            <span>SoyTrace</span>
          </div>
          <p className="rpt-kicker">{r.coverKicker}</p>
          <h1>{name}</h1>
          <dl className="rpt-meta">
            <dt>{r.metaPlant}</dt>
            <dd>{[data.plant.name, [data.plant.city, data.plant.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</dd>
            <dt>{r.metaScope}</dt>
            <dd>
              {name} <small>({combo ? r.kindCombo : kindOf(scope, data, c)})</small>
            </dd>
            <dt>{r.metaRadius}</dt>
            <dd>
              {combo
                ? // One line per member, named: "ADM Quincy · Quincy 0–80 NM: 80 NM · 148 km".
                  comboMembers(scope).map((m) => (
                    <span key={m} className="rpt-meta-line">
                      {scopeName(m, data, c)}: {radiusText(scopeRadius(m, data), lang)}
                    </span>
                  ))
                : radiusText(scopeRadius(scope, data), lang)}
            </dd>
            <dt>{r.metaFacilities}</dt>
            <dd>{countF(facRows.filter((x) => !x.total && !["all", "adm", "tp", "tpcore"].includes(x.id)).length)}</dd>
            <dt>{r.metaDate}</dt>
            <dd>{date}</dd>
            <dt>{r.metaData}</dt>
            <dd>{data.source}</dd>
            <dt>{r.metaBy}</dt>
            <dd>{r.metaByValue}</dd>
          </dl>
          <p className="rpt-confidential">{r.confidential}</p>
        </header>

        {/* -------------------------------------------------- summary */}
        <Section n={num()} title={r.s1}>
          <div className="rpt-kpis">
            <Kpi value={countF(cf)} label={c.kpiFields} />
            <Kpi value={acF(ca)} label={c.kpiArea} sub={haF(ca)} />
            <Kpi tone="ok" value={pctF(pct(ca, ca + na))} label={c.kpiCompliantShare} />
            <Kpi tone="nc" value={countF(nf)} label={c.kpiNcFields} />
            <Kpi tone="nc" value={acF(na)} label={c.kpiNcArea} sub={haF(na)} />
            <Kpi tone="nc" value={pctF(ns)} label={c.kpiNcShare} sub={`${r.kNcShareFields}: ${pctF(pct(nf, cf + nf))}`} />
          </div>
          <div className="rpt-prose">
            <p>
              {nf
                ? fill(r.sumLead, { cf: countF(cf), ca: acF(ca), cha: haF(ca), nf: countF(nf), na: acF(na), cs: pctF(pct(ca, ca + na)), ns: pctF(ns) })
                : fill(r.sumLeadNone, { cf: countF(cf), ca: acF(ca), cha: haF(ca) })}
            </p>
            {combo ? <p>{r.sumCombo}</p> : null}
            {scope === "all" && outside > 0 ? <p>{fill(r.sumOutside, { all: countF(data.nonCompliantAll.fields), out: countF(outside) })}</p> : null}
            {states.length ? (
              <p>
                {fill(r.sumStates, {
                  states: states
                    .slice(0, 3)
                    .map((s) => `${stateName(s.state)} ${pctF(pct(s.acres, stateAcres))}`)
                    .join(", "),
                })}
              </p>
            ) : null}
            {k && all8 ? <p>{fill(r.sumAll8, { n: countF(all8), p: pctF(pct(all8, k.compliant.fields)) })}</p> : null}
            {near5 != null ? <p>{fill(r.sumRail, { p: pctF(near5) })}</p> : null}
          </div>
        </Section>

        {/* ------------------------------------------------------ map */}
        {sections.map ? (
          <Section n={num()} title={r.s2}>
            {shot === null ? (
              <div className="rpt-map-wait">{r.printWait}</div>
            ) : shot === "failed" ? (
              <p className="rpt-note">{r.mapFailed}</p>
            ) : (
              <figure className="rpt-map">
                <div className="rpt-map-img">
                  <img src={shot.url} alt={name} />
                  <div className="rpt-scale">
                    <i style={{ width: `${shot.scalePct}%` }} />
                    <span>{fill(r.scale, { n: shot.scaleMi })}</span>
                  </div>
                  <span className="rpt-north">↑ {r.north}</span>
                </div>
                <ul className="rpt-legend">
                  {parts ? (
                    <li>
                      <i className="sw" style={{ background: FIELD_COLOR }} />
                      {c.legendCompliant}
                    </li>
                  ) : null}
                  <li>
                    <i className="dot" style={{ background: NC_MARK }} />
                    {c.legendNc}
                  </li>
                  <li>
                    <i className="dot" style={{ background: PLANT_COLOR }} />
                    {c.legendPlant}
                  </li>
                  <li>
                    <i className="dot ring" />
                    {c.legendAdm}
                  </li>
                  <li>
                    <i className="dot" style={{ background: TP_COLOR }} />
                    {c.legendTp}
                  </li>
                  <li>
                    <i className="dash" />
                    {r.legendCatchment}
                  </li>
                  <li>
                    <i className="dash faint" />
                    {r.legendOtherCatchment}
                  </li>
                </ul>
                <figcaption>
                  {fill(parts ? r.mapCaption : r.mapCaptionNoFields, { scope: name })}{" "}
                  {basemap === "esri" ? "Imagery © Esri, Maxar, Earthstar Geographics." : "© OpenStreetMap contributors."}
                </figcaption>
              </figure>
            )}
          </Section>
        ) : null}

        {/* ----------------------------------------------- facilities */}
        {sections.facilities && facNcRows.length > 1 ? (
          <Section n={num()} title={r.s3}>
            <div className="rpt-chart">
              <h3>{r.chFacNc}</h3>
              <HBars color={NC_COLOR} rows={facNcRows} room={17} />
              <p className="rpt-note">
                {fill(r.chFacNcNote, { n: FAC_CHART_MAX })} {appendixA ? fill(r.seeAppendix, { x: "A" }) : ""}
              </p>
            </div>
          </Section>
        ) : null}

        {/* ------------------------------------------------------- nc */}
        {sections.nc ? (
          <Section n={num()} title={r.s4}>
            {!nf && !(scope === "all" && data.nonCompliantAll.fields) ? (
              <p className="rpt-note">{r.ncNone}</p>
            ) : (
              <>
                <p className="rpt-note">
                  {r.ncSummaryNote}
                  {scope === "all" ? ` ${fill(r.sumOutside, { all: countF(data.nonCompliantAll.fields), out: countF(outside) })}` : ""}
                </p>
                <div className="rpt-grid2">
                  <div className="rpt-chart">
                    <h3>{c.ncByState}</h3>
                    <HBars color={NC_COLOR} rows={ncStateRows} room={4} />
                  </div>
                  <div>
                    <div className="rpt-chart">
                      <h3>{c.ncUseTitle}</h3>
                      <ShareBar
                        fmt={pctF}
                        parts={[
                          { key: "crop", label: c.ncUseCrop, color: "#2a78d6" },
                          { key: "pasture", label: c.ncUsePasture, color: "#1baf7a" },
                          { key: "nonag", label: c.ncUseNonAg, color: "#eb6834" },
                          { key: "unknown", label: c.unknown, color: UNKNOWN_COLOR },
                        ].map((x) => ({ ...x, value: ncStats.byUse?.[x.key] ?? 0, text: fill(r.fieldsN, { n: countF(ncStats.byUse?.[x.key] ?? 0) }) }))}
                      />
                    </div>
                    <div className="rpt-chart">
                      <h3>{c.ncBefore}</h3>
                      <ShareBar
                        fmt={pctF}
                        parts={[
                          { key: "treed", label: c.ncBeforeTreed, color: "#008300" },
                          { key: "natural", label: c.ncBeforeNatural, color: "#eda100" },
                          { key: "crop", label: c.ncBeforeCrop, color: "#2a78d6" },
                          { key: "unknown", label: c.unknown, color: UNKNOWN_COLOR },
                        ].map((x) => ({ ...x, value: ncStats.byBefore?.[x.key] ?? 0, text: fill(r.fieldsN, { n: countF(ncStats.byBefore?.[x.key] ?? 0) }) }))}
                      />
                    </div>
                  </div>
                </div>
                {ncStats.byYear.length ? (
                  <div className="rpt-chart">
                    <h3>{c.ncByYear}</h3>
                    <Columns
                      color={NC_COLOR}
                      height={110}
                      rows={ncStats.byYear.map((y) => ({ key: String(y.year), label: String(y.year), value: y.fields, text: countF(y.fields) }))}
                    />
                    <p className="rpt-note">
                      {c.ncByYearNote} {appendixC ? fill(r.seeAppendix, { x: "C" }) : ""}
                    </p>
                  </div>
                ) : null}

              </>
            )}
          </Section>
        ) : null}

        {/* ---------------------------------------------------- crops */}
        {sections.crops ? (
          <Section n={num()} title={r.s5}>
            {!k ? (
              <p className="rpt-note">{r.cropsCombo}</p>
            ) : (
              <>
                <div className="rpt-chart">
                  <h3>{c.cropTitle}</h3>
                  <StackColumns
                    fmt={(p) => `${Math.round(p)}%`}
                    series={SOY_GROUPS.map((g) => ({ key: g, label: sc.groups[g], color: CROP_COLORS[g] }))}
                    cols={k.compliant.cropHistoryHa.map((row) => ({
                      key: String(row.year),
                      label: String(row.year),
                      parts: Object.fromEntries(SOY_GROUPS.map((g) => [g, Number(row[g] ?? 0)])),
                    }))}
                  />
                  <p className="rpt-note">
                    {c.cropNote} {appendixB ? fill(r.seeAppendix, { x: "B" }) : ""}
                  </p>
                </div>
                <div className="rpt-chart">
                  <h3>{c.yearsTitle}</h3>
                  <Columns
                    color={CROP_COLORS.soy}
                    height={120}
                    rows={k.compliant.soyYears.map((d) => ({
                      key: String(d.years),
                      label: fill(c.yearsN, { n: d.years }),
                      value: d.fields,
                      text: countF(d.fields),
                      sub: pctF(pct(d.fields, k.compliant.fields)),
                    }))}
                  />
                  <p className="rpt-note">
                    {c.yearsNote} {r.chSeasonsNote}
                  </p>
                </div>
                <div className="rpt-stack2">
                  <div className="rpt-chart">
                    <h3>{c.countiesTitle}</h3>
                    <HBars room={14}
                      color={CROP_COLORS.soy}
                      rows={k.compliant.topCounties.map((x) => ({
                        key: `${x.county}-${x.state}`,
                        label: `${x.county}, ${x.state}`,
                        value: x.acres,
                        text: acF(x.acres),
                        sub: fill(r.fieldsN, { n: countF(x.fields) }),
                      }))}
                    />
                    <p className="rpt-note">{r.chCountiesNote}</p>
                  </div>
                  <div className="rpt-chart">
                    <h3>{r.statesTitle}</h3>
                    <HBars room={13}
                      color={CROP_COLORS.soy}
                      max={100}
                      rows={stateRows}
                    />
                    <p className="rpt-note">{r.chStatesNote}</p>
                  </div>
                </div>
              </>
            )}
          </Section>
        ) : null}

        {/* ------------------------------------------------ transport */}
        {sections.transport ? (
          <Section n={num()} title={r.s6}>
            {!k ? (
              <p className="rpt-note">{r.trCombo}</p>
            ) : k.compliant.coverageAcres <= 0 ? (
              <p className="rpt-note">{r.trNone}</p>
            ) : (
              <>
                <p className="rpt-prose-p">
                  {fill(r.trLead, { base: acF(k.compliant.coverageAcres), p: pctF(pct(k.compliant.coverageAcres, k.compliant.acres)) })}
                </p>
                <div className="rpt-chart">
                  <GroupedColumns
                    series={[
                      { key: "rail", label: r.trRail, color: NET_COLORS.rail },
                      { key: "river", label: r.trRiver, color: NET_COLORS.river },
                      { key: "either", label: r.trEither, color: NET_COLORS.either },
                    ]}
                    groups={data.bandsMi.map((b) => {
                      const x = k.compliant.corridor[String(b)];
                      const base = k.compliant.coverageAcres;
                      const v = (a: number) => ({ value: pct(a, base), text: pctF(pct(a, base)) });
                      return { key: String(b), label: `≤ ${b} mi`, values: { rail: v(x?.rail ?? 0), river: v(x?.river ?? 0), either: v(x?.either ?? 0) } };
                    })}
                  />
                  <p className="rpt-note">{r.chTransportNote}</p>
                </div>
                {facilityName && facilityDist ? (
                  <p className="rpt-prose-p">{fill(r.trFacility, { name: facilityName, rail: miF(facilityDist.railMi), river: miF(facilityDist.riverMi) })}</p>
                ) : null}
                <p className="rpt-note">{fill(c.method1, { x: formatCount(data.network.railKm.X ?? 0, lang) })}</p>
                <p className="rpt-note">{fill(c.method2, { km2: formatCount(data.network.riverSystemKm2, lang), n: data.network.riverSystems ?? 1 })}</p>
              </>
            )}
          </Section>
        ) : null}

        {/* --------------------------------------------------- method */}
        {sections.method ? (
          <Section n={num()} title={r.s7}>
            <h3>{r.methodSources}</h3>
            <ul className="rpt-list">
              <li>{c.docsSource1}</li>
              <li>{c.docsSource2}</li>
              <li>{c.docsSource3}</li>
            </ul>
            <h3>{r.methodDefs}</h3>
            <ul className="rpt-list">
              <li>{c.docsDef1}</li>
              <li>{c.docsDef2}</li>
              <li>{c.docsDef3}</li>
              <li>{r.ncSummaryNote}</li>
            </ul>
            <h3>{r.methodUnits}</h3>
            <p className="rpt-prose-p">{r.methodUnitsBody}</p>
            <p className="rpt-note">{fill(r.methodGenerated, { date })}</p>
          </Section>
        ) : null}
        {/* -------------------------------------------------- appendix */}
        {appendixA || appendixB || appendixC ? (
          <section className="rpt-section rpt-appendix">
            <h2>{r.sApp}</h2>
            {appendixA ? (
              <div className="rpt-app-block">
                <h3>A. {r.appA}</h3>
                <p className="rpt-note">{r.facNote}</p>
                <table className="rpt-table rpt-fac">
              <thead>
                <tr>
                  <th>{r.colFacility}</th>
                  <th>{r.colType}</th>
                  <th>{r.colRadius}</th>
                  <th className="num">{r.colCf}</th>
                  <th className="num">{r.colCa}</th>
                  <th className="num">{r.colNf}</th>
                  <th className="num">{r.colNa}</th>
                  <th className="num">{r.colNs}</th>
                </tr>
              </thead>
              <tbody>
                {facRows.map((x) => (
                  <tr key={x.id} className={x.total || ["all", "adm", "tp", "tpcore"].includes(x.id) ? "rpt-row-total" : ""}>
                    <td>{x.name}</td>
                    <td className="nowrap">{x.kind}</td>
                    <td className="nowrap">{x.radius}</td>
                    <td className="num">{countF(x.cf)}</td>
                    <td className="num">{formatLarge(x.ca, lang)}</td>
                    <td className={`num ${x.nf ? "nc" : ""}`}>{countF(x.nf)}</td>
                    <td className="num">{formatLarge(x.na, lang)}</td>
                    <td className="num">{pctF(pct(x.na, x.ca + x.na))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
            ) : null}
            {appendixB && k ? (
              <div className="rpt-app-block">
                <h3>B. {r.chCropTable}</h3>
                <SimpleTable
                    head={["", ...k.compliant.cropHistoryHa.map((row) => String(row.year))]}
                    num={k.compliant.cropHistoryHa.map((_, i) => i + 1)}
                    rows={SOY_GROUPS.map((g) => [
                      sc.groups[g],
                      ...k.compliant.cropHistoryHa.map((row) => {
                        const total = SOY_GROUPS.reduce((a, x) => a + Number(row[x] ?? 0), 0);
                        return pctF(pct(Number(row[g] ?? 0), total));
                      }),
                    ])}
                  />
              </div>
            ) : null}
            {appendixC ? (
              <div className="rpt-app-block">
                <h3>C. {r.secNcList}</h3>
                <p className="rpt-note">
                      {fill(r.ncListNote, { n: countF(ncList.length) })}
                      {ncList.length > NC_LIST_MAX ? ` ${fill(r.ncListMore, { n: countF(NC_LIST_MAX), total: countF(ncList.length) })}` : ""}
                    </p>
                <SimpleTable
                      head={[r.colId, r.colPlace, r.colAcres, r.colUse, r.colCrop25, r.colSeasons, r.colFirst, r.colRail, r.colRiver]}
                      num={[2, 5, 6, 7, 8]}
                      rows={ncList.slice(0, NC_LIST_MAX).map((p) => [
                        String(p.id ?? ""),
                        [p.n, p.s].filter(Boolean).join(", ") || "—",
                        Number(p.a ?? 0).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }),
                        useLabel(p.u),
                        p.c25 ? String(p.c25) : "—",
                        p.sy == null ? "—" : fill(c.yearsN, { n: Number(p.sy) }),
                        p.y == null ? "—" : String(p.y),
                        p.r == null ? "—" : Number(p.r).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }),
                        p.v == null ? "—" : Number(p.v).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }),
                      ])}
                    />
              </div>
            ) : null}
          </section>
        ) : null}
      </article>
    </div>
  );

  return createPortal(report, document.body);
}
