"use client";

import { useEffect, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";

// OPTIONAL FEEDBACK ON ONE AI OUTPUT -- COMPETEN-SCHOLAR-AI-OPT-01 s7. One tap, never required, never in the way: a
// small line under the output. "Not helpful" may add reasons, also one tap each. Nothing is typed, so nothing personal
// or clinical can be sent. The line is not shown where feedback cannot be stored (GET /api/individual/scholar/feedback),
// so a learner is never offered a button that fails.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const small = `inline-flex items-center rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] disabled:opacity-50 ${focusRing}`;

export type FeedbackKind = "explanation" | "question" | "case";
export type FeedbackTarget = "action" | "artefact" | "question" | "case" | "step_case";

const WORDS: Record<FeedbackKind, { ask: string; positive: string; negative: string }> = {
  explanation: { ask: "Was this explanation helpful?", positive: "Helpful", negative: "Not helpful" },
  question: { ask: "Was this question clear?", positive: "Clear", negative: "Needs improvement" },
  case: { ask: "Was this case useful?", positive: "Useful", negative: "Needs improvement" },
};
const REASONS: { code: string; label: string }[] = [
  { code: "inaccurate", label: "Inaccurate" },
  { code: "unclear", label: "Unclear" },
  { code: "difficulty", label: "Wrong difficulty" },
  { code: "relevance", label: "Not relevant" },
  { code: "evidence", label: "Missing supporting evidence" },
];

// One availability check per page load, shared by every widget on it.
let available: Promise<boolean> | null = null;
const feedbackAvailable = () =>
  (available ??= fetch("/api/individual/scholar/feedback").then(r => (r.ok ? r.json() : { available: false })).then(j => j.available === true).catch(() => false));

export function AiFeedback({ kind, target, refId }: { kind: FeedbackKind; target: FeedbackTarget; refId: string | null | undefined }) {
  const [on, setOn] = useState(false);
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => { let live = true; if (refId) void feedbackAvailable().then(a => { if (live) setOn(a); }); return () => { live = false; }; }, [refId]);
  if (!on || !refId) return null;

  const send = async (r: "positive" | "negative", why: string[]) => {
    setRating(r); setReasons(why); setState("saving");
    try {
      const res = await fetch("/api/individual/scholar/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, ref: refId, rating: r, reasons: why }),
      });
      setState(res.ok ? "saved" : "failed");
    } catch { setState("failed"); }
  };
  const w = WORDS[kind];
  const pressed = (r: "positive" | "negative") => rating === r ? "border-gray-800 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50";

  return (
    <div className="mt-3 border-t border-gray-100 pt-2" role="group" aria-label={`Feedback: ${w.ask}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-gray-600">{w.ask} <span className="text-gray-500">(optional)</span></span>
        <button type="button" className={`${small} ${pressed("positive")}`} aria-pressed={rating === "positive"} disabled={state === "saving"} onClick={() => send("positive", [])}>{w.positive}</button>
        <button type="button" className={`${small} ${pressed("negative")}`} aria-pressed={rating === "negative"} disabled={state === "saving"} onClick={() => send("negative", reasons)}>{w.negative}</button>
        <span aria-live="polite" className="text-[12px] text-gray-500">
          {state === "saved" ? "Thanks, noted." : state === "failed" ? "Could not be saved just now." : ""}
        </span>
      </div>
      {rating === "negative" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-gray-600">What could be better? (optional)</span>
          {REASONS.map(x => {
            const sel = reasons.includes(x.code);
            return (
              <button key={x.code} type="button" aria-pressed={sel} disabled={state === "saving"}
                className={`${small} ${sel ? "text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
                style={sel ? { background: SCHOLAR.accent, borderColor: SCHOLAR.accent } : undefined}
                onClick={() => send("negative", sel ? reasons.filter(c => c !== x.code) : [...reasons, x.code])}>{x.label}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
