import { DATA_AS_OF } from "@/lib/data-meta";
import type { EudrSummary } from "@/lib/eudr-aggregates.server";
import type { DataScope } from "@/lib/gate";
import type { Tenant } from "@/lib/tenants";

/**
 * PalmTrace data assistant ("Tanya data"). The model never sees raw plot
 * files and never computes figures: it only picks one of the tools below,
 * each of which reads the same per-mill statistics the dashboard shows
 * (private-data/eudr-stats.json via eudr-aggregates.server.ts) and returns a
 * ready table. The model writes one or two sentences around it; the UI shows
 * the table itself, so a number on screen is always the dashboard's number.
 *
 * Everything is scoped to the signed-in session: the tenant comes from the
 * session (never from the request) and restricted roles see only their
 * groups/refineries, exactly like /eudr-summary.
 *
 * Models, in order (two providers, so one outage does not take the
 * assistant down):
 *  1. qwen on Groq's free tier (GROQ_API_KEY, OpenAI-style API) — about 1 s
 *     and accurate; when its small per-minute quota is used up it says so at
 *     once (429).
 *  2. Gemini Flash on Google AI Studio's free tier (GEMINI_API_KEY), trying
 *     the next Flash model when one is busy — slower (4–17 s), and a busy
 *     model can take 20 s to fail, but its answers are right.
 * gpt-oss (also on Groq) was tried as a third step and dropped (4 Oct): it
 * rounded 0.0074% to "0 %", quoted the wrong column and read total plots as
 * non-compliant ones. When both models are out, a ready-made question still
 * shows its table and a free question asks to try again — no wrong figures.
 */

// Free-tier Flash models; any of them can be "experiencing high demand" (503)
// for a while, so the chain is long and the last one that worked is
// remembered for a few minutes (per serverless instance).
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash"] as const;
const CALL_TIMEOUT_MS = 25_000;
// A busy Gemini model can take 20 s just to say 503, so each call gets 10 s
// and one question gets 20 s of Gemini in total.
const GEMINI_CALL_TIMEOUT_MS = 10_000;
const GEMINI_BUDGET_MS = 20_000;
const STICKY_MS = 5 * 60_000;
// Groq's quotas are per minute: once qwen is used up, questions skip it until
// the minute has passed.
const GROQ_REST_MS = 60_000;
let preferred = { index: 0, until: 0 };
let groqRestUntil = 0;
const API = "https://generativelanguage.googleapis.com/v1beta/models";

// Groq model: qwen got the numbers right in testing (4 Oct). Its free quota is
// small (7k tokens in, 1k out per minute), hence Gemini behind it.
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS = [{ id: "qwen/qwen3.8-27b", extra: { reasoning_effort: "none" } }] as const;
// On Groq the first step must call a tool (qwen once answered a data question
// from nothing, numbers made up); this one is the way out for greetings and
// off-topic messages.
const NO_DATA_TOOL = {
  name: "answer_without_data",
  description:
    "Call this only when the latest message is not a question about the supply-chain data (a greeting, thanks, or an unrelated topic). It returns nothing; then reply briefly without numbers.",
  parameters: { type: "object", properties: {} },
};
const MAX_STEPS = 4;
export const MAX_ROWS = 40;

export type Lang = "en" | "id";
export type AssistantTable = { title: string; columns: string[]; rows: (string | number)[][]; millIds?: (string | null)[] };
export type AssistantContext = { group?: string | null; millId?: string | null; scope?: string | null };
export type AssistantTurn = { role: "user" | "assistant"; text: string };
export type AssistantReply = { text: string; tables: AssistantTable[]; model: string | null; error?: string };

type MillRow = {
  id: string;
  group?: string;
  refinery?: string;
  millName?: string;
  umlId?: string;
  port?: string;
  traceability?: string;
  groupName?: string;
  parentCompany?: string;
};

type Data = { mills: MillRow[]; stats: Record<string, EudrSummary>; lang: Lang };

// --------------------------------------------------------------------- data
async function loadData(tenant: Tenant, scope: DataScope | null, lang: Lang): Promise<Data> {
  const [{ loadMills }, { millStatsFor }, { millInScope }] = await Promise.all([
    import("@/lib/kanopi-data.server"),
    import("@/lib/eudr-aggregates.server"),
    import("@/lib/gate"),
  ]);
  const all = (await loadMills(tenant)) as MillRow[];
  const mills = scope ? all.filter((m) => millInScope(m, scope)) : all;
  return { mills, stats: await millStatsFor(tenant), lang };
}

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const norm = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : 0);
const defoHa = (s: EudrSummary) => Object.values(s.deforestationByYear).reduce((a, b) => a + b, 0);

function sum(list: EudrSummary[]): EudrSummary & { mills: number } {
  const out = {
    mills: list.length,
    totalPlots: 0,
    totalAreaHa: 0,
    comply: { yes: 0, no: 0 },
    risk: { low: 0, medium: 0, high: 0 },
    mitigation: Object.fromEntries(LETTERS.map((l) => [l, { count: 0, areaHa: 0 }])) as EudrSummary["mitigation"],
    deforestationByYear: {} as Record<string, number>,
    forestOverlap: { HL: 0, HP: 0, HPK: 0, HPT: 0 },
    plotType: {} as EudrSummary["plotType"],
  };
  for (const s of list) {
    out.totalPlots += s.totalPlots;
    out.totalAreaHa += s.totalAreaHa;
    out.comply.yes += s.comply.yes;
    out.comply.no += s.comply.no;
    out.risk.low += s.risk.low;
    out.risk.medium += s.risk.medium;
    out.risk.high += s.risk.high;
    for (const l of LETTERS) {
      out.mitigation[l].count += s.mitigation[l]?.count ?? 0;
      out.mitigation[l].areaHa += s.mitigation[l]?.areaHa ?? 0;
    }
    for (const [y, v] of Object.entries(s.deforestationByYear)) out.deforestationByYear[y] = (out.deforestationByYear[y] ?? 0) + v;
  }
  return out;
}

function groupsOf(d: Data) {
  const m = new Map<string, MillRow[]>();
  for (const x of d.mills) if (x.group) m.set(x.group, [...(m.get(x.group) ?? []), x]);
  return m;
}

function findGroup(d: Data, q: string | undefined): string | null {
  if (!q) return null;
  const groups = [...groupsOf(d).keys()];
  const n = norm(q);
  return groups.find((g) => norm(g) === n) ?? groups.find((g) => norm(g).includes(n) || n.includes(norm(g))) ?? null;
}

function findMills(d: Data, q: string, group?: string | null): MillRow[] {
  const n = norm(q);
  const pool = group ? d.mills.filter((m) => m.group === group) : d.mills;
  const exact = pool.filter((m) => m.id === q || norm(m.umlId ?? "") === n || norm(m.millName ?? "") === n);
  if (exact.length) return exact;
  return pool.filter((m) => norm(`${m.millName} ${m.umlId} ${m.parentCompany ?? ""}`).includes(n));
}

const T = {
  en: {
    group: "Group", mill: "Mill", refinery: "Refinery", mills: "Mills", withData: "With data", plots: "Plots", area: "Area (ha)",
    compliant: "Compliant %", nc: "Non-compliant plots", ncShare: "Non-compliant %", classF: "Class F", value: "Value", item: "Item",
    groups: "All groups", millsIn: "Mills in", top: "Top mills by", in: "in", detail: "Mill", noData: "no plot data yet",
  },
  id: {
    group: "Grup", mill: "PKS", refinery: "Refinery/KCP", mills: "PKS", withData: "Punya data", plots: "Plot", area: "Luas (ha)",
    compliant: "Patuh %", nc: "Plot tidak patuh", ncShare: "Tidak patuh %", classF: "Kelas F", value: "Nilai", item: "Butir",
    groups: "Semua grup", millsIn: "PKS di", top: "PKS teratas menurut", in: "di", detail: "PKS", noData: "belum ada data plot",
  },
} as const;

const METRICS = {
  noncomply_share: { en: "non-compliant share (%)", id: "porsi tidak patuh (%)", f: (s: EudrSummary) => pct(s.comply.no, s.totalPlots) },
  noncomply_plots: { en: "non-compliant plots", id: "plot tidak patuh", f: (s: EudrSummary) => s.comply.no },
  class_C: { en: "class C plots", id: "plot kelas C", f: (s: EudrSummary) => s.mitigation.C.count },
  class_D: { en: "class D plots", id: "plot kelas D", f: (s: EudrSummary) => s.mitigation.D.count },
  class_E: { en: "class E plots", id: "plot kelas E", f: (s: EudrSummary) => s.mitigation.E.count },
  class_F: { en: "class F plots", id: "plot kelas F", f: (s: EudrSummary) => s.mitigation.F.count },
  high_risk_plots: { en: "plots in high-risk villages", id: "plot di desa risiko tinggi", f: (s: EudrSummary) => s.risk.high },
  deforestation_ha: { en: "deforestation after 2020 (ha)", id: "deforestasi setelah 2020 (ha)", f: (s: EudrSummary) => r1(defoHa(s)) },
  plots: { en: "plots", id: "jumlah plot", f: (s: EudrSummary) => s.totalPlots },
  area_ha: { en: "area (ha)", id: "luas (ha)", f: (s: EudrSummary) => Math.round(s.totalAreaHa) },
} as const;
type Metric = keyof typeof METRICS;

// -------------------------------------------------------------------- tools
export type ToolOut = { result: unknown; table?: AssistantTable };

/** What one product gives the model: its instructions and its tools. */
export type Kit = {
  system: string;
  decls: object[];
  has: (name: string) => boolean;
  run: (name: string, args: Record<string, unknown>) => ToolOut;
};

const TOOLS: Record<string, { decl: object; run: (d: Data, a: Record<string, unknown>) => ToolOut }> = {
  list_groups: {
    decl: {
      name: "list_groups",
      description: "Overview of every supply-chain group the user can see: mills, plots, area, compliant share, non-compliant plots, class F plots.",
      parameters: { type: "object", properties: {} },
    },
    run: (d) => {
      const t = T[d.lang];
      const rows = [...groupsOf(d)].map(([g, ms]) => {
        const st = ms.map((m) => d.stats[m.id]).filter(Boolean);
        const s = sum(st);
        return [g, ms.length, st.length, s.totalPlots, Math.round(s.totalAreaHa), pct(s.comply.yes, s.totalPlots), s.comply.no, s.mitigation.F.count];
      });
      rows.sort((a, b) => Number(b[3]) - Number(a[3]));
      return {
        result: { groups: rows.map((r) => ({ group: r[0], mills: r[1], millsWithData: r[2], plots: r[3], areaHa: r[4], compliantPct: r[5], nonCompliantPlots: r[6], classF: r[7] })) },
        table: { title: t.groups, columns: [t.group, t.mills, t.withData, t.plots, t.area, t.compliant, t.nc, t.classF], rows },
      };
    },
  },
  group_summary: {
    decl: {
      name: "group_summary",
      description: "One group's totals and its mills (plots, area, compliant share, non-compliant plots, A–F classes). Use for 'this group', a named group, or comparing mills inside a group.",
      parameters: { type: "object", properties: { group: { type: "string", description: "Group name, e.g. SUNRISE, NAM & LTS, Permata" } }, required: ["group"] },
    },
    run: (d, a) => {
      const t = T[d.lang];
      const g = findGroup(d, String(a.group ?? ""));
      if (!g) return { result: { error: "group not found", groups: [...groupsOf(d).keys()] } };
      const ms = groupsOf(d).get(g)!;
      const withStats = ms.filter((m) => d.stats[m.id]);
      const s = sum(withStats.map((m) => d.stats[m.id]!));
      const rows = withStats
        .map((m) => {
          const x = d.stats[m.id]!;
          return { m, r: [m.millName ?? m.id, m.refinery ?? "", x.totalPlots, Math.round(x.totalAreaHa), pct(x.comply.yes, x.totalPlots), x.comply.no, ...LETTERS.map((l) => x.mitigation[l].count)] };
        })
        .sort((p, q) => Number(q.r[2]) - Number(p.r[2]));
      return {
        result: {
          group: g, mills: ms.length, millsWithData: withStats.length, plots: s.totalPlots, areaHa: Math.round(s.totalAreaHa),
          compliantPct: pct(s.comply.yes, s.totalPlots), nonCompliantPlots: s.comply.no,
          classes: Object.fromEntries(LETTERS.map((l) => [l, s.mitigation[l].count])),
          riskPlots: s.risk, deforestationHaAfter2020: r1(defoHa(s)), dataAsOf: DATA_AS_OF,
          perMill: rows.slice(0, MAX_ROWS).map(({ r }) => ({ mill: r[0], plots: r[2], compliantPct: r[4], nonCompliantPlots: r[5] })),
        },
        table: {
          title: `${t.millsIn} ${g}`,
          columns: [t.mill, t.refinery, t.plots, t.area, t.compliant, t.nc, ...LETTERS],
          rows: rows.slice(0, MAX_ROWS).map((x) => x.r),
          millIds: rows.slice(0, MAX_ROWS).map((x) => x.m.id),
        },
      };
    },
  },
  rank_mills: {
    decl: {
      name: "rank_mills",
      description: "Rank mills by a metric, across all groups or inside one group. Use for 'which mill has the most/least …', best/worst mills.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: Object.keys(METRICS) },
          group: { type: "string", description: "Optional group name to limit the ranking" },
          order: { type: "string", enum: ["desc", "asc"], description: "desc = highest first (default)" },
          limit: { type: "integer", description: "How many mills (default 10, max 40)" },
        },
        required: ["metric"],
      },
    },
    run: (d, a) => {
      const t = T[d.lang];
      const metric = (String(a.metric) in METRICS ? String(a.metric) : "noncomply_share") as Metric;
      const g = a.group ? findGroup(d, String(a.group)) : null;
      if (a.group && !g) return { result: { error: "group not found", groups: [...groupsOf(d).keys()] } };
      const limit = Math.min(Math.max(Number(a.limit) || 10, 1), MAX_ROWS);
      const asc = a.order === "asc";
      const M = METRICS[metric];
      const list = d.mills
        .filter((m) => (!g || m.group === g) && d.stats[m.id] && d.stats[m.id]!.totalPlots > 0)
        .map((m) => ({ m, v: M.f(d.stats[m.id]!), s: d.stats[m.id]! }))
        .sort((p, q) => (asc ? p.v - q.v : q.v - p.v))
        .slice(0, limit);
      return {
        result: { metric: M[d.lang], group: g, order: asc ? "asc" : "desc", mills: list.map((x) => ({ mill: x.m.millName, group: x.m.group, value: x.v, plots: x.s.totalPlots })) },
        table: {
          title: `${t.top} ${M[d.lang]}${g ? ` ${t.in} ${g}` : ""}`,
          columns: [t.mill, t.group, M[d.lang], t.plots, t.compliant],
          rows: list.map((x) => [x.m.millName ?? x.m.id, x.m.group ?? "", x.v, x.s.totalPlots, pct(x.s.comply.yes, x.s.totalPlots)]),
          millIds: list.map((x) => x.m.id),
        },
      };
    },
  },
  mill_detail: {
    decl: {
      name: "mill_detail",
      description: "Everything about one mill: identity (group, refinery, UML ID, port, traceability) and its plot statistics (A–F classes with area, risk tiers, deforestation by year, forest-estate overlap, plot types).",
      parameters: {
        type: "object",
        properties: { mill: { type: "string", description: "Mill name, UML ID or id" }, group: { type: "string", description: "Optional group to disambiguate" } },
        required: ["mill"],
      },
    },
    run: (d, a) => {
      const t = T[d.lang];
      const g = a.group ? findGroup(d, String(a.group)) : null;
      const hits = findMills(d, String(a.mill ?? ""), g);
      if (!hits.length) return { result: { error: "mill not found" } };
      if (hits.length > 1 && !hits.every((h) => h.umlId === hits[0]!.umlId))
        return { result: { error: "several mills match — ask which one", matches: hits.slice(0, 12).map((h) => ({ mill: h.millName, group: h.group, umlId: h.umlId })) } };
      const m = hits[0]!;
      const s = d.stats[m.id];
      const L = d.lang === "id";
      const rows: (string | number)[][] = [
        [t.group, m.group ?? "—"], [t.refinery, m.refinery ?? "—"], ["UML ID", m.umlId ?? "—"],
        [L ? "Pelabuhan" : "Port", m.port ?? "—"], [L ? "Ketertelusuran" : "Traceability", m.traceability ?? "—"],
      ];
      if (s) {
        rows.push(
          [t.plots, s.totalPlots], [t.area, Math.round(s.totalAreaHa)], [t.compliant, pct(s.comply.yes, s.totalPlots)], [t.nc, s.comply.no],
          ...LETTERS.map((l) => [`${L ? "Kelas" : "Class"} ${l}`, `${s.mitigation[l].count} · ${Math.round(s.mitigation[l].areaHa)} ha`]),
          [L ? "Plot desa risiko rendah/sedang/tinggi" : "Plots in low/medium/high-risk villages", `${s.risk.low} / ${s.risk.medium} / ${s.risk.high}`],
          [L ? "Deforestasi setelah 2020 (ha)" : "Deforestation after 2020 (ha)", r1(defoHa(s))],
        );
      } else rows.push([t.plots, t.noData]);
      return {
        result: { mill: m.millName, group: m.group, refinery: m.refinery, umlId: m.umlId, port: m.port, traceability: m.traceability, stats: s ?? null, dataAsOf: DATA_AS_OF },
        table: { title: `${t.detail} ${m.millName ?? m.id}`, columns: [t.item, t.value], rows, millIds: rows.map(() => m.id) },
      };
    },
  },
  find_mill: {
    decl: {
      name: "find_mill",
      description: "Search mills by (part of) a name or UML ID. Use when the user names a mill you are not sure about.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    run: (d, a) => {
      const t = T[d.lang];
      const hits = findMills(d, String(a.query ?? "")).slice(0, MAX_ROWS);
      return {
        result: { matches: hits.map((h) => ({ mill: h.millName, group: h.group, refinery: h.refinery, umlId: h.umlId, hasData: !!d.stats[h.id] })) },
        table: { title: `${t.mill}: "${a.query}"`, columns: [t.mill, t.group, t.refinery, "UML ID", t.plots], rows: hits.map((h) => [h.millName ?? h.id, h.group ?? "", h.refinery ?? "", h.umlId ?? "", d.stats[h.id]?.totalPlots ?? "—"]), millIds: hits.map((h) => h.id) },
      };
    },
  },
};

export const PRESET_TOOLS = Object.keys(TOOLS);

// --------------------------------------------------------------------- model
function palmKit(d: Data, ctx: AssistantContext): Kit {
  return {
    system: systemPrompt(d, ctx),
    decls: Object.values(TOOLS).map((x) => x.decl),
    has: (name) => !!TOOLS[name],
    run: (name, args) => (TOOLS[name] ? TOOLS[name]!.run(d, args) : { result: { error: `unknown tool ${name}` } }),
  };
}

function systemPrompt(d: Data, ctx: AssistantContext) {
  const groups = [...groupsOf(d).keys()].join(", ");
  const here = ctx.millId
    ? `The user is looking at mill "${d.mills.find((m) => m.id === ctx.millId)?.millName ?? ctx.millId}" in group "${ctx.group ?? "?"}".`
    : ctx.group
      ? `The user is looking at group "${ctx.group}".`
      : "The user is on the portfolio overview (all groups).";
  return [
    "You are the data assistant inside PalmTrace, an EUDR due-diligence dashboard for palm-oil supply chains (mills, plots, compliant/non-compliant plots, village risk, mitigation classes A–F).",
    `Reply in ${d.lang === "id" ? "Indonesian (Bahasa Indonesia, plain and friendly)" : "English"}.`,
    "Answer ONLY from tool results. Never invent or estimate a number; if a tool does not have it, say the dashboard does not show it.",
    "The tool's table is shown to the user below your text, so do not repeat the table. Write 1–3 short sentences in plain text (no markdown, no bullet lists): the direct answer and the one or two numbers that matter.",
    "Answer only the user's latest message.",
    "Use the dashboard's own words: in Indonesian say \"plot\" (never \"persil\"), \"PKS\", \"patuh\" / \"tidak patuh\", \"kelas A–F\"; in English \"plot\", \"mill\", \"compliant\" / \"non-compliant\".",
    "A–F: A compliant/low-risk village, B compliant/medium, C compliant/high (enhanced checks), D non-compliant/low (likely mapping error, pending review), E non-compliant/medium (corrective plan), F non-compliant/high (excluded).",
    "Questions unrelated to this dashboard's data: say briefly that you can only answer about the supply-chain data shown here.",
    `Data as of ${DATA_AS_OF}. ${here} Groups available: ${groups}.`,
  ].join("\n");
}

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string };
type Content = { role: "user" | "model"; parts: Record<string, unknown>[] };

async function callGemini(model: string, kit: Kit, contents: Content[], withTools: boolean, timeoutMs: number) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set"), { fatal: true });
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: kit.system }] },
      contents,
      ...(withTools ? { tools: [{ functionDeclarations: kit.decls }] } : {}),
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`gemini ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const j = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  return (j.candidates?.[0]?.content?.parts ?? []) as Part[];
}

const retryable = (e: unknown) => {
  const status = (e as { status?: number }).status ?? 0;
  const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
  return timedOut || status === 429 || status >= 500 || status === 404;
};

/** One Gemini turn, trying the next model on busy / rate-limited / timed-out models, within the question's budget. */
async function turn(state: { model: number }, kit: Kit, contents: Content[], withTools: boolean, deadline: number) {
  let last: unknown = new Error("gemini: time budget used up");
  const order = MODELS.map((_, i) => (state.model + i) % MODELS.length);
  for (const i of order) {
    const left = deadline - Date.now();
    if (left < 2_000) break;
    try {
      const parts = await callGemini(MODELS[i]!, kit, contents, withTools, Math.min(GEMINI_CALL_TIMEOUT_MS, left));
      state.model = i;
      preferred = { index: i, until: Date.now() + STICKY_MS };
      return parts;
    } catch (e) {
      last = e;
      console.warn(`[assistant] ${MODELS[i]} failed: ${(e as Error).message}`);
      if ((e as { fatal?: boolean }).fatal || !retryable(e)) break;
    }
  }
  throw last;
}

type GroqCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type GroqMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GroqCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolChoice = "none" | "auto" | "required";

/** Groq checks tool arguments against the schema, and a model may send null
 * for an optional argument it leaves out: let optional arguments be null. */
function nullableOptionals(decl: object): object {
  const d = decl as { parameters?: { properties?: Record<string, { type?: unknown; enum?: unknown[] }>; required?: string[] } };
  const props = d.parameters?.properties;
  if (!props) return decl;
  const required = new Set(d.parameters?.required ?? []);
  const next = Object.fromEntries(
    Object.entries(props).map(([k, v]) => [
      k,
      required.has(k) || typeof v.type !== "string" ? v : { ...v, type: [v.type, "null"], ...(v.enum ? { enum: [...v.enum, null] } : {}) },
    ]),
  );
  return { ...decl, parameters: { ...d.parameters, properties: next } };
}

async function callGroq(model: (typeof GROQ_MODELS)[number], kit: Kit, messages: GroqMsg[], tools: ToolChoice) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw Object.assign(new Error("GROQ_API_KEY is not set"), { fatal: true });
  const res = await fetch(GROQ_API, {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model.id,
      messages,
      ...(tools !== "none"
        ? { tools: [...kit.decls, NO_DATA_TOOL].map((decl) => ({ type: "function", function: nullableOptionals(decl) })), tool_choice: tools }
        : {}),
      temperature: 0.2,
      max_completion_tokens: 1024,
      ...model.extra,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`groq ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: GroqCall[] } }[] };
  return j.choices?.[0]?.message ?? {};
}

/** One Groq turn, trying the next Groq model (if any) on a busy or rejected call. */
async function groqTurn(state: { model: number }, kit: Kit, messages: GroqMsg[], tools: ToolChoice) {
  let last: unknown;
  for (let i = state.model; i < GROQ_MODELS.length; i++) {
    try {
      const msg = await callGroq(GROQ_MODELS[i]!, kit, messages, tools);
      state.model = i;
      return msg;
    } catch (e) {
      last = e;
      console.warn(`[assistant] groq ${GROQ_MODELS[i]!.id} failed: ${(e as Error).message}`);
      if ((e as { fatal?: boolean }).fatal || !(retryable(e) || (e as { status?: number }).status === 400)) break;
    }
  }
  throw last;
}

function runTool(kit: Kit, name: string, args: Record<string, unknown>, tables: AssistantTable[]) {
  if (name === NO_DATA_TOOL.name) return { ok: true };
  const out = kit.run(name, args);
  if (out.table) tables.push(out.table);
  return out.result;
}

const parseArgs = (s: string) => {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

type Ask = {
  tenant: Tenant;
  scope: DataScope | null;
  lang: Lang;
  message: string;
  history: AssistantTurn[];
  context: AssistantContext;
  preset?: { tool: string; args: Record<string, unknown> } | null;
};

const presetPrompt = (opts: Ask, result: unknown) => `${opts.message}\n\n[Tool ${opts.preset!.tool} result]\n${JSON.stringify(result).slice(0, 12000)}`;

async function viaGemini(kit: Kit, opts: Ask, tables: AssistantTable[], presetResult: unknown): Promise<AssistantReply> {
  const deadline = Date.now() + GEMINI_BUDGET_MS;
  const state = { model: Date.now() < preferred.until ? preferred.index : 0 };
  const contents: Content[] = opts.history.slice(-8).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text.slice(0, 2000) }] }));

  // A ready-made question: its tool already ran, the model only words the answer.
  if (presetResult !== undefined) {
    contents.push({ role: "user", parts: [{ text: presetPrompt(opts, presetResult) }] });
    const parts = await turn(state, kit, contents, false, deadline);
    return { text: parts.map((p) => p.text ?? "").join("").trim(), tables, model: MODELS[state.model]! };
  }

  contents.push({ role: "user", parts: [{ text: opts.message.slice(0, 2000) }] });
  for (let step = 0; step < MAX_STEPS; step++) {
    const parts = await turn(state, kit, contents, step < MAX_STEPS - 1, deadline);
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return { text: parts.map((p) => p.text ?? "").join("").trim(), tables, model: MODELS[state.model]! };
    // Echo the model's parts unchanged (Gemini 3 needs its thought signatures back).
    contents.push({ role: "model", parts: parts as Record<string, unknown>[] });
    const responses = calls.map((p) => {
      const fc = p.functionCall!;
      const result = runTool(kit, fc.name, fc.args ?? {}, tables);
      return { functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { result } } };
    });
    contents.push({ role: "user", parts: responses });
  }
  return { text: "", tables, model: MODELS[state.model]! };
}

async function viaGroq(kit: Kit, opts: Ask, tables: AssistantTable[], presetResult: unknown): Promise<AssistantReply> {
  const state = { model: 0 };
  const messages: GroqMsg[] = [
    { role: "system", content: kit.system },
    ...opts.history.slice(-8).map((h): GroqMsg => (h.role === "user" ? { role: "user", content: h.text.slice(0, 2000) } : { role: "assistant", content: h.text.slice(0, 2000) })),
  ];
  const name = () => `groq:${GROQ_MODELS[state.model]!.id}`;

  if (presetResult !== undefined) {
    messages.push({ role: "user", content: presetPrompt(opts, presetResult) });
    const msg = await groqTurn(state, kit, messages, "none");
    return { text: (msg.content ?? "").trim(), tables, model: name() };
  }

  messages.push({ role: "user", content: opts.message.slice(0, 2000) });
  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await groqTurn(state, kit, messages, step === 0 ? "required" : step < MAX_STEPS - 1 ? "auto" : "none");
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { text: (msg.content ?? "").trim(), tables, model: name() };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      const result = runTool(kit, c.function.name, parseArgs(c.function.arguments), tables);
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  return { text: "", tables, model: name() };
}

export async function askAssistant(opts: Ask): Promise<AssistantReply> {
  const { isSoyTenant } = await import("@/lib/tenants");
  const kit = isSoyTenant(opts.tenant)
    ? await (await import("@/lib/assistant-soy.server")).soyKit(opts.tenant, opts.lang, opts.context)
    : palmKit(await loadData(opts.tenant, opts.scope, opts.lang), opts.context);
  const presetTables: AssistantTable[] = [];
  const presetResult = opts.preset && kit.has(opts.preset.tool) ? runTool(kit, opts.preset.tool, opts.preset.args ?? {}, presetTables) : undefined;
  // Test hook (dev only): ASSISTANT_ONLY=groq|gemini uses just that provider.
  const only = process.env.NODE_ENV !== "production" ? process.env.ASSISTANT_ONLY : undefined;
  const useGroq = !!process.env.GROQ_API_KEY && only !== "gemini";
  const useGemini = only !== "groq";
  let error: unknown = null;

  // A model that ends without a sentence (it kept calling tools) still hands
  // back its tables; the panel then says the tables are the dashboard's.
  const worded = (r: AssistantReply): AssistantReply => (r.text ? r : { ...r, error: "no-text" });

  // Each step starts over: tables from a half-finished earlier run are dropped.
  if (useGroq && (!useGemini || Date.now() >= groqRestUntil)) {
    try {
      return worded(await viaGroq(kit, opts, [...presetTables], presetResult));
    } catch (e) {
      error = e;
      if (useGemini) groqRestUntil = Date.now() + GROQ_REST_MS;
    }
  }
  if (useGemini) {
    try {
      return worded(await viaGemini(kit, opts, [...presetTables], presetResult));
    } catch (e) {
      error = e;
    }
  }
  // Nobody could word it; a ready-made question still shows its table.
  return { text: "", tables: presetTables, model: null, error: String((error as Error)?.message ?? error) };
}
