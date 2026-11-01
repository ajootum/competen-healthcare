"use client";

import { useId, useState } from "react";
import type { LessonStatus } from "@/lib/individual/scholar/learn-journey";

// SCHOLAR-COMPANION-01 P0b: THE JOURNEY NAVIGATOR. The session's lessons as an outline, each with its learning mark in
// WORDS and an icon (never colour alone), the current one marked aria-current. Choosing one makes it the ACTIVE lesson
// (SCHOLAR-PERSISTENT-LEARNING-01): the page scrolls to it (smoothly unless reduced motion is asked for), focuses its
// heading, and shows its SAVED teaching with no AI call; only a lesson with nothing saved, in Guided learning, is taught.
//   JourneyOutline   the list (the wide layout's sticky left column; also the phone outline sheet)
//   JourneyBar       below 66rem of content width: one compact sticky bar, "Lesson 3 of 8 · 2 read", that opens the
//                    outline. It replaces the old Previous/Next bar -- there is never a second sticky bar.
// A learning mark says what the learner did, never how well they know it, and is not verified competence.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export type NavLesson = { index: number; title: string; status: LessonStatus; revealed: boolean };

export function Mark({ icon }: { icon: LessonStatus["icon"] }) {
  // Shapes differ, so the mark is legible without colour: a filled dot (current), a filled disc with a tick (completed),
  // a ring with a tick (checked), a ring with a centre dot (taught), a half disc (read), a dashed ring (not started).
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      {icon === "current" && <circle cx="8" cy="8" r="5" fill="currentColor" />}
      {icon === "completed" && <><circle cx="8" cy="8" r="6.6" fill="currentColor" /><path d="M5 8.2l2 2 4-4.2" stroke="white" /></>}
      {icon === "checked" && <><circle cx="8" cy="8" r="6.2" /><path d="M5 8.2l2 2 4-4.2" /></>}
      {icon === "taught" && <><circle cx="8" cy="8" r="6.2" /><circle cx="8" cy="8" r="2.6" fill="currentColor" /></>}
      {icon === "read" && <><circle cx="8" cy="8" r="6.2" /><path d="M8 1.8a6.2 6.2 0 010 12.4z" fill="currentColor" /></>}
      {icon === "none" && <circle cx="8" cy="8" r="6.2" strokeDasharray="2.2 2" />}
    </svg>
  );
}

export function JourneyOutline({ lessons, onJump, label = "Lessons" }: { lessons: NavLesson[]; onJump: (index: number) => void; label?: string }) {
  return (
    <nav aria-label={label}>
      <ol className="space-y-1">
        {lessons.map(l => (
          <li key={l.index}>
            <button type="button" onClick={() => onJump(l.index)} aria-current={l.status.current ? "step" : undefined}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${l.status.current ? "bg-gray-900 text-white" : "text-gray-800 hover:bg-gray-50"} ${focusRing}`}>
              <Mark icon={l.status.icon} />
              <span className="min-w-0">
                <span className="block break-words"><span className="font-semibold">{l.index + 1}.</span> {l.title}</span>
                <span className={`block text-[12px] ${l.status.current ? "text-gray-300" : "text-gray-600"}`}>{l.status.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The compact bar (content width below 66rem). Sticky above the phone tab bar; the outline opens as a disclosure above it. */
export function JourneyBar({ lessons, current, read, onJump, trailing }: { lessons: NavLesson[]; current: number; read: number; onJump: (index: number) => void; trailing?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="sticky bottom-[calc(70px_+_env(safe-area-inset-bottom))] z-10 mt-4 md:bottom-3 @min-[66rem]:hidden">
      {open && (
        <div id={`${id}-outline`} className="mb-2 max-h-[55vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
          <JourneyOutline lessons={lessons} label="Lessons in this session" onJump={i => { setOpen(false); onJump(i); }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <button type="button" aria-expanded={open} aria-controls={`${id}-outline`} onClick={() => setOpen(o => !o)}
          className={`inline-flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left text-[13.5px] font-semibold text-gray-900 hover:bg-gray-50 ${focusRing}`}>
          <span aria-hidden="true" className={`text-[10px] text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="min-w-0 truncate">Lesson {current + 1} of {lessons.length} · {read} read</span>
          <span className="sr-only">{open ? "Close the outline" : "Open the outline"}</span>
        </button>
        {trailing}
      </div>
    </div>
  );
}
