import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Lang } from "@/lib/copy";

/**
 * "Tanya data" — PalmTrace's data assistant. A launcher at the bottom right
 * opens a panel with ready-made questions for the page the user is on
 * (portfolio, a group, a mill) and a free-text box. Answers come from
 * /assistant: a sentence from the model plus tables built from the
 * dashboard's own statistics (assistant.server.ts). A table row naming a
 * mill opens that mill.
 */

type Table = { title: string; columns: string[]; rows: (string | number)[][]; millIds?: (string | null)[] };
type Msg = { role: "user" | "assistant"; text: string; tables?: Table[]; error?: string | null };
type Preset = { label: string; tool: string; args: Record<string, unknown> };

const COPY = {
  en: {
    open: "Ask the data",
    title: "Ask the data",
    sub: "Answers from this dashboard's figures only.",
    place: "Ask about groups, mills, compliance, A–F…",
    send: "Ask",
    close: "Close",
    clear: "New chat",
    thinking: "Looking it up…",
    busy: "The assistant is busy right now — the table below comes straight from the dashboard.",
    failed: "The assistant could not answer just now. Please try again in a minute.",
    limit: "Daily question limit reached. Try again tomorrow.",
    openMill: "Open mill",
    suggestions: "Try asking",
    beta: "Beta · free AI model, may make mistakes in wording; numbers in tables are the dashboard's.",
    p: {
      groups: "Summary of all groups",
      worstAll: "Mills with the highest non-compliant share",
      fAll: "Mills with the most class F plots",
      defoAll: "Largest deforestation after 2020",
      group: "Summary of this group",
      worstGroup: "Highest non-compliant share in this group",
      bestGroup: "Cleanest mills in this group",
      fGroup: "Class F plots per mill in this group",
      mill: "Summary of this mill",
    },
  },
  id: {
    open: "Tanya data",
    title: "Tanya data",
    sub: "Jawaban hanya dari angka di dashboard ini.",
    place: "Tanya soal grup, PKS, kepatuhan, kelas A–F…",
    send: "Tanya",
    close: "Tutup",
    clear: "Obrolan baru",
    thinking: "Sedang mencari…",
    busy: "Asisten sedang sibuk — tabel di bawah langsung dari dashboard.",
    failed: "Asisten belum bisa menjawab. Coba lagi sebentar lagi.",
    limit: "Batas pertanyaan hari ini sudah tercapai. Coba lagi besok.",
    openMill: "Buka PKS",
    suggestions: "Coba tanyakan",
    beta: "Beta · model AI gratis, kalimatnya bisa keliru; angka di tabel adalah angka dashboard.",
    p: {
      groups: "Ringkasan semua grup",
      worstAll: "PKS dengan porsi tidak patuh tertinggi",
      fAll: "PKS dengan plot kelas F terbanyak",
      defoAll: "Deforestasi setelah 2020 terbesar",
      group: "Ringkasan grup ini",
      worstGroup: "Porsi tidak patuh tertinggi di grup ini",
      bestGroup: "PKS paling bersih di grup ini",
      fGroup: "Plot kelas F per PKS di grup ini",
      mill: "Ringkasan PKS ini",
    },
  },
} as const;

function presetsFor(c: (typeof COPY)[Lang], group: string | null, millId: string | null): Preset[] {
  const p = c.p;
  if (millId)
    return [
      { label: p.mill, tool: "mill_detail", args: { mill: millId } },
      ...(group ? [{ label: p.group, tool: "group_summary", args: { group } }] : []),
      ...(group ? [{ label: p.worstGroup, tool: "rank_mills", args: { metric: "noncomply_share", group } }] : []),
    ];
  if (group)
    return [
      { label: p.group, tool: "group_summary", args: { group } },
      { label: p.worstGroup, tool: "rank_mills", args: { metric: "noncomply_share", group } },
      { label: p.bestGroup, tool: "rank_mills", args: { metric: "noncomply_share", group, order: "asc" } },
      { label: p.fGroup, tool: "rank_mills", args: { metric: "class_F", group } },
    ];
  return [
    { label: p.groups, tool: "list_groups", args: {} },
    { label: p.worstAll, tool: "rank_mills", args: { metric: "noncomply_share" } },
    { label: p.fAll, tool: "rank_mills", args: { metric: "class_F" } },
    { label: p.defoAll, tool: "rank_mills", args: { metric: "deforestation_ha" } },
  ];
}

/** The model sometimes still writes **bold**: show it as bold, never as asterisks. */
function bold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part));
}

function cell(v: string | number, lang: Lang) {
  return typeof v === "number" ? v.toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }) : v;
}

export function DataAssistant({
  lang,
  group,
  millId,
  onOpenMill,
}: {
  lang: Lang;
  group: string | null;
  millId: string | null;
  onOpenMill: (millId: string) => void;
}) {
  const c = COPY[lang];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask(question: string, preset?: Preset) {
    const q = question.trim();
    if (!q || busy) return;
    // Only answered exchanges go back as history, so a failed turn's question is not answered later.
    const history: { role: "user" | "assistant"; text: string }[] = [];
    msgs.forEach((m, i) => {
      const next = msgs[i + 1];
      if (m.role === "user" && next?.role === "assistant" && next.text) history.push({ role: "user", text: m.text }, { role: "assistant", text: next.text });
    });
    setMsgs((xs) => [...xs, { role: "user", text: q }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, history, lang, context: { group, millId }, preset: preset ? { tool: preset.tool, args: preset.args } : null }),
      });
      const body = (await res.json().catch(() => null)) as { text?: string; tables?: Table[]; error?: string } | null;
      setMsgs((xs) => [
        ...xs,
        { role: "assistant", text: body?.text ?? "", tables: body?.tables ?? [], error: res.status === 429 ? "limit" : body?.error ?? (res.ok ? null : "failed") },
      ]);
    } catch {
      setMsgs((xs) => [...xs, { role: "assistant", text: "", tables: [], error: "failed" }]);
    } finally {
      setBusy(false);
    }
  }

  // Opening a mill closes the panel so it does not cover the mill; the chat stays.
  function openMill(id: string) {
    setOpen(false);
    onOpenMill(id);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(text);
  }

  const presets = presetsFor(c, group, millId);

  if (!open)
    return (
      <button type="button" className="assistant-launch" onClick={() => setOpen(true)} aria-label={c.open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4V5z" strokeLinejoin="round" />
          <path d="M8 10h8M8 13h5" strokeLinecap="round" />
        </svg>
        {c.open}
      </button>
    );

  return (
    <section className="assistant-panel" role="dialog" aria-label={c.title}>
      <header className="assistant-head">
        <div>
          <h2>{c.title}</h2>
          <p>{c.sub}</p>
        </div>
        <div className="assistant-head-actions">
          {msgs.length ? (
            <button type="button" className="btn-text" onClick={() => setMsgs([])}>
              {c.clear}
            </button>
          ) : null}
          <button type="button" className="assistant-x" aria-label={c.close} onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
      </header>

      <div className="assistant-body">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="assistant-q">
              {m.text}
            </p>
          ) : (
            <div key={i} className="assistant-a">
              {m.text ? <p>{bold(m.text)}</p> : null}
              {m.error && !m.text ? (
                <p className="assistant-note">{m.error === "limit" ? c.limit : m.tables?.length ? c.busy : c.failed}</p>
              ) : null}
              {(m.tables ?? []).map((t, ti) => (
                <div key={ti} className="assistant-table">
                  <p className="assistant-table-title">{t.title}</p>
                  <div className="assistant-table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {t.columns.map((col) => (
                            <th key={col} className={col === t.columns[0] ? "" : "num"}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, ri) => {
                          const id = t.millIds?.[ri] ?? null;
                          const clickable = !!id && t.columns.length > 2;
                          return (
                            <tr
                              key={ri}
                              className={clickable ? "clickable" : ""}
                              title={clickable ? c.openMill : undefined}
                              tabIndex={clickable ? 0 : undefined}
                              onClick={clickable ? () => openMill(id!) : undefined}
                              onKeyDown={clickable ? (e) => e.key === "Enter" && openMill(id!) : undefined}
                            >
                              {r.map((v, vi) => (
                                <td key={vi} className={typeof v === "number" ? "num tabular-nums" : ""}>
                                  {cell(v, lang)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ),
        )}
        {busy ? <p className="assistant-note">{c.thinking}</p> : null}
        <div className="assistant-suggest">
          <p className="assistant-suggest-head">{c.suggestions}</p>
          {presets.map((p) => (
            <button key={p.label} type="button" className="assistant-chip" disabled={busy} onClick={() => void ask(p.label, p)}>
              {p.label}
            </button>
          ))}
        </div>
        <div ref={endRef} />
      </div>

      <form className="assistant-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          maxLength={2000}
          placeholder={c.place}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
        />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {c.send}
        </button>
      </form>
      <p className="assistant-foot">{c.beta}</p>
    </section>
  );
}
