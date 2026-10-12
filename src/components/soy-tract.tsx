import { useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/copy";
import { fill, formatCount } from "@/lib/format";
import type { SoyNavCopy } from "@/lib/soy-nav-copy";
import type { SoySupplyCopy } from "@/lib/soy-supply-copy";
import type { SupplyData } from "@/lib/soy-supply";

type Kind = "plant" | "adm" | "tp";
type Row = { id: string; label: string; kind: Kind; radiusNm: number; fields: number; parts: [number, number, number][]; bytes: number };

const KIND_OF: Record<string, Kind> = { "crushing plant": "plant", "ADM elevator": "adm", "third-party elevator": "tp" };
const KIND_ORDER: Kind[] = ["plant", "adm", "tp"];

export function tractRows(data: SupplyData): Row[] {
  const files = data.tract?.files ?? {};
  return Object.entries(files)
    .map(([id, f]) => ({ id, label: f.label, kind: KIND_OF[f.kind] ?? "tp", radiusNm: f.radiusNm, fields: f.fields, parts: f.parts, bytes: f.parts.reduce((a, p) => a + p[2], 0) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
}

const href = (id: string, p: number) => `/soy-tract?f=${encodeURIComponent(id)}&p=${p}`;

/** Downloads one file after another; browsers drop clicks that come too fast. */
async function downloadAll(list: [string, number][], onProgress: (done: number) => void) {
  let done = 0;
  for (const [id, p] of list) {
    const a = document.createElement("a");
    a.href = href(id, p);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    onProgress(++done);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * GeoJSON for TRACT / TRACES, facility by facility (9 Oct 2026 layout, user
 * feedback): every facility with a file set is listed with a tick box, a
 * search and a type filter; a large catchment's parts are shown as one row
 * and downloaded together. Inline on the Data tab, a dialog on a facility page.
 */
export function TractPicker({ data, c, nav, lang, initial = [], inline = false, onClose }: {
  data: SupplyData;
  c: SoySupplyCopy;
  nav: SoyNavCopy;
  lang: Lang;
  initial?: string[];
  inline?: boolean;
  onClose?: () => void;
}) {
  const rows = useMemo(() => tractRows(data), [data]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial.filter((id) => data.tract?.files[id])));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<string | null>(initial.length === 1 ? initial[0]! : null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const countF = (n: number) => formatCount(n, lang);
  const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 2 })} GB` : `${(b / 1e6).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 })} MB`);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (kind === "all" || r.kind === kind) && (!q || r.label.toLowerCase().includes(q)));
  const picked = rows.filter((r) => sel.has(r.id));
  const files = picked.flatMap((r) => r.parts.map(([p]) => [r.id, p] as [string, number]));
  const bytes = picked.reduce((a, r) => a + r.bytes, 0);
  const kindLabel: Record<Kind, string> = { plant: c.kindPlant, adm: c.kindAdm, tp: c.kindTp };
  const rep = data.tract?.repaired ?? {};
  const fixedInvalid = (rep.repaired_invalid ?? 0) + (rep.repaired_after_rounding ?? 0) + (rep.merged_parts ?? 0);
  const leftOut = Object.values(data.tract?.leftOut ?? {}).reduce((a, b) => a + b, 0);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  async function run(list: [string, number][]) {
    setProgress({ done: 0, total: list.length });
    await downloadAll(list, (done) => setProgress({ done, total: list.length }));
    setProgress(null);
  }
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = (
    <div className="tract-picker">
      <p className="chart-note">{nav.tractPickHint}</p>
      <div className="tract-tools">
        <div className="seg" role="group" aria-label={nav.tractKindAll}>
          {(["all", "plant", "adm", "tp"] as const).map((k) => (
            <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? nav.tractKindAll : k === "plant" ? nav.tractKindPlant : k === "adm" ? nav.tractKindAdm : nav.tractKindTp}
            </button>
          ))}
        </div>
        <label className="search-field">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={nav.tractSearch} aria-label={nav.tractSearch} />
        </label>
        <div className="tract-quick">
          <button type="button" className="btn-text" onClick={() => setSel((s) => new Set([...s, ...shown.map((r) => r.id)]))}>
            {fill(nav.tractSelectVisible, { n: countF(shown.length) })}
          </button>
          <button type="button" className="btn-text" disabled={!sel.size} onClick={() => setSel(new Set())}>
            {nav.tractClear}
          </button>
        </div>
      </div>
      <div className="soy-table-wrap tract-table">
        <table className="data-table soy-table">
          <thead>
            <tr>
              <th className="tract-tick" />
              <th>{c.facCol}</th>
              <th className="num">{c.colFields}</th>
              <th className="num">{c.tractFiles}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const on = sel.has(r.id);
              const isOpen = open === r.id;
              return (
                <tr key={r.id} className={on ? "on" : ""}>
                  <td className="tract-tick">
                    <input type="checkbox" checked={on} aria-label={r.label} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    <button type="button" className="tract-name" onClick={() => toggle(r.id)}>
                      {r.label}
                    </button>
                    <span className="soy-cell-sub">
                      {kindLabel[r.kind]} · {r.radiusNm} NM
                    </span>
                    {isOpen ? (
                      <span className="tract-parts">
                        {r.parts.map(([p, , b]) => (
                          <a key={p} href={href(r.id, p)} download>
                            {r.parts.length > 1 ? fill(c.tractPart, { n: p }) : "GeoJSON"} · {mb(b)}
                          </a>
                        ))}
                      </span>
                    ) : null}
                  </td>
                  <td className="num tabular-nums">{countF(r.fields)}</td>
                  <td className="num tabular-nums tract-files">
                    <button type="button" className="btn-text" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                      {r.parts.length > 1 ? fill(nav.tractParts, { n: r.parts.length }) : nav.tractOneFile} · {mb(r.bytes)}
                    </button>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="chart-note">
                  {c.noMatches}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="tract-foot">
        <div>
          <p className="tract-sum">{sel.size ? fill(nav.tractSelected, { n: countF(sel.size), files: countF(files.length), size: mb(bytes) }) : nav.tractNoneSel}</p>
          <p className="chart-note">
            {nav.tractPartsHint} {nav.tractBrowserNote}
          </p>
          <p className="chart-note">
            {fill(c.tractRepaired, { holes: countF(rep.filled_holes ?? 0), invalid: countF(fixedInvalid) })}
            {leftOut > 0 ? ` ${fill(c.tractLeftOut, { n: countF(leftOut) })}` : ""}
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={!files.length || !!progress} onClick={() => void run(files)}>
          {progress ? fill(nav.tractDownloading, { done: countF(progress.done), total: countF(progress.total) }) : fill(nav.tractDownloadSel, { n: countF(files.length) })}
        </button>
      </div>
    </div>
  );

  if (inline) return body;
  return (
    <div className="tract-layer" role="dialog" aria-modal="true" aria-label={c.tractTitle} onClick={onClose}>
      <div className="tract-card tract-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="tract-head">
          <h2>{c.tractTitle}</h2>
          <button type="button" className="btn-text" onClick={onClose}>
            {c.close}
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
