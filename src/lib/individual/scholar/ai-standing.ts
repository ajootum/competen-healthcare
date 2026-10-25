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

export type { AiActivityState, AiStanding };
export type AiServiceLevel = AiStanding["level"];

/** Scholar's activity codes (the approved list). The engine refuses an unknown code. */
export const SCHOLAR_AI_ACTIVITIES = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "check", "clarify", "tutor_continue", "map", "questions", "case_steps", "evaluate"] as const;
export type ScholarAiActivity = (typeof SCHOLAR_AI_ACTIVITIES)[number];

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
      : standing.message ?? a?.reason ?? "New AI help is not available right now. Everything you have saved is still here.",
  };
}
