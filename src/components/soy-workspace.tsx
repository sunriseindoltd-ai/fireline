import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BrandMark } from "@/components/brand-mark";
import { KpiTile } from "@/components/kpi-tile";
import { LangToggle } from "@/components/lang-toggle";
import {
  SoyMap,
  type SoyBuffers,
  type SoyFieldCollection,
  type SoyPlant,
} from "@/components/soy-map";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { fill, formatCount, formatHa, formatLarge } from "@/lib/format";
import type { GateRole } from "@/lib/gate";
import { gateLogout, gateSwitchTenant } from "@/lib/gate-actions";
import { useI18n } from "@/lib/i18n";
import { SOY_GROUPS, SOY_GROUP_COLORS, SOY_YEARS_COLORS, soyCopy } from "@/lib/soy-copy";
import { TENANTS, type Tenant } from "@/lib/tenants";

type SoyStats = {
  fields: number;
  ha: number;
  acres: number;
  fieldHa: { p10: number | null; median: number | null; p90: number | null; max: number | null };
  sizeBinsHa: { bounds: number[]; fields: number[] };
  cropHistoryHa: ({ year: number } & Record<(typeof SOY_GROUPS)[number], number>)[];
  soyYears: { years: number; fields: number }[];
  states: { state: string; name: string; fields: number; ha: number }[];
  topCounties: { county: string; state: string; fields: number; ha: number }[];
};
type SoyData = {
  source: string;
  bufferMiles: number;
  plants: (SoyPlant & { stats: SoyStats })[];
  overall: SoyStats;
  buffers: SoyBuffers;
  cdlNames: Record<string, string>;
};

type FieldsState = {
  status: "idle" | "loading" | "error" | "ready";
  fc: SoyFieldCollection | null;
};

/**
 * The ADM Soy workspace (tenant `adm-soy`): ADM's US crushing plants, their
 * 40-mile sourcing areas and the soybean fields inside — statistics and map
 * only for now, no EUDR analysis. Data: /data/soy.json (bundled, small) and
 * /data/fields/<plant>.geojson (the soy R2 bucket), both built by
 * scripts/prepare-adm-soy.py.
 */
export function SoyWorkspace({ role, tenant }: { role: GateRole; tenant: Tenant }) {
  const { t, lang } = useI18n();
  const sc = soyCopy[lang];
  const navigate = useNavigate();
  const [data, setData] = useState<SoyData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldsState>({ status: "idle", fc: null });
  const cache = useRef(new Map<string, SoyFieldCollection>());
  const reqId = useRef(0);

  useEffect(() => {
    void fetchWithRetry("/data/soy.json")
      .then((res) =>
        res.ok ? (res.json() as Promise<SoyData>) : Promise.reject(new Error(String(res.status))),
      )
      .then(setData)
      .catch(() => setLoadError(true));
  }, []);

  const loadFields = useCallback((plant: string | null) => {
    const id = ++reqId.current;
    if (!plant) return setFields({ status: "idle", fc: null });
    const hit = cache.current.get(plant);
    if (hit) return setFields({ status: "ready", fc: hit });
    setFields({ status: "loading", fc: null });
    void fetchWithRetry(`/data/fields/${encodeURIComponent(plant)}.geojson`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<SoyFieldCollection>)
          : Promise.reject(new Error(String(res.status))),
      )
      .then((fc) => {
        cache.current.set(plant, fc);
        if (reqId.current === id) setFields({ status: "ready", fc });
      })
      .catch(() => {
        if (reqId.current === id) setFields({ status: "error", fc: null });
      });
  }, []);

  function select(plant: string | null) {
    setSelected(plant);
    loadFields(plant);
  }

  async function logout() {
    await gateLogout();
    await navigate({ to: "/login" });
  }
  async function switchTenant(next: Tenant) {
    const res = await gateSwitchTenant({ data: { tenant: next } });
    if (res.ok) window.location.assign("/app/portfolio");
  }

  const header = (
    <header className="app-header">
      <span className="app-brand">
        <BrandMark size={22} />
        <span className="word">{t.app}</span>
      </span>
      <span className="app-sep" aria-hidden="true">
        /
      </span>
      <span className="soy-scope">{sc.scopeLabel}</span>
      <div className="app-actions">
        {role === "admin" ? (
          <label className="tenant-switch">
            <span>{t.clientLabel}</span>
            <select value={tenant} onChange={(e) => void switchTenant(e.target.value as Tenant)}>
              {TENANTS.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <LangToggle />
        <button type="button" className="btn-text" onClick={() => void logout()}>
          {t.signOut}
        </button>
      </div>
    </header>
  );

  if (!data) {
    return (
      <div className="app">
        {header}
        <main className="app-main">
          <div className="boot">
            <BrandMark size={32} />
            <span>{loadError ? sc.loadError : t.loading}</span>
          </div>
        </main>
      </div>
    );
  }

  const plant = selected ? (data.plants.find((p) => p.id === selected) ?? null) : null;
  const stats = plant ? plant.stats : data.overall;
  const countF = (n: number) => formatCount(n, lang);
  const haF = (n: number) => formatHa(n, lang);
  const statesText = stats.states.map((s) => s.state).join(" · ");
  const bins = stats.sizeBinsHa;
  const sizeData = bins.fields.map((n, i) => ({
    label:
      i === 0
        ? `<${bins.bounds[0]}`
        : i === bins.bounds.length
          ? `≥${bins.bounds[i - 1]}`
          : `${bins.bounds[i - 1]}–${bins.bounds[i]}`,
    fields: n,
  }));

  return (
    <div className="app">
      {header}
      <main className="app-main">
        <div className="page soy-page">
          <div className="summary-head">
            <div>
              <h1>{plant ? plant.name : sc.title}</h1>
              <p className="summary-sub">
                {plant ? plant.address : fill(sc.intro, { miles: data.bufferMiles })}
              </p>
            </div>
          </div>

          <div className="soy-plant-seg seg" role="tablist" aria-label={sc.plantsLabel}>
            <button
              type="button"
              role="tab"
              aria-selected={!selected}
              className={!selected ? "on" : ""}
              onClick={() => select(null)}
            >
              {sc.allPlants}
            </button>
            {data.plants.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={selected === p.id}
                className={selected === p.id ? "on" : ""}
                onClick={() => select(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="kpi-row">
            {!plant ? (
              <KpiTile
                value={countF(data.plants.length)}
                label={sc.plantsKpi}
                hint={sc.plantsHint}
              />
            ) : null}
            <KpiTile value={countF(stats.fields)} label={sc.fieldsKpi} hint={sc.fieldsHint} />
            <KpiTile
              value={haF(stats.ha)}
              label={sc.areaKpi}
              hint={sc.areaHint}
              sub={fill(sc.acres, { n: formatLarge(stats.acres, lang) })}
            />
            <KpiTile
              value={stats.fieldHa.median == null ? "—" : haF(stats.fieldHa.median)}
              label={sc.medianKpi}
              hint={sc.medianHint}
            />
            <KpiTile value={statesText || "—"} label={sc.statesKpi} hint={sc.statesHint} />
          </div>

          <section className="chart-card soy-map-card">
            <SoyMap
              plants={data.plants}
              buffers={data.buffers}
              selected={selected}
              fields={fields.fc}
              cdlNames={data.cdlNames}
              sc={sc}
              lang={lang}
              onSelectPlant={(id) => select(id)}
            />
            {!selected ? <p className="soy-map-status">{sc.mapPickPlant}</p> : null}
            {fields.status === "loading" ? (
              <p className="soy-map-status">
                <span className="spinner" aria-hidden="true" />{" "}
                {fill(sc.mapLoading, { n: countF(stats.fields) })}
              </p>
            ) : null}
            {fields.status === "error" ? (
              <p className="soy-map-status error">
                {sc.mapError}{" "}
                <button type="button" className="btn-text" onClick={() => loadFields(selected)}>
                  {sc.retry}
                </button>
              </p>
            ) : null}
          </section>

          <div className="chart-grid soy-charts">
            <div className="chart-card">
              <h3>{sc.cropHistoryTitle}</h3>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={stats.cropHistoryHa} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={88}
                    tickFormatter={(v: number) => formatLarge(v, lang)}
                  />
                  <Tooltip
                    formatter={(v: number, k: string) => [
                      haF(v),
                      sc.groups[k as keyof typeof sc.groups] ?? k,
                    ]}
                  />
                  {SOY_GROUPS.map((g) => (
                    <Bar
                      key={g}
                      dataKey={g}
                      stackId="a"
                      fill={SOY_GROUP_COLORS[g]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <ul className="chart-legend">
                {SOY_GROUPS.map((g) => (
                  <li key={g}>
                    <i style={{ background: SOY_GROUP_COLORS[g] }} />
                    {sc.groups[g]}
                  </li>
                ))}
              </ul>
              <p className="chart-note">{sc.cropHistoryNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.soyYearsTitle}</h3>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={stats.soyYears} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis
                    dataKey="years"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(v: number) => fill(sc.yearsN, { n: v })}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={56}
                    tickFormatter={(v: number) => countF(v)}
                  />
                  <Tooltip
                    formatter={(v: number) => [countF(v), sc.colFields]}
                    labelFormatter={(v: number) => fill(sc.yearsN, { n: v })}
                  />
                  <Bar dataKey="fields" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {stats.soyYears.map((d) => (
                      <Cell
                        key={d.years}
                        fill={SOY_YEARS_COLORS[Math.min(7, Math.max(0, d.years - 1))]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="chart-note">{sc.soyYearsNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.sizeTitle}</h3>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={sizeData} margin={{ top: 8, left: 8, right: 8 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={56}
                    tickFormatter={(v: number) => countF(v)}
                  />
                  <Tooltip
                    formatter={(v: number) => [countF(v), sc.colFields]}
                    labelFormatter={(v: string) => `${v} ha`}
                  />
                  <Bar
                    dataKey="fields"
                    fill="#58a06e"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
              <p className="chart-note">{sc.sizeNote}</p>
            </div>

            <div className="chart-card">
              <h3>{sc.countiesTitle}</h3>
              <table className="data-table soy-table">
                <thead>
                  <tr>
                    <th>{sc.colCounty}</th>
                    <th className="num">{sc.colFields}</th>
                    <th className="num">{sc.colArea}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topCounties.map((c) => (
                    <tr key={`${c.county}-${c.state}`}>
                      <td>
                        {c.county}, {c.state}
                      </td>
                      <td className="num tabular-nums">{countF(c.fields)}</td>
                      <td className="num tabular-nums">{haF(c.ha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.states.length > 1 ? (
                <>
                  <h3 className="soy-subhead">{sc.statesTitle}</h3>
                  <table className="data-table soy-table">
                    <tbody>
                      {stats.states.map((s) => (
                        <tr key={s.state}>
                          <td>{s.name}</td>
                          <td className="num tabular-nums">{countF(s.fields)}</td>
                          <td className="num tabular-nums">{haF(s.ha)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          </div>

          {!plant ? (
            <section className="chart-card soy-compare">
              <h3>{sc.compareTitle}</h3>
              <div className="soy-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{sc.colPlant}</th>
                      <th>{sc.colState}</th>
                      <th className="num">{sc.colFields}</th>
                      <th className="num">{sc.colArea}</th>
                      <th className="num">{sc.colMedian}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plants.map((p) => (
                      <tr
                        key={p.id}
                        tabIndex={0}
                        onClick={() => select(p.id)}
                        onKeyDown={(e) => e.key === "Enter" && select(p.id)}
                      >
                        <td>{p.name}</td>
                        <td>{p.stats.states.map((s) => s.state).join(" · ")}</td>
                        <td className="num tabular-nums">{countF(p.stats.fields)}</td>
                        <td className="num tabular-nums">{haF(p.stats.ha)}</td>
                        <td className="num tabular-nums">
                          {p.stats.fieldHa.median == null ? "—" : haF(p.stats.fieldHa.median)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chart-note">{sc.overlapNote}</p>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
