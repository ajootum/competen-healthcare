import Link from "next/link";
import { focusRing } from "@/app/individual/_components/chrome";

// ── SMALL PIECES SHARED BY THE COURSES & TRAINING AND MY COMPETENCIES PAGES ── SCHOLAR-MODULES-01 ─────────
// Server components, no state, no data: each page reads its own rows and passes the words in. Links only --
// nothing here enrols, pays, certifies or calls an AI.

/** The cards an Overview page links to: whole card is the link, at least a touch target tall. */
export function ModuleCards({ items }: { items: { href: string; title: string; body: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(i => (
        <li key={i.href}>
          <Link href={i.href}
            className={`flex h-full min-h-[44px] flex-col rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] sm:p-5 ${focusRing}`}>
            <span className="text-[15px] font-bold text-gray-900">{i.title}</span>
            <span className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{i.body}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A titled block on a page: the heading style the Progress page uses, with an optional one-line note. */
export function Block({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8 first:mt-0">
      <h2 id={id} className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">{title}</h2>
      {note && <p className="mt-1 text-[13px] text-gray-600">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A destination that is not operational: says what is true and what is needed from the person (nothing). */
export function PlaceholderCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 sm:p-6" data-testid="placeholder">
      <h2 className="text-[17px] font-bold tracking-tight text-gray-900">{title}</h2>
      <div className="mt-1.5 max-w-2xl space-y-2 text-[14.5px] leading-relaxed text-gray-700">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

/** An empty list, said in words (never a blank): a read that succeeded and found nothing. */
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">{children}</p>;
}

/** A text link at a touch-friendly height, in the experience accent. */
export function TextLink({ href, accent, children }: { href: string; accent: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} style={{ color: accent }}>
      {children}
    </Link>
  );
}

/** A list of rows inside one bordered card. */
export function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">{children}</ul>;
}
