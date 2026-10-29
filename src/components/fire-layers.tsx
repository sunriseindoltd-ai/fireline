import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { fill } from "@/lib/format";
import { PHONE_MQ, type Case } from "@/lib/fire-ui";

/**
 * Context layers on the overview map, drawn under the incidents:
 *  - Earthline plot coverage (0.02° cells with plot counts) — "all plantations in the supply chain";
 *  - RSPO member concessions (GeoRSPO, Grower + Scheme), click = who it is + FireLine hotspots inside;
 *  - KLHK burned areas 2026 to date;
 *  - province outlines (FireLine Indonesia);
 *  - roads and rivers: Esri reference overlays (raster tiles, drawn straight from Esri, nothing stored here);
 *  - palm oil mills of the Universal Mill List (Rainforest Alliance), drawn above the hotspots; click = the mill + hotspots within 20 km;
 *  plus a "zoom to" list of the provinces whose haze reaches Singapore.
 * Files come from /fire/layer?name= (scripts/prepare-fire-layers.py).
 */
export type LayerKey = "plots" | "rspo" | "burned" | "prov" | "roads" | "rivers" | "mills";
type Key = LayerKey;
const FILE: Record<Key, string> = { plots: "plots-grid", rspo: "rspo", burned: "burned-2026", prov: "provinces", roads: "", rivers: "", mills: "mills-uml" };
const LAYERS: Record<Key, string[]> = {
  plots: ["ctx-plots"],
  rspo: ["ctx-rspo-fill", "ctx-rspo-line"],
  burned: ["ctx-burned", "ctx-burned-line"],
  prov: ["ctx-prov"],
  roads: ["ctx-roads"],
  rivers: ["ctx-rivers"],
  mills: ["ctx-mills", "ctx-mills-lbl"],
};
/** Mills are drawn above the hotspots: a click on a mill wins over the hotspot under it. */
export const MILL_LAYER = "ctx-mills";
export const MILL_KM = 20;
/** Raster overlays (no file of ours): Esri World Transportation and Esri Hydro Reference Overlay. */
const TILES: Partial<Record<Key, { url: string; attribution: string }>> = {
  roads: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", attribution: "Roads © Esri, HERE, Garmin, OpenStreetMap contributors" },
  rivers: { url: "https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/Esri_Hydro_Reference_Overlay/MapServer/tile/{z}/{y}/{x}", attribution: "Rivers © Esri" },
};
const STORE = "fireline.layers";
export const PROVINCES: { id: string; bbox: [number, number, number, number] }[] = [
  { id: "corridor", bbox: [98.8, -5.6, 114.3, 3.3] },
  { id: "Riau", bbox: [100.0, -1.9, 103.9, 2.9] },
  { id: "Jambi", bbox: [101.1, -2.8, 104.6, -0.7] },
  { id: "Sumatera Selatan", bbox: [102.0, -5.0, 106.2, -1.6] },
  { id: "Kep. Bangka Belitung", bbox: [105.1, -3.4, 108.4, -1.4] },
  { id: "Kalimantan Barat", bbox: [108.6, -3.2, 114.2, 2.2] },
  { id: "Kalimantan Tengah", bbox: [110.6, -3.6, 115.9, 0.9] },
  { id: "all", bbox: [95, -11, 141, 6] },
];
const SG: [number, number] = [103.82, 1.352];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(x: number, y: number, g: GeoJSON.Geometry) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
}
/** Great-circle distance in km. */
export function distKm(x1: number, y1: number, x2: number, y2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((y2 - y1) * r) / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
/** True when a click landed on a mill (so the hotspot layers below can leave it alone). */
export const onMill = (map: maplibregl.Map, pt: maplibregl.PointLike) => !!map.getLayer(MILL_LAYER) && map.queryRenderedFeatures(pt, { layers: [MILL_LAYER] }).length > 0;

export function ContextLayers({
  map,
  cases,
  blocked,
  keys = ["plots", "rspo", "burned", "roads", "rivers", "mills"],
  before: beforeId = "plots-fill",
  top = ["inc", "cl"],
  store = STORE,
  initial,
  near,
}: {
  map: maplibregl.Map;
  /** Cases for the RSPO popup's hotspot count; null = no count (FireLine Indonesia has its own map popups). */
  cases: Case[] | null;
  blocked: () => boolean;
  /** Which toggles this map offers. */
  keys?: Key[];
  /** Context layers go under this layer. */
  before?: string;
  /** Hotspot layers whose clicks win over the RSPO popup. */
  top?: string[];
  store?: string;
  /** Layers on at first visit. */
  initial?: Partial<Record<Key, boolean>>;
  /** Hotspots within `km` of a point and the period they cover (mill popup); default = the cases' points, last 28 days. */
  near?: (lon: number, lat: number, km: number) => { n: number; period: string };
}) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const [on, setOn] = useState<Record<Key, boolean>>(() => {
    const base = { plots: false, rspo: false, burned: false, prov: false, roads: false, rivers: false, mills: false, ...initial };
    try {
      return { ...base, ...JSON.parse(localStorage.getItem(store) || "{}") };
    } catch {
      return base;
    }
  });
  // Closed on phones: open, the card covers most of a small map.
  const [open, setOpen] = useState(() => typeof window === "undefined" || !window.matchMedia(PHONE_MQ).matches);
  const [busy, setBusy] = useState<Key | null>(null);
  const loaded = useRef<Record<string, boolean>>({});
  const rspoById = useRef<Map<number, GeoJSON.Feature>>(new Map());
  const casesRef = useRef(cases);
  casesRef.current = cases;
  const nearRef = useRef(near);
  nearRef.current = near;
  const popup = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(store, JSON.stringify(on));
    } catch {}
  }, [on]);

  // Singapore marker (always on): the reference point for the haze story.
  useEffect(() => {
    if (!map.getStyle() || map.getSource("sg")) return;
    map.addSource("sg", { type: "geojson", data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Singapura" }, geometry: { type: "Point", coordinates: SG } }] } });
    map.addLayer({ id: "sg-dot", type: "circle", source: "sg", paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#1d1d1f", "circle-stroke-width": 2 } });
    map.addLayer({ id: "sg-lbl", type: "symbol", source: "sg", layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"], "text-anchor": "left", "text-offset": [0.8, 0] }, paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.4 } });
  }, [map]);

  // Add / show / hide each layer on demand.
  useEffect(() => {
    if (!map.getStyle()) return;
    const before = map.getLayer(beforeId) ? beforeId : undefined;
    const ensure = async (k: Key) => {
      const src = `ctx-${k}`;
      const tiles = TILES[k];
      if (tiles && !loaded.current[k]) {
        if (!map.getSource(src)) map.addSource(src, { type: "raster", tiles: [tiles.url], tileSize: 256, maxzoom: 16, attribution: tiles.attribution });
        if (!map.getLayer(`ctx-${k}`)) map.addLayer({ id: `ctx-${k}`, type: "raster", source: src, paint: { "raster-opacity": 0.9 } }, before);
        loaded.current[k] = true;
      }
      if (!loaded.current[k]) {
        setBusy(k);
        const data = (await fetch(`/fire/layer?name=${FILE[k]}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as GeoJSON.FeatureCollection | null;
        setBusy(null);
        if (!data || !map.getStyle() || map.getSource(src)) return;
        if (k === "rspo") for (const ft of data.features) rspoById.current.set(Number(ft.id), ft);
        map.addSource(src, { type: "geojson", data, ...(k === "rspo" ? { promoteId: "fid" } : {}) });
        if (k === "plots") {
          map.addLayer(
            {
              id: "ctx-plots",
              type: "circle",
              source: src,
              // Coverage only makes sense zoomed out: it fades away by zoom 10, where the real plot polygons take over.
              // Company plots only (smallholder cells are not drawn).
              maxzoom: 10.5,
              filter: [">", ["get", "co"], 0],
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["interpolate", ["linear"], ["get", "co"], 1, 1.1, 50, 2, 400, 3], 8, ["interpolate", ["linear"], ["get", "co"], 1, 3, 400, 8], 10, 9],
                "circle-color": "#86e3a4",
                "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 0.4, 9.5, 0.2, 10.5, 0],
              },
            },
            before,
          );
        } else if (k === "rspo") {
          map.addLayer({ id: "ctx-rspo-fill", type: "fill", source: src, paint: { "fill-color": "#8fc9ff", "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.35, 0.16] } }, before);
          map.addLayer({ id: "ctx-rspo-line", type: "line", source: src, paint: { "line-color": "#bfe0ff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.4], "line-opacity": 0.9 } }, before);
          map.on("mouseenter", "ctx-rspo-fill", () => {
            if (!blocked()) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "ctx-rspo-fill", () => {
            if (!blocked()) map.getCanvas().style.cursor = "";
          });
          map.on("click", "ctx-rspo-fill", (ev) => {
            if (blocked()) return;
            // Incident dots sit on top: let them win.
            if (map.queryRenderedFeatures(ev.point, { layers: [...top, MILL_LAYER].filter((l) => map.getLayer(l)) }).length) return;
            const ft = ev.features?.[0];
            if (!ft) return;
            const p = ft.properties ?? {};
            const full = rspoById.current.get(Number(ft.id));
            let pts = 0;
            const caseIds = new Set<string>();
            if (full) for (const c of casesRef.current ?? []) for (const [x, y] of c.pts) if (inGeom(x, y, full.geometry)) { pts++; caseIds.add(c.id); }
            const rows = [
              [f.rspoSubsidiary, p.Subsidiary],
              [f.rspoUnit, p.ManageUnit],
              [f.rspoCat, p.MemberCat],
              [f.rspoProvince, p.Province],
              [f.rspoArea, p.ha != null ? `${Number(p.ha).toLocaleString(lang === "id" ? "id-ID" : "en-US")} ha` : null],
              [f.rspoMember, p.MemberYear],
            ].filter(([, v]) => v);
            const html = `<div class="fl-pop"><b>${esc(p.Parent || p.Subsidiary)}</b>${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}${casesRef.current ? `<p class="${pts ? "hot" : ""}">${pts ? fill(f.rspoCases, { n: pts, m: caseIds.size }) : f.rspoNone}</p>` : ""}<small>${f.rspoSrc}</small></div>`;
            popup.current?.remove();
            popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px", className: "fl-popup" }).setLngLat(ev.lngLat).setHTML(html).addTo(map);
          });
        } else if (k === "mills") {
          // On top of everything (no `before`): small enough not to hide the fire under it.
          map.addLayer({
            id: "ctx-mills",
            type: "circle",
            source: src,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 4, 12, 6.5],
              "circle-color": ["case", ["==", ["get", "r"], 1], "#8fc9ff", "#ffffff"],
              "circle-stroke-color": "#1d1d1f",
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 1.6],
            },
          });
          map.addLayer({
            id: "ctx-mills-lbl",
            type: "symbol",
            source: src,
            minzoom: 9.5,
            layout: { "text-field": ["get", "n"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-anchor": "left", "text-offset": [0.8, 0], "text-optional": true },
            paint: { "text-color": "#ffffff", "text-halo-color": "#1d1d1f", "text-halo-width": 1.3 },
          });
          map.on("mouseenter", "ctx-mills", () => {
            if (!blocked()) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "ctx-mills", () => {
            if (!blocked()) map.getCanvas().style.cursor = "";
          });
          map.on("click", "ctx-mills", (ev) => {
            if (blocked()) return;
            const ft = ev.features?.[0];
            if (!ft) return;
            const p = ft.properties ?? {};
            const [x, y] = (ft.geometry as GeoJSON.Point).coordinates;
            let hot: { n: number; period: string } | null = null;
            if (nearRef.current) hot = nearRef.current(x, y, MILL_KM);
            else if (casesRef.current) {
              let n = 0;
              for (const c of casesRef.current) for (const [px, py] of c.pts) if (distKm(x, y, px, py) <= MILL_KM) n++;
              hot = { n, period: f.millPeriod28 };
            }
            const loc = lang === "id" ? "id-ID" : "en-US";
            const conf = Number(p.c);
            const rspoType = String(p.rt ?? "").replace(/^RSPO Certified,?\s*/, "");
            const rows = [
              [f.millGroup, p.g],
              [f.millParent, p.pc && p.pc !== p.g ? p.pc : null],
              [f.millAlt, p.alt],
              ["RSPO", Number(p.r) === 1 ? (rspoType ? `${f.millRspoYes} · ${rspoType}` : f.millRspoYes) : f.millRspoNo],
              [f.millWhere, [p.ds, p.pv].filter(Boolean).join(", ")],
              [f.millConf, conf >= 1 && conf <= 3 ? f.millConfLabels[conf - 1] : null],
              ["UML ID", p.id],
            ].filter(([, v]) => v);
            const hotTxt = hot
              ? `<p class="${hot.n ? "hot" : ""}">${hot.n ? fill(f.millNear, { n: hot.n.toLocaleString(loc), period: hot.period }) : fill(f.millNearNone, { period: hot.period })}</p>`
              : "";
            const html = `<div class="fl-pop"><b>${esc(p.n)}</b>${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}${hotTxt}<small>${f.millSrc}</small></div>`;
            popup.current?.remove();
            popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px", className: "fl-popup" }).setLngLat(ev.lngLat).setHTML(html).addTo(map);
          });
        } else if (k === "prov") {
          map.addLayer({ id: "ctx-prov", type: "line", source: src, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 9, 1.6], "line-opacity": 0.55, "line-dasharray": [3, 2] } }, before);
        } else {
          map.addLayer({ id: "ctx-burned", type: "fill", source: src, paint: { "fill-color": "#ff7a1a", "fill-opacity": 0.45 } }, before);
          map.addLayer({ id: "ctx-burned-line", type: "line", source: src, minzoom: 9, paint: { "line-color": "#ffb13b", "line-width": 1 } }, before);
        }
        loaded.current[k] = true;
      }
      showHide();
    };
    const showHide = () => {
      for (const key of Object.keys(LAYERS) as Key[]) for (const id of LAYERS[key]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on[key] && keys.includes(key) ? "visible" : "none");
    };
    for (const k of keys) if (on[k]) void ensure(k);
    showHide();
    if (!on.rspo && !on.mills) popup.current?.remove();
  }, [map, on, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = (id: string) => {
    const p = PROVINCES.find((x) => x.id === id);
    if (!p) return;
    map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 40, duration: 900 });
  };
  const label = (id: string) => (id === "corridor" ? f.lyCorridor : id === "all" ? f.lyIndonesia : id);

  return (
    <div className={`fl-layers map-card ${open ? "" : "closed"}`}>
      <button type="button" className="fl-img-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <b>{f.layersTitle}</b>
        <span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {open ? (
        <>
          {(
            [
              ["plots", f.lyPlots, "#86e3a4"],
              ["rspo", f.lyRspo, "#8fc9ff"],
              ["burned", f.lyBurned, "#ff7a1a"],
              ["prov", f.lyProv, "#ffffff"],
              ["roads", f.lyRoads, "#f2c14e"],
              ["rivers", f.lyRivers, "#4fa3e0"],
              ["mills", f.lyMills, "#ffffff"],
            ] as [Key, string, string][]
          )
            .filter(([k]) => keys.includes(k))
            .map(([k, text, c]) => (
            <label key={k} className="fl-check">
              <input type="checkbox" checked={on[k]} onChange={(e) => setOn((s) => ({ ...s, [k]: e.target.checked }))} />
              <i className="fl-sw" style={{ background: c }} aria-hidden="true" />
              {text}
              {busy === k ? <span className="muted"> …</span> : null}
            </label>
          ))}
          {keys.includes("mills") && on.mills ? (
            <p className="fl-mill-key">
              <span>
                <i style={{ background: "#8fc9ff" }} aria-hidden="true" />
                {f.millRspoYes}
              </span>
              <span>
                <i style={{ background: "#ffffff" }} aria-hidden="true" />
                {f.millRspoNo}
              </span>
            </p>
          ) : null}
          <label className="fl-zoom">
            <span>{f.lyZoom}</span>
            <select className="fl-select" defaultValue="" onChange={(e) => e.target.value && zoomTo(e.target.value)} aria-label={f.lyZoom}>
              <option value="">—</option>
              {PROVINCES.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.id)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}
