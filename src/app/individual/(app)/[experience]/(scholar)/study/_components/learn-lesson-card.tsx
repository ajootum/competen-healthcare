"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// SCHOLAR-COMPANION-01 P0b: THE PIECES OF THE CONTINUOUS JOURNEY. Presentation only: every button here runs an action
// learn-client.tsx already has (Teach, Go deeper, Examples, the check, Practise, Apply, Finish); nothing here calls a
// route or a model. Calm and plain: no streaks, points, badges or celebration -- the learner's progress is said in words.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const chip = `inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

export const lessonDomId = (step: number) => `lesson-${step}`;
export const lessonHeadingId = (step: number) => `lesson-${step}-h`;

/** One lesson of the journey: a labelled region with its own heading (the navigator focuses it on a jump). */
export function LessonCard({ step, index, count, title, objective, status, accent, children }: {
  step: number; index: number; count: number; title: string; objective: string; status: string; accent: string; children: ReactNode;
}) {
  return (
    <section id={lessonDomId(step)} data-lesson-index={index} aria-labelledby={lessonHeadingId(step)} className="scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Lesson {index + 1} of {count}</p>
        <p className="text-[12px] text-gray-600">{status}</p>
      </div>
      <h3 id={lessonHeadingId(step)} tabIndex={-1} className={`break-words text-[17px] font-bold text-gray-900 ${focusRing}`}>{title || `Lesson ${index + 1}`}</h3>
      {/* SCHOLAR-LEARN-FIX-01 L-B: the lesson's objective (learn.lessonOutline, no AI). A missing one is simply not shown. */}
      {objective && <p className="mt-1 break-words text-[14px] leading-relaxed text-gray-700"><span className="font-semibold text-gray-900">In this lesson: </span>{objective}</p>}
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
export function ActivityRow({ items, label }: { items: Activity[]; label: string }) {
  if (!items.length) return null;
  return (
    <div role="group" aria-label={label} className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
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
 * The end of the journey so far. Reaching it never asks for anything: moving on is the learner's choice, from here.
 * The last lesson offers Finish and a look back over what was covered instead.
 */
export function ContinueCard({ accent, next, onContinue, onDeeper, onPractise, otherTopicHref, last, completed, onFinish, onReview, disabled }: {
  accent: string; next: { number: number; title: string } | null; onContinue: () => void; onDeeper?: () => void; onPractise: () => void;
  otherTopicHref: string; last: boolean; completed: boolean; onFinish: () => void; onReview: () => void; disabled?: boolean;
}) {
  return (
    <section aria-labelledby="journey-next-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h3 id="journey-next-h" className="text-[15px] font-bold text-gray-900">{last ? (completed ? "Session completed" : "You have reached the last lesson") : "What next?"}</h3>
      {completed && <p className="mt-1 text-[13.5px] text-gray-700">You can still revisit any lesson. Your progress here is a learning record for you, not an assessment.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!last && next && (
          <button type="button" className={btn} style={{ background: accent }} onClick={onContinue} disabled={disabled}>
            <span className="min-w-0 break-words">Continue to lesson {next.number}: {next.title}</span>
          </button>
        )}
        {last && !completed && <button type="button" className={btn} style={{ background: accent }} onClick={onFinish}>Finish session</button>}
        {last && <button type="button" className={ghost} onClick={onReview}>Review what you covered</button>}
        {onDeeper && <button type="button" className={ghost} onClick={onDeeper} disabled={disabled}>Go deeper</button>}
        <button type="button" className={ghost} onClick={onPractise}>Practise this lesson</button>
        <Link href={otherTopicHref} className={ghost}>Choose another topic</Link>
      </div>
    </section>
  );
}

/** Continue where you stopped: a plain, dismissible line. Choosing it scrolls there; nothing is asked of Scholar. */
export function ResumeBanner({ lesson, title, onGo, onDismiss }: { lesson: number; title: string; onGo: () => void; onDismiss: () => void }) {
  return (
    <div role="region" aria-label="Continue where you stopped" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
      <p className="min-w-0 flex-1 break-words text-[13.5px] text-sky-950"><span className="font-semibold">Continue where you stopped</span> — Lesson {lesson}{title ? `: ${title}` : ""}</p>
      <button type="button" className={`${chip} border-sky-300 bg-white text-sky-950 hover:bg-sky-100`} onClick={onGo}>Go to lesson {lesson}</button>
      <button type="button" className={`${chip} border-transparent bg-transparent text-sky-950 underline underline-offset-2`} onClick={onDismiss}>Dismiss</button>
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
