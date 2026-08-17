"use client";

import Link from "next/link";

// CPR-MOB-001 s5 — "Wide data table → Card/list rows with key fields and primary action."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE MOBILE FACE OF A TABLE, NOT A SECOND TABLE. s19's card-fallback rule says every core desktop
// table must define its card equivalent; this is the equivalent, and the adopting page keeps its table
// at md and up while rendering this below. The render contract is deliberately thin — a title, a few
// labelled fields, at most ONE action — because s4 caps a viewport at one dominant primary action and
// a card that reproduces every column has only reproduced the horizontal scroll it exists to remove.
//
// ⚠ `empty` IS REQUIRED, NOT DEFAULTED. "No rows" and "the read failed" are different sentences
// (the todaysPlan doctrine, and the null-count≠error control pattern), and only the adopter knows
// which one is true. A primitive that painted its own "Nothing here" would say it equally happily
// over a failed query.
//
// NO onClick ON THE CARD BODY. A whole-card tap target with a button inside it is two overlapping
// targets, and the accidental one wins at clinic pace. The action is the action; if a page wants
// tap-anywhere it can pass an href-only action and make the card's title the link itself later —
// adoption decisions belong to the page phases, not here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type CardListField = { label: string; value: React.ReactNode };
export type CardListAction = { label: string; href?: string; onSelect?: () => void };

export default function CardList<T>({ items, getKey, title, badge, fields, action, empty }: {
  items: T[];
  getKey: (item: T) => string;
  /** The row's identity — on a patients table, the person's name. */
  title: (item: T) => React.ReactNode;
  /** Optional status, rendered beside the title. MUST carry words, never only a coloured shape (s4). */
  badge?: (item: T) => React.ReactNode;
  /** The few fields that survive the table→card cut, each with its visible label (s16). */
  fields: (item: T) => CardListField[];
  /** At most one primary action per row (s4). Return null for rows that have none. */
  action?: (item: T) => CardListAction | null;
  /** What to render when items is []. Required: only the adopter knows whether the emptiness is a
      quiet day or a failed read, and the two must not share a sentence. */
  empty: React.ReactNode;
}) {
  if (items.length === 0) return <div className="py-4 text-center text-[13px] text-gray-500">{empty}</div>;

  const actionClass =
    "mt-2.5 flex min-h-[var(--cp-touch)] w-full items-center justify-center rounded-lg border " +
    "border-gray-200 px-3 text-[13px] font-semibold text-[var(--cp-primary-deep)] hover:bg-gray-50";

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map(item => {
        const a = action?.(item) ?? null;
        return (
          <li key={getKey(item)} className="rounded-xl border border-gray-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-gray-900">{title(item)}</p>
              {badge?.(item)}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {fields(item).map(f => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{f.label}</dt>
                  <dd className="truncate text-[12.5px] text-gray-700">{f.value}</dd>
                </div>
              ))}
            </dl>
            {a && (a.href
              ? <Link href={a.href} className={actionClass}>{a.label}</Link>
              : <button type="button" onClick={a.onSelect} className={actionClass}>{a.label}</button>)}
          </li>
        );
      })}
    </ul>
  );
}
