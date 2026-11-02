"use client";

import { useEffect, useState } from "react";

// HQ-SCHOLAR-PREVIEW-01. The sticky banner that tells a staff member, on every page, that this is a preview of the REAL
// Scholar as a demonstration learner, how long is left, and how to leave. Rendered only when the proxy has verified a live
// preview session (headers.ts), never from the URL or anything a client can send.
//
// CPR-MOB-001: one md edge, and touch-target height gated on pointer-coarse (not viewport width). The bar is exactly
// --cmp-touch-min tall, so the button fills it on touch and sits inside it with a mouse.
// Read-only is the calm dark bar. Testing mode is a distinct amber bar, because it is the one mode in which actions are real
// (on the sandbox learner) and a person must never mistake one for the other.

export type BannerMode = "read_only" | "testing";

/** "58 min left", "Under 1 min left", "Preview ended". */
export function timeLeftLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return "Preview ended";
  const minutes = Math.ceil(secondsLeft / 60);
  if (secondsLeft < 60) return "Under 1 min left";
  return `${minutes} min left`;
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2";

export default function ScholarPreviewBanner({ mode, secondsLeft }: { mode: BannerMode; secondsLeft: number }) {
  // Counted down from the SERVER's remaining time, never from the client clock, so a skewed device clock cannot show the wrong time.
  const [left, setLeft] = useState(secondsLeft);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setLeft(Math.max(0, secondsLeft - Math.floor((Date.now() - started) / 1000))), 15000);
    return () => window.clearInterval(id);
  }, [secondsLeft]);
  // When it runs out the next request is refused by the proxy and lands on the "preview ended" page.
  useEffect(() => {
    if (left > 0) return;
    const id = window.setTimeout(() => window.location.reload(), 1500);
    return () => window.clearTimeout(id);
  }, [left]);

  const testing = mode === "testing";
  const tone = testing
    ? "border-amber-300 bg-amber-100 text-amber-900"
    : "border-[var(--cmp-app-text)] bg-[var(--cmp-app-text)] text-white";
  const button = testing
    ? "border-amber-900 bg-amber-900 text-white hover:bg-amber-800"
    : "border-white bg-white text-[var(--cmp-app-text)] hover:bg-gray-100";

  return (
    <div role="region" aria-label="Scholar product preview" data-scholar-preview={mode}
      className={`sticky top-0 z-40 flex h-11 items-center gap-3 border-b px-4 text-[13px] md:px-7 ${tone}`}>
      <p className="min-w-0 flex-1 truncate font-semibold">
        {testing ? (
          <>
            <span className="md:hidden">Testing mode · sandbox learner</span>
            <span className="hidden md:inline">Testing mode: changes and AI use go to the sandbox demo learner</span>
          </>
        ) : (
          <>
            <span className="md:hidden">Scholar preview · Read-only</span>
            <span className="hidden md:inline">Scholar Product Preview · Demonstration learner · Read-only</span>
          </>
        )}
      </p>
      <span className="shrink-0 tabular-nums" role="timer" aria-live="off">{timeLeftLabel(left)}</span>
      <form method="post" action="/preview/end" className="shrink-0">
        <button type="submit"
          className={`inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-semibold pointer-coarse:h-[var(--cmp-touch-min)] ${button} ${focusRing} focus-visible:outline-current`}>
          Return to HQ
        </button>
      </form>
    </div>
  );
}
