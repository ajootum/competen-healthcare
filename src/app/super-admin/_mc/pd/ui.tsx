import Link from "next/link";
import type { ReactNode } from "react";
import type { Figure, Comparison } from "@/lib/hq/pd-mission";
import { Icon, type IconName } from "./icons";

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
// The same rule is why `StatusDot` will not render without a word: a green dot is not a status.
//
// ⚠ AND THE LONG EXPLANATIONS LIVE IN `Explain`, WHICH IS A <details>, NOT A TOOLTIP. §15 asks for
// "progressive disclosure for detail" in the same breath as "keyboard navigation, visible focus …
// accessible names". A `title` attribute satisfies neither — it is unreachable by keyboard and skipped
// by most screen readers — so every one of these carries a real <summary> that tabs, takes focus and
// announces itself, with `title` added only as a mouse convenience on top of it.

export const CARD = "rounded-xl border border-gray-200 bg-white";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1";

// ── Panels: the comp's card shape — a tinted header strip, a body, and one footer link ───────────────

export type PanelTone = "plain" | "critical" | "warning" | "info" | "brand";

const PANEL_HEAD: Record<PanelTone, string> = {
  plain: "bg-white text-gray-900",
  critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  warning: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  info: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  brand: "bg-violet-50 text-violet-700",
};

export function Panel({
  id, title, tone = "plain", icon, badge, subtitle, right, footer, children, className = "",
}: {
  id: string;
  title: string;
  tone?: PanelTone;
  icon?: IconName;
  /** The comp's count chip. Drawn in the header's own ink, so it cannot claim a severity the tone denies. */
  badge?: number;
  subtitle?: string;
  right?: { label: string; href: string };
  footer?: { label: string; href: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className={`${CARD} flex min-w-0 flex-col ${className}`}>
      <div className={`flex items-center gap-2 rounded-t-[11px] border-b border-gray-200 px-3.5 py-2 ${PANEL_HEAD[tone]}`}>
        {icon && <Icon name={icon} className="h-4 w-4 shrink-0" />}
        <h2 id={`${id}-h`} className="min-w-0 truncate text-[13px] font-semibold">{title}</h2>
        {typeof badge === "number" && badge > 0 && (
          <span className="shrink-0 rounded-full border border-current px-1.5 text-[10px] font-bold tabular-nums">
            {badge}
          </span>
        )}
        {subtitle && <span className="min-w-0 truncate text-[11px] font-normal text-gray-500">{subtitle}</span>}
        {right && (
          <Link href={right.href} className={`ml-auto shrink-0 text-[11px] font-semibold text-teal-700 hover:underline ${FOCUS}`}>
            {right.label}
          </Link>
        )}
      </div>
      <div className="flex-1 px-3.5 py-3">{children}</div>
      {footer && (
        <Link
          href={footer.href}
          className={`flex items-center justify-between gap-2 rounded-b-[11px] border-t border-gray-200 px-3.5 py-2 text-[12px] font-semibold text-teal-700 hover:bg-teal-50/40 ${FOCUS}`}
        >
          <span className="truncate">{footer.label}</span>
          <Icon name="arrow" className="h-3.5 w-3.5 shrink-0" />
        </Link>
      )}
    </section>
  );
}

// ── Progressive disclosure ───────────────────────────────────────────────────────────────────────────

const SUMMARY_BASE =
  `cursor-pointer list-none rounded-md [&::-webkit-details-marker]:hidden ${FOCUS}`;

/**
 * The compact "i" the dense cards carry, with the paragraph behind it.
 *
 * ⚠ THE BUTTON IS TAKEN OUT OF FLOW; THE PANEL IS NOT, AND THAT SPLIT IS THE WHOLE COMPONENT. `anchor`
 * pins the <summary> to a corner of the nearest positioned ancestor, so the affordance costs no width in
 * a six-across KPI row or a one-line Today row. The <details> itself stays a full-width block in normal
 * flow, so the disclosed text opens at the card's own width and pushes the card taller — which is what a
 * disclosure should do. Left inline, the panel would be shrink-wrapped to the width of a 20px button and
 * a five-line registry sentence would render one word per line or overflow the neighbouring card.
 *
 * ⚠ AND IT IS A <summary>, NOT A `title`. §15 requires keyboard navigation, visible focus and accessible
 * names in the same sentence as progressive disclosure. `title` is unreachable by keyboard and skipped by
 * most screen readers, so it is added here only as a mouse convenience ON TOP of a real focusable element
 * carrying a real accessible name.
 */
export function ExplainDot({ label, anchor = "", children }: {
  /** The accessible name. Also the mouse tooltip — as an addition to the name, never as the only one. */
  label: string;
  /** Absolute-positioning classes for the button, e.g. "absolute right-2 top-2". Needs a `relative` parent. */
  anchor?: string;
  children: ReactNode;
}) {
  return (
    <details>
      <summary
        title={label}
        className={`${SUMMARY_BASE} ${anchor} inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 hover:border-gray-400 hover:text-gray-700`}
      >
        <Icon name="info" className="h-3 w-3" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className="mt-2 space-y-1 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-2.5 text-left">
        {children}
      </div>
    </details>
  );
}

/** A disclosure whose HEADLINE stays visible — used where the summary line is itself the finding. */
export function Explain({ summary, children, className = "" }: {
  summary: string; children: ReactNode; className?: string;
}) {
  return (
    <details className={className}>
      <summary
        title={summary}
        className={`${SUMMARY_BASE} flex items-center gap-1.5 px-1 py-0.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900`}
      >
        <Icon name="info" className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className="min-w-0">{summary}</span>
      </summary>
      <div className="mt-1.5 space-y-1 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-2.5">
        {children}
      </div>
    </details>
  );
}

/** The one paragraph style the disclosures use, so a moved explanation stays readable. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-gray-600">{children}</p>;
}

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The headline a figure shows, and nothing else.
 *
 * ⚠ THE `why` IS DELIBERATELY NOT RETURNED. A caller that wants the reason has to go and render it —
 * which is the point: the compact card shows the state, the disclosure carries the sentence, and no
 * caller can accidentally print a bare "Not measured" with the reason silently dropped, because the
 * reason was never in this value to drop.
 */
export function figureHeadline(figure: Figure): { text: string; tone: "value" | "unknown" | "absent" } {
  if (figure.state === "value") return { text: figure.value.toLocaleString(), tone: "value" };
  if (figure.state === "unknown") return { text: "Could not be read", tone: "unknown" };
  return { text: "Not measured", tone: "absent" };
}

const FIGURE_INK: Record<"value" | "unknown" | "absent", string> = {
  value: "text-gray-900",
  unknown: "text-[var(--cmp-text-warning)]",
  absent: "text-gray-500",
};

/** A measurement, an unreadable, or a metric the registry refuses. Never an em dash. */
export function FigureValue({ figure, size = "lg" }: { figure: Figure; size?: "lg" | "md" | "sm" }) {
  const { text, tone } = figureHeadline(figure);
  const scale = tone === "value"
    ? { lg: "text-[28px] leading-8", md: "text-xl leading-7", sm: "text-[17px] leading-6" }[size]
    : { lg: "text-[13px] leading-5", md: "text-[12px] leading-5", sm: "text-[12px] leading-5" }[size];
  return <p className={`${scale} font-bold tabular-nums ${FIGURE_INK[tone]}`}>{text}</p>;
}

/**
 * §3: "Do not show a delta when the comparison period or data quality is insufficient."
 *
 * ⚠ THE WORDS "NOT ENOUGH DATA" STAY ON THE CARD; ONLY THE REASON MOVES. §3 prescribes the phrase, so
 * demoting it into a disclosure would be deleting the rule rather than compacting it.
 */
export function Delta({ comparison, unit }: { comparison: Comparison | null; unit: string }) {
  if (!comparison) return null;
  if (comparison.state === "insufficient")
    return <p className="text-[11px] font-semibold text-gray-500">Not enough data</p>;

  const { current, prior, direction } = comparison;
  const word = direction === "up" ? "up from" : direction === "down" ? "down from" : "level with";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "▬";
  const ink = direction === "up"
    ? "text-[var(--cmp-text-success)]"
    : direction === "down"
      ? "text-[var(--cmp-text-warning)]"
      : "text-gray-500";
  return (
    <p className={`text-[11px] font-medium tabular-nums ${ink}`}>
      <span aria-hidden="true">{arrow} </span>
      {current.toLocaleString()} {unit}, {word} {prior.toLocaleString()}
    </p>
  );
}

// ── Severity and status: a hue and a word, always both ────────────────────────────────────────────────

const SEVERITY: Record<string, { chip: string; word: string }> = {
  critical: { chip: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] border-[var(--cmp-color-critical)]", word: "Critical" },
  warning: { chip: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]", word: "Needs action" },
  info: { chip: "bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)] text-blue-700", word: "For information" },
};

export function SeverityChip({ severity }: { severity: "critical" | "warning" | "info" }) {
  const s = SEVERITY[severity];
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${s.chip}`}>
      {s.word}
    </span>
  );
}

const DOT: Record<string, string> = {
  healthy: "bg-[var(--cmp-color-success)]",
  degraded: "bg-[var(--cmp-color-warning)]",
  down: "bg-[var(--cmp-color-critical)]",
  unknown: "bg-[var(--cmp-neutral-300)]",
};

/**
 * The comp's coloured service dot — with §8's state name beside it, which is not optional.
 *
 * ⚠ `word` HAS NO DEFAULT ON PURPOSE. §15 and PD-001 §9 both forbid colour alone, and a default would
 * make the omission compile. All four of §8's states are here; today this product produces exactly one
 * of them, and the card that uses it says so in as many words.
 */
export function StatusDot({ state, word }: { state: "healthy" | "degraded" | "down" | "unknown"; word: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="text-[11px] font-medium text-gray-700">{word}</span>
    </span>
  );
}

// ── Bars ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ NO BAR WHERE THERE IS NO NUMBER — enforced by the type. `pct` is not nullable, so a caller holding
 * an uncounted row cannot render an empty track beside "could not be counted", which reads as a measured
 * zero and is the exact substitution §14 forbids.
 */
export function Bar({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "info" }) {
  return (
    <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full ${tone === "brand" ? "bg-[var(--cmp-color-primary)]" : "bg-[var(--cmp-color-secondary)]"}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// ── Absences ─────────────────────────────────────────────────────────────────────────────────────────

const TILE: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
  orange: "bg-orange-50 text-orange-600",
  sky: "bg-sky-50 text-sky-600",
  /** ⚠ THE TONE AN UNMEASURED FIGURE ALWAYS GETS. A green shield over "Not measured" is a claim. */
  neutral: "bg-gray-100 text-gray-400",
};

export type TileTone = keyof typeof TILE;

export function IconTile({ name, tone }: { name: IconName; tone: TileTone }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TILE[tone]}`}>
      <Icon name={name} className="h-4 w-4" />
    </span>
  );
}

/**
 * A stated absence, in the registry's own words.
 *
 * ⚠ THIS COMPONENT IS THE DELIVERABLE FOR FOUR OF PD-002's ELEVEN COMPONENTS, not an apology for them.
 * A reader who is told "nothing records this" can act on it; a reader shown a confident zero cannot.
 *
 * ⚠ `explainLabel` COMPACTS IT WITHOUT LOSING IT. The registry's sentences run to five lines; at
 * four-cards-across that is the whole card. With `explainLabel` set, the heading stays on the card and
 * the sentence moves one keystroke away — verbatim, never trimmed.
 */
export function Absent({ heading, why, explainLabel, children }: {
  heading: string; why: string; explainLabel?: string; children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-2.5">
      <p className="text-[12px] font-bold leading-snug text-[var(--cmp-text-warning)]">{heading}</p>
      {explainLabel
        ? <Explain summary={explainLabel} className="mt-1.5"><Note>{why}</Note></Explain>
        : <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-gray-800">{why}</p>}
      {children}
    </div>
  );
}

/** "12 of 30 (40%)" — §19 requires the denominator wherever the percentage renders. */
export function Ratio({ n, of }: { n: number | null; of: number }) {
  if (n === null)
    return <span className="text-[11px] font-semibold text-[var(--cmp-text-warning)]">Could not be counted</span>;
  const pct = of > 0 ? Math.round((n / of) * 100) : null;
  return (
    <span className="text-[11px] tabular-nums text-gray-700">
      <span className="font-semibold text-gray-900">{n.toLocaleString()}</span> of {of.toLocaleString()}
      {pct !== null && <span className="text-gray-500"> ({pct}%)</span>}
    </span>
  );
}
