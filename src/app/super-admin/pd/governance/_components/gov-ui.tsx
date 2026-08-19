// The Governance & Risk view kit.
//
// ⚠ TAKEN FROM THE SHARED PATTERN, NOT COPIED. CPR-CORE-MOS-001 §17 asks for ONE standard
// missing-evidence pattern across the workspace, and three modules had grown their own before the
// shared file existed. Explain, Cite, Absent and AbsentList come from there unchanged, so the doctrine
// harness's module-local ratchet does not move.
export { Explain, Cite, Absent, AbsentList, PlaneRefusal } from "../../_components/evidence";

export function GovHeader({ title, purpose }: { title: string; purpose: string }) {
  return (
    <header className="mb-1 border-b border-gray-200 pb-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Governance &amp; Risk</p>
      <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">{title}</h1>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">{purpose}</p>
    </header>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * ⚠ THREE STATES, NOT TWO, AND THE COMPONENT WILL NOT LET A CALLER COLLAPSE THEM.
 *
 * A register can hold rows, hold none, or have failed to be read. The last two render identically if a
 * page tests `length === 0`, and this build has shipped that mistake before — so `rows` is nullable and
 * the unreadable case is a different sentence with a different tone.
 *
 * `meaning` is required on purpose. Every empty register in this module means something specific — no
 * methodology published, no judgement made, nothing escalated — and a generic "no records found" throws
 * away the only useful thing an empty page can say.
 */
export function EmptyOrUnreadable({ rows, what, meaning }: {
  rows: unknown[] | null; what: string; meaning: string;
}) {
  if (rows === null) {
    return (
      <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-3 py-2.5">
        <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">
          The {what} store could not be read.
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-800">
          ⚠ That is not none, and nothing below it is a measurement.
        </p>
      </div>
    );
  }
  if (rows.length > 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className="text-[12px] font-semibold text-gray-700">No {what} has been recorded.</p>
      <p className="mt-0.5 max-w-4xl text-[11.5px] leading-relaxed text-gray-600">{meaning}</p>
    </div>
  );
}

/** A vocabulary rendered as the model it is — the states a record can hold, and how many hold each. */
export function StateList({ items, total }: {
  items: readonly { key: string; label: string; n: number; note?: string }[]; total: number;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(i => (
        <li key={i.key} className="flex items-start gap-2.5">
          <span className="w-[150px] shrink-0 text-[11.5px] font-medium text-gray-800">{i.label}</span>
          <span aria-hidden className="mt-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
            <span className="block h-full rounded-full bg-teal-500"
              style={{ width: total > 0 ? `${(i.n / total) * 100}%` : "0%" }} />
          </span>
          <span className="w-[28px] shrink-0 text-right text-[11.5px] tabular-nums text-gray-600">{i.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a page would need before it can say anything. Each item is a model or a decision, never a query. */
export function Needs({ items }: { items: readonly { label: string; why: string }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map(i => (
        <li key={i.label} className="rounded-lg border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] px-3 py-2">
          <p className="text-[12px] font-bold text-gray-700">{i.label}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{i.why}</p>
        </li>
      ))}
    </ul>
  );
}
