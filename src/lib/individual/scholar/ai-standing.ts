/* eslint-disable @typescript-eslint/no-unused-vars */
// ── THE STUDENT'S AI STANDING (STUB) ── COMPETEN-AI-FAIR-USE-01 s7, Scholar side ─────────────────────────────
//
// The interface below is the one the coordinator approved (2026-10-24) for IND-007's Holdings implementation in
// src/lib/ai/allowance.ts (server-only), which Scholar must not edit. Until it lands, this stub answers "full AI"
// for every activity, so nothing changes for students today -- and every Scholar caller already goes through
// getScholarAiStanding(), so switching to the real one is this one file.
//
// ⚠ STANDING NEVER GATES READS. `readable: false` means continuity for NEW chargeable AI only. Uploads, extracted
// knowledge, saved explanations and summaries, questions (marked deterministically), cards, cases, history,
// progress and the Passport stay available whatever the standing says.

export type AiServiceLevel = "full" | "optimised" | "essential" | "continuity";
export type AiActivityState = { available: boolean; via: "included" | "reserve" | null; reason: string | null };
export type AiStanding = {
  readable: boolean;
  level: AiServiceLevel;
  remaining: { band: "plenty" | "some" | "low" | "none"; percent: number | null };
  resetsAt: string | null;
  activities: Record<string, AiActivityState>;
  message: string | null;
};

/** Scholar's activity codes (the approved list). An unknown code is refused by the real implementation. */
export const SCHOLAR_AI_ACTIVITIES = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "check", "clarify", "tutor_continue", "map", "questions", "case_steps"] as const;
export type ScholarAiActivity = (typeof SCHOLAR_AI_ACTIVITIES)[number];

const FULL: AiActivityState = { available: true, via: "included", reason: null };

/** STUB until IND-007's getAiStanding lands: full AI, every activity available. */
export async function getScholarAiStanding(_admin: unknown, _userId: string): Promise<AiStanding> {
  return {
    readable: true, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null,
    activities: Object.fromEntries(SCHOLAR_AI_ACTIVITIES.map(a => [a, FULL])), message: null,
  };
}

/** Pure. Whether new AI may be used for this activity now, and if not the student-facing reason. */
export function activityState(standing: AiStanding, activity: ScholarAiActivity): { available: boolean; message: string | null; insufficient: boolean } {
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
