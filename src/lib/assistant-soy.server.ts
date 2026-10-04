import { MAX_ROWS, norm, pct, r1, type AssistantContext, type Kit, type Lang, type ToolOut } from "@/lib/assistant.server";
import { soySupplyCopy, type SoySupplyCopy } from "@/lib/soy-supply-copy";
import { AC_TO_HA, comboTotals, stateName, type Catchment, type SupplyData } from "@/lib/soy-supply";
import type { Tenant } from "@/lib/tenants";

/**
 * SoyTrace's tools for the "Tanya data" assistant (assistant.server.ts runs
 * the models). Same rule as PalmTrace: the model only picks a tool, the
 * figures come from the workspace's own supply.json and the UI shows the
 * table. Compliant / non-compliant is the client's classification; shares
 * are by area unless the question asks for field counts, as on the Summary
 * tab. No deforestation figures (the workspace dropped them, 2 Oct) and no
 * owner data (it is not in supply.json).
 */

type Facility = { id: string; kind: "chain" | "plant" | "adm" | "tp"; name: string; place: string; k: Catchment };
type Soy = { data: SupplyData; lang: Lang; c: SoySupplyCopy; facilities: Facility[]; byId: Map<string, Facility> };

const T = {
  en: {
    scope: "Catchment", kind: "Type", place: "Place", cf: "Compliant fields", nf: "Non-compliant fields", ca: "Compliant acres",
    na: "Non-compliant acres", cs: "Compliant % (area)", ns: "Non-compliant % (area)", nsf: "Non-compliant % (fields)", item: "Item",
    value: "Value", radius: "Radius (client buffer)", states: "States (soybean acres)", counties: "Top counties (acres)", rail: "Rail",
    river: "River", either: "Rail or river", band: "Within", toRail: "Facility to rail (mi)", toRiver: "Facility to river (mi)",
    overview: "All catchments", top: "Facilities by", combined: "Combined, each field once", soy8: "Fields in soybeans all 8 seasons",
    railRiver: "Soybean acres near rail and river", ncStates: "Non-compliant fields by state", covered: "share of acres in the 7 states with rail/river data",
  },
  id: {
    scope: "Catchment", kind: "Tipe", place: "Lokasi", cf: "Ladang comply", nf: "Ladang non-comply", ca: "Luas comply (acre)",
    na: "Luas non-comply (acre)", cs: "Comply % (luas)", ns: "Non-comply % (luas)", nsf: "Non-comply % (ladang)", item: "Butir",
    value: "Nilai", radius: "Radius (buffer klien)", states: "Negara bagian (acre kedelai)", counties: "County teratas (acre)", rail: "Rel",
    river: "Sungai", either: "Rel atau sungai", band: "Dalam", toRail: "Fasilitas ke rel (mi)", toRiver: "Fasilitas ke sungai (mi)",
    overview: "Semua catchment", top: "Fasilitas menurut", combined: "Gabungan, tiap ladang sekali", soy8: "Ladang kedelai 8 musim penuh",
    railRiver: "Luas kedelai dekat rel dan sungai", ncStates: "Ladang non-comply per negara bagian", covered: "porsi luas di 7 negara bagian yang punya data rel/sungai",
  },
} as const;

const OVERVIEW = ["all", "direct", "q40", "adm", "tp", "tpcore"] as const;

function facilitiesOf(data: SupplyData, c: SoySupplyCopy): Facility[] {
  const k = new Map(data.catchments.map((x) => [x.id, x]));
  const plantPlace = [data.plant.city, data.plant.state].filter(Boolean).join(", ");
  const out: Omit<Facility, "k">[] = [
    { id: "all", kind: "chain", name: c.scopeAll, place: plantPlace },
    { id: "direct", kind: "plant", name: `${data.plant.name} · ${c.scopeQ80}`, place: plantPlace },
    { id: "q40", kind: "plant", name: `${data.plant.name} · ${c.scopeQ40}`, place: plantPlace },
    { id: "adm", kind: "chain", name: c.scopeAdm, place: "" },
    { id: "tp", kind: "chain", name: c.scopeTp, place: "" },
    { id: "tpcore", kind: "chain", name: c.scopeTp56, place: "" },
    ...data.admElevators
      .filter((e) => e.radiusM)
      .map((e) => ({ id: e.id, kind: "adm" as const, name: e.name, place: [e.city, e.state].filter(Boolean).join(", ") })),
    ...data.thirdParty.map((t) => ({ id: t.id, kind: "tp" as const, name: t.company ?? t.id, place: [t.county, t.state].filter(Boolean).join(", ") })),
  ];
  return out.filter((f) => k.has(f.id)).map((f) => ({ ...f, k: k.get(f.id)! }));
}

function kindLabel(s: Soy, f: Facility) {
  return { chain: s.c.facChain, plant: s.c.kindPlant, adm: s.c.kindAdm, tp: s.c.kindTp }[f.kind];
}

/** A catchment by id ("q40", "adm3", "tp17", "direct"…) or by (part of) its name/place. */
function findFacilities(s: Soy, q: string): Facility[] {
  const raw = q.trim();
  if (s.byId.has(raw)) return [s.byId.get(raw)!];
  const n = norm(raw);
  if (!n) return [];
  if (/^(quincy )?0 ?40( nm)?$|^40( nm)?$/.test(n)) return [s.byId.get("q40")!];
  if (/^(quincy )?0 ?80( nm)?$|^80( nm)?$|^quincy$|^direct$|^langsung( ke quincy)?$/.test(n)) return [s.byId.get("direct")!];
  const exact = s.facilities.filter((f) => norm(f.name) === n);
  if (exact.length) return exact;
  return s.facilities.filter((f) => norm(`${f.name} ${f.place} ${f.id}`).includes(n));
}

const acres = (n: number) => Math.round(n);
// Non-compliant shares are tiny (0.007% around the plant): keep two significant
// digits below 1%, so a share never reads as 0% (or compliant as 100%).
const share = (part: number, whole: number) => {
  const p = pct(part, whole);
  return p > 0 && p < 1 ? Number(p.toPrecision(2)) : r1(p);
};
// Shares go to the model as text in the user's locale ("0,0074%"): models copy
// a string as is, but rounded the bare number 0.0074 to "0 %" in testing.
const pctText = (s: Soy, n: number) => `${n.toLocaleString(s.lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 4 })}%`;
const compliantShare = (nc: number) => (nc > 0 && nc < 1 ? Number((100 - nc).toFixed(3)) : r1(100 - nc));
const line = (s: Soy, f: Facility) => {
  const k = f.k;
  return [
    f.name, kindLabel(s, f), f.place || "—",
    k.compliant.fields, k.nonCompliant.fields, acres(k.compliant.acres), acres(k.nonCompliant.acres),
    compliantShare(share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres)), share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres),
  ];
};
const lineCols = (t: (typeof T)[Lang]) => [t.scope, t.kind, t.place, t.cf, t.nf, t.ca, t.na, t.cs, t.ns];
const brief = (s: Soy, f: Facility) => {
  const k = f.k;
  return {
    id: f.id, catchment: f.name, type: kindLabel(s, f), place: f.place,
    compliantFields: k.compliant.fields, nonCompliantFields: k.nonCompliant.fields,
    compliantAcres: acres(k.compliant.acres), nonCompliantAcres: acres(k.nonCompliant.acres),
    compliantShareByArea: pctText(s, compliantShare(share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres))),
    nonCompliantShareByArea: pctText(s, share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres)),
  };
};

const METRICS = {
  noncomply_share: (k: Catchment) => share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres),
  noncomply_fields: (k: Catchment) => k.nonCompliant.fields,
  noncomply_acres: (k: Catchment) => acres(k.nonCompliant.acres),
  compliant_fields: (k: Catchment) => k.compliant.fields,
  compliant_acres: (k: Catchment) => acres(k.compliant.acres),
} as const;
type Metric = keyof typeof METRICS;
const METRIC_LABEL: Record<Lang, Record<Metric, string>> = {
  en: { noncomply_share: "non-compliant % (area)", noncomply_fields: "non-compliant fields", noncomply_acres: "non-compliant acres", compliant_fields: "compliant fields", compliant_acres: "compliant acres" },
  id: { noncomply_share: "non-comply % (luas)", noncomply_fields: "ladang non-comply", noncomply_acres: "luas non-comply (acre)", compliant_fields: "ladang comply", compliant_acres: "luas comply (acre)" },
};

function radiusText(s: Soy, f: Facility): string {
  const d = s.data.delivered;
  const fmt = (x: { m: number; unit: string }) => (x.unit === "NM" ? `${Math.round(x.m / 1852)} NM` : `${Math.round(x.m / 1609.344)} mi (${Math.round(x.m / 1000)} km)`);
  if (f.id === "q40") return fmt(d.q40);
  if (f.id === "direct") return fmt(d.q80);
  if (f.kind === "adm" || f.id === "adm") return fmt(d.adm);
  if (f.kind === "tp" || f.id === "tp" || f.id === "tpcore") return fmt(d.tp);
  return "—";
}

const TOOLS: Record<string, { decl: object; run: (s: Soy, a: Record<string, unknown>) => ToolOut }> = {
  list_catchments: {
    decl: {
      name: "list_catchments",
      description: "Overview of the supply chain's main catchments (whole chain, direct to the plant 0–80 NM, 0–40 NM, all ADM elevators, all third parties, third parties in 6 states): compliant and non-compliant fields and acres, shares by area.",
      parameters: { type: "object", properties: {} },
    },
    run: (s) => {
      const t = T[s.lang];
      const list = OVERVIEW.map((id) => s.byId.get(id)).filter((f): f is Facility => !!f);
      return {
        result: { catchments: list.map((f) => brief(s, f)), note: "A field can be in several catchments; use combined_catchments for unions." },
        table: { title: t.overview, columns: lineCols(t), rows: list.map((f) => line(s, f)), millIds: list.map((f) => f.id) },
      };
    },
  },
  catchment_summary: {
    decl: {
      name: "catchment_summary",
      description: "Everything about one catchment: the plant's 0–40 / 0–80 NM catchment, one elevator (ADM or third party), or a tier (all, ADM elevators, third parties). Fields and acres compliant/non-compliant, shares, radius, states, top counties, seasons in soybeans, distance of the facility to rail and river.",
      parameters: { type: "object", properties: { catchment: { type: "string", description: "Catchment id (q40, direct, adm, tp, adm3, tp17…) or a facility name / place, e.g. Burlington, Bunge Decatur" } }, required: ["catchment"] },
    },
    run: (s, a) => {
      const t = T[s.lang];
      const hits = findFacilities(s, String(a.catchment ?? ""));
      if (!hits.length) return { result: { error: "catchment not found" } };
      if (hits.length > 1) return { result: { error: "several catchments match — ask which one", matches: hits.slice(0, 12).map((h) => ({ id: h.id, name: h.name, place: h.place, type: kindLabel(s, h) })) } };
      const f = hits[0]!;
      const k = f.k;
      const L = s.lang === "id";
      const all8 = k.compliant.soyYears.find((y) => y.years === 8)?.fields ?? 0;
      const adm = s.data.admElevators.find((e) => e.id === f.id);
      const tp = s.data.thirdParty.find((e) => e.id === f.id);
      const plant = f.id === "q40" || f.id === "direct" ? s.data.plant : null;
      const dist = adm ?? tp ?? plant;
      const rows: (string | number)[][] = [
        [t.kind, kindLabel(s, f)],
        [t.place, f.place || "—"],
        [t.radius, radiusText(s, f)],
        [t.cf, k.compliant.fields],
        [t.ca, acres(k.compliant.acres)],
        [L ? "Luas comply (ha)" : "Compliant hectares", acres(k.compliant.acres * AC_TO_HA)],
        [t.nf, k.nonCompliant.fields],
        [t.na, acres(k.nonCompliant.acres)],
        [t.cs, compliantShare(share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres))],
        [t.ns, share(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres)],
        [t.nsf, share(k.nonCompliant.fields, k.compliant.fields + k.nonCompliant.fields)],
        [t.soy8, all8],
        [t.states, k.compliant.states.slice(0, 4).map((x) => `${stateName(x.state)} ${acres(x.acres).toLocaleString(L ? "id-ID" : "en-US")}`).join(" · ") || "—"],
        [t.counties, k.compliant.topCounties.slice(0, 3).map((x) => `${x.county}, ${x.state} ${acres(x.acres).toLocaleString(L ? "id-ID" : "en-US")}`).join(" · ") || "—"],
      ];
      if (k.nonCompliant.byState.length) rows.push([t.ncStates, k.nonCompliant.byState.slice(0, 5).map((x) => `${x.state} ${x.fields}`).join(" · ")]);
      if (dist) rows.push([t.toRail, dist.railMi], [t.toRiver, dist.riverMi]);
      return {
        result: {
          ...brief(s, f), radius: radiusText(s, f), compliantHectares: acres(k.compliant.acres * AC_TO_HA),
          nonCompliantShareByFields: pctText(s, share(k.nonCompliant.fields, k.compliant.fields + k.nonCompliant.fields)),
          fieldsSoybeansAll8Seasons: all8, states: k.compliant.states.slice(0, 6), topCounties: k.compliant.topCounties.slice(0, 5),
          nonCompliantByState: k.nonCompliant.byState.slice(0, 8), facilityToRailMi: dist?.railMi ?? null, facilityToRiverMi: dist?.riverMi ?? null,
          source: s.data.source,
        },
        table: { title: `${t.scope}: ${f.name}`, columns: [t.item, t.value], rows, millIds: rows.map(() => f.id) },
      };
    },
  },
  rank_facilities: {
    decl: {
      name: "rank_facilities",
      description: "Rank the elevators (ADM's own, third parties, or both) by a metric. Use for 'which elevator has the most/least …', best/worst facilities.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: Object.keys(METRICS), description: "noncomply_share = non-compliant share of soybean area" },
          kind: { type: "string", enum: ["all", "adm", "tp"], description: "adm = ADM's own elevators, tp = third-party elevators (default all)" },
          order: { type: "string", enum: ["desc", "asc"], description: "desc = highest first (default)" },
          limit: { type: "integer", description: "How many (default 10, max 40)" },
        },
        required: ["metric"],
      },
    },
    run: (s, a) => {
      const t = T[s.lang];
      const metric = (String(a.metric) in METRICS ? String(a.metric) : "noncomply_share") as Metric;
      const kind = a.kind === "adm" || a.kind === "tp" ? a.kind : "all";
      const asc = a.order === "asc";
      const limit = Math.min(Math.max(Number(a.limit) || 10, 1), MAX_ROWS);
      const list = s.facilities
        .filter((f) => (kind === "all" ? f.kind === "adm" || f.kind === "tp" : f.kind === kind) && f.k.compliant.fields + f.k.nonCompliant.fields > 0)
        .map((f) => ({ f, v: METRICS[metric](f.k) }))
        .sort((p, q) => (asc ? p.v - q.v : q.v - p.v))
        .slice(0, limit);
      const label = METRIC_LABEL[s.lang][metric];
      return {
        result: { metric: label, kind, order: asc ? "asc" : "desc", facilities: list.map((x) => ({ ...brief(s, x.f), value: x.v })) },
        table: { title: `${t.top} ${label}`, columns: lineCols(t), rows: list.map((x) => line(s, x.f)), millIds: list.map((x) => x.f.id) },
      };
    },
  },
  combined_catchments: {
    decl: {
      name: "combined_catchments",
      description: "Totals for a union of catchments with every field counted once (a field can sit in several catchments). Ids: q40, q80 (plant 0–80 NM), adm (all ADM elevators), adm<n>, tp (all third parties), tpcore. E.g. the plant plus ADM elevators = ['q80','adm'].",
      parameters: { type: "object", properties: { catchments: { type: "array", items: { type: "string" } } }, required: ["catchments"] },
    },
    run: (s, a) => {
      const t = T[s.lang];
      const bits = s.data.combos?.bits ?? {};
      const asked = Array.isArray(a.catchments) ? (a.catchments as unknown[]).map(String) : [];
      const ids = new Set<string>();
      for (const x of asked) {
        const id = x === "direct" ? "q80" : x;
        if (id === "adm") Object.keys(bits).filter((b) => /^adm\d+$/.test(b)).forEach((b) => ids.add(b));
        else if (bits[id] != null) ids.add(id);
        else {
          const hit = findFacilities(s, x)[0];
          if (hit) ids.add(hit.id === "direct" ? "q80" : hit.id);
        }
      }
      const known = [...ids].filter((id) => bits[id] != null);
      const tot = comboTotals(s.data, known);
      if (!tot || !known.length) return { result: { error: "no matching catchments", allowed: Object.keys(bits) } };
      const names = known.map((id) => s.byId.get(id === "q80" ? "direct" : id)?.name ?? id);
      const nc = share(tot.ncAcres, tot.acres + tot.ncAcres);
      return {
        result: { catchments: names, compliantFields: tot.fields, nonCompliantFields: tot.ncFields, compliantAcres: acres(tot.acres), nonCompliantAcres: acres(tot.ncAcres), compliantShareByArea: pctText(s, compliantShare(nc)), nonCompliantShareByArea: pctText(s, nc) },
        table: {
          title: t.combined,
          columns: [t.item, t.value],
          rows: [
            [t.scope, names.length > 6 ? `${names.slice(0, 6).join(", ")} … (+${names.length - 6})` : names.join(", ")],
            [t.cf, tot.fields], [t.ca, acres(tot.acres)], [t.nf, tot.ncFields], [t.na, acres(tot.ncAcres)], [t.cs, compliantShare(nc)], [t.ns, nc],
          ],
        },
      };
    },
  },
  rail_river: {
    decl: {
      name: "rail_river",
      description: "How much of a catchment's compliant soybean area lies within 5, 10 and 20 statute miles (straight line) of active rail and of the major river system. Only fields in the 7 states with rail/river data count.",
      parameters: { type: "object", properties: { catchment: { type: "string", description: "Catchment id or facility name (default: whole chain)" } } },
    },
    run: (s, a) => {
      const t = T[s.lang];
      const f = a.catchment ? findFacilities(s, String(a.catchment))[0] : s.byId.get("all");
      if (!f) return { result: { error: "catchment not found" } };
      const k = f.k.compliant;
      const base = k.coverageAcres;
      const bands = s.data.bandsMi.map((b) => {
        const x = k.corridor[String(b)];
        return { miles: b, railPct: r1(pct(x?.rail ?? 0, base)), riverPct: r1(pct(x?.river ?? 0, base)), railOrRiverPct: r1(pct(x?.either ?? 0, base)) };
      });
      return {
        result: {
          catchment: f.name, basisAcres: acres(base), coveredShareOfCatchment: pctText(s, r1(pct(base, k.acres))), states: s.data.coverageStates,
          bands: bands.map((b) => ({ withinMiles: b.miles, rail: pctText(s, b.railPct), river: pctText(s, b.riverPct), railOrRiver: pctText(s, b.railOrRiverPct) })),
        },
        table: {
          title: `${t.railRiver} · ${f.name}`,
          columns: [t.band, `${t.rail} %`, `${t.river} %`, `${t.either} %`],
          rows: [...bands.map((b) => [`≤ ${b.miles} mi`, b.railPct, b.riverPct, b.railOrRiverPct]), [t.covered, "", "", r1(pct(base, k.acres))]],
        },
      };
    },
  },
  find_facility: {
    decl: {
      name: "find_facility",
      description: "Search elevators and catchments by (part of) a name, company, city, county or state.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    run: (s, a) => {
      const t = T[s.lang];
      const hits = findFacilities(s, String(a.query ?? "")).slice(0, MAX_ROWS);
      return {
        result: { matches: hits.map((h) => brief(s, h)) },
        table: { title: `${t.scope}: "${a.query}"`, columns: lineCols(t), rows: hits.map((h) => line(s, h)), millIds: hits.map((h) => h.id) },
      };
    },
  },
};

function systemPrompt(s: Soy, ctx: AssistantContext) {
  const d = s.data;
  const here = ctx.scope && s.byId.get(ctx.scope) ? `The user has selected the catchment "${s.byId.get(ctx.scope)!.name}" (id ${ctx.scope}).` : "The user is looking at the whole supply chain.";
  const elevators = s.facilities.filter((f) => f.kind === "adm").length;
  const tps = s.facilities.filter((f) => f.kind === "tp").length;
  return [
    `You are the data assistant inside SoyTrace, a dashboard of the soybean supply chain of ${d.plant.name} (crushing plant, ${d.plant.city}, ${d.plant.state}): the plant's own catchments (0–40 and 0–80 nautical miles), ${elevators} ADM elevator catchments (20 NM each) and ${tps} third-party elevator catchments (20 statute miles / 32 km each), with the 2025 soybean fields inside them (USDA Crop Sequence Boundaries). Each field is compliant or non-compliant according to the client's own classification; SoyTrace shows it and does not re-assess it.`,
    `Reply in ${s.lang === "id" ? "Indonesian (Bahasa Indonesia, plain and friendly)" : "English"}.`,
    "Answer ONLY from tool results. Never invent or estimate a number; if a tool does not have it, say the dashboard does not show it.",
    "The tool's table is shown to the user below your text, so do not repeat the table. Write 1–3 short sentences in plain text (no markdown, no bullet lists): the direct answer and the one or two numbers that matter.",
    "Answer only the user's latest message.",
    "Areas are in acres (hectares only if asked). Shares are by area unless the user asks about field counts. A field can sit in several catchments, so never add catchments up yourself: use combined_catchments.",
    "Use the dashboard's own words: in Indonesian \"ladang\", \"comply\" / \"non-comply\", \"catchment\", \"elevator\", \"pihak ketiga\", \"acre\"; in English \"field\", \"compliant\" / \"non-compliant\", \"catchment\", \"elevator\", \"third party\", \"acres\".",
    "Non-compliant shares are often tiny (e.g. 0.0074%): quote them exactly as the tool gives them, never as 0% or 100%.",
    "Deforestation figures and field owners are not shown in this dashboard: if asked, say exactly that (it is not off-topic), and offer the non-compliant figures instead.",
    "Questions unrelated to this dashboard's data: say briefly that you can only answer about the soybean supply-chain data shown here.",
    `Data: ${d.source}. ${here}`,
  ].join("\n");
}

export async function soyKit(tenant: Tenant, lang: Lang, ctx: AssistantContext): Promise<Kit> {
  const { loadSoySupply } = await import("@/lib/kanopi-data.server");
  const data = await loadSoySupply<SupplyData>(tenant);
  if (!data) throw Object.assign(new Error("supply.json not found"), { fatal: true });
  const c = soySupplyCopy[lang];
  const facilities = facilitiesOf(data, c);
  const s: Soy = { data, lang, c, facilities, byId: new Map(facilities.map((f) => [f.id, f])) };
  return {
    system: systemPrompt(s, ctx),
    decls: Object.values(TOOLS).map((x) => x.decl),
    has: (name) => !!TOOLS[name],
    run: (name, args) => (TOOLS[name] ? TOOLS[name]!.run(s, args) : { result: { error: `unknown tool ${name}` } }),
  };
}

