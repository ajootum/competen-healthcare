import Link from "next/link";

// Shared furniture for Product Operations' four pages (CPR-PD-014 build 3).
//
// ⚠ THE RULES THESE COMPONENTS EXIST TO KEEP, written once so four pages cannot each forget one:
//
//   A FIGURE IS EITHER MEASURED OR IT IS A SENTENCE. `Stat` takes `value: string | null`. A null renders
//   the `unreadable` sentence in prose — never "—", never "0". An em-dash in a metric slot is a claim
//   that something was measured and came back empty; a zero is a claim that it came back zero. Both are
//   lies when the read failed, and this codebase has shipped five screens reading fields that never
//   existed to learn it.
//
//   A COUNT SAYS WHAT IT COUNTED. `scope` is not decoration: "12" over the estate and "12" over a
//   200-row page are different facts, and the one an operator would quote is the estate.
//
// No client component here and none on the four pages: everything is a server render of facts the
// loader already resolved, so nothing about a practice reaches a browser bundle that did not have to.

export function OpsHeader({ title, purpose, spec, children }: {
  title: string; purpose: string; spec: string; children?: React.ReactNode;
}) {
  return (
    <div>
      {/* ⚠ THE CRUMB IS A NAVIGATION CONTROL AND WAS 16px TALL. WCAG 2.2 AA (2.5.8) sets a 24px floor
          for anything that is not inline text in a sentence, and a breadcrumb link is a target somebody
          aims at, not prose. globals.css keeps 44px opt-in via data-touch-target so dense grids are not
          forced to it — this only needs the AA floor, which `inline-flex` + min-height gives without
          changing the row's look. */}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <Link href="/super-admin/pd/operations"
          className="inline-flex min-h-[24px] items-center hover:text-teal-700">Product Operations</Link>
        <span>/</span><span className="text-gray-600">{title}</span>
      </div>
      <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">{purpose}</p>
      <p className="mt-1 font-mono text-[11px] text-gray-500">{spec}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value, scope, unreadable, tone }: {
  label: string;
  /** Null means it could not be read. It is NOT rendered as a dash or a zero — see the note above. */
  value: string | null;
  /** What the number is over. Omitted only when the figure is self-evidently total. */
  scope?: string;
  /** The sentence shown in place of the figure when `value` is null. Name the fact and why. */
  unreadable?: string;
  tone?: "neutral" | "critical" | "warning" | "success";
}) {
  const toneClass =
    tone === "critical" ? "text-[var(--cmp-text-critical)]"
      : tone === "warning" ? "text-[var(--cmp-text-warning)]"
        : tone === "success" ? "text-[var(--cmp-text-success)]"
          : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      {value === null ? (
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
          {unreadable ?? "This could not be read. It is not zero."}
        </p>
      ) : (
        <>
          <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
          {scope && <p className="text-[11px] leading-snug text-gray-500">{scope}</p>}
        </>
      )}
    </div>
  );
}

export function Panel({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * A fact this surface does NOT have, with the reason named.
 *
 * Kept visually distinct from a measurement so it can never be mistaken for one, and required to carry
 * a `why` — "not available" without a reason is indistinguishable from "we forgot to build it", and the
 * operator has no way to tell whether to go looking elsewhere.
 */
export function Absent({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] p-4">
      <p className="text-[12px] font-bold text-gray-700">{what}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{why}</p>
    </div>
  );
}

export function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">{title}</p>
      <div className="mt-1.5 text-[12px] leading-relaxed text-gray-800">{children}</div>
    </div>
  );
}

/**
 * The deep technical view.
 *
 * ⚠ PD-001 §3 RETAINS THE EXISTING PAGE RATHER THAN REPLACING IT: it is the only caller of the
 * provisioning API and it carries the IAM-001 §14 gate ledger. So every Product Operations page points
 * at it instead of growing a second console, and says which of the two owns the action.
 */
export function TechnicalOpsLink({ for: what }: { for: string }) {
  return (
    <p className="text-[12px] text-gray-500">
      {what}{" "}
      <Link href="/super-admin/platform-ops/practice" className="font-semibold text-teal-700 hover:underline">
        Technical Operations →
      </Link>
    </p>
  );
}

/** A destination card for the overview's routing half. */
export function ModuleLink({ href, label, summary }: { href: string; label: string; summary: string }) {
  return (
    <Link href={href}
      className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-teal-600 hover:bg-teal-50/30">
      <p className="text-[13px] font-bold text-gray-900">{label} →</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{summary}</p>
    </Link>
  );
}

/** A count that is over a page rather than the estate always says so in the same words. */
export const PAGE_SCOPE = (n: number, total: number | null) =>
  total === null
    ? `of the ${n} most recent practices this page read (the estate count could not be read)`
    : total > n
      ? `of the ${n} most recent practices, out of ${total.toLocaleString()} on the platform`
      : `of all ${n} practices on the platform`;
