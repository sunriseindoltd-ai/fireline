import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { KpiTile } from "@/components/kpi-tile";
import { BufferSeg, SoyRelated, scopeSummary } from "@/components/soy-side";
import {
  SoySupplyMap,
  bboxOf,
  type MapTheme,
  type MapFocus,
  type ScopeFields,
  type SoyFeature,
  type SupplyColorBy,
} from "@/components/soy-supply-map";
import type { OtherPlant, SoyArea } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
import { usePersistentState } from "@/lib/use-persistent";
import { fill, formatAcres, formatCount, formatHa } from "@/lib/format";
import { SOY_GROUP_COLORS, soyGroupOf } from "@/lib/soy-copy";
import { formatSharePct, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import {
  AC_TO_HA,
  FLAG,
  comboMembers,
  comboTotals,
  isCombo,
  levelOf,
  pct,
  plantOfScope,
  plantUnit,
  radiusLabel,
  unitName,
  type Band,
  type Basis,
  type Catchment,
  type PlantBuffer,
  type SupplyData, countyOf, stateName, areaStats, type SoyAreas, type SoyAreaStats
} from "@/lib/soy-supply";

import { csv, downloadBlob, downloadFieldsCsv, downloadFieldsGeo } from "@/lib/soy-downloads";

type StatusFilter = "all" | "ok" | "in" | "out" | "nc";
/** fields/places/<ST>/<county>.geojson, named like scripts/prepare-soy-place-fields.py. */
const placeSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
const PAGE = 100;

export type CatchmentInfo = {
  id: string;
  level: 1 | 2 | 3;
  parent: string | null;
  kind: "plant" | "group" | "direct" | "adm" | "tp" | "combo";
  name: string;
  sub: string;
  k: Catchment | undefined;
};

/** The supply chain as a tree — the whole chain, three supplier types, their catchments. */
export function catchmentInfos(data: SupplyData, catchments: Map<string, Catchment>, c: SoySupplyCopy): CatchmentInfo[] {
  const sites = data.admElevators.filter((x) => x.radiusM);
  const out: CatchmentInfo[] = [
    { id: "all", level: 1, parent: null, kind: "plant", name: c.scopeAll, sub: fill(c.chainSub, { p: data.plants.length, a: sites.length, t: data.thirdParty.length }), k: catchments.get("all") },
    { id: "direct", level: 2, parent: "all", kind: "group", name: c.scopeDirect, sub: fill(c.groupDirectSub, { n: data.plants.length }), k: catchments.get("direct") },
    { id: "adm", level: 2, parent: "all", kind: "group", name: c.scopeAdm, sub: fill(c.groupAdmSub, { n: sites.length }), k: catchments.get("adm") },
    { id: "tp", level: 2, parent: "all", kind: "group", name: c.scopeTp, sub: fill(c.groupTpSub, { n: data.thirdParty.length }), k: catchments.get("tp") },
  ];
  // The 40–80 NM rings are only building blocks of 0–80 NM; not offered on their own.
  for (const p of data.plants)
    for (const id of [`${p.key}80`, `${p.key}40`])
      out.push({ id, level: 3, parent: "direct", kind: "direct", name: unitName(id, data, c) ?? id, sub: [p.name, p.state].filter(Boolean).join(" · "), k: catchments.get(id) });
  for (const e of sites)
    out.push({ id: e.id, level: 3, parent: "adm", kind: "adm", name: e.name, sub: [e.city, e.state].filter(Boolean).join(", "), k: catchments.get(e.id) });
  for (const e of data.thirdParty)
    out.push({ id: e.id, level: 3, parent: "tp", kind: "tp", name: e.company ?? e.id, sub: [e.county, e.state].filter(Boolean).join(", "), k: catchments.get(e.id) });
  return out;
}

/** A union of catchments (from the Summary statistics) as a side-panel node. */
function comboInfo(scope: string, data: SupplyData, c: SoySupplyCopy): CatchmentInfo {
  const mem = comboMembers(scope);
  const sites = data.admElevators.filter((e) => e.radiusM);
  const picked = sites.filter((e) => mem.includes(e.id));
  const parts: string[] = [];
  for (const id of mem) {
    const n = unitName(id, data, c);
    if (n) parts.push(n);
  }
  if (picked.length === sites.length) parts.push(fill(c.comboAdm, { n: sites.length }));
  else if (picked.length > 3) parts.push(fill(c.comboAdmN, { n: picked.length }));
  else parts.push(...picked.map((e) => e.name));
  // Third parties combine with any plant too (one by one, or all of them).
  const tps = data.thirdParty.filter((e) => mem.includes(e.id));
  if (mem.includes("tp")) parts.push(fill(c.comboTp, { n: data.thirdParty.length }));
  else if (tps.length > 3) parts.push(fill(c.comboTpN, { n: tps.length }));
  else parts.push(...tps.map((e) => [e.company, e.state].filter(Boolean).join(", ")));
  const t = comboTotals(data, mem);
  const k = t
    ? ({ id: scope, kind: "tier", name: "", compliant: { fields: t.fields, acres: t.acres }, nonCompliant: { fields: t.ncFields, acres: t.ncAcres, changeAcres: t.defo } } as unknown as Catchment) // prettier-ignore
    : undefined;
  return { id: scope, level: 3, parent: "all", kind: "combo", name: parts.join(" + "), sub: c.comboSub, k };
}

/**
 * SoyTrace's Map & data tab, laid out like PalmTrace's: the map, a side panel
 * that lists catchments and, once one is picked, shows its figures, facts and
 * downloads; a field table in a drawer and a detail card for the field picked
 * on the map or in the table. Picking a catchment shows only its fields.
 */
export function SoyMapView({
  data,
  cdlNames,
  catchments,
  c,
  lang,
  scope,
  setScope,
  canDownload,
  showOwners = true,
  mode = "supply",
  otherPlants = [],
  buffer = "80",
  setBuffer = () => {},
  ncReview = false,
  setNcReview = () => {},
  sel,
  setSel,
  areas = null,
  area: areaProp,
  setArea: setAreaProp,
  findField = null,
  onOverview,
  nav,
  onOpenPlace,
}: {
  data: SupplyData;
  cdlNames: Record<string, string>;
  catchments: Map<string, Catchment>;
  c: SoySupplyCopy;
  lang: Lang;
  scope: string;
  setScope: (id: string) => void;
  canDownload: boolean;
  /** Owner name and address of non-compliant fields (off in presentation mode). */
  showOwners?: boolean;
  /** "corridor": the Rail & river tab — fields shaded by distance to rail / the river system. */
  mode?: "supply" | "corridor";
  /** The client's other crushing plants, shown as points until their catchments arrive. */
  otherPlants?: OtherPlant[];
  /** Crushing plants are listed once each, at this buffer (0–40 / 0–80 NM). */
  buffer?: PlantBuffer;
  setBuffer?: (b: PlantBuffer) => void;
  /** Only ADM-listed fields already cropland in 2018–2020 ("to review"). */
  ncReview?: boolean;
  setNcReview?: (on: boolean) => void;
  /** The Summary's selection (ticked catchments), so a combination can be built on the map too. */
  sel?: string[];
  setSel?: (ids: string[]) => void;
  /** The supply chain per state / county (areas.json), for the whole-chain area filter. */
  areas?: SoyAreas | null;
  /** The area filter, shared with the Summary (state / county). */
  area?: SoyArea;
  setArea?: (a: SoyArea) => void;
  /** A field to open on arrival (Non-compliant page, facility page): picked and flown to once it is loaded. */
  findField?: { id: string; nonce: number } | null;
  /** The way back to the Overview, as one plain button at the top of the panel (user, 10 Oct 2026). */
  onOverview?: () => void;
  nav?: { backOverview: string };
  /** Places layer: a county / subdivision clicked on the map opens in the Places tab. */
  onOpenPlace?: (p: { s: string; n?: string; sub?: string }) => void;
}) {
  // The map mode (Compliance / Logistics / Land cover / Context): Logistics is the old Rail & river view.
  const [themeStored, setTheme] = usePersistentState<string>("soytrace.mapTheme", mode === "corridor" ? "log" : "comp");
  const theme: MapTheme = (["comp", "log", "land", "ctx"] as string[]).includes(themeStored) ? (themeStored as MapTheme) : "comp";
  const corridor = theme === "log";
  const [band, setBand] = useState<Band>(10);
  const [basis, setBasis] = useState<Basis>("either");
  const [colorBy, setColorBy] = useState<SupplyColorBy>("status");
  const [scopeFieldsRaw, setScopeFields] = useState<ScopeFields>({ fields: [], nc: [], complete: false, loading: false, scope: null });
  // Until the map reports on the newly chosen scope, show it as loading rather than the previous scope's fields.
  // A county of the whole chain is asked for: its fields are on their way (not "0 fields").
  // A county / township of the whole chain is asked for: every field of the county is on its way (not "0 fields").
  const countyWanted = levelOf(scope) === 1 && !!areaProp?.s && !!areaProp?.n;
  const scopeFields = useMemo<ScopeFields>(
    () =>
      scopeFieldsRaw.scope === scope && !(countyWanted && !scopeFieldsRaw.complete && !scopeFieldsRaw.failed && scopeFieldsRaw.fields.length === 0)
        ? scopeFieldsRaw
        : { fields: [], nc: [], complete: false, loading: levelOf(scope) === 3 || countyWanted, scope },
    [scopeFieldsRaw, scope, countyWanted],
  );
  const [drawer, setDrawer] = useState(false);
  const [picked, setPicked] = useState<SoyFeature | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapOnly, setMapOnly] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tableQuery, setTableQuery] = useState("");
  const [page, setPage] = useState(0);
  const [findText, setFindText] = useState("");
  const [findMiss, setFindMiss] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  // State / county filter on the selection (user feedback, 8 Oct 2026); cleared when the selection changes.
  const [areaLocal, setAreaLocal] = useState<SoyArea>({});
  const area = areaProp ?? areaLocal;
  const setArea = setAreaProp ?? setAreaLocal;
  const [areaFor, setAreaFor] = useState(scope);
  if (areaFor !== scope) {
    setAreaFor(scope);
    if (area.s) setArea({});
  }
  // Whole supply chain + one county: that county's own field file.
  const countyFile = levelOf(scope) === 1 && area.s && area.n ? (areaStats(areas, area.s, area.n) as { file?: string | null } | null)?.file ?? null : null;
  // Every 2025 field of the county (in and outside catchments), for a county or township of the whole chain.
  const placeFile = levelOf(scope) === 1 && area.s && area.n ? `${area.s}/${placeSlug(area.n)}` : null;
  const areaName = area.s ? [area.sub ?? null, area.n ? countyOf(area.n, area.s) : null, stateName(area.s)].filter(Boolean).join(", ") : "";
  const sidePlants = useMemo(() => data.plants.map((p) => ({ id: p.id, name: p.city ?? p.name, hasData: true })), [data]);
  const nonce = useRef(0);
  const infos = useMemo(() => catchmentInfos(data, catchments, c), [data, catchments, c]);
  const countF = (n: number) => formatCount(n, lang);
  // Areas in acres (the client's unit); hectares only as a second figure on a field.
  const haF = (acres: number) => formatAcres(acres, lang);
  const miF = (n: unknown) =>
    n == null || n === "" ? "—" : fill(c.milesShort, { n: Number(n).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) });

  function pick(f: SoyFeature | null, fly = false) {
    setPicked(f);
    if (f && fly) {
      const b = f.geometry.type === "Point" ? null : bboxOf(f.geometry);
      nonce.current++;
      setFocus(
        b
          ? { bbox: b, nonce: nonce.current }
          : { center: f.geometry.coordinates as [number, number], zoom: 14, nonce: nonce.current },
      );
    }
  }
  // Whole supply chain + a state or a county: fit the map to it (a county to its own outline, not just its fields).
  const fitArea = levelOf(scope) === 1 && area.s ? (areaStats(areas, area.s, area.n) as (SoyAreaStats & { cbox?: [number, number, number, number] }) | null) : null;
  const stateFit = fitArea ? (area.bbox ?? fitArea.cbox ?? fitArea.bbox) : null;
  const fitKey = stateFit ? stateFit.join(",") : "";
  const [fitDone, setFitDone] = useState("");
  // The field another page asked for: looked up among the loaded fields until found (non-compliant
  // fields arrive first, a catchment's compliant fields a few seconds later).
  const foundFor = useRef(0);
  useEffect(() => {
    if (!findField || foundFor.current === findField.nonce) return;
    const all = [...scopeFields.nc, ...scopeFields.fields];
    const f = all.find((x) => String(x.properties.id) === findField.id);
    if (!f) return;
    foundFor.current = findField.nonce;
    pick(f, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findField, scopeFields]);
  if (stateFit && fitKey !== fitDone) {
    setFitDone(fitKey);
    nonce.current++;
    setFocus({ bbox: [[stateFit[0], stateFit[1]], [stateFit[2], stateFit[3]]], nonce: nonce.current });
  }
  function choose(id: string) {
    setScope(id);
    setPicked(null);
    setPage(0);
  }

  // ------------------------------------------------------------ table rows
  const rows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    const out: { f: SoyFeature; nc: boolean }[] = [];
    if (status === "all" || status === "nc") for (const f of scopeFields.nc) out.push({ f, nc: true });
    if (status !== "nc")
      for (const f of scopeFields.fields) {
        const inCatch = !!String(f.properties.k ?? "");
        if ((status === "in" && !inCatch) || (status === "out" && inCatch)) continue;
        out.push({ f, nc: false });
      }
    const hit = (r: { f: SoyFeature }) =>
      !q || String(r.f.properties.id).toLowerCase().includes(q) || String(r.f.properties.n ?? "").toLowerCase().includes(q);
    return out.filter(hit).sort((a, b) => Number(b.nc) - Number(a.nc) || Number(b.f.properties.a) - Number(a.f.properties.a));
  }, [scopeFields, status, tableQuery]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageNow = Math.min(page, pages - 1);

  // ------------------------------------------------------------- find box
  function find(e: FormEvent) {
    e.preventDefault();
    const q = findText.trim();
    const m = q.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      // lat, lon (US: lat 25–50, lon negative); accept lon, lat too.
      const [lat, lon] = Math.abs(a) <= 90 && b < 0 ? [a, b] : [b, a];
      nonce.current++;
      setFocus({ center: [lon, lat], zoom: 14, nonce: nonce.current });
      setFindMiss(false);
      return;
    }
    const all = [...scopeFields.nc, ...scopeFields.fields];
    const f = all.find((x) => String(x.properties.id) === q) ?? all.find((x) => String(x.properties.id).includes(q));
    setFindMiss(!f);
    if (f) pick(f, true);
  }

  // ------------------------------------------------------------ downloads
  const scopeName = [infos.find((x) => x.id === scope)?.name ?? c.scopeAll, areaName].filter(Boolean).join(" · ");
  const slug = [scope || "all", area.s, area.n].filter(Boolean).join("-").replace(/[^\w-]+/g, "-");
  // Fields of the current selection (one catchment or a combination): compliant, non-compliant or both,
  // as CSV or GeoJSON (user, 8 Oct 2026); the columns are in lib/soy-downloads.ts.
  const [dlSet, setDlSet] = useState<"both" | "ok" | "nc">("both");
  // Compliant fields are loaded once one catchment or a combination is picked.
  const okReady = scopeFields.complete;
  const set = okReady ? dlSet : "nc";
  const dlRows = [
    ...(set !== "ok" ? scopeFields.nc.map((f) => ({ f, nc: true })) : []),
    ...(set !== "nc" ? scopeFields.fields.map((f) => ({ f, nc: false })) : []),
  ];
  const dlName = (ext: string) => `soytrace-${slug}-${set === "ok" ? "compliant" : set === "nc" ? "noncompliant" : "fields"}.${ext}`;
  const downloadCsv = () => downloadFieldsCsv(dlRows, dlName("csv"));
  const downloadGeo = () => downloadFieldsGeo(dlRows, dlName("geojson"));
  function downloadSummary() {
    downloadBlob(
      "soytrace-catchments.csv",
      csv([
        ["catchment_id", "kind", "name", "place", "compliant_fields", "compliant_acres", "noncompliant_fields", "noncompliant_acres", "noncompliant_share_pct"],
        ...infos.map((x) => [
          x.id,
          x.kind,
          x.name,
          x.sub,
          x.k?.compliant.fields,
          x.k?.compliant.acres,
          x.k?.nonCompliant.fields,
          x.k?.nonCompliant.acres,
          x.k ? pct(x.k.nonCompliant.acres, x.k.compliant.acres + x.k.nonCompliant.acres).toFixed(2) : null,
        ]),
      ]),
      "text/csv",
    );
  }

  // ------------------------------------------------------------ side panel
  const level = levelOf(scope);
  const node = (isCombo(scope) ? comboInfo(scope, data, c) : null) ?? infos.find((x) => x.id === scope) ?? infos[0]!;
  const parent = node.parent ? infos.find((x) => x.id === node.parent) : null;
  // The levels above this one, top first (supply chain › supplier type › …).
  const trail: CatchmentInfo[] = [];
  for (let up = parent; up; up = up.parent ? infos.find((x) => x.id === up!.parent) : undefined) trail.unshift(up);
  // The search box belongs to the long lists (elevators, third parties).
  const q = node.id === "tp" || node.id === "adm" ? listQuery.trim().toLowerCase() : "";
  const children =
    level === 3
      ? []
      : infos.filter(
          (x) =>
            x.parent === node.id &&
            // One row per crushing plant, at the chosen buffer.
            (x.kind !== "direct" || plantUnit(x.id)?.ring === buffer) &&
            (!q || `${x.name} ${x.sub}`.toLowerCase().includes(q)),
        );
  const nodePlant = node.kind === "direct" ? plantOfScope(node.id, data) : undefined;
  // With an area chosen the figures come from the loaded fields of that area (each counted once).
  const wholeArea = levelOf(scope) === 1 && area.s ? areaStats(areas, area.s, area.n) : null;
  const k: Catchment | undefined = wholeArea
    ? ({
        ...node.k!,
        compliant: { ...node.k!.compliant, fields: wholeArea.f, acres: wholeArea.a },
        nonCompliant: { ...node.k!.nonCompliant, fields: wholeArea.nf, acres: wholeArea.na },
      } as Catchment)
    : area.s && scopeFields.complete
      ? ({
          ...node.k!,
          compliant: { ...node.k!.compliant, fields: scopeFields.fields.length, acres: scopeFields.fields.reduce((a, f) => a + (Number(f.properties.a) || 0), 0) },
          nonCompliant: { ...node.k!.nonCompliant, fields: scopeFields.nc.length, acres: scopeFields.nc.reduce((a, f) => a + (Number(f.properties.a) || 0), 0) },
        } as Catchment)
      : node.k;
  // Area choices: the loaded selection's own fields, or every county of the whole chain (areas.json).
  const areaOpts: Record<string, Record<string, number>> | null =
    level === 3
      ? (scopeFields.areas ?? null)
      : level === 1 && areas
        ? Object.fromEntries(areas.states.map((st) => [st.s, Object.fromEntries(st.counties.map((co) => [co.n, co.f + co.nf]))]))
        : null;
  // A state of the whole chain: fit the map to it (its fields are too many to draw; a county's are drawn).
  const fieldsMode = level === 3 || !!countyFile || !!placeFile;
  const facts: [string, string][] = [];
  {
    const adm = data.admElevators.find((e) => e.id === node.id);
    const tp = data.thirdParty.find((e) => e.id === node.id);
    const plant = node.kind === "direct" ? plantOfScope(node.id, data) : undefined;
    const at = plant ?? adm ?? tp;
    if (at) {
      facts.push([c.location, plant ? [plant.city, plant.state].filter(Boolean).join(", ") : node.sub]);
      facts.push([c.coordinates, `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`]);
    }
    if (plant) {
      const ring = plantUnit(node.id)!.ring;
      const r = ring === "40" ? plant.rings[0]! : plant.rings[1]!;
      facts.push([c.radius, ring === "80r" ? `${radiusLabel(plant.rings[0]!.radiusM, lang)} – ${radiusLabel(r.radiusM, lang)}` : radiusLabel(r.radiusM, lang)]);
      if (plant.address) facts.push([c.address, plant.address]);
    }
    if (adm?.radiusM) facts.push([c.radius, radiusLabel(adm.radiusM, lang)]);
    if (tp) facts.push([c.radius, radiusLabel(tp.radiusM, lang)]);
    if (at) facts.push([c.toRail, miF(at.railMi)], [c.toRiver, miF(at.riverMi)]);
    if (adm?.river) facts.push([c.river, adm.river]);
    if (adm?.type) facts.push([c.facilityType, adm.type]);
    if (adm?.address) facts.push([c.address, adm.address]);
    if (tp?.company) facts.push([c.company, tp.company]);
    if (tp?.tract) facts.push(["ID", tp.tract]);
  }
  const total = (k?.compliant.fields ?? 0) + (k?.nonCompliant.fields ?? 0);
  const kindLabel = (x: CatchmentInfo) =>
    x.kind === "combo" ? c.comboKind : x.kind === "plant" ? c.facChain : x.kind === "group" ? c.levelGroup : x.kind === "adm" ? c.kindAdm : x.kind === "tp" ? c.kindTp : c.kindPlant;
  const nameOf = (id: string) => infos.find((x) => x.id === id)?.name ?? id;

  // ------------------------------------------------------------ field card
  const p = picked?.properties;
  const isNc = !!p && ("ch" in p || "po" in p);
  const tiers = (kk: unknown) => {
    // Fields in a plant's 40–80 NM ring read as "<plant> 0–80 NM"; 0–40 NM fields are in both.
    const ids: string[] = [];
    for (const x of String(kk ?? "").split("|").filter(Boolean)) {
      const u = plantUnit(x);
      if (u?.ring === "80r") ids.push(`${u.key}80`);
      else if (u?.ring === "40") ids.push(x, `${u.key}80`);
      else ids.push(x);
    }
    return [...new Set(ids)].map(nameOf).join(" · ") || "—";
  };
  const acresHa = (a: unknown) =>
    a == null ? "—" : `${haF(Number(a))} · ${formatHa(Number(a) * AC_TO_HA, lang)}`;

  return (
    <div className={`mapview soy-mapview ${mapOnly ? "map-only" : ""}`}>
      <div className="mapview-map">
        <SoySupplyMap
          data={data}
          mode={corridor ? "corridor" : "supply"}
          theme={theme}
          setTheme={setTheme}
          selected={scope}
          onSelect={(id) => choose(id ?? "all")}
          colorBy={colorBy}
          basis={basis}
          band={band}
          cdlNames={cdlNames}
          catchments={catchments}
          c={c}
          lang={lang}
          onScopeFields={setScopeFields}
          area={area}
          countyFile={countyFile}
          placeFile={placeFile}
          selectedField={p ? String(p.id) : null}
          onSelectField={(f) => pick(f)}
          focus={focus}
          otherPlants={otherPlants}
          ncReview={ncReview}
          setNcReview={setNcReview}
          onOpenPlace={onOpenPlace}
          onPickArea={(a) => setArea(a)}
          toolsSlot={
            <form className="map-card soy-find" onSubmit={find}>
              <label className="sr-only" htmlFor="soy-find">
                {c.findTitle}
              </label>
              <input
                id="soy-find"
                value={findText}
                onChange={(e) => {
                  setFindText(e.target.value);
                  setFindMiss(false);
                }}
                placeholder={c.findPlaceholder}
                aria-label={c.findTitle}
              />
              <button type="submit">{c.findGo}</button>
              {findMiss ? <p className="soy-find-miss">{c.findNone}</p> : null}
            </form>
          }
          backSlot={
            parent ? (
              <button type="button" className="map-card soy-map-back" onClick={() => choose(parent.id)}>
                <span aria-hidden="true">←</span> {fill(c.backTo, { name: parent.name })}
              </button>
            ) : null
          }
        />
        <button
          type="button"
          className="map-focus-btn"
          aria-pressed={mapOnly}
          aria-label={c.layers}
          title={mapOnly ? "⤡" : "⤢"}
          onClick={() => setMapOnly((v) => !v)}
        >
          {mapOnly ? "⤡" : "⤢"}
        </button>

        {picked && p ? (
          <div className="plot-detail map-card" role="dialog" aria-label={String(p.id)}>
            <div className="plot-detail-header">
              <span className="truncate">{isNc ? (p.po ? c.popNcPoint : c.popNc) : c.popField}</span>
              <button type="button" className="plot-detail-close" aria-label={c.close} onClick={() => setPicked(null)}>
                ×
              </button>
            </div>
            <div className="plot-detail-body">
              {(
                [
                  [c.fieldId, String(p.id), "mono"],
                  [c.fieldArea, acresHa(p.a), ""],
                  ...(isNc
                    ? ([
                        [
                          c.useLabel,
                          p.u
                            ? fill(p.u === "crop" ? c.useCrop : p.u === "pasture" ? c.usePasture : c.useNonAg, { crop: p.c25 ? ` · ${String(p.c25)}` : "" })
                            : "—",
                          "",
                        ],
                      ] as const)
                    : []),
                  [c.location, [p.n, p.s].filter(Boolean).join(", ") || "—", ""],
                  ...(isNc && showOwners
                    ? ([
                        [c.owner, String(p.on ?? "—"), ""],
                        [c.ownerAddress, String(p.oa ?? "—"), ""],
                        ...(p.pv ? ([[c.prevOwner, String(p.pv), ""]] as const) : []),
                      ] as const)
                    : []),
                  [c.memberOf, tiers(p.k), ""],
                  ...(isNc
                    ? ([
                        [c.before, p.b === "treed" ? c.ncBeforeTreed : p.b === "natural" ? c.ncBeforeNatural : p.b === "crop" ? c.ncBeforeCrop : c.unknown, ""],
                        [c.firstCrop, p.y == null ? "—" : String(p.y), ""],
                        [c.crops2425, `${p.c24 ?? "—"} → ${p.c25 ?? "—"}`, ""],
                        [c.soy2026, String(p.s26 ?? "—"), ""],
                        [c.seasonsLabel, p.sy == null ? "—" : fill(c.yearsN, { n: Number(p.sy) }), ""],
                        [c.toRail, miF(p.r), ""],
                        [c.toRiver, miF(p.v), ""],
                      ] as const)
                    : ([
                        [c.seasonsLabel, fill(c.yearsN, { n: Number(p.y) }), ""],
                        [c.toRail, miF(p.r), ""],
                        [c.toRiver, miF(p.v), ""],
                      ] as const)),
                ] as (readonly [string, string, string])[]
              ).map(([label, value, cls]) => (
                <div className="plot-detail-row" key={label}>
                  <span>{label}</span>
                  <b className={cls}>{value}</b>
                </div>
              ))}
              <div className="plot-detail-row">
                <span>{c.coordinates}</span>
                <a href={`https://www.google.com/maps?q=${Number(p._y)},${Number(p._x)}`} target="_blank" rel="noopener noreferrer">
                  {Number(p._y).toFixed(5)}, {Number(p._x).toFixed(5)}
                </a>
              </div>
              {isNc && Number(p.f) & FLAG.dual ? <p className="plot-detail-note bad">{c.alsoCompliant}</p> : null}
              {p.c && !p.po ? (
                <div className="soy-deck-hist">
                  <span>{c.history}</span>
                  <ul className="soy-pop-hist">
                    {String(p.c)
                      .split(",")
                      .map((code, i) => {
                        const n = code === "" ? null : Number(code);
                        return (
                          <li key={i}>
                            <span>{2018 + i}</span>
                            <i style={{ background: SOY_GROUP_COLORS[soyGroupOf(n)] }} />
                            {n == null ? "—" : (cdlNames[String(n)] ?? `CDL ${n}`)}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {drawer ? (
          <div className="plot-drawer soy-drawer">
            <div className="drawer-head">
              <h2>
                {c.tableTitle} · {scopeName}
                <span>{fill(c.fieldsN, { n: countF(rows.length) })}</span>
              </h2>
              <button type="button" className="btn-text" onClick={() => setDrawer(false)}>
                {c.close}
              </button>
            </div>
            <div className="table-tools">
              <div className="seg" role="group" aria-label={c.colStatus}>
                {((placeFile ? ["all", "in", "out", "nc"] : ["all", "ok", "nc"]) as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={status === s ? "on" : ""}
                    aria-pressed={status === s}
                    onClick={() => {
                      setStatus(s);
                      setPage(0);
                    }}
                  >
                    {s === "all" ? c.statusAll : s === "nc" ? c.statusNc : s === "in" ? c.statusIn : s === "out" ? c.statusOut : c.statusCompliant}
                  </button>
                ))}
              </div>
              <label className="search-field">
                <input
                  type="search"
                  value={tableQuery}
                  onChange={(e) => {
                    setTableQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder={c.tableSearch}
                  aria-label={c.tableSearch}
                />
              </label>
            </div>
            <div className="table-wrap">
              {rows.length === 0 ? (
                <p className="table-empty">{scopeFields.fields.length + scopeFields.nc.length === 0 ? c.tableEmptyScope : c.tableEmpty}</p>
              ) : (
                <table className="data-table soy-field-table">
                  <thead>
                    <tr>
                      <th>{c.colStatus}</th>
                      <th>{c.colFieldId}</th>
                      <th>{c.colLocation}</th>
                      <th className="num">{c.colAreaHa}</th>
                      <th className="num">{c.colSeasons}</th>
                      <th className="num">{c.colRail}</th>
                      <th className="num">{c.colRiverDist}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(pageNow * PAGE, (pageNow + 1) * PAGE).map(({ f, nc }) => {
                      const q = f.properties;
                      return (
                        <tr
                          key={`${nc ? "n" : "c"}${String(q.id)}`}
                          className={p && String(p.id) === String(q.id) ? "on" : ""}
                          tabIndex={0}
                          onClick={() => (p && String(p.id) === String(q.id) ? setPicked(null) : pick(f, true))}
                          onKeyDown={(e) => e.key === "Enter" && (p && String(p.id) === String(q.id) ? setPicked(null) : pick(f, true))}
                        >
                          <td>
                            {nc ? (
                              <span className="soy-status nc">{c.statusNc}</span>
                            ) : placeFile && !String(q.k ?? "") ? (
                              <span className="soy-status out">{c.statusOut}</span>
                            ) : (
                              <span className="soy-status ok">{c.statusCompliant}</span>
                            )}
                          </td>
                          <td className="mono">{String(q.id)}</td>
                          <td className="truncate">{[q.n, q.s].filter(Boolean).join(", ")}</td>
                          <td className="num tabular-nums">{haF(Number(q.a))}</td>
                          <td className="num tabular-nums">{nc ? (q.sy == null ? "—" : fill(c.yearsN, { n: Number(q.sy) })) : fill(c.yearsN, { n: Number(q.y) })}</td>
                          <td className="num tabular-nums">{miF(q.r)}</td>
                          <td className="num tabular-nums">{miF(q.v)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {rows.length > 0 ? (
              <div className="table-pager">
                <span>
                  {fill(c.rowsRange, {
                    from: countF(pageNow * PAGE + 1),
                    to: countF(Math.min(rows.length, (pageNow + 1) * PAGE)),
                    total: countF(rows.length),
                  })}
                </span>
                {pages > 1 ? (
                  <div className="table-pager-nav">
                    <button type="button" disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)}>
                      ‹ {c.prev}
                    </button>
                    <span>{fill(c.pageOf, { page: pageNow + 1, total: pages })}</span>
                    <button type="button" disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)}>
                      {c.next} ›
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="side-panel" aria-label={node.name}>
        {onOverview && nav ? (
          <button type="button" className="btn-secondary block soy-back-overview" onClick={onOverview}>
            ← {nav.backOverview}
          </button>
        ) : null}
        <div className="panel-head">
          {trail.length ? (
            // Where this catchment sits: every level above is a step back.
            <nav className="soy-crumbs" aria-label={c.crumbsLabel}>
              {trail.map((t) => (
                <span key={t.id}>
                  <button type="button" onClick={() => choose(t.id)}>
                    {t.name}
                  </button>
                  <i aria-hidden="true">›</i>
                </span>
              ))}
              <b aria-current="location">{node.name}</b>
            </nav>
          ) : null}
          <div className="panel-title">
            <h2>{node.name}</h2>
            <span className={`status-pill ${level === 3 ? "ready" : "master"}`}>{kindLabel(node)}</span>
          </div>
          {level < 3 ? <p className="soy-panel-sub">{node.sub}</p> : null}
        </div>
        <div className="panel-body">
          {corridor ? <p className="panel-note soy-corr-purpose">{c.corrPurpose}</p> : null}
          {corridor ? (
            <div className="soy-corr-controls">
              <div className="seg" role="group" aria-label={c.bandLabel}>
                {data.bandsMi.map((b) => (
                  <button key={b} type="button" className={band === b ? "on" : ""} aria-pressed={band === b} onClick={() => setBand(b as Band)}>
                    {fill(c.bandLe, { n: b })}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label={c.basisLabel}>
                {(["either", "rail", "river"] as const).map((b) => (
                  <button key={b} type="button" className={basis === b ? "on" : ""} aria-pressed={basis === b} onClick={() => setBasis(b)}>
                    {b === "rail" ? c.basisRail : b === "river" ? c.basisRiver : c.basisEither}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {k && corridor && k.compliant.corridor ? (
            (() => {
              const cov = k.compliant.coverageAcres;
              const at = k.compliant.corridor[String(band)] ?? { rail: 0, river: 0, either: 0, both: 0 };
              const share = (v: number) => fill(c.ofCoverage, { p: formatSharePct(pct(v, cov), lang) });
              const outside = k.compliant.fields - k.compliant.coverageFields;
              return (
                <>
                  <div className="kpi-row compact">
                    <KpiTile tone="comply" value={haF(at[basis])} label={fill(basis === "rail" ? c.kpiNearRail : basis === "river" ? c.kpiNearRiver : c.kpiNearEither, { n: band })} sub={share(at[basis])} />
                    <KpiTile value={haF(cov)} label={c.kpiCoverage} hint={c.kpiCoverageHint} sub={fill(c.fieldsN, { n: countF(k.compliant.coverageFields) })} />
                    {basis === "either" ? (
                      <>
                        <KpiTile value={haF(at.rail)} label={fill(c.kpiNearRail, { n: band })} sub={share(at.rail)} />
                        <KpiTile value={haF(at.river)} label={fill(c.kpiNearRiver, { n: band })} sub={share(at.river)} />
                        <KpiTile value={haF(at.both)} label={fill(c.kpiNearBoth, { n: band })} sub={share(at.both)} />
                      </>
                    ) : null}
                  </div>
                  {outside > 0 ? <p className="panel-note">{fill(c.outsideCoverage, { n: countF(outside), area: haF(k.compliant.acres - cov) })}</p> : null}
                </>
              );
            })()
          ) : placeFile && scopeFields.complete ? (
            (() => {
              // The four counts of the workbook / Places tab, from the loaded fields of this county or township.
              const ac = (xs: SoyFeature[]) => xs.reduce((a, f) => a + (Number(f.properties.a) || 0), 0);
              const inF = scopeFields.fields.filter((f) => !!String(f.properties.k ?? ""));
              const outF = scopeFields.fields.filter((f) => !String(f.properties.k ?? ""));
              const ncIn = scopeFields.nc.filter((f) => !!String(f.properties.k ?? ""));
              const allAc = ac(scopeFields.fields);
              return (
                <div className="kpi-row compact soy-place-kpis">
                  <KpiTile tone="comply" value={haF(ac(inF))} label={c.kpiInCatch} sub={`${fill(c.fieldsN, { n: countF(inF.length) })} · ${formatSharePct(pct(ac(inF), allAc), lang)}`} />
                  <KpiTile value={haF(ac(outF))} label={c.kpiOutCatch} sub={`${fill(c.fieldsN, { n: countF(outF.length) })} · ${formatSharePct(pct(ac(outF), allAc), lang)}`} />
                  <KpiTile tone="danger" value={countF(ncIn.length)} label={c.kpiNcIn} sub={haF(ac(ncIn))} />
                  <KpiTile tone="danger" value={countF(scopeFields.nc.length)} label={c.kpiNcList} sub={haF(ac(scopeFields.nc))} />
                </div>
              );
            })()
          ) : k ? (
            <div className="kpi-row compact">
              <KpiTile
                value={haF(k.compliant.acres)}
                label={c.kpiArea}
                sub={`${fill(c.fieldsN, { n: countF(k.compliant.fields) })} · ${formatSharePct(pct(k.compliant.acres, k.compliant.acres + k.nonCompliant.acres), lang)}`}
              />
              <KpiTile
                tone="danger"
                value={countF(k.nonCompliant.fields)}
                label={c.kpiNcFields}
                sub={`${haF(k.nonCompliant.acres)} · ${formatSharePct(pct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres), lang)}`}
              />
              <KpiTile
                tone="comply"
                value={formatSharePct(pct(k.compliant.acres, k.compliant.acres + k.nonCompliant.acres), lang)}
                label={c.kpiCompliantShare}
                sub={fill(c.ncShareSub, { p: formatSharePct(pct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres), lang) })}
              />
            </div>
          ) : null}

          {fieldsMode ? (
            <>
              {nodePlant ? (
                <BufferSeg
                  value={plantUnit(node.id)?.ring === "40" ? "40" : "80"}
                  onChange={(b) => {
                    setBuffer(b);
                    choose(`${nodePlant.key}${b}`);
                  }}
                  c={c}
                  label={c.bufferLabel}
                />
              ) : null}
              {corridor ? null : (
              <div className="soy-colorby">
                <span>{c.colorBy}</span>
                <div className="seg" role="group" aria-label={c.colorBy}>
                  {(["status", "years"] as const).map((v) => (
                    <button key={v} type="button" className={colorBy === v ? "on" : ""} aria-pressed={colorBy === v} onClick={() => setColorBy(v)}>
                      {v === "status" ? c.colorCatchment : c.colorYears}
                    </button>
                  ))}
                </div>
              </div>
              )}
              <button type="button" className="btn-primary block" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>
                {drawer ? c.closeTable : c.openTable} · {fill(c.fieldsN, { n: countF(scopeFields.complete ? scopeFields.fields.length + scopeFields.nc.length : total) })}
              </button>
              <p className="panel-note soy-load-note">
                {scopeFields.loading
                  ? countyFile || placeFile
                    ? c.loadingCounty
                    : c.loadingScope
                  : scopeFields.failed
                    ? c.fieldsError
                    : fill(placeFile ? c.loadedPlace : countyFile ? c.loadedCounty : c.loadedAll, { n: countF(scopeFields.fields.length + scopeFields.nc.length) })}
              </p>
            </>
          ) : (
            <>
              {node.id === "tp" || node.id === "adm" ? (
                <div className="soy-panel-tools">
                  <label className="search-field">
                    <input type="search" value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder={c.listSearch} aria-label={c.listSearch} />
                  </label>
                </div>
              ) : null}
              {node.id === "direct" ? <BufferSeg value={buffer} onChange={setBuffer} c={c} label={c.bufferLabel} /> : null}
              <p className="eyebrow soy-list-head">{level === 1 ? c.levelGroup : c.levelCatchment}</p>
              {children.length === 0 ? (
                <p className="panel-empty">{c.noMatches}</p>
              ) : (
                <ul className="mill-list">
                  {children.map((x) => (
                    <li key={x.id}>
                      <button type="button" className="mill-row" onClick={() => choose(x.id)}>
                        <span className="mill-row-main">
                          <b>{x.name}</b>
                          <span>
                            {x.sub}
                            {x.k ? ` · ${haF(x.k.compliant.acres)}` : ""}
                          </span>
                        </span>
                        {corridor && x.k ? (
                          <span className={`soy-corr-badge${x.k.compliant.coverageAcres > 0 ? "" : " none"}`}>
                            {x.k.compliant.coverageAcres > 0
                              ? fill(c.corrBadge, {
                                  p: formatSharePct(pct(x.k.compliant.corridor[String(band)]?.[basis] ?? 0, x.k.compliant.coverageAcres), lang),
                                  n: band,
                                })
                              : c.corrNoData}
                          </span>
                        ) : x.k && x.k.nonCompliant.fields > 0 ? (
                          <span className="soy-nc-badge">{fill(c.ncBadge, { n: countF(x.k.nonCompliant.fields) })}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {sel && setSel ? (
            // The same picker as the Summary's sidebar (user, 8 Oct 2026): combine without leaving the map.
            <details className="soy-map-combine" open={combineOpen} onToggle={(e) => setCombineOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>
                <span>{c.combineTitle}</span>
                <b>{scopeSummary(sel, data, c, lang)}</b>
              </summary>
              <p className="side-note soy-combine-hint">{c.combineHint}</p>
              <SoyRelated
                data={data}
                c={c}
                lang={lang}
                plants={sidePlants}
                plantSel=""
                sel={sel}
                setSel={(ids) => {
                  setSel(ids);
                  setPicked(null);
                  setPage(0);
                }}
                catchments={catchments}
                buffer={buffer}
                setBuffer={setBuffer}
              />
            </details>
          ) : null}
          {areaOpts && Object.keys(areaOpts).length ? (
            <details className="soy-area soy-map-fold" open={!!area.s || level === 1}>
              <summary>
                <span>{c.areaTitle}</span>
                {area.s ? <b>{areaName}</b> : null}
              </summary>
              {area.s ? (
                <button type="button" className="btn-text soy-area-clear" onClick={() => setArea({})}>
                  {c.sideClear}
                </button>
              ) : null}
              <div className="soy-area-row">
                <select
                  aria-label={c.areaState}
                  value={area.s ?? ""}
                  onChange={(e) => {
                    setArea(e.target.value ? { s: e.target.value } : {});
                    setPage(0);
                  }}
                >
                  <option value="">{c.areaAllStates}</option>
                  {Object.entries(areaOpts)
                    .map(([st, cos]) => [st, Object.values(cos).reduce((a, b) => a + b, 0)] as const)
                    .sort((a, b) => stateName(a[0]).localeCompare(stateName(b[0])))
                    .map(([st, n]) => (
                      <option key={st} value={st}>
                        {stateName(st)} · {countF(n)}
                      </option>
                    ))}
                </select>
                <select
                  aria-label={c.areaCounty}
                  value={area.n ?? ""}
                  disabled={!area.s}
                  onChange={(e) => {
                    setArea({ s: area.s, n: e.target.value || undefined });
                    setPage(0);
                  }}
                >
                  <option value="">{c.areaAllCounties}</option>
                  {area.s
                    ? Object.entries(areaOpts[area.s] ?? {})
                        .filter(([co]) => co)
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([co, n]) => (
                          <option key={co} value={co}>
                            {countyOf(co, area.s)} · {countF(n)}
                          </option>
                        ))
                    : null}
                  {/* A county outside every catchment (picked from the Places layer): still the current choice. */}
                  {area.s && area.n && !(areaOpts[area.s] ?? {})[area.n] ? <option value={area.n}>{countyOf(area.n, area.s)}</option> : null}
                </select>
              </div>
              {area.s ? <p className="soy-area-note">{fill(area.sub ? c.areaNoteSub : level === 1 ? (area.n ? c.areaNoteCounty : c.areaNoteState) : c.areaNote, { area: areaName })}</p> : null}
            </details>
          ) : null}
          {facts.length ? (
            <dl className="facts">
              {facts.map(([label, value], i) => (
                <div key={label + i}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {/* Rail & river had the same Download as Map & data (Feedback 5): shown on Map & data only. */}
          {canDownload && !corridor ? (
            <div className="downloads soy-downloads">
              <p className="eyebrow">
                {c.download} · {scopeName}
              </p>
              <div className="seg soy-dl-set" role="group" aria-label={c.dlSetLabel}>
                {(["ok", "nc", "both"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={set === v ? "on" : ""}
                    aria-pressed={set === v}
                    disabled={v !== "nc" && !okReady}
                    onClick={() => setDlSet(v)}
                  >
                    {v === "both" ? c.dlBoth : v === "ok" ? c.statusCompliant : c.statusNc}
                  </button>
                ))}
              </div>
              <div className="soy-dl-formats">
                {(
                  [
                    ["CSV", downloadCsv, c.dlCsvHint],
                    ["GeoJSON", downloadGeo, c.dlGeoHint],
                  ] as const
                ).map(([tag, run, hint]) => (
                  <button key={tag} type="button" className="download-row" disabled={!dlRows.length} onClick={run}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                    <span>
                      <b>
                        {tag} · {fill(c.fieldsN, { n: countF(dlRows.length) })}
                      </b>
                      {hint}
                    </span>
                  </button>
                ))}
              </div>
              <p className="panel-note">{okReady ? c.dlNote : scopeFields.loading ? c.loadingScope : c.dlNoteNcOnly}</p>
              <button type="button" className="download-row" onClick={downloadSummary}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  <b>
                    {c.dlSummary} · CSV
                  </b>
                  {c.dlSummaryHint}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
