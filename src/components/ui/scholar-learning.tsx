"use client";

// SCHOLAR LEARNING DESIGN SYSTEM (owner directive 4 Nov 2026): the shared presentational patterns of every Scholar learning
// stage. Learn is the first consumer; Revise, Apply, Evaluate and My Plan adopt the same components without forking.
// Spec: docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md. Colours are the PUI design tokens (tokens.ts learningTone, generated
// into globals.css as --cmp-learn-*); nothing here hard-codes a colour, calls a route or a model, or decides any learning
// rule. Every component carries its meaning in words and shape, never in colour alone.

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import type { LearningTone } from "@/lib/design/tokens";
import { notesBlocks } from "@/lib/individual/scholar/notes-layout";

export type { LearningTone } from "@/lib/design/tokens";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const kebab = (t: string) => t.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

/** The tone's role variables (--learn-surface / --learn-border / --learn-accent / --learn-ink), no box. */
export const learnTone = (t: LearningTone) => `cmp-learn-${kebab(t)}`;
/** The tone's card: soft surface, quiet border, the 16px radius. */
export const learnBox = (t: LearningTone) => `cmp-learn-${kebab(t)} cmp-learn-box`;

// ── Icons ─────────────────────────────────────────────────────────────────────────────────────────────────

export type LearningIconName = "teach" | "question" | "robot" | "book" | "compass" | "bolt" | "target" | "check" | "notes" | "library"
  | "list" | "chat" | "arrow" | "lesson" | "spark" | "miss" | "warn" | "cards" | "bulb" | "key" | "summary" | "example" | "record" | "layers" | "clock" | "search" | "chevron";

/** A line icon in currentColor. Always decorative: the words beside it say what it is. */
export function LearningIcon({ name, className = "h-5 w-5" }: { name: LearningIconName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} {...p}>
      {name === "teach" && <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c2 2 10 2 12 0v-5" /><path d="M22 9v6" /></>}
      {name === "question" && <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.3" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>}
      {name === "robot" && <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4" /><circle cx="12" cy="3.5" r="1" /><circle cx="9" cy="13" r="1.2" fill="currentColor" /><circle cx="15" cy="13" r="1.2" fill="currentColor" /><path d="M2 12v3M22 12v3" /></>}
      {name === "book" && <><path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z" /><path d="M12 6v13" /></>}
      {name === "compass" && <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>}
      {name === "bolt" && <path d="M13 2L4 14h7l-1 8 9-12h-7z" />}
      {name === "target" && <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>}
      {name === "check" && <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></>}
      {name === "notes" && <><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4" /><path d="M8 13h8M8 17h5" /></>}
      {name === "library" && <><path d="M4 4h4v16H4zM10 4h4v16h-4z" /><path d="M16 5l3.5-1 2.5 15.5-3.5 1z" /></>}
      {name === "list" && <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></>}
      {name === "chat" && <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>}
      {name === "arrow" && <path d="M5 12h14M13 6l6 6-6 6" />}
      {name === "lesson" && <><path d="M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z" /><path d="M9 11.5l2 2 4-4" /></>}
      {name === "spark" && <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />}
      {name === "miss" && <><circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" /><path d="M12 8v5" /><circle cx="12" cy="16" r=".6" fill="currentColor" /></>}
      {name === "warn" && <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>}
      {name === "cards" && <><rect x="3" y="6" width="13" height="14" rx="2" /><path d="M8 3h11a2 2 0 012 2v12" /></>}
      {name === "bulb" && <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z" /></>}
      {name === "key" && <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />}
      {name === "summary" && <path d="M5 6h14M5 12h14M5 18h9" />}
      {name === "example" && <path d="M4 5h16v11H10l-5 4v-4H4z" />}
      {name === "record" && <><path d="M6 3h8l4 4v14H6z" /><path d="M9 11h6M9 15h6" /></>}
      {name === "layers" && <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>}
      {name === "clock" && <><path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.5 8.5 0 005.6 6.4L3.5 8.5" /><path d="M3.5 4v4.5H8" /><path d="M12 7.5V12l3 2" /></>}
      {name === "search" && <><circle cx="11" cy="11" r="7" /><path d="M20.5 20.5L16 16" /></>}
      {name === "chevron" && <path d="M9 5l7 7-7 7" />}
    </svg>
  );
}

// ── Section shell ─────────────────────────────────────────────────────────────────────────────────────────

/** A section heading: the icon in a round tile, the title in the tone's ink, optional trailing content (a badge, an action). */
export function LearningSectionHead({ icon, title, id, level = 3, trailing, className = "", caps = true }: {
  icon: LearningIconName; title: ReactNode; id?: string; level?: 2 | 3 | 4 | 5; trailing?: ReactNode; className?: string;
  /** Small capitals (a section label) or a sentence-case title. */
  caps?: boolean;
}) {
  const H = `h${level}` as "h2" | "h3" | "h4" | "h5";
  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 ${className}`}>
      <span className="cmp-learn-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)]"><LearningIcon name={icon} className="h-[18px] w-[18px]" /></span>
      <H id={id} className={`cmp-learn-ink min-w-0 flex-1 break-words font-bold ${caps ? "text-[13px] uppercase tracking-[0.08em]" : "text-[17px]"}`}>{title}</H>
      {trailing}
    </div>
  );
}

/** The section shell: a card in its tone, with its heading. Pass `ariaLabel` when the section has no heading id. */
export function LearningSection({ tone, icon, title, level = 3, id, headingId, trailing, caps, className = "", ariaLabel, children }: {
  tone: LearningTone; icon: LearningIconName; title: ReactNode; level?: 2 | 3 | 4 | 5; id?: string; headingId?: string; trailing?: ReactNode;
  caps?: boolean; className?: string; ariaLabel?: string; children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={ariaLabel ? undefined : headingId} aria-label={ariaLabel} className={`${learnBox(tone)} p-4 sm:p-5 ${className}`}>
      <LearningSectionHead icon={icon} title={title} id={headingId} level={level} trailing={trailing} caps={caps} />
      {children}
    </section>
  );
}

/**
 * A collapsible section in its tone (native details/summary: keyboard operable, and its expanded state is announced).
 * The body sits on the white card surface so long text reads on white, framed by the tone.
 */
export function LearningDisclosure({ tone, icon, title, meta, open, onToggle, className = "", bodyClassName = "", children }: {
  tone: LearningTone; icon: LearningIconName; title: ReactNode; meta?: ReactNode; open?: boolean; onToggle?: (open: boolean) => void;
  className?: string; bodyClassName?: string; children: ReactNode;
}) {
  return (
    <details open={open} onToggle={onToggle ? e => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined} className={`group ${learnBox(tone)} ${className}`}>
      <summary className={`flex min-h-[48px] cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl px-4 py-2 text-[14px] font-bold pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span className="cmp-learn-accent"><LearningIcon name={icon} className="h-5 w-5" /></span>
        <span className="cmp-learn-ink">{title}</span>
        {meta}
        <span aria-hidden="true" className="cmp-learn-accent ml-auto text-[10px] motion-safe:transition-transform group-open:rotate-90">▶</span>
      </summary>
      <div className={`rounded-b-2xl border-t border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-4 py-3 ${bodyClassName}`}>{children}</div>
    </details>
  );
}

// ── Selectable style card ─────────────────────────────────────────────────────────────────────────────────

/**
 * One choice of a radio group, as a card in its tone. Selected is never colour alone: a 2px accent edge with a ring, the
 * word "Selected", a filled tick badge and a stronger surface; unselected keeps a 1px edge and an empty ring. The caller
 * owns the radiogroup and its arrow keys (roving tabIndex): every other button attribute passes through.
 */
export const StyleCard = forwardRef<HTMLButtonElement, {
  tone: LearningTone; icon: LearningIconName; label: ReactNode; description: ReactNode; selected: boolean; descriptionId?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">>(function StyleCard({ tone, icon, label, description, selected, descriptionId, className = "", ...rest }, ref) {
  return (
    <button ref={ref} type="button" role="radio" aria-checked={selected} aria-describedby={descriptionId} {...rest}
      className={`${learnTone(tone)} relative flex min-h-[44px] flex-col gap-1.5 rounded-2xl px-3.5 py-3 text-left disabled:opacity-60 pointer-coarse:min-h-[var(--cmp-touch-min)] ${selected ? "border-2 border-[var(--learn-accent)] bg-[var(--learn-surface)] shadow-[0_0_0_3px_var(--learn-border)]" : "border border-[var(--learn-border)] bg-[color-mix(in_srgb,var(--learn-surface)_55%,var(--cmp-app-surface))] hover:bg-[var(--learn-surface)]"} ${focusRing} ${className}`}>
      {/* The title row (icon, label, tick) over the description, so a narrow card never squeezes the words. */}
      <span className="flex w-full items-start gap-2.5">
        <span className="cmp-learn-accent mt-0.5"><LearningIcon name={icon} className="h-6 w-6" /></span>
        <span className="cmp-learn-ink flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-bold leading-snug">{label}{selected && <span className="rounded-full bg-[var(--learn-ink)] px-2 py-px text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--learn-surface)]">Selected</span>}</span>
        <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-[var(--learn-accent)] text-[var(--cmp-app-surface)]" : "ring-1 ring-inset ring-[var(--learn-accent)]"}`}>
          {selected && <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>}
        </span>
      </span>
      <span id={descriptionId} className="block text-[13px] leading-snug text-gray-700">{description}</span>
    </button>
  );
});

// ── Question card ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * One understanding question, on a white row inside its section. States:
 *   unanswered  the action is the filled button
 *   answered    a tick and the last outcome in words ("Answered · Partly understood"); the action steps back to outlined
 *   open / feedback  `children` (the answer form, then its feedback) follows under the question
 * The question text, action label and outcome wording come from the caller; this decides none of them.
 */
export function QuestionCard({ question, answered, action, children }: {
  question: ReactNode; answered?: string | null; action?: { label: string; onClick: () => void; disabled?: boolean } | null; children?: ReactNode;
}) {
  return (
    <li className="rounded-xl bg-[var(--cmp-app-surface)] px-3.5 py-3 ring-1 ring-[var(--learn-border)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 basis-[14rem] text-[14.5px] leading-relaxed text-gray-900">{question}</span>
        {answered && <span className="cmp-learn-ink inline-flex items-center gap-1 rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2.5 py-0.5 text-[12px] font-semibold"><LearningIcon name="check" className="h-3.5 w-3.5" />Answered · {answered}</span>}
        {action && (
          <button type="button" onClick={action.onClick} disabled={action.disabled}
            className={`inline-flex min-h-[40px] items-center rounded-full border px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${answered ? "border-[var(--learn-accent)] bg-[var(--cmp-app-surface)] text-[var(--learn-ink)] hover:bg-[var(--learn-surface)]" : "border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)] hover:opacity-90"} ${focusRing}`}>{action.label}</button>
        )}
      </div>
      {children}
    </li>
  );
}

/** A verdict said in words with a shape: a ring with a tick (understood), a half disc (partly), a dashed ring (not yet). */
export function VerdictLine({ value, label, informal }: { value: string; label: string; informal?: string }) {
  return (
    <p className="flex items-start gap-2 text-[14px] text-gray-900">
      <span className="cmp-learn-accent"><ProgressMark state={value === "understood" ? "checked" : value === "partly" ? "read" : "none"} /></span>
      <span className="min-w-0"><span className="cmp-learn-ink font-bold">{label}.</span>{informal ? ` ${informal}` : ""}</span>
    </p>
  );
}

export type FeedbackKind = "right" | "missing" | "misconceptions" | "keyPoints" | "next";
const FEEDBACK_ICON: Record<FeedbackKind, { icon: LearningIconName; cls: string }> = {
  right: { icon: "check", cls: "cmp-learn-accent" }, missing: { icon: "miss", cls: "cmp-learn-accent" },
  // Misconceptions take the calm revision (amber) family, never red: feedback is formative, never punitive.
  misconceptions: { icon: "warn", cls: "text-[var(--cmp-role-revision-strong)]" }, keyPoints: { icon: "list", cls: "cmp-learn-accent" },
  next: { icon: "arrow", cls: "text-[var(--cmp-learn-next-accent)]" },
};
/**
 * Feedback in its parts, each a heading with its own icon so correct / missing / misconceptions / key points / next action
 * read apart without colour. The caller gives the headings (its own wording) and the bodies, in its order.
 */
export function FeedbackParts({ parts, level = 5, compact = false }: { parts: { kind: FeedbackKind; heading: string; body: ReactNode }[]; level?: 4 | 5; compact?: boolean }) {
  const H = `h${level}` as "h4" | "h5";
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {parts.map(p => (
        <div key={p.kind} className="flex items-start gap-2.5">
          <span className={`mt-0.5 ${FEEDBACK_ICON[p.kind].cls}`}><LearningIcon name={FEEDBACK_ICON[p.kind].icon} className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} /></span>
          <div className="min-w-0 flex-1"><H className={`${compact ? "text-[11.5px]" : "text-[12px]"} font-bold uppercase tracking-[0.08em] text-gray-700`}>{p.heading}</H>{p.body}</div>
        </div>
      ))}
    </div>
  );
}

// ── Progress-state list item ──────────────────────────────────────────────────────────────────────────────

export type ProgressState = "current" | "completed" | "checked" | "taught" | "read" | "none";
/** Shapes differ, so the state is legible without colour: filled dot, filled disc with tick, ring with tick, ring with dot, half disc, dashed ring. */
export function ProgressMark({ state }: { state: ProgressState }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      {state === "current" && <circle cx="8" cy="8" r="5" fill="currentColor" />}
      {state === "completed" && <><circle cx="8" cy="8" r="6.6" fill="currentColor" /><path d="M5 8.2l2 2 4-4.2" stroke="white" /></>}
      {state === "checked" && <><circle cx="8" cy="8" r="6.2" /><path d="M5 8.2l2 2 4-4.2" /></>}
      {state === "taught" && <><circle cx="8" cy="8" r="6.2" /><circle cx="8" cy="8" r="2.6" fill="currentColor" /></>}
      {state === "read" && <><circle cx="8" cy="8" r="6.2" /><path d="M8 1.8a6.2 6.2 0 010 12.4z" fill="currentColor" /></>}
      {state === "none" && <circle cx="8" cy="8" r="6.2" strokeDasharray="2.2 2" />}
    </svg>
  );
}

/**
 * One item of a progress list (lessons, plan steps): number, wrapping title, state in words with its mark. The current item
 * is a filled row and aria-current; completed / in progress / not started differ by the mark's shape and the words, with a
 * quiet tint on the mark only. Sits inside an element with a learning tone (the list's tone colours the current row).
 */
export function ProgressListItem({ number, title, stateLabel, state, current, onClick }: {
  number?: number; title: string; stateLabel: string; state: ProgressState; current: boolean; onClick: () => void;
}) {
  const markTone = current ? "" : state === "completed" ? "text-[var(--cmp-learn-explain-accent)]" : state === "none" ? "text-gray-500" : "cmp-learn-accent";
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={current ? "step" : undefined}
        className={`flex min-h-[44px] w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] leading-snug pointer-coarse:min-h-[var(--cmp-touch-min)] ${current ? "bg-[var(--learn-ink)] text-[var(--learn-surface)] shadow-sm" : "text-gray-900 hover:bg-[var(--learn-surface)]"} ${focusRing}`}>
        <span className={markTone}><ProgressMark state={state} /></span>
        <span className="min-w-0">
          <span className="block break-words">{number !== undefined && <span className="font-semibold">{number}. </span>}<span className={current ? "font-semibold" : ""}>{title}</span></span>
          <span className={`mt-0.5 block text-[12px] ${current ? "" : "text-gray-600"}`}>{stateLabel}</span>
        </span>
      </button>
    </li>
  );
}

// ── Source and citation chips ─────────────────────────────────────────────────────────────────────────────

/**
 * An inline citation ([S3]) linking to the cited section. In the tone's ink inside a section, the Scholar ink elsewhere;
 * an AI-read source carries a visible "AI" mark as well as its note in the accessible name.
 */
export function CitationChip({ tag, href, label, aiRead = false }: { tag: string; href: string; label: string; aiRead?: boolean }) {
  return (
    <Link href={href} title={label} aria-label={`Source ${tag}: ${label}`}
      className={`rounded font-mono text-[12.5px] font-bold text-[var(--learn-ink,var(--cmp-product-scholar-ink))] underline underline-offset-2 pointer-coarse:px-1 pointer-coarse:py-1 ${focusRing}`}>
      [{tag}]{aiRead && <sup aria-hidden="true" className="ml-px text-[9px] font-bold">AI</sup>}
    </Link>
  );
}

/** A source as a list row: its tag chip, the citation as a link, and an optional note under it. */
export function SourceLink({ tag, href, citation, note, children }: { tag?: string; href: string; citation: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="break-words text-[13px] text-gray-800">
      {tag && <span className="cmp-learn-ink mr-1.5 inline-flex rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-1.5 font-mono text-[11.5px] font-bold">{tag}</span>}
      <Link href={href} className={`text-gray-900 underline underline-offset-2 ${focusRing}`}>{citation}</Link>
      {note}
      {children}
    </div>
  );
}

// ── Action band ───────────────────────────────────────────────────────────────────────────────────────────

export type BandAction = { label: ReactNode; onClick?: () => void; href?: string; disabled?: boolean; describedBy?: string; icon?: LearningIconName };
/**
 * A primary / secondary action band (What next?): ONE filled primary action, the rest outlined. Nothing here moves the
 * learner by itself; every action is a click. `children` sits between the heading and the actions (a reason, a note).
 */
export function ActionBand({ tone = "next", icon = "target", title, headingId, primary, secondary, children }: {
  tone?: LearningTone; icon?: LearningIconName; title: ReactNode; headingId: string; primary?: BandAction | null; secondary: BandAction[]; children?: ReactNode;
}) {
  const base = `inline-flex min-h-[44px] max-w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[14px] font-semibold disabled:opacity-50 ${focusRing}`;
  const second = `${base} border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]`;
  const one = (a: BandAction, cls: string, key?: number) => {
    const inner = <>{a.icon && <span className="cmp-learn-accent"><LearningIcon name={a.icon} className="h-4 w-4" /></span>}<span className="min-w-0 break-words">{a.label}</span></>;
    return a.href
      ? <Link key={key} href={a.href} className={cls} onClick={a.onClick}>{inner}</Link>
      : <button key={key} type="button" className={cls} onClick={a.onClick} disabled={a.disabled} aria-describedby={a.describedBy}>{inner}</button>;
  };
  return (
    <section aria-labelledby={headingId} className={`${learnBox(tone)} p-4 sm:p-5`}>
      <LearningSectionHead level={3} id={headingId} icon={icon} caps={false} title={title} />
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2 pointer-coarse:flex-col pointer-coarse:items-stretch">
        {primary && (
          <button type="button" className={`${base} min-h-[48px] bg-[var(--learn-ink)] text-[var(--learn-surface)] hover:opacity-90`} onClick={primary.onClick} disabled={primary.disabled} aria-describedby={primary.describedBy}>
            <span className="min-w-0 break-words">{primary.label}</span><LearningIcon name={primary.icon ?? "arrow"} className="h-4 w-4" />
          </button>
        )}
        {secondary.map((a, i) => one(a, second, i))}
      </div>
    </section>
  );
}

// ── Disclaimer badge ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A provenance / safety disclaimer, always visible and always in words: "AI-generated from your notes, not clinically
 * reviewed", "formative, not an assessment". Amber (the revision role), the unreviewed colour: never a reassuring green
 * or teal, so no badge can be read as clinical verification. The caller supplies the exact wording it has always used.
 */
export function DisclaimerBadge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--cmp-role-revision-ink)] ${className}`}>
      <span aria-hidden>✦</span>{children}
    </p>
  );
}

// ── Callout ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * An answer callout (Clinical caution, Key concept, Memory aid, Example, From your record, Summary, General background) in
 * its learning tone, with its icon and label in words. `emphasis`: "safety" (caution) is the strongest -- a full 2px edge and
 * a 6px rule; "prominent" (memory) a full edge and a 4px rule; "standard" the 4px rule only.
 */
export function LearningCallout({ tone, icon, label, emphasis = "standard", children }: {
  tone: LearningTone; icon: LearningIconName; label: string; emphasis?: "safety" | "prominent" | "standard"; children: ReactNode;
}) {
  const edge = emphasis === "safety" ? "border-2 border-l-[6px] border-[var(--learn-accent)]"
    : emphasis === "prominent" ? "border border-l-4 border-[var(--learn-border)] border-l-[var(--learn-accent)]"
    : "border-l-4 border-[var(--learn-accent)]";
  return (
    <aside role="note" aria-label={label} className={`${learnTone(tone)} rounded-lg bg-[var(--learn-surface)] px-3.5 py-3 ${edge}`}>
      <p className={`cmp-learn-ink flex items-center gap-1.5 font-bold uppercase tracking-[0.08em] ${emphasis === "standard" ? "text-[12.5px]" : "text-[13px]"}`}>
        <span className="cmp-learn-accent"><LearningIcon name={icon} className="h-[18px] w-[18px]" /></span>{label}
      </p>
      <div className="mt-1.5 space-y-1.5 text-[15px] leading-[1.6] text-gray-900">{children}</div>
    </aside>
  );
}

// ── Inside a section (LEARN SECTIONS HFE, owner 4 Nov 2026: "improve HFE and reading ease") ──────────────────────────

/** The consistent action classes: ONE primary (filled in the tone's ink) and secondary (outlined) per row. 44px on touch. */
export const learnAction = {
  primary: `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[var(--learn-ink)] bg-[var(--learn-ink)] px-4 py-1.5 text-[13.5px] font-semibold text-[var(--learn-surface)] hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`,
  secondary: `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3.5 py-1.5 text-[13.5px] font-semibold text-gray-900 hover:bg-[var(--learn-surface)] disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`,
  link: `inline-flex min-h-[40px] items-center gap-1 rounded text-[13.5px] font-semibold text-[var(--learn-ink)] underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`,
} as const;

/** A light card INSIDE a section (one notes section, one source, one previous check): white, a hairline in the tone. */
export function SectionCard({ as: As = "div", id, className = "", children }: { as?: "div" | "li" | "article"; id?: string; className?: string; children: ReactNode }) {
  return <As id={id} className={`rounded-xl bg-[var(--cmp-app-surface)] p-4 ring-1 ring-[var(--learn-border)] ${className}`}>{children}</As>;
}

/** One consistent action row at the foot of a card: primary first, then secondary; wraps on a phone. */
export function ActionRow({ label, children, className = "" }: { label?: string; children: ReactNode; className?: string }) {
  return <div role="group" aria-label={label} className={`mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--learn-border)] pt-3 ${className}`}>{children}</div>;
}

/** A short source reference as a chip that opens it ("Slide 14"); the full citation is its accessible name and title. */
export function RefChip({ href, text, citation }: { href: string; text: string; citation: string }) {
  return (
    <Link href={href} title={`Open in the material: ${citation}`} aria-label={`Open in the material: ${citation}`}
      className={`cmp-learn-ink inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2.5 text-[12.5px] font-semibold hover:underline pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
      {text}<svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" /></svg>
    </Link>
  );
}

/**
 * A calm inline note with its icon, never an alarm: "info" for a plain state (a slide with no text), "ai" for provenance that
 * must stay visible (text read by AI from a picture), in the amber unreviewed colour.
 */
export function InlineNote({ kind = "info", children, className = "" }: { kind?: "info" | "ai"; children: ReactNode; className?: string }) {
  const cls = kind === "ai" ? "border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]" : "border-[var(--learn-border)] bg-[var(--learn-surface)] text-gray-800";
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13.5px] leading-snug ${cls} ${className}`}>
      <span className="mt-0.5 shrink-0"><LearningIcon name={kind === "ai" ? "robot" : "notes"} className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

/**
 * The learner's own notes laid out for reading (notes-layout.ts: paragraphs and lists from the structure the text already has,
 * never a word changed), in the reading type at a comfortable measure (about 70 characters).
 */
export function NotesText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = notesBlocks(text);
  return (
    <div data-notes-body className={`cmp-reading max-w-[68ch] break-words text-gray-900 ${className}`}>
      {blocks.map((b, i) => b.kind === "para"
        ? <p key={i} className={b.text.endsWith(":") && blocks[i + 1]?.kind === "list" ? "font-semibold" : undefined}>{b.text}</p>
        : <ul key={i} className={`my-2 space-y-1 pl-5 marker:text-[var(--learn-accent)] ${b.marked ? "list-disc" : "list-[circle]"}`}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>)}
    </div>
  );
}

/**
 * A toggle choice as a card (Flashcards, Quiz, Apply): pressed is a 2px accent edge, the word "Selected", never colour alone.
 * `href` makes it a link (then never pressed).
 */
export function ChoiceCard({ tone, icon, label, hint, pressed = false, onClick, href }: {
  tone: LearningTone; icon: LearningIconName; label: string; hint: string; pressed?: boolean; onClick?: (e: MouseEvent) => void; href?: string;
}) {
  const cls = `${learnTone(tone)} flex w-full min-h-[44px] items-start gap-3 rounded-xl px-3.5 py-2.5 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${pressed ? "border-2 border-[var(--learn-accent)] bg-[var(--learn-surface)]" : "border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] hover:bg-[var(--learn-surface)]"} ${focusRing}`;
  const inner = (
    <>
      <span className="cmp-learn-accent mt-0.5"><LearningIcon name={icon} className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="cmp-learn-ink flex flex-wrap items-center gap-x-2 text-[14.5px] font-bold">{label}{pressed && <span className="rounded-full bg-[var(--learn-ink)] px-2 py-px text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--learn-surface)]">Selected</span>}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-gray-700">{hint}</span>
      </span>
    </>
  );
  return href
    ? <a href={href} onClick={onClick} className={cls}>{inner}</a>
    : <button type="button" aria-pressed={pressed} onClick={onClick} className={cls}>{inner}</button>;
}

/**
 * One answer option of a marked question. After marking: the option matching the notes says so with a tick; the learner's other
 * choice says "Your answer" with a calm amber mark. Never red, never colour alone; the radio stays the real control.
 */
export function AnswerOption({ name, checked, onChange, mark, children }: {
  name: string; checked: boolean; onChange: () => void; mark: "" | "right" | "chosen"; children: ReactNode;
}) {
  const edge = mark === "right" ? "border-2 border-[var(--learn-accent)] bg-[var(--learn-surface)]" : mark === "chosen" ? "border-2 border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)]" : checked ? "border-2 border-[var(--learn-ink)] bg-[var(--cmp-app-surface)]" : "border border-gray-300 bg-[var(--cmp-app-surface)] hover:bg-[var(--learn-surface)]";
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-2.5 text-[14.5px] leading-snug text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${edge}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className={`mt-0.5 h-4 w-4 shrink-0 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
      <span className="min-w-0 flex-1 break-words">{children}
        {mark === "right" && <span className="cmp-learn-ink mt-1 flex items-center gap-1 text-[12.5px] font-bold"><LearningIcon name="check" className="h-4 w-4" />Matches your notes</span>}
        {mark === "chosen" && <span className="mt-1 flex items-center gap-1 text-[12.5px] font-bold text-[var(--cmp-role-revision-ink)]"><LearningIcon name="miss" className="h-4 w-4" />Your answer</span>}
      </span>
    </label>
  );
}
