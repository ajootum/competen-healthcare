// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE STANDARD MISSING-EVIDENCE PATTERN — CPR-CORE-MOS-001 §17.
//
// "Do not build extensive bespoke refusal UX for every remaining module before the substrate is
// implemented; reuse a standard missing-evidence pattern."
//
// ⚠ THERE WERE THREE, AND THAT IS HOW IT STARTS. Configuration, Releases and Product Health each grew
// their own AbsentList and PlaneRefusal. Two of the three were byte-identical and the third differed
// only in whether the sentence sat behind a disclosure — which is not a design decision anybody made,
// it is what happens when the second module is written by copying the first. Five more modules would
// have made eight, and the day somebody improved the refusal wording they would have improved one of
// eight.
//
// The gap matrix records the consolidation as a build action and the doctrine harness ratchets the count
// so a fourth cannot appear quietly. This file is the one.
//
// ⚠ AND IT KEEPS BOTH RENDERINGS, because both were right for their page. A refusal on Configuration is
// one of several and belongs behind a disclosure; a refusal on Product Health IS the page's content and
// belongs in front of the reader. `inline` chooses, and the default is the disclosure.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A real <details>.
 *
 * ⚠ NOT A `title` ATTRIBUTE, EVER. It is unreachable by keyboard and unread by a screen reader, so it
 * cannot carry a sentence the reader needs.
 */
export function Explain({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="mt-1.5 text-[11px] leading-relaxed text-gray-600">
      <summary className="cursor-pointer font-semibold text-teal-700 marker:text-gray-400 hover:underline">
        {summary}
      </summary>
      <div className="mt-1 text-gray-600">{children}</div>
    </details>
  );
}

/**
 * ⚠ THE ONE PLACE A MIGRATION NUMBER, FILE OR LINE MAY APPEAR ON A DIRECTOR SURFACE.
 *
 * PD-001 §3 keeps raw implementation detail off these screens. Deleting a citation would make a verdict
 * something a reader must TRUST, and these verdicts are only worth reading because they can be checked —
 * so the visible sentence speaks the product's language and the exact reference lives one click away.
 * pd-screen-doctrine-harness counts every identifier and fails if one is in a sentence a reader cannot
 * avoid.
 */
export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <Explain summary="Where to check this">
      <span className="font-mono text-[10px] break-words text-gray-500">{children}</span>
    </Explain>
  );
}

/**
 * Several facts a surface does NOT have, as a tight list. Never "coming soon".
 *
 * The NAME of the missing fact is the row; the registry's sentence — the part that must never be
 * softened or dropped — is either beneath it or one click away, depending on whether the absence is
 * this page's subject or a footnote to it.
 */
export function AbsentList({ items, inline = false }: {
  items: { label: string; why: string }[];
  /** true when the absences ARE the page's content, so the sentence is not worth a click. */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <ul className="flex flex-col divide-y divide-gray-100">
        {items.map(i => (
          <li key={i.label} className="py-2 first:pt-0 last:pb-0">
            <p className="text-[12px] font-semibold text-gray-800">
              {i.label} <span className="font-normal text-gray-500">— not measured</span>
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{i.why}</p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col">
      {items.map(i => (
        <li key={i.label} className="border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
          <p className="text-[12px] font-semibold text-gray-800">
            {i.label} <span className="font-normal text-gray-500">— not shown</span>
          </p>
          <Explain summary="Why this is not shown">{i.why}</Explain>
        </li>
      ))}
    </ul>
  );
}

/** One fact a surface does NOT have, where a card is the right weight. */
export function Absent({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] p-4">
      <p className="text-[12px] font-bold text-gray-700">{what}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{why}</p>
    </div>
  );
}

/**
 * ⚠ A REFUSED READ IS NOT AN ABSENCE, AND THE TWO MUST NOT LOOK ALIKE.
 *
 * These rows exist and the product writes them; this plane may not read them. Filing that under "no
 * data" would leave a reader with the exact opposite of the truth — they would go and build something
 * that is already there.
 *
 * ⚠ AND IT SAYS ONLY THAT THE READ IS FORBIDDEN. It may not say what it would have found: a refused read
 * distinguishes an empty table from a full one no better than a reader can. Product Health learned that
 * the hard way, having claimed rows "written daily" for a table holding none.
 */
export function PlaneRefusal({ what, tables, why }: {
  what?: string;
  tables: readonly string[];
  why: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
        {what ? `${what}: these values exist and this page may not read them` : "These values exist and this page may not read them"}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-800">{why}</p>
      <Explain summary="What it would take to change that">
        One entry per table in the practice plane&apos;s allowlist, naming the exact columns and the
        reason, plus the matching change to what the Practice product tells practitioners the platform
        can see. That is an owner decision, not a screen&apos;s.
        <Cite>{tables.join(", ")} are absent from PRACTICE_ALLOWLIST in src/lib/access/plane-boundary.ts</Cite>
      </Explain>
    </div>
  );
}
