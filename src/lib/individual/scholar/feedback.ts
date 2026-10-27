// ── LEARNER FEEDBACK ON SCHOLAR'S AI OUTPUT ── COMPETEN-SCHOLAR-AI-OPT-01 (Wave 2, directive s7) ──────────────────
//
// Optional and one tap: Helpful / Not helpful on an explanation, Clear / Needs improvement on a question, Useful /
// Needs improvement on a case, with optional reason codes. Stored in plat_ai_feedback (600) as codes only, under a
// one-way key of the learner and the output: no text, no user id.
//
// ⚠ FEEDBACK CHANGES NOTHING BY ITSELF. It is never used to publish, approve or retrain anything (directive s7). It is
// read only in aggregate, by the Holdings quality view, to find what to improve.
//
// The output is resolved from the caller's OWN rows (user_id) where it is stored: a saved explanation (artefact), a
// question, a private case, or a step-by-step case. An explanation that is not stored (Explain, Ask) is rated by the
// action that produced it, which must be a Scholar outcome of that kind.

import type { AiOutputKind } from "@/lib/ai/outcomes";

export const FEEDBACK_TARGETS = ["action", "artefact", "question", "case", "step_case"] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

/** The words the widget shows, per kind of output (directive s7). */
export const FEEDBACK_WORDS: Record<Exclude<AiOutputKind, "other">, { positive: string; negative: string }> = {
  explanation: { positive: "Helpful", negative: "Not helpful" },
  question: { positive: "Clear", negative: "Needs improvement" },
  case: { positive: "Useful", negative: "Needs improvement" },
};

// The output itself is resolved in store.ts (resolveFeedbackTarget), the only Scholar file that reads individual_scholar_*.
export { resolveFeedbackTarget, type ResolvedOutput } from "./store";
