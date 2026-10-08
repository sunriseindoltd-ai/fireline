import { useMemo, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount } from "@/lib/format";
import type { SoySupplyCopy } from "@/lib/soy-supply-copy";
import { admSiteIds, placeOf, plantById, toggleSel, tpName as tpLabel, type Catchment, type Plant, type PlantBuffer, type SupplyData } from "@/lib/soy-supply";

/** A crushing plant in the list (hasData false = announced, catchments not delivered yet). */
export type SidePlant = { id: string; name: string; hasData: boolean };

type Props = {
  data: SupplyData;
  c: SoySupplyCopy;
  lang: Lang;
  plants: SidePlant[];
  /** "" = all plants. */
  plantSel: string;
  setPlantSel: (id: string) => void;
  /** Ticked catchment ids; none = the whole chain. */
  sel: string[];
  setSel: (ids: string[]) => void;
  catchments: Map<string, Catchment>;
  /** The plant buffer new ticks use (each ticked plant keeps its own). */
  buffer: PlantBuffer;
  setBuffer: (b: PlantBuffer) => void;
};

/** 0–40 / 0–80 NM, wherever a plant's buffer is picked. */
export function BufferSeg({ value, onChange, c, label }: { value: PlantBuffer; onChange: (b: PlantBuffer) => void; c: SoySupplyCopy; label: string }) {
  return (
    <div className="seg soy-buffer-seg" role="group" aria-label={label}>
      {(["40", "80"] as const).map((b) => (
        <button key={b} type="button" className={value === b ? "on" : ""} aria-pressed={value === b} onClick={() => onChange(b)}>
          {b === "40" ? c.scopeQ40 : c.scopeQ80}
        </button>
      ))}
    </div>
  );
}

/** The crushing plants — a compact list, as tall as the page title beside it. */
export function SoyPlants({ c, plants, plantSel, setPlantSel }: Pick<Props, "c" | "plants" | "plantSel" | "setPlantSel">) {
  return (
    <section className="soy-plants" aria-label={c.sidePlants}>
      <h2>{c.sidePlants}</h2>
      <ul className="side-plants">
        <li>
          <button type="button" className={!plantSel ? "on" : ""} aria-pressed={!plantSel} onClick={() => setPlantSel("")}>
            {c.sideAllPlants}
          </button>
        </li>
        {plants.map((p) => (
          <li key={p.id}>
            <button type="button" className={plantSel === p.id ? "on" : ""} aria-pressed={plantSel === p.id} onClick={() => setPlantSel(p.id)}>
              {p.name}
              {p.hasData ? null : <i className="supply-soon">{c.plantSoon}</i>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The selection in one line (Feedback 5, P2-2): "Whole supply chain" or "Quincy 0–80 NM + 3 ADM elevators". */
export function scopeSummary(sel: string[], data: SupplyData, c: SoySupplyCopy, lang: Lang): string {
  if (!sel.length) return c.sumAll;
  const parts: string[] = [];
  for (const p of data.plants) {
    const b = sel.includes(`${p.key}80`) ? c.scopeQ80 : sel.includes(`${p.key}40`) ? c.scopeQ40 : sel.includes(`${p.key}80r`) ? c.scopeQ80r : null;
    if (b) parts.push(`${p.city ?? p.name} ${b}`);
  }
  const adm = sel.filter((id) => /^adm\d+$/.test(id)).length;
  if (adm) parts.push(adm === 1 ? (data.admElevators.find((e) => e.id === sel.find((x) => /^adm\d+$/.test(x)))?.name ?? "") : fill(c.sumAdm, { n: formatCount(adm, lang) }));
  if (sel.includes("tp")) parts.push(c.sumTpAll);
  const tp = sel.filter((id) => /^tp\d+$/.test(id));
  if (tp.length === 1) {
    const t = data.thirdParty.find((e) => e.id === tp[0]);
    if (t) parts.push(tpLabel(t, data));
  } else if (tp.length) parts.push(fill(c.sumTp, { n: formatCount(tp.length, lang) }));
  return parts.filter(Boolean).join(" + ");
}

/**
 * The chosen plant's catchments (every plant's with "All plants"), then the ADM
 * and third-party elevators. Which plant an elevator delivers to isn't in the
 * data, so every elevator and third party can be ticked together with any
 * plant. Nothing ticked = the whole selection; ticks combine and each field is
 * counted once.
 */
export function SoyRelated({ data, c, lang, plants, plantSel, sel, setSel, catchments, buffer, setBuffer }: Omit<Props, "setPlantSel">) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [qa, setQa] = useState("");
  const pending = plants.find((p) => p.id === plantSel && !p.hasData);
  const plant = plantSel ? plantById(data, plantSel) : undefined;
  const directPlants = plant ? [plant] : data.plants;
  const sites = useMemo(() => data.admElevators.filter((e) => e.radiusM), [data]);
  const tps = data.thirdParty;
  // Several points in one town (Evansville: an elevator and two terminals) read apart by their address.
  const cityCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of sites) m.set(`${e.city}|${e.state}`, (m.get(`${e.city}|${e.state}`) ?? 0) + 1);
    return m;
  }, [sites]);
  const siteMatches = useMemo(() => {
    const needle = qa.trim().toLowerCase();
    if (!needle) return sites;
    return sites.filter((e) => [e.name, e.city, e.county, e.state, e.address].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [sites, qa]);
  const tpMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tps;
    return tps.filter((e) => [e.company, e.county, e.state].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [tps, q]);
  const siteIds = admSiteIds(data).filter((id) => sites.some((e) => e.id === id));
  const tpOpen = sel.some((id) => /^tp\d+$/.test(id));
  const nc = (id: string) => catchments.get(id)?.nonCompliant.fields ?? 0;
  const summary = scopeSummary(sel, data, c, lang);

  const row = (id: string, label: string, sub?: string) => (
    <label key={id} className={`side-row ${sel.includes(id) ? "on" : ""}`}>
      <input type="checkbox" checked={sel.includes(id)} onChange={() => setSel(toggleSel(sel, id))} />
      <span className="side-label">
        {label}
        {sub ? <small>{sub}</small> : null}
      </span>
      {nc(id) > 0 ? (
        <b className="side-nc tabular-nums" title={c.colNcN}>
          {formatCount(nc(id), lang)}
        </b>
      ) : null}
    </label>
  );

  // One row per plant: a tick and its buffer (0–40 / 0–80 NM).
  const plantRow = (p: Plant) => {
    const ids = [`${p.key}40`, `${p.key}80`, `${p.key}80r`];
    const cur = sel.includes(`${p.key}40`) ? "40" : sel.includes(`${p.key}80`) ? "80" : null;
    const buf: PlantBuffer = cur ?? buffer;
    const id = `${p.key}${buf}`;
    return (
      <div key={p.id} className={`side-row side-row-plant ${cur ? "on" : ""}`}>
        <label>
          <input
            type="checkbox"
            checked={!!cur}
            onChange={() => setSel(cur ? sel.filter((x) => !ids.includes(x)) : [...sel.filter((x) => !/80r$/.test(x)), id])}
          />
          <span className="side-label">{p.city ?? p.name}</span>
        </label>
        <select
          className="side-buffer"
          value={buf}
          aria-label={`${p.city ?? p.name} · ${c.bufferLabel}`}
          onChange={(e) => {
            const b = e.target.value as PlantBuffer;
            setBuffer(b);
            if (cur) setSel(sel.map((x) => (x === `${p.key}${cur}` ? `${p.key}${b}` : x)));
          }}
        >
          <option value="40">{c.scopeQ40}</option>
          <option value="80">{c.scopeQ80}</option>
        </select>
        {nc(id) > 0 ? (
          <b className="side-nc tabular-nums" title={c.colNcN}>
            {formatCount(nc(id), lang)}
          </b>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="soy-related" aria-label={c.sideRelated}>
      <button type="button" className="soy-side-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          <small>{c.sideToggle}</small>
          {summary}
        </span>
        <i aria-hidden="true">{open ? "−" : "+"}</i>
      </button>
      <div className={`soy-side-body ${open ? "open" : ""}`}>
        <section>
          <div className="side-head">
            <h2>{c.sideRelated}</h2>
            {sel.length ? (
              <button type="button" className="btn-text" onClick={() => setSel([])}>
                {c.sideClear}
              </button>
            ) : null}
          </div>
          <p className="side-summary" aria-live="polite">
            {summary}
          </p>
          {pending ? (
            <p className="side-note">{c.sidePending}</p>
          ) : (
            <>
              <p className="side-note">{c.sideHint}</p>

              <fieldset className="side-group">
                <legend>{c.sideDirect}</legend>
                {directPlants.map(plantRow)}
              </fieldset>

              {sites.length ? (
                <fieldset className="side-group">
                  <legend>
                    {c.scopeAdm} · {formatCount(sites.length, lang)}
                  </legend>
                  <div className="side-quick">
                    <button type="button" onClick={() => setSel([...new Set([...sel.filter((x) => !siteIds.includes(x)), ...siteIds])])} disabled={siteIds.every((id) => sel.includes(id))}>
                      {c.comboAllSites}
                    </button>
                    <button type="button" onClick={() => setSel(sel.filter((x) => !siteIds.includes(x)))} disabled={!siteIds.some((id) => sel.includes(id))}>
                      {c.comboNoSites}
                    </button>
                  </div>
                  <input className="side-search" type="search" value={qa} onChange={(e) => setQa(e.target.value)} placeholder={c.sideSearchAdm} aria-label={c.sideSearchAdm} />
                  <div className="side-tp-list">
                    {siteMatches.length ? (
                      siteMatches.map((e) =>
                        row(e.id, [e.city ?? e.name, e.state].filter(Boolean).join(", "), (cityCount.get(`${e.city}|${e.state}`) ?? 0) > 1 ? (e.address ?? e.name) : undefined),
                      )
                    ) : (
                      <p className="side-note">{c.sideNoAdm}</p>
                    )}
                  </div>
                </fieldset>
              ) : null}

              {tps.length ? (
                <fieldset className="side-group">
                  <legend>
                    {c.scopeTp} · {tps.length}
                  </legend>
                  {row("tp", c.sideTpAll, formatCount(tps.length, lang))}
                  <details className="side-tp" open={tpOpen}>
                    <summary>{c.sideTpPick}</summary>
                    <input className="side-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.sideSearchTp} aria-label={c.sideSearchTp} />
                    <div className="side-tp-list">
                      {tpMatches.length ? (
                        tpMatches.map((e) =>
                          row(e.id, tpLabel(e, data), placeOf(e)),
                        )
                      ) : (
                        <p className="side-note">{c.sideNoTp}</p>
                      )}
                    </div>

                  </details>
                </fieldset>
              ) : null}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
