import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fireCopy } from "@/lib/fire-copy";
import { fill, formatCount } from "@/lib/format";

/** Sales-team attribution for a company (from /fire/contacts, loaded once per session). */
export type SalesCompany = {
  company: string;
  group?: string | null;
  estates: { rights?: string | null; district?: string | null; province?: string | null; ha?: number | null; archive?: string | null; deck?: string | null }[];
  contacts: { name: string; position?: string | null; phone?: string | null; email?: string | null; address?: string | null }[];
};
type Book = { source?: string; companies: Record<string, SalesCompany> };

let bookP: Promise<Book | null> | null = null;
const loadBook = () => (bookP ??= fetch("/fire/contacts").then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** Same normalisation as scripts/prepare-fire-layers.py. */
export const salesKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(pt|plasma|tbk|cv|group|grup)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

export function useSales(name: string): SalesCompany | null {
  const [book, setBook] = useState<Book | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBook().then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, []);
  if (!book) return null;
  const k = salesKey(name);
  if (book.companies[k]) return book.companies[k];
  // Fall back to containment either way ("plasma pt x" vs "pt x").
  const hit = Object.keys(book.companies).find((c) => c.length > 8 && (k.includes(c) || c.includes(k)));
  return hit ? book.companies[hit] : null;
}

export function SalesCard({ name }: { name: string }) {
  const { lang } = useI18n();
  const f = fireCopy[lang];
  const s = useSales(name);
  if (!s) return null;
  const ha = s.estates.reduce((a, e) => a + (e.ha ?? 0), 0);
  const districts = [...new Set(s.estates.map((e) => e.district).filter(Boolean))] as string[];
  const rights = [...new Set(s.estates.map((e) => e.rights).filter(Boolean))] as string[];
  const deck = s.estates.find((e) => e.deck)?.deck;
  return (
    <section className="fl-box fl-sales">
      <h3>{f.salesTitle}</h3>
      <dl className="fl-route">
        <dt>{f.salesGroup}</dt>
        <dd>{s.group || "—"}</dd>
        <dt>{f.salesEstates}</dt>
        <dd>
          {fill(f.salesEstatesVal, { n: s.estates.length, ha: formatCount(ha, lang) })}
          {districts.length ? ` · ${districts.join(", ")}` : ""}
        </dd>
        {rights.length ? (
          <>
            <dt>{f.salesRights}</dt>
            <dd>{rights.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      {s.contacts.length ? (
        <>
          <h4 className="fl-contacts-h">{f.salesContacts}</h4>
        <ul className="fl-contacts">
          {s.contacts.map((c, i) => (
            <li key={i}>
              <b>{c.name}</b>
              {c.position ? <span>{c.position}</span> : null}
              <span className="fl-contact-links">
                {c.phone ? <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}>{c.phone}</a> : null}
                {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
              </span>
              {c.address ? <small>{c.address}</small> : null}
            </li>
          ))}
        </ul>
        </>
      ) : (
        <p className="fl-note">{f.salesNoContact}</p>
      )}
      <div className="fl-row">
        {deck ? (
          <a className="btn-text small" href={deck} target="_blank" rel="noopener noreferrer">
            {f.salesDeck} ↗
          </a>
        ) : null}
      </div>
    </section>
  );
}
