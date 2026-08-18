import Link from "next/link";
import type { Figure, Sample } from "@/lib/hq/pd-health";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-008 — the Product Health view kit.
//
// ⚠ NOTHING HERE DECIDES WHETHER A FIGURE MAY RENDER. The registry gate runs in the loader, so an absent
// metric arrives already carrying its sentence and there is nothing for a component to forget.
//
// ⚠ AND EVERY IMPLEMENTATION IDENTIFIER GOES IN <Cite> OR <Explain>. PD-001 s3 keeps migration numbers,
// table names and file paths off a Director's surface — not deleted, because a verdict the reader cannot
// check is worth nothing, but one click away. pd-screen-doctrine-harness counts this.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** A real <details>. `title` is not an acceptable carrier: unreachable by keyboard, unread by a reader. */
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

export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <Explain summary="Where to check this">
      <span className="font-mono text-[10px] break-words text-gray-500">{children}</span>
    </Explain>
  );
}

export function HealthHeader({ title, spec, purpose, readAt, windowDays }: {
  title: string; spec: string; purpose: string; readAt: string; windowDays: number;
}) {
  return (
    <header className="mb-4 border-b border-gray-200 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Product Health</p>
          <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">{purpose}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* ⚠ GMT, BECAUSE FRESHNESS MUST MEAN THE SAME THING TO TWO READERS IN TWO COUNTRIES. */}
          <p className="font-mono text-[11px] text-gray-500">
            {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)} GMT
          </p>
          <p className="text-[11px] text-gray-400">counted over the last {windowDays} days</p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">{spec}</p>
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

/**
 * One figure.
 *
 * ⚠ COLOUR IS GRANTED ONLY TO A MEASUREMENT. An unknown or absent figure cannot wear a reassuring tint,
 * because the tint is what a reader scans before the words.
 */
export function Stat({ label, f, unit, explain }: {
  label: string; f: Figure; unit?: string; explain?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      {f.state === "value" ? (
        <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
          {f.value.toLocaleString("en-GB")}
          {unit && <span className="ml-1 text-[12px] font-medium text-gray-400">{unit}</span>}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[13px] font-semibold text-gray-400">
            {f.state === "unknown" ? "Could not be read" : "Not measured"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{f.why}</p>
        </>
      )}
      {f.state === "value" && explain}
    </div>
  );
}

/** A duration, rendered in the unit a person reads rather than raw milliseconds. */
export function Duration({ label, f, explain }: { label: string; f: Figure; explain?: React.ReactNode }) {
  if (f.state !== "value") return <Stat label={label} f={f} explain={explain} />;
  const ms = f.value;
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s` : `${Math.round(ms)}ms`;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">{text}</p>
      {explain}
    </div>
  );
}

/**
 * A share.
 *
 * ⚠ IT RENDERS ITS DENOMINATOR, ALWAYS. A percentage with no stated base is the figure this product's
 * honesty rules exist to prevent; the registry already refuses a rate whose halves are not both real.
 */
export function Share({ label, f, of }: { label: string; f: Figure; of: string }) {
  if (f.state !== "value") return <Stat label={label} f={f} />;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
        {(f.value * 100).toFixed(1)}<span className="ml-0.5 text-[12px] font-medium text-gray-400">%</span>
      </p>
      <p className="mt-1 text-[11px] text-gray-500">of {of}</p>
    </div>
  );
}

/** Says what a sampled statistic was actually computed over. Silence here is how a truncation lies. */
export function SampleNote({ sample, what }: { sample: Sample; what: string }) {
  if (!sample.truncated) {
    return <p className="text-[11px] text-gray-500">{what} computed over all {sample.read.toLocaleString("en-GB")} rows in the window.</p>;
  }
  return (
    <p className="text-[11px] leading-relaxed text-[var(--cmp-text-warning)]">
      ⚠ {what} computed over the most recent {sample.read.toLocaleString("en-GB")} rows, not all{" "}
      {(sample.total ?? 0).toLocaleString("en-GB")} in the window. The read is capped at one thousand
      rows, so this is a recent sample rather than a window statistic.
    </p>
  );
}

export function Absent({ label, why }: { label: string; why: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5">
      <p className="text-[12px] font-semibold text-gray-700">{label} <span className="font-normal text-gray-400">— not measured</span></p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{why}</p>
    </div>
  );
}

export function AbsentList({ items }: { items: { label: string; why: string }[] }) {
  return (
    <ul className="flex flex-col divide-y divide-gray-100">
      {items.map(i => (
        <li key={i.label} className="py-2 first:pt-0 last:pb-0">
          <p className="text-[12px] font-semibold text-gray-800">{i.label} <span className="font-normal text-gray-400">— not measured</span></p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{i.why}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * ⚠ A REFUSED READ IS NOT AN ABSENCE, AND THE TWO MUST NOT LOOK ALIKE. These rows exist and Competen
 * Practice writes them every day; this plane may not read them. Filing that under "no data" would leave
 * a reader with the exact opposite of the truth.
 */
export function PlaneRefusal({ what, tables, why }: { what: string; tables: readonly string[]; why: string }) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
        {what}: these values exist and this page may not read them
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

const STATE_STYLE: Record<string, string> = {
  real: "bg-teal-50 text-teal-800 border-teal-300",
  partial: "bg-amber-50 text-amber-800 border-amber-300",
  absent: "bg-gray-100 text-gray-600 border-gray-300",
  refused: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]",
};
const STATE_WORD: Record<string, string> = {
  real: "Measured",
  partial: "Partly measured",
  absent: "Not measured",
  refused: "Refused read",
};

/** ⚠ NEVER COLOUR ALONE — the chip carries its word, so the state survives a monochrome screen. */
export function StateChip({ state }: { state: string }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_STYLE[state] ?? STATE_STYLE.absent}`}>
      {STATE_WORD[state] ?? state}
    </span>
  );
}

export function SubmoduleGrid({ items }: { items: readonly { key: string; label: string; href: string; spec: string; state: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(s => (
        <Link key={s.key} href={s.href}
          className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-gray-900">{s.label} →</span>
            <span className="mt-0.5 block font-mono text-[10px] text-gray-400">{s.spec}</span>
          </span>
          <StateChip state={s.state} />
        </Link>
      ))}
    </div>
  );
}

/** Read failures, shown rather than swallowed. A count that could not be read is not zero. */
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

export function TechnicalOpsLink({ what }: { what: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-500">
      {what} is operated from Technical Operations, which this module deliberately does not reimplement —
      PD-001 §3 keeps the console and the lens apart.
    </p>
  );
}
