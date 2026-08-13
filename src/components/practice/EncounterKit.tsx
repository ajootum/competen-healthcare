import type { ReactNode } from "react";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ENCOUNTER WORKSPACE KIT (CP-ENC-DIAG-001, CP-ENC-PROC-001, and the six tabs beside them).
//
// The owner, 2026-08-12: "replicate the colour schemes as depicted here. Extrapolate the concept to the
// rest of the tabs." The eight tabs of EncounterConsole are already built -- these comps are a REDESIGN
// of working screens, not a specification for missing ones -- and every one of them draws the same six
// things: a section header with an About affordance, two rows of quick-pick chips, a working set with
// requirement badges, a batch action naming its own count, a tip band and an empty state.
//
// ⚠ ONE DEFINITION, HERE, FOR THE REASON THE PATIENT TABLES HAVE ONE. Five patient tables were restyled
// separately over months and drifted until a sticky header meant three different things. Eight tabs is
// worse odds. Anything a second tab would copy belongs in this file the moment there is a second tab.
//
// ⚠ NO "use client". These are plain render functions, so a server component may use them. The stateful
// parts of a tab -- the working set, the search box -- stay in the tab that owns them, and receive
// strings rather than functions from the server: a function on a payload handed to a client component
// type-checks, lints, passes every harness and kills the page at runtime.
//
// ⚠ AND NO COLOUR CARRIES MEANING ALONE. Every badge below prints a word; the tint reinforces it. A
// clinician who cannot separate amber from green still reads "Required details".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The card every tab section sits in. */
export const PANEL = "rounded-xl border border-gray-200 bg-white";

/**
 * A section heading with its optional About control -- the comp's "About procedures" / "About ongoing
 * problems" pill, top right of every tab.
 *
 * `about` is a NODE rather than a handler, so a server-rendered tab can pass a link and a client tab can
 * pass a button. The kit does not decide which, because the tabs genuinely differ.
 */
export function SectionHeader({ title, subtitle, about }: {
  title: string; subtitle?: string; about?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
      <div>
        <h2 className="text-[14px] font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-gray-500">{subtitle}</p>}
      </div>
      {about}
    </div>
  );
}

/** The outlined "About …" pill. Rendered by the caller so it can be a link or a disclosure button. */
export const ABOUT_PILL =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 "
  + "text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]";

/**
 * A row of quick-pick chips under a small heading -- the comp's "Recent" and "Common in my practice".
 *
 * ⚠ AN EMPTY SET IS NOT RENDERED AS AN EMPTY ROW. A heading with nothing under it reads as a feature
 * that is broken; a practice with no recent items simply has not used one yet, and the caller says so
 * once rather than leaving a labelled void.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[220px] flex-1">
      <p className="text-[11.5px] font-bold text-[var(--cp-primary-deep)]">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export const CHIP =
  "rounded-lg bg-[var(--cp-primary)]/[0.07] px-2.5 py-1 text-[12px] font-semibold "
  + "text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/[0.14]";

/**
 * The badges beside an item in the working set: "Required details", "No consent required", "Performed".
 *
 * ⚠ THE TONES ARE FIXED AND FEW ON PURPOSE. The comp uses amber for "this item still needs something",
 * green for "nothing further is needed", and the practice indigo for a neutral classification. A fourth
 * tone invented per tab is how two screens come to disagree about what amber means -- which is the
 * failure the appointment status palette was consolidated to end.
 */
export type BadgeTone = "needs" | "settled" | "neutral" | "muted";

const BADGE_TONE: Record<BadgeTone, string> = {
  needs: "bg-amber-100 text-amber-800",
  settled: "bg-emerald-100 text-emerald-700",
  neutral: "bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]",
  muted: "bg-gray-100 text-gray-600",
};

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${BADGE_TONE[tone]}`}>
      {children}
    </span>
  );
}

/** The working-set table's chrome. Light dividers, no zebra, a hover state -- as the patient tables. */
export const WS_HEAD = "bg-gray-50/80";
export const WS_TH = "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500";
export const WS_ROW = "border-t border-gray-100 transition-colors hover:bg-gray-50/60";
export const WS_TD = "px-3 py-2.5 align-middle text-[12.5px] text-gray-800";

/**
 * ══ THE RECORDED TABLE ═══════════════════════════════════════════════════════════════════════════
 *
 * What is already IN the record, as against WS_* above, which is the working set still being typed.
 * Diagnoses, procedures and treatments all render one of these, so a reader learns the shape once.
 *
 * ⚠ THE STRIPE AND THE LEFT EDGE ARE DIFFERENT JOBS, AND KEEPING BOTH IS THE POINT. The stripe answers
 * a POSITIONAL question -- where does this row end and the next begin, once there are six of them. The
 * left edge answers a CLINICAL one -- how settled is this finding, did this procedure actually happen.
 * Collapsing them into one signal would either throw the meaning away or make every second row look
 * significant, and a colour that means something on odd rows and nothing on even rows means nothing.
 *
 * ⚠ THE STRIPE IS DELIBERATELY FAINT. It is navigation, not information. Anything stronger competes
 * with the edge colour that a clinician is actually meant to read.
 */
export const REC_TABLE = "w-full border-collapse";
export const REC_HEAD = "bg-gray-50/80";
export const REC_TH = "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500";
export const REC_TD = "px-3 py-2.5 align-middle text-[12.5px] text-gray-800";

/**
 * One recorded row: the zebra stripe, plus the 3px slot the caller colours by meaning.
 *
 * ⚠ THE LEADING ROW BEATS THE STRIPE. Whether a row is the primary diagnosis must not depend on
 * whether it happens to have landed in an even position -- that would make the most important row on
 * the table invisible half the time, decided by how many rows precede it.
 *
 * The caller supplies borderLeftColor and borderLeftStyle inline, from its own domain vocabulary. This
 * file deliberately holds no clinical meaning: it knows there IS an edge, never what it says.
 */
export function recRow(index: number, opts: { leading?: boolean } = {}): string {
  const base = "border-t border-gray-100 border-l-[3px] transition-colors";
  return opts.leading
    ? `${base} bg-[var(--cp-primary-soft)]`
    : `${base} ${index % 2 === 1 ? "bg-gray-50/60" : "bg-white"} hover:bg-gray-50`;
}

/** The drag affordance at the head of each working-set row. Decorative until reordering is real. */
export function DragHandle({ label }: { label: string }) {
  return (
    <span aria-hidden="true" title={`Reorder ${label}`} className="cursor-grab select-none text-[13px] leading-none text-gray-300">
      &#8942;&#8942;
    </span>
  );
}

/** The destructive row control. Red, outlined, and never the only way to undo something. */
export const ROW_REMOVE =
  "rounded-lg border border-rose-200 px-2 py-1 text-[12px] font-semibold text-rose-600 hover:bg-rose-50";

/**
 * The batch commit bar -- the comp's "Record 2 procedures" beside "Clear all".
 *
 * ⚠ THE COUNT IS IN THE LABEL BECAUSE THE WHOLE PATTERN IS BATCH ENTRY. "Record" alone, over a working
 * set of four, is a button whose consequence is invisible at the moment of pressing it. Both specs put
 * the number there and both are right to.
 *
 * ⚠ AND IT IS DISABLED AT NOUGHT, WITH THE NOUN STILL CORRECT. A live button that would record nothing
 * teaches people that pressing it does nothing, which is exactly what they will assume the day it fails
 * for a real reason.
 */
export function CommitBar({ count, noun, pluralNoun, onClearLabel = "Clear all", disabled, children }: {
  count: number; noun: string; pluralNoun?: string; onClearLabel?: string; disabled?: boolean; children?: ReactNode;
}) {
  const word = count === 1 ? noun : (pluralNoun ?? `${noun}s`);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
      {children}
      <span className="sr-only">{count} {word} in the working set</span>
      <button type="button" disabled={disabled || count === 0}
        className="rounded-lg border border-gray-200 px-3.5 py-2 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        {onClearLabel}
      </button>
      <button type="submit" disabled={disabled || count === 0}
        className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
        Record {count} {word}
      </button>
    </div>
  );
}

/** The tip band at the foot of a tab. Guidance, never a warning -- see TIP vs NOTICE below. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-[var(--cp-primary)]/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-gray-600">
      <span aria-hidden="true" className="mt-px text-[12px] text-[var(--cp-primary)]">&#9432;</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * The empty state -- the comp's "No diagnosis recorded yet".
 *
 * ⚠ IT TAKES A `reason` BECAUSE THIS PRODUCT HAS THREE EMPTY STATES AND NOT TWO. Nothing recorded, not
 * permitted to see, and could not be read are different facts, and a tab that draws them identically
 * tells a clinician a patient has no diagnoses when the query failed. Callers pass the sentence; the kit
 * refuses to invent one.
 */
export function EmptyState({ title, reason, tone = "neutral" }: {
  title: string; reason: string; tone?: "neutral" | "problem";
}) {
  const isProblem = tone === "problem";
  return (
    <div className={`flex items-start gap-3 rounded-lg px-4 py-5 ${isProblem
      ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
      : "bg-gray-50/70 text-gray-600"}`}>
      <span aria-hidden="true" className="text-[16px] opacity-60">{isProblem ? "⚠" : "☷"}</span>
      <div>
        <p className={`text-[13px] font-semibold ${isProblem ? "" : "text-gray-800"}`}>{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed">{reason}</p>
      </div>
    </div>
  );
}

/**
 * AN ADVISORY THAT COSTS ONE LINE UNTIL IT IS ASKED FOR.
 *
 * The owner, 2026-08-12, of the pre-close notes: "drop this to a one-liner with click to see more. this
 * important space that is being eaten up." A block that is permanently open spends the same vertical
 * room whether or not anybody is reading it, and on a consultation screen that room is the record.
 *
 * ⚠ THE COUNT AND THE TONE STAY ON THE CLOSED LINE. Collapsing to "Notes" alone would hide HOW MANY
 * there are, and somebody deciding whether to open it needs exactly that. Four outstanding notes and
 * one are different situations, and the summary must say which without being opened.
 *
 * ⚠ AND IT IS <details>, NOT useState. No client component, no hydration boundary, keyboard-operable for
 * free, and -- the part that matters on this screen -- it PRINTS OPEN, because `open` is what the print
 * stylesheet can force. A React-collapsed block is absent from the DOM and cannot be recovered onto
 * paper, which is the trap the Booked and seen day-groups had to avoid.
 */
export function Advisory({ tone = "note", summary, count, children }: {
  tone?: "note" | "warn";
  summary: string;
  /** Shown on the closed line. Omit only where a count would be meaningless. */
  count?: number;
  children: ReactNode;
}) {
  const warn = tone === "warn";
  return (
    <details className={`group rounded-xl border ${warn
      ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50/70"}`}>
      <summary className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-bold ${warn
        ? "text-amber-800" : "text-gray-700"}`}>
        <span aria-hidden="true" className="text-[9px] transition-transform group-open:rotate-90">&#9654;</span>
        {summary}
        {count !== undefined && (
          <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${warn
            ? "bg-amber-200/70 text-amber-900" : "bg-gray-200 text-gray-700"}`}>
            {count}
          </span>
        )}
        <span className="ml-auto text-[10.5px] font-semibold opacity-60 group-open:hidden">show</span>
        <span className="ml-auto hidden text-[10.5px] font-semibold opacity-60 group-open:inline">hide</span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}
