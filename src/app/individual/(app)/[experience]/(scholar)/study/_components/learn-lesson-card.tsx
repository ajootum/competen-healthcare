"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LessonStatus } from "@/lib/individual/scholar/learn-journey";
import { Mark } from "./learn-journey-nav";
import { ActionBand, LearningIcon, learnBox, learnTone, type BandAction } from "@/components/ui/scholar-learning";

// SCHOLAR-COMPANION-01 P0b: THE PIECES OF THE CONTINUOUS JOURNEY. Presentation only: every button here runs an action
// learn-client.tsx already has (Teach, Go deeper, Examples, the check, Practise, Apply, Finish); nothing here calls a
// route or a model. Calm and plain: no streaks, points, badges or celebration -- the learner's progress is said in words.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const chip = `inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

export const lessonDomId = (step: number) => `lesson-${step}`;
export const lessonHeadingId = (step: number) => `lesson-${step}-h`;

/** One lesson of the journey: a labelled region with its own heading (the navigator focuses it on a jump). */
export function LessonCard({ step, index, count, title, objective, status, accent, children }: {
  step: number; index: number; count: number; title: string; objective: string; status: string; accent: string; children: ReactNode;
}) {
  return (
    // LESSON REDESIGN: the lesson is not one big box around boxes. Its header is a card of its own; its sections follow as
    // sibling cards, each in its own colour identity (learn-section.tsx).
    <section id={lessonDomId(step)} data-lesson-index={index} aria-labelledby={lessonHeadingId(step)} className="scroll-mt-4">
      <div className={`${learnTone("teach")} flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5`}>
        <span className="cmp-learn-accent hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--learn-surface)] ring-1 ring-[var(--learn-border)] @min-[30rem]:inline-flex"><LearningIcon name="lesson" className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Lesson {index + 1} of {count}</p>
            <p className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{status}</p>
          </div>
          <h3 id={lessonHeadingId(step)} tabIndex={-1} className={`mt-0.5 break-words text-[20px] font-bold leading-tight text-gray-900 @min-[40rem]:text-[22px] ${focusRing}`}>{title || `Lesson ${index + 1}`}</h3>
          {/* SCHOLAR-LEARN-FIX-01 L-B: the lesson's objective (learn.lessonOutline, no AI). A missing one is simply not shown. */}
          {objective && <p className="mt-1.5 break-words text-[14px] leading-relaxed text-gray-700"><span className="font-semibold text-gray-900">In this lesson: </span>{objective}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A lesson not opened yet: said calmly, with the one way in. Opening it is the learner's choice. */
export function LessonPlaceholder({ label, onTeach, disabled, describedBy, note }: { label: string; onTeach?: () => void; disabled?: boolean; describedBy?: string; note?: string }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
      <p className="text-[13.5px] text-gray-700">{note ?? "Not opened yet."}</p>
      {onTeach && <button type="button" onClick={onTeach} disabled={disabled} aria-describedby={describedBy} className={`${ghost} mt-2`}>{label}</button>}
    </div>
  );
}

export type Activity = { key: string; label: string; onClick?: () => void; href?: string; disabled?: boolean; pressed?: boolean; done?: boolean; describedBy?: string };
/** The compact row under a lesson: Understand · Mechanisms · Examples · Check · Practise · Apply · Evaluate, each on demand. */
export function ActivityRow({ items, label, id }: { items: Activity[]; label: string; id?: string }) {
  if (!items.length) return null;
  return (
    <div id={id} role="group" aria-label={label} className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-3">
      {items.map(a => {
        const text = <>{a.label}{a.done && <span className="sr-only"> (done)</span>}{a.done && <span aria-hidden="true" className="ml-1 text-gray-500">✓</span>}</>;
        const cls = `${chip} ${a.pressed ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`;
        return a.href
          ? <Link key={a.key} href={a.href} onClick={a.onClick} className={cls}>{text}</Link>
          : <button key={a.key} type="button" onClick={a.onClick} disabled={a.disabled} aria-pressed={a.pressed} aria-describedby={a.describedBy} className={cls}>{text}</button>;
      })}
    </div>
  );
}

/**
 * SCHOLAR-LEARN-GAPS-02 item 1: a plain link to the PDF of SAVED learning (learn/export). No AI and no allowance: every word is
 * already stored. `download` makes it a file, not a page, so the learner stays in the lesson.
 */
export function DownloadLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} download className={`inline-flex min-h-[36px] items-center text-[13px] font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${className}`}>{children}</a>
  );
}
/** The export URL of one saved lesson, or of all of one material's saved lessons. */
export const lessonExportHref = (sessionId: string, step: number) => `/api/individual/scholar/learn/export?session=${encodeURIComponent(sessionId)}&step=${step}`;
export const materialExportHref = (materialId: string) => `/api/individual/scholar/learn/export?material=${encodeURIComponent(materialId)}`;

/** One lesson that is not the active one: its number, title, state in words with an icon, and its one primary way in. */
export type LessonRow = { index: number; title: string; status: LessonStatus; action: string };

/**
 * SCHOLAR-PERSISTENT-LEARNING-01: the lessons that are not active, as a compact list. Tapping one makes it the active
 * lesson (saved teaching shows at once with no AI; Guided learning teaches only one with nothing saved).
 */
export function LessonList({ rows, onSelect, label }: { rows: LessonRow[]; onSelect: (index: number) => void; label: string }) {
  if (!rows.length) return null;
  return (
    <nav aria-label={label}>
      <ol className="space-y-1.5">
        {rows.map(r => (
          <li key={r.index}>
            <button type="button" onClick={() => onSelect(r.index)}
              className={`flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
              <span className="flex min-w-0 flex-1 basis-[12rem] items-start gap-2 text-[14px] text-gray-900">
                <span className="text-gray-700"><Mark icon={r.status.icon} /></span>
                <span className="min-w-0 break-words"><span className="font-semibold">{r.index + 1}.</span> {r.title}</span>
              </span>
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-700">{r.status.label}</span>
              <span className="text-[13px] font-semibold text-gray-900 underline underline-offset-2">{r.action}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * After the ACTIVE lesson: Previous, and Next lesson (which opens it saved, or in Guided learning teaches it, in one
 * action). Never reached by scrolling alone: moving on is the learner's choice. The last lesson offers Finish instead.
 */
export function ContinueCard({ next, onContinue, onPrevious, onDeeper, onPractise, otherTopicHref, last, completed, onFinish, onReview, disabled, blockedReason, suggestion }: {
  /** Kept for callers; the band takes the What next? tone. */
  accent?: string;
  next: { number: number; title: string } | null; onContinue: () => void; onPrevious?: () => void; onDeeper?: () => void; onPractise: () => void;
  otherTopicHref: string; last: boolean; completed: boolean; onFinish: () => void; onReview: () => void; disabled?: boolean;
  /** The required recall check is not finished: Next lesson and Finish wait, with this reason beside them. Everything else stays usable. */
  blockedReason?: string;
  /** SALE-2026-11 R1: the lesson's suggested next step and its stated reason, where one exists. Shown as words and a link to it; never run from here. */
  suggestion?: { label: string; why: string; href: string } | null;
}) {
  // SCHOLAR LEARNING DESIGN SYSTEM: the shared ActionBand -- ONE primary action (filled), the rest secondary (outlined).
  // Nothing advances by itself: every action is the learner's click.
  const wait = blockedReason ? "journey-wait-why" : undefined;
  const primary = !last && next ? { label: `Next lesson: ${next.number}. ${next.title}`, onClick: onContinue, disabled: disabled || !!blockedReason, describedBy: wait }
    : last && !completed ? { label: "Finish session", onClick: onFinish, disabled: !!blockedReason, describedBy: wait } : null;
  const secondary: BandAction[] = [
    ...(onPrevious ? [{ label: "Previous lesson", onClick: onPrevious, disabled }] : []),
    ...(last ? [{ label: "Review what you covered", onClick: onReview }] : []),
    ...(onDeeper ? [{ label: "Go deeper", onClick: onDeeper, disabled, icon: "compass" as const }] : []),
    { label: "Practise this lesson", onClick: onPractise, icon: "cards" },
    { label: "Choose another topic", href: otherTopicHref, icon: "spark" },
  ];
  return (
    <ActionBand headingId="journey-next-h" title={last ? (completed ? "Session completed" : "You have reached the last lesson") : "What next?"} primary={primary} secondary={secondary}>
      {completed && <p className="mt-2 text-[13.5px] text-gray-700">You can still revisit any lesson. Your progress here is a learning record for you, not an assessment.</p>}
      {suggestion && (
        <p className="mt-2 break-words text-[13.5px] leading-relaxed text-gray-800">
          <span className="cmp-learn-ink font-semibold">Suggested for you: {suggestion.label}.</span> {suggestion.why}{" "}
          <a href={suggestion.href} className={`cmp-learn-ink font-semibold underline underline-offset-2 ${focusRing}`}>See your next step</a>
        </p>
      )}
      {blockedReason && <p id="journey-wait-why" role="status" className="mt-2 text-[13.5px] font-semibold text-gray-900">{blockedReason}</p>}
    </ActionBand>
  );
}

/** Continue where you stopped: a plain, dismissible line. Choosing it scrolls there; nothing is asked of Scholar. */
export function ResumeBanner({ lesson, title, onGo, onDismiss }: { lesson: number; title: string; onGo: () => void; onDismiss: () => void }) {
  return (
    <div role="region" aria-label="Continue where you stopped" className={`${learnBox("next")} mb-3 flex flex-wrap items-center gap-2 px-4 py-2.5`}>
      <LearningIcon name="arrow" className="cmp-learn-accent h-5 w-5" />
      <p className="min-w-0 flex-1 break-words text-[13.5px] text-gray-900"><span className="cmp-learn-ink font-semibold">Continue where you stopped</span> — Lesson {lesson}{title ? `: ${title}` : ""}</p>
      <button type="button" className={`${chip} border-[var(--learn-accent)] bg-[var(--cmp-app-surface)] text-[var(--learn-ink)] hover:bg-[var(--learn-surface)]`} onClick={onGo}>Go to lesson {lesson}</button>
      <button type="button" className={`${chip} border-transparent bg-transparent text-[var(--learn-ink)] underline underline-offset-2`} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

export type Depth = "brief" | "standard" | "detailed";
/** Quick / Standard / Deep -- the stored values (brief / standard / detailed) are unchanged: they are part of the saved-lesson key. */
export const DEPTH_LABEL: Record<Depth, string> = { brief: "Quick", standard: "Standard", detailed: "Deep" };
export function DepthSegment({ value, onChange, disabled, accent }: { value: Depth; onChange: (d: Depth) => void; disabled?: boolean; accent: string }) {
  return (
    <div role="radiogroup" aria-label="Depth" className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-300 bg-white p-1">
      {(["brief", "standard", "detailed"] as const).map(d => (
        <button key={d} type="button" role="radio" aria-checked={value === d} disabled={disabled} onClick={() => onChange(d)}
          className={`min-h-[36px] rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${value === d ? "text-white" : "text-gray-800 hover:bg-gray-50"} ${focusRing}`}
          style={value === d ? { background: accent } : undefined}>{DEPTH_LABEL[d]}</button>
      ))}
    </div>
  );
}
