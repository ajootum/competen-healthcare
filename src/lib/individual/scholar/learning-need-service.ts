import { listCheckAttempts } from "./store";
import { decideNext, isDifferentQuestion, outcomeOf, parseFollowUp, type AdaptiveRecord, type CheckOutcome, type PriorCheckOutcome } from "./learning-need";
import type { CheckHistoryItem } from "./learn-check-record";
import type { IndividualPolicy } from "../policy";

// ── SALE-2026-11 R1: THE NEXT-STEP DECISION FOR A KEPT CHECK (server) ────────────────────────────────────────────────────
//
// Called by the two places a lesson check is kept -- the act route (an AI judgement) and the checks route (the learner's own
// grade) -- BEFORE the attempt is written, so the decision and its reason are kept on that same attempt (416 response.adaptive).
// It reads only the learner's own kept checks (store.listCheckAttempts, 950). Off when HQ sets scholar_adaptive_teaching off.
// No AI, nothing generated: learning-need.ts decides from the rule table.

const KEPT_READ = 200;

/** Pure. A kept check as the rules read it. */
export function priorOf(i: CheckHistoryItem): PriorCheckOutcome {
  const r = i.response;
  return {
    attemptId: i.attemptId, questionId: i.questionId, stem: i.question, at: i.answeredAt, step: i.step, sessionId: i.sessionId,
    outcome: outcomeOf({ verdict: r.verdict, selfGrade: r.selfGrade }),
    misconceptions: r.feedback?.misconceptions ?? [], adaptive: r.adaptive ?? null,
  };
}

/** Learn actions on offer for the rule table: the policy's actions, with the Guide me / Challenge me styles only where HQ has them on. */
export const adaptiveActions = (p: IndividualPolicy): string[] =>
  p.scholarLearningActions.filter(a => (a !== "guide" || p.scholarLearnStyleGuide === "on") && (a !== "challenge" || p.scholarLearnStyleChallenge === "on"));

export type AdaptiveReply = AdaptiveRecord & { earlierQuestions: string[] };

export async function adaptiveDecision(admin: unknown, userId: string, policy: IndividualPolicy, o: {
  sessionId: string; step: number; steps: readonly { step: number }[]; chunkIds: readonly string[];
  current: CheckOutcome; followUp: unknown; aiAvailable: boolean; applyAvailable: boolean;
}): Promise<AdaptiveReply | null> {
  if (policy.scholarAdaptiveTeaching !== "on") return null;
  const kept = await listCheckAttempts(admin, userId, { limit: KEPT_READ }).catch(() => null);
  const items = kept?.ok ? kept.data : [];
  const sections = new Set(o.chunkIds);
  const lessonItems = items.filter(i => i.sessionId === o.sessionId && i.step === o.step);
  const sectionItems = items.filter(i => !(i.sessionId === o.sessionId && i.step === o.step) && sections.has(i.chunkId));
  const f = parseFollowUp(o.followUp);
  const followed = f ? items.find(i => i.attemptId === f.attemptId) ?? null : null;
  const record = decideNext({
    current: o.current, lesson: lessonItems.map(priorOf), section: sectionItems.map(priorOf),
    availability: { actions: adaptiveActions(policy), aiAvailable: o.aiAvailable, hasFoundation: o.steps.some(s => s.step < o.step), applyAvailable: o.applyAvailable },
    follows: f && followed ? { attemptId: followed.attemptId, approach: f.approach, differentQuestion: isDifferentQuestion(followed.question, o.current.stem) } : null,
    thresholds: { reteachMax: policy.scholarAdaptiveReteachMax, prerequisiteMisses: policy.scholarAdaptivePrerequisiteMisses },
  });
  const asked = new Set([o.current.stem, ...lessonItems.map(i => i.question)].map(s => s.trim().toLowerCase()));
  const earlierQuestions = [...new Set(sectionItems.map(i => i.question.trim()).filter(s => s && !asked.has(s.toLowerCase())))].slice(0, 3);
  return { ...record, earlierQuestions };
}
