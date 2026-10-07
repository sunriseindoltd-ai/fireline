import { useMemo, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount } from "@/lib/format";
import type { SoySupplyCopy } from "@/lib/soy-supply-copy";
import { admSiteIds, plantById, toggleSel, unitName, type Catchment, type SupplyData } from "@/lib/soy-supply";

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
};

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

/**
 * The catchments of the chosen plant, or — with all plants — every plant's
 * catchments plus the ADM and third-party elevators (not tied to a plant in
 * ADM's data, so they only appear here). Nothing ticked = the whole selection;
 * ticks combine and each field is counted once. A single third party is
 * viewed on its own.
 */
export function SoyRelated({ data, c, lang, plants, plantSel, sel, setSel, catchments }: Omit<Props, "setPlantSel">) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pending = plants.find((p) => p.id === plantSel && !p.hasData);
  // Elevators only list under a plant once ADM says which plant they deliver to.
  const forPlant = (e: { plants?: string[] }) => !plantSel || (e.plants ?? []).includes(plantSel);
  const plant = plantSel ? plantById(data, plantSel) : undefined;
  const directPlants = plant ? [plant] : data.plants;
  const sites = useMemo(() => data.admElevators.filter((e) => e.radiusM && forPlant(e)), [data, plantSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const tps = useMemo(() => data.thirdParty.filter(forPlant), [data, plantSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const tpMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tps;
    return tps.filter((e) => [e.company, e.county, e.state].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [tps, q]);
  const siteIds = admSiteIds(data).filter((id) => sites.some((e) => e.id === id));
  const tpOpen = sel.some((id) => /^tp\d+$/.test(id));
  const nc = (id: string) => catchments.get(id)?.nonCompliant.fields ?? 0;

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

  return (
    <aside className="soy-related" aria-label={c.sideRelated}>
      <button type="button" className="soy-side-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {c.sideToggle}
        {sel.length ? <i>{sel.length}</i> : null}
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
          {pending ? (
            <p className="side-note">{c.sidePending}</p>
          ) : (
            <>
              <p className="side-note">{c.sideHint}</p>

              <fieldset className="side-group">
                <legend>{c.sideDirect}</legend>
                {directPlants.flatMap((p) => [
                  row(`${p.key}40`, unitName(`${p.key}40`, data, c)!),
                  row(`${p.key}80`, unitName(`${p.key}80`, data, c)!),
                  ...(plant ? [row(`${p.key}80r`, unitName(`${p.key}80r`, data, c)!)] : []),
                ])}
              </fieldset>

              {sites.length ? (
                <fieldset className="side-group">
                  <legend>
                    {c.scopeAdm} · {sites.length}
                  </legend>
                  <div className="side-quick">
                    <button type="button" onClick={() => setSel([...new Set([...sel.filter((x) => !siteIds.includes(x)), ...siteIds])])} disabled={siteIds.every((id) => sel.includes(id))}>
                      {c.comboAllSites}
                    </button>
                    <button type="button" onClick={() => setSel(sel.filter((x) => !siteIds.includes(x)))} disabled={!siteIds.some((id) => sel.includes(id))}>
                      {c.comboNoSites}
                    </button>
                  </div>
                  <div className="side-tp-list">{sites.map((e) => row(e.id, [e.city ?? e.name, e.state].filter(Boolean).join(", ")))}</div>
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
                        tpMatches.map((e) => row(e.id, e.company ?? e.id, [e.county, e.state].filter(Boolean).join(", ")))
                      ) : (
                        <p className="side-note">{c.sideNoTp}</p>
                      )}
                    </div>
                    <p className="side-note">{c.sideOnlyOne}</p>
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
