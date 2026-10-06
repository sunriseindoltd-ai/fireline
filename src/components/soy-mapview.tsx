import { useMemo, useRef, useState, type FormEvent } from "react";
import { KpiTile } from "@/components/kpi-tile";
import {
  SoySupplyMap,
  bboxOf,
  type MapFocus,
  type ScopeFields,
  type SoyFeature,
  type SupplyColorBy,
} from "@/components/soy-supply-map";
import type { OtherPlant } from "@/components/soy-supply-map";
import type { Lang } from "@/lib/copy";
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
  radiusLabel,
  type Band,
  type Basis,
  type Catchment,
  type SupplyData,
} from "@/lib/soy-supply";

type StatusFilter = "all" | "ok" | "nc";
const PAGE = 100;

function downloadBlob(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
// Downloads carry neither the map centre nor the owner's name and address.
const stripCenter = (f: SoyFeature): SoyFeature => {
  const { _x, _y, on, oa, pv, ...props } = f.properties;
  void [_x, _y, on, oa, pv];
  return { ...f, properties: props };
};

export type CatchmentInfo = {
  id: string;
  level: 1 | 2 | 3;
  parent: string | null;
  kind: "plant" | "group" | "direct" | "adm" | "tp" | "combo";
  name: string;
  sub: string;
  k: Catchment | undefined;
};

/** The supply chain as a tree — Quincy, three supplier types, their catchments. */
export function catchmentInfos(data: SupplyData, catchments: Map<string, Catchment>, c: SoySupplyCopy): CatchmentInfo[] {
  const sites = data.admElevators.filter((x) => x.radiusM);
  const plantPlace = [data.plant.city, data.plant.state].filter(Boolean).join(", ");
  const out: CatchmentInfo[] = [
    { id: "all", level: 1, parent: null, kind: "plant", name: data.plant.name, sub: `${c.levelPlant} · ${plantPlace}`, k: catchments.get("all") },
    { id: "direct", level: 2, parent: "all", kind: "group", name: c.scopeDirect, sub: c.groupDirectSub, k: catchments.get("direct") },
    { id: "adm", level: 2, parent: "all", kind: "group", name: c.scopeAdm, sub: fill(c.groupAdmSub, { n: sites.length }), k: catchments.get("adm") },
    { id: "tp", level: 2, parent: "all", kind: "group", name: c.scopeTp, sub: fill(c.groupTpSub, { n: data.thirdParty.length }), k: catchments.get("tp") },
  ];
  const directName: Record<string, string> = { q40: c.scopeQ40, q80r: c.scopeQ80r, q80: c.scopeQ80 };
  // The 40–80 NM ring is only a building block of 0–80 NM; not offered on its own.
  for (const id of data.directUnits.filter((x) => x !== "q80r"))
    out.push({ id, level: 3, parent: "direct", kind: "direct", name: directName[id] ?? id, sub: plantPlace, k: catchments.get(id) });
  for (const e of sites)
    out.push({ id: e.id, level: 3, parent: "adm", kind: "adm", name: e.name, sub: [e.city, e.state, e.river].filter(Boolean).join(" · "), k: catchments.get(e.id) });
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
  if (mem.includes("q80")) parts.push(c.scopeQ80);
  else if (mem.includes("q40")) parts.push(c.scopeQ40);
  if (picked.length === sites.length) parts.push(fill(c.comboAdm, { n: sites.length }));
  else if (picked.length > 3) parts.push(fill(c.comboAdmN, { n: picked.length }));
  else parts.push(...picked.map((e) => e.name));
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
}) {
  const corridor = mode === "corridor";
  const [band, setBand] = useState<Band>(10);
  const [basis, setBasis] = useState<Basis>("either");
  const [colorBy, setColorBy] = useState<SupplyColorBy>("status");
  const [scopeFieldsRaw, setScopeFields] = useState<ScopeFields>({ fields: [], nc: [], complete: false, loading: false, scope: null });
  // Until the map reports on the newly chosen scope, show it as loading rather than the previous scope's fields.
  const scopeFields = useMemo<ScopeFields>(
    () => (scopeFieldsRaw.scope === scope ? scopeFieldsRaw : { fields: [], nc: [], complete: false, loading: levelOf(scope) === 3, scope }),
    [scopeFieldsRaw, scope],
  );
  const [drawer, setDrawer] = useState(false);
  const [picked, setPicked] = useState<SoyFeature | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapOnly, setMapOnly] = useState(false);
  const [coreOnly, setCoreOnly] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tableQuery, setTableQuery] = useState("");
  const [page, setPage] = useState(0);
  const [findText, setFindText] = useState("");
  const [findMiss, setFindMiss] = useState(false);
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
  function choose(id: string) {
    setScope(id);
    setPicked(null);
    setPage(0);
  }

  // ------------------------------------------------------------ table rows
  const rows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    const out: { f: SoyFeature; nc: boolean }[] = [];
    if (status !== "ok") for (const f of scopeFields.nc) out.push({ f, nc: true });
    if (status !== "nc") for (const f of scopeFields.fields) out.push({ f, nc: false });
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
  const scopeName = infos.find((x) => x.id === scope)?.name ?? c.scopeAll;
  const slug = (scope || "all").replace(/[^\w-]+/g, "-");
  const ncHeader = ["field_id", "state", "county", "field_acres", "cover_2018_2020", "first_cropped", "crop_2024", "crop_2025", "F2026_Soy", "also_compliant", "point_only", "lon", "lat"]; // prettier-ignore
  const ncRow = (f: SoyFeature) => {
    const p = f.properties;
    return [p.id, p.s, p.n, p.a, p.b, p.y, p.c24, p.c25, p.s26, Number(p.f) & FLAG.dual ? "yes" : "no", p.po ? "yes" : "no", Number(p._x).toFixed(5), Number(p._y).toFixed(5)] as (string | number | null)[]; // prettier-ignore
  };
  const downloads = [
    {
      label: c.dlNcCsv,
      hint: c.dlNcCsvHint,
      tag: "CSV",
      run: () => downloadBlob(`soytrace-${slug}-noncompliant.csv`, csv([ncHeader, ...scopeFields.nc.map(ncRow)]), "text/csv"),
    },
    {
      label: c.dlNcGeo,
      hint: c.dlNcGeoHint,
      tag: "GeoJSON",
      run: () =>
        downloadBlob(
          `soytrace-${slug}-noncompliant.geojson`,
          JSON.stringify({ type: "FeatureCollection", features: scopeFields.nc.map(stripCenter) }),
          "application/geo+json",
        ),
    },
    {
      label: c.dlFieldsCsv,
      hint: c.dlFieldsCsvHint,
      tag: "CSV",
      run: () =>
        downloadBlob(
          `soytrace-${slug}-fields.csv`,
          csv([
            ["field_id", "state", "county", "acres", "soy_seasons_2018_2025", "rail_mi", "river_mi", "cdl_2018_2025", "lon", "lat"],
            ...scopeFields.fields.map((f) => {
              const p = f.properties;
              return [p.id, p.s, p.n, p.a, p.y, p.r, p.v, String(p.c).replace(/,/g, " "), Number(p._x).toFixed(5), Number(p._y).toFixed(5)] as (string | number | null)[]; // prettier-ignore
            }),
          ]),
          "text/csv",
        ),
    },
    {
      label: c.dlSummary,
      hint: c.dlSummaryHint,
      tag: "CSV",
      run: () =>
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
              x.k ? pct(x.k.nonCompliant.acres, x.k.compliant.acres + x.k.nonCompliant.acres).toFixed(4) : null,
            ]),
          ]),
          "text/csv",
        ),
    },
  ];

  // ------------------------------------------------------------ side panel
  const level = levelOf(scope);
  const node = (isCombo(scope) ? comboInfo(scope, data, c) : null) ?? infos.find((x) => x.id === scope) ?? infos[0]!;
  const parent = node.parent ? infos.find((x) => x.id === node.parent) : null;
  // The levels above this one, top first (supply chain › supplier type › …).
  const trail: CatchmentInfo[] = [];
  for (let up = parent; up; up = up.parent ? infos.find((x) => x.id === up!.parent) : undefined) trail.unshift(up);
  // The search box and 6-state filter belong to the third-party list only.
  const q = node.id === "tp" ? listQuery.trim().toLowerCase() : "";
  const coreIds = new Set(data.thirdParty.filter((e) => e.core).map((e) => e.id));
  const children =
    level === 3
      ? []
      : infos.filter(
          (x) =>
            x.parent === node.id &&
            (!coreOnly || x.kind !== "tp" || coreIds.has(x.id)) &&
            (!q || `${x.name} ${x.sub}`.toLowerCase().includes(q)),
        );
  const k = node.k;
  const facts: [string, string][] = [];
  {
    const adm = data.admElevators.find((e) => e.id === node.id);
    const tp = data.thirdParty.find((e) => e.id === node.id);
    const atPlant = node.id === "all" || node.kind === "direct";
    const at = atPlant ? data.plant : (adm ?? tp);
    if (at) {
      facts.push([c.location, atPlant ? [data.plant.city, data.plant.state].filter(Boolean).join(", ") : node.sub]);
      facts.push([c.coordinates, `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`]);
    }
    if (node.kind === "direct") {
      const r40 = data.rings.find((r) => r.id === "q40")!;
      const r80 = data.rings.find((r) => r.id === "q80")!;
      const nm = (r: typeof r40) => `${r.nm} NM · ${Math.round(r.deliveredM / 1000)} km`;
      if (node.id === "q80r") {
        facts.push([c.radius, `${radiusLabel(r40.radiusM, lang)} – ${radiusLabel(r80.radiusM, lang)}`]);
        facts.push([c.deliveredLabel, `${nm(r40)} – ${nm(r80)}`]);
      } else {
        const r = node.id === "q40" ? r40 : r80;
        facts.push([c.radius, radiusLabel(r.radiusM, lang)]);
        facts.push([c.deliveredLabel, nm(r)]);
      }
    }
    if (adm?.radiusM) {
      facts.push([c.radius, radiusLabel(adm.radiusM, lang)]);
      facts.push([c.deliveredLabel, `20 NM · ${Math.round(data.delivered.adm.m / 1000)} km`]);
    }
    if (tp) {
      facts.push([c.radius, radiusLabel(tp.radiusM, lang)]);
      facts.push([c.deliveredLabel, `20 mi · ${Math.round(data.delivered.tp.m / 1000)} km`]);
    }
    if (at) facts.push([c.toRail, miF(at.railMi)], [c.toRiver, miF(at.riverMi)]);
    if (adm?.river) facts.push([c.river, adm.river]);
    if (adm?.type) facts.push([c.facilityType, adm.type]);
    if (tp?.company) facts.push([c.company, tp.company]);
    if (tp?.tract) facts.push(["ID", tp.tract]);
  }
  const total = (k?.compliant.fields ?? 0) + (k?.nonCompliant.fields ?? 0);
  const kindLabel = (x: CatchmentInfo) =>
    x.kind === "combo" ? c.comboKind : x.kind === "plant" ? c.levelPlant : x.kind === "group" ? c.levelGroup : x.kind === "adm" ? c.kindAdm : x.kind === "tp" ? c.kindTp : c.kindPlant;
  const nameOf = (id: string) => infos.find((x) => x.id === id)?.name ?? id;

  // ------------------------------------------------------------ field card
  const p = picked?.properties;
  const isNc = !!p && ("ch" in p || "po" in p);
  const tiers = (kk: unknown) => {
    // Fields in the 40–80 NM ring read as "Quincy 0–80 NM"; 0–40 NM fields are in both.
    const ids = String(kk ?? "").split("|").filter(Boolean).map((x) => (x === "q80r" ? "q80" : x));
    if (ids.includes("q40") && !ids.includes("q80")) ids.splice(ids.indexOf("q40") + 1, 0, "q80");
    return [...new Set(ids)].map(nameOf).join(" · ") || "—";
  };
  const acresHa = (a: unknown) =>
    a == null ? "—" : `${haF(Number(a))} · ${formatHa(Number(a) * AC_TO_HA, lang)}`;

  return (
    <div className={`mapview soy-mapview ${mapOnly ? "map-only" : ""}`}>
      <div className="mapview-map">
        <SoySupplyMap
          data={data}
          mode={mode}
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
          selectedField={p ? String(p.id) : null}
          onSelectField={(f) => pick(f)}
          focus={focus}
          otherPlants={otherPlants}
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
                {(["all", "ok", "nc"] as const).map((s) => (
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
                    {s === "all" ? c.statusAll : s === "nc" ? c.statusNc : c.statusCompliant}
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
                          onClick={() => pick(f, true)}
                          onKeyDown={(e) => e.key === "Enter" && pick(f, true)}
                        >
                          <td>
                            <span className={`soy-status ${nc ? "nc" : "ok"}`}>{nc ? c.statusNc : c.statusCompliant}</span>
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

          {level === 3 ? (
            <>
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
                  ? c.loadingScope
                  : scopeFields.failed
                    ? c.fieldsError
                    : fill(c.loadedAll, { n: countF(scopeFields.fields.length + scopeFields.nc.length) })}
              </p>
            </>
          ) : (
            <>
              {node.id === "tp" ? (
                <div className="soy-panel-tools">
                  <label className="search-field">
                    <input type="search" value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder={c.listSearch} aria-label={c.listSearch} />
                  </label>
                  <label className="check-inline">
                    <input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> {c.tpCoreOnly}
                  </label>
                </div>
              ) : null}
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
          {canDownload ? (
            <div className="downloads">
              <p className="eyebrow">{c.download}</p>
              {downloads
                .filter((d) => level === 3 || d.tag !== "CSV" || d.label !== c.dlFieldsCsv)
                .map((d) => (
                  <button key={d.label + d.tag} type="button" className="download-row" onClick={d.run}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>
                      <b>
                        {d.label} · {d.tag}
                      </b>
                      {d.hint}
                    </span>
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
