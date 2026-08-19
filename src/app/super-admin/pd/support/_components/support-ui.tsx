import Link from "next/link";
import type { Figure } from "@/lib/hq/pd-support";
import { caveatSentence } from "@/lib/hq/pd-metric-registry";
import { Explain } from "../../_components/evidence";

// The Support & Incidents view kit.
//
// ⚠ THE MISSING-EVIDENCE PATTERN IS TAKEN, NOT COPIED. CPR-CORE-MOS-001 §17 asks for one standard
// pattern; three modules had grown their own before the shared file existed. This module is the first
// built after it, and takes AbsentList, PlaneRefusal, Explain and Cite from there. Nothing in this file
// redefines them, which is why the doctrine harness's ratchet does not move.
export { Explain, Cite, Absent, AbsentList, PlaneRefusal } from "../../_components/evidence";

export function SupportHeader({ title, spec, purpose, readAt }: {
  title: string; spec: string; purpose: string; readAt: string;
}) {
  return (
    <header className="mb-4 border-b border-gray-200 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Support &amp; Incidents</p>
          <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">{purpose}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* GMT, so freshness means the same thing to two readers in two countries. */}
          <p className="font-mono text-[11px] text-gray-500">
            {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)} GMT
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-500">{spec}</p>
        </div>
      </div>
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

/** ⚠ COLOUR IS GRANTED ONLY TO A MEASUREMENT — an unread figure cannot wear a reassuring tint. */
export function Stat({ label, f, unit, tone }: {
  label: string; f: Figure; unit?: string; tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      {f.state === "value" ? (
        <p className={`mt-0.5 text-[22px] font-bold leading-none tracking-tight tabular-nums ${
          tone === "warn" && f.value > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
          {f.value.toLocaleString("en-GB")}
          {unit && <span className="ml-1 text-[12px] font-medium text-gray-500">{unit}</span>}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[13px] font-semibold text-gray-500">
            {f.state === "unknown" ? "Could not be read" : "No such record"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{f.why}</p>
        </>
      )}
    </div>
  );
}

const SEV_TONE: Record<string, string> = {
  "SEV-1 Critical": "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-critical)]",
  "SEV-2 High": "border-orange-400 bg-orange-50 text-orange-800",
  "SEV-3 Moderate": "border-amber-300 bg-amber-50 text-amber-800",
  "SEV-4 Low": "border-gray-300 bg-gray-100 text-gray-700",
  Informational: "border-sky-300 bg-sky-50 text-sky-800",
};

/** ⚠ NEVER COLOUR ALONE — the grade is printed, so severity survives a monochrome screen. */
export function SeverityBadge({ label }: { label: string }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
      SEV_TONE[label] ?? SEV_TONE["SEV-4 Low"]}`}>
      {label}
    </span>
  );
}

export function StatusChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
      {label}
    </span>
  );
}

export function SubmoduleGrid({ items }: {
  items: readonly { key: string; label: string; href: string; spec: string; state: string }[];
}) {
  const WORD: Record<string, string> = { real: "Built", partial: "Partly built", absent: "No record type" };
  const TONE: Record<string, string> = {
    real: "border-teal-300 bg-teal-50 text-teal-800",
    partial: "border-amber-300 bg-amber-50 text-amber-800",
    absent: "border-gray-300 bg-gray-100 text-gray-600",
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(s => (
        <Link key={s.key} href={s.href}
          className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-gray-900">{s.label} →</span>
            <span className="mt-0.5 block font-mono text-[10px] text-gray-500">{s.spec}</span>
          </span>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[s.state]}`}>
            {WORD[s.state]}
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * ⚠ THE CAVEAT, RENDERED FROM THE REGISTRY RATHER THAN TYPED ON THE PAGE.
 *
 * Migration 318 made the five record types real, so their counts are honest measurements. Nothing
 * writes to them yet, which is a separate fact and the one that misleads: zero open cases reads as
 * "practitioners are fine" and means "a practitioner has nowhere to report". Eight pages each phrasing
 * that in their own words is eight chances to phrase it weakly, so it is said once in the registry and
 * shown here. When a metric gets its writer, the caveat is deleted in that commit and every page that
 * shows it stops showing it in the same change.
 */
export function Caveat({ metric }: { metric: string }) {
  const text = caveatSentence(metric);
  if (!text) return null;
  return (
    <p className="mt-1.5 border-l-2 border-amber-300 pl-2 text-[11px] leading-relaxed text-gray-600">
      {text}
    </p>
  );
}

/**
 * An absence WHERE A NUMBER WOULD HAVE GONE, inside a stat card that already carries the label.
 *
 * ⚠ NOT `Absent` FROM THE SHARED KIT. That one is a bordered block with its own heading, which inside a
 * card produces a box in a box and a heading repeated twice. Same rule, same sentence source, different
 * enclosure — the wording still comes from the registry, so this is a layout variant and not a second
 * opinion about what is missing.
 */
export function AbsentValue({ why }: { why: string }) {
  return (
    <>
      <p className="mt-0.5 text-[13px] font-semibold text-gray-500">Not available</p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{why}</p>
    </>
  );
}

/** The module-level version of the same fact, for the top of a record page. */
export function NoIntakeBanner({ what, metric }: { what: string; metric: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5">
      <p className="text-[12.5px] font-bold text-amber-900">
        {what} can be recorded, but nothing can raise one yet.
      </p>
      <p className="mt-1 max-w-4xl text-[11.5px] leading-relaxed text-gray-800">
        {caveatSentence(metric)}
      </p>
      <Explain summary="Why this page ships before the intake does">
        The record type is the hard half and the constraint set is the valuable half — a P1 with no due
        date, an accepted risk with no named authority and a confirmed cause on an unconfirmed problem
        are all refused by the database rather than by a reviewer. Shipping the surface now means the
        intake, whenever it is built, writes into a shape that has already been proved. What it does not
        mean is that these figures describe practitioner experience yet, which is why the sentence above
        sits on every screen that counts them.
      </Explain>
    </div>
  );
}

/**
 * ⚠ THREE STATES, NOT TWO. A list can hold rows, hold none, or have failed to be read, and the last two
 * look identical if a screen only checks `length === 0`. This build has shipped that mistake before, so
 * the empty state is a component that cannot be rendered without saying which of the two it is.
 */
export function EmptyOrUnreadable({ rows, what, caveat }: {
  rows: unknown[] | null; what: string; caveat?: string;
}) {
  if (rows === null) {
    return (
      <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-3 py-2.5">
        <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">
          The {what} store could not be read.
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-800">
          ⚠ That is not none. Nothing on this page below this point is a measurement.
        </p>
      </div>
    );
  }
  if (rows.length > 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className="text-[12px] font-semibold text-gray-700">No {what} has been recorded.</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">
        The store was read and holds none — a measured zero, not an unavailable one.
        {caveat ? ` ${caveat}` : ""}
      </p>
    </div>
  );
}

/** A distribution over a fixed vocabulary, in the vocabulary's order rather than by size. */
export function Distribution({ items, total }: {
  items: readonly { key: string; label: string; n: number }[]; total: number;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(b => (
        <li key={b.key} className="flex items-center gap-2.5">
          <span className="w-[124px] shrink-0 text-[11.5px] text-gray-700">{b.label}</span>
          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
            <span className="block h-full rounded-full bg-teal-500"
              style={{ width: total > 0 ? `${(b.n / total) * 100}%` : "0%" }} />
          </span>
          <span className="w-[28px] shrink-0 text-right text-[11.5px] tabular-nums text-gray-600">{b.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** One labelled value, with an explicit rendering for "the record does not say". */
export function Field({ label, value, warnWhenEmpty }: {
  label: string; value: string | null; warnWhenEmpty?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-0.5 text-[12.5px] leading-snug ${
        value ? "text-gray-900" : warnWhenEmpty ? "font-semibold text-[var(--cmp-text-warning)]" : "text-gray-500"}`}>
        {value ?? "not recorded"}
      </p>
    </div>
  );
}

export function PriorityChip({ label }: { label: string }) {
  const TONE: Record<string, string> = {
    "P1 Urgent": "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-critical)]",
    "P2 High": "border-orange-400 bg-orange-50 text-orange-800",
    "P3 Normal": "border-gray-300 bg-gray-50 text-gray-700",
    "P4 Low": "border-gray-200 bg-gray-50 text-gray-500",
  };
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
      TONE[label] ?? TONE["P3 Normal"]}`}>
      {label}
    </span>
  );
}

/** ⚠ SHOWN WHENEVER A LIST WAS CUT. A count over a truncated fetch is arithmetic on a lie. */
export function Truncated({ truncated, what }: { truncated: boolean; what: string }) {
  if (!truncated) return null;
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
      ⚠ More than 500 {what} exist and this page read the first 500. Every figure on it describes that
      page of results and not the estate.
    </p>
  );
}

export function ReadFailures({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
      <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not answer</p>
      <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-gray-800">
        {problems.map(p => <li key={p}>{p}</li>)}
      </ul>
    </div>
  );
}
