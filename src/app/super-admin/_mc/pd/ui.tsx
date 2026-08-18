import Link from "next/link";
import type { Figure, Comparison } from "@/lib/hq/pd-mission";

// CPR-PD-002 — the small vocabulary Mission Control draws figures with.
//
// ⚠ THERE ARE THREE WAYS TO DRAW A NUMBER AND ONLY ONE OF THEM IS A NUMBER. §3 and §14 both say the
// same thing from different directions: never substitute zero, and say "Not enough data" instead. So a
// value, an unreadable and an absent metric are drawn DIFFERENTLY and none of them borrows the other's
// shape. A grey em dash in a metric slot is not neutral — it is a claim that something was measured and
// came back empty, which is the one thing none of these states means.
//
// ⚠ SEVERITY IS NEVER COLOUR ALONE (§15). Every tone below carries a word as well as a hue, because a
// dashboard read by somebody who cannot distinguish red from amber must still rank its own exceptions.

export const CARD = "rounded-xl border border-gray-200 bg-white";

export function Section({ id, title, purpose, action, children }: {
  id: string; title: string; purpose?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className={`${CARD} p-5`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id={`${id}-h`} className="text-[15px] font-semibold text-gray-900">{title}</h2>
          {purpose && <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-gray-500">{purpose}</p>}
        </div>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs text-teal-700 hover:underline">
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** A measurement, an unreadable, or a metric the registry refuses. Never an em dash. */
export function FigureValue({ figure, size = "lg" }: { figure: Figure; size?: "lg" | "sm" }) {
  if (figure.state === "value")
    return (
      <p className={`${size === "lg" ? "text-3xl" : "text-2xl"} font-bold tabular-nums text-gray-900`}>
        {figure.value.toLocaleString()}
      </p>
    );

  if (figure.state === "unknown")
    return (
      <div>
        <p className={`${size === "lg" ? "text-base" : "text-sm"} font-semibold text-[var(--cmp-text-warning)]`}>
          Could not be read
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{figure.why}</p>
      </div>
    );

  return (
    <div>
      <p className={`${size === "lg" ? "text-base" : "text-sm"} font-semibold text-gray-500`}>Not measured</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{figure.why}</p>
    </div>
  );
}

/** §3: "Do not show a delta when the comparison period or data quality is insufficient." */
export function Delta({ comparison, unit }: { comparison: Comparison | null; unit: string }) {
  if (!comparison) return null;
  if (comparison.state === "insufficient")
    return (
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-600">Not enough data</span> — {comparison.why}
      </p>
    );

  const { current, prior, direction } = comparison;
  const word = direction === "up" ? "up from" : direction === "down" ? "down from" : "level with";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "▬";
  return (
    <p className="mt-1 text-[11px] text-gray-500">
      <span aria-hidden="true">{arrow} </span>
      {current.toLocaleString()} {unit}, {word} {prior.toLocaleString()} in the previous period
    </p>
  );
}

const SEVERITY: Record<string, { chip: string; word: string }> = {
  critical: { chip: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] border-[var(--cmp-color-critical)]", word: "Critical" },
  warning: { chip: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]", word: "Needs action" },
  info: { chip: "bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)] text-blue-700", word: "For information" },
};

export function SeverityChip({ severity }: { severity: "critical" | "warning" | "info" }) {
  const s = SEVERITY[severity];
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.chip}`}>
      {s.word}
    </span>
  );
}

/**
 * A stated absence, in the registry's own words.
 *
 * ⚠ THIS COMPONENT IS THE DELIVERABLE FOR FOUR OF PD-002's ELEVEN COMPONENTS, not an apology for them.
 * A reader who is told "nothing records this" can act on it; a reader shown a confident zero cannot.
 */
export function Absent({ heading, why, children }: { heading: string; why: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3.5">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">{heading}</p>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-gray-800">{why}</p>
      {children}
    </div>
  );
}

/** "12 of 30 (40%)" — §19 requires the denominator wherever the percentage renders. */
export function Ratio({ n, of }: { n: number | null; of: number }) {
  if (n === null)
    return <span className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">Could not be counted</span>;
  const pct = of > 0 ? Math.round((n / of) * 100) : null;
  return (
    <span className="text-[12px] tabular-nums text-gray-700">
      <span className="font-semibold text-gray-900">{n.toLocaleString()}</span> of {of.toLocaleString()}
      {pct !== null && <span className="text-gray-500"> ({pct}%)</span>}
    </span>
  );
}
