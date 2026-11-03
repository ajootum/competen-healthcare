// ── THE STUDENT'S AI STANDING ── COMPETEN-AI-FAIR-USE-01 s7, Scholar side ──────────────────────────────────
//
// Scholar reads the Holdings allowance (src/lib/ai/allowance.ts, IND-007's -- not edited here) through this one
// adapter, so every Scholar surface asks the same question the same way.
//
// ⚠ METERING OFF IS TODAY. With the ai_fair_use flag off, getAiStanding answers metered: false and Scholar behaves
// exactly as before: every activity is available and the existing Individual quota (scholar/http.ts) applies.
// ⚠ STANDING NEVER GATES READS. `readable: false` holds back NEW chargeable AI only. Uploads, extracted knowledge,
// saved explanations and summaries, questions (marked deterministically), cards, cases, history, progress and the
// Passport stay available whatever the standing says.

import { getAiStanding, type AiActivityState, type AiStanding } from "@/lib/ai/allowance";
import type { AiTier } from "@/lib/ai/fair-use-policy";
import { studentAiText } from "../ai-availability";

export type { AiActivityState, AiStanding };
export type AiServiceLevel = AiStanding["level"];

/** Scholar's activity codes (the approved list). The engine refuses an unknown code. */
export const SCHOLAR_AI_ACTIVITIES = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "check", "clarify", "tutor_continue", "map", "questions", "case_steps", "evaluate", "flashcards", "scenarios"] as const;
export type ScholarAiActivity = (typeof SCHOLAR_AI_ACTIVITIES)[number];

// ── SCHOLAR-INDEPENDENT-LEARNING-01 P3: THE ACTIVITY AND THE TIER ARE CONFIGURATION ─────────────────────────────────────
//
// `flashcards` and `scenarios` are their own activity codes (owner decisions 3 Nov 2026, SCHOLAR-AI-COST-CONFIG-01): a flashcard is a
// low-risk recall item; an evolving scenario or an OSCE station from the notes is complex clinical work that keeps the stronger
// model (`scenarios`), so ordinary questions (`questions`) can be routed apart from them. A flashcard is a low-risk recall item, and the published
// fair-use policy, model routing and eligibility rows may give it a cheaper tier and model than `questions` (which also
// writes evolving scenarios and clinical cases). Nothing is hard-coded: where the published policy does not define
// `flashcards` yet, the code uses `questions` exactly as before (activityOrFallback), and the tier a call runs on is the
// policy's tier for its activity (policyTierFor), never a model name in code. Clinical-risk subjects are still floored by
// the policy's per-risk-tier model floor and gated by eligibility in the engine (allowance.ts): a cheaper tier is never a
// silent downgrade and never reaches a model that is not eligible.

/** Pure. `preferred` when the published policy lists it as available now, else `fallback` (the code before P3). */
export function activityOrFallback(standing: Pick<AiStanding, "readable" | "activities">, preferred: ScholarAiActivity, fallback: ScholarAiActivity): ScholarAiActivity {
  return standing.readable && standing.activities[preferred]?.available ? preferred : fallback;
}

/** Pure. The tier the published policy gives an activity (cheap / reasoning / heavy), or null where it does not define it. */
export function policyTierFor(policy: { activities: Record<string, { tier: AiTier }> } | null | undefined, activity: string): AiTier | null {
  return policy?.activities?.[activity]?.tier ?? null;
}

/** Where the student stands for Scholar's AI. Never throws (the engine's contract). */
export function getScholarAiStanding(admin: unknown, userId: string): Promise<AiStanding> {
  return getAiStanding(admin, { userId, product: "scholar" });
}

/** Pure. Whether new AI may be used for this activity now, and if not the student-facing reason. */
export function activityState(standing: AiStanding, activity: ScholarAiActivity): { available: boolean; message: string | null; insufficient: boolean } {
  // Metered or not, what the standing lists is what counts: with metering off a clinical-risk activity with no eligible
  // model is not available (allowance.ts unmeteredGate), and an activity it does not list is refused, so not offered.
  const a = standing.activities[activity];
  if (standing.readable && a?.available) return { available: true, message: null, insufficient: false };
  const insufficient = a?.reason === "level_insufficient";
  return {
    available: false, insufficient,
    message: insufficient
      ? "This needs a level of AI help that is not available to you right now. Scholar will not use a weaker one instead."
      // SCHOLAR-EDU-AI-01 s6: never the governance reason (NOT_ELIGIBLE_REASON) -- the plain student words instead.
      : studentAiText(standing.message ?? a?.reason ?? "New AI help is not available right now. Everything you have saved is still here."),
  };
}
