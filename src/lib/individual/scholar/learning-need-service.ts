import { listCheckAttempts } from "./store";
import { decideNext, isDifferentQuestion, outcomeOf, parseFollowUp, type AdaptiveRecord, type CheckOutcome, type PriorCheckOutcome } from "./learning-need";
import type { CheckHistoryItem } from "./learn-check-record";
import type { IndividualPolicy } from "../policy";
import { lessonPrerequisite, prerequisiteHref } from "./retention-data";
import type { PrerequisiteSuggestion } from "./prerequisite";
import type { StateEvidence } from "./learning-state";

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

/** SALE-2026-11 R2 / SALE-09: a framework prerequisite for a possible missing foundation. primary: there is no earlier lesson, so it IS the foundation step. */
export type PrerequisiteHint = PrerequisiteSuggestion & { href: string; primary: boolean };
export type AdaptiveReply = AdaptiveRecord & { earlierQuestions: string[]; prerequisite?: PrerequisiteHint | null };

/** Pure. A kept check as learning-state evidence (enough for the prerequisite rules: item, section, outcome, when). */
export function checkEvidence(i: CheckHistoryItem): StateEvidence {
  const o = priorOf(i).outcome;
  return {
    itemId: i.questionId, attemptId: i.attemptId, topicKey: "", chunkId: i.chunkId, materialId: i.materialId, source: "check", level: "unknown",
    outcome: o === "right" ? 1 : o === "partly" ? 0.5 : o === "wrong" ? 0 : null, marking: o === null ? "unmarked" : i.marking === "self_graded" ? "self" : "ai_evaluation",
    at: i.answeredAt, confidence: null, misconceptions: [],
  };
}
const EARLIER_LINE = "An earlier lesson of this session holds the ideas this one builds on.";

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
  const earlier = o.steps.some(s => s.step < o.step);
  // SALE-2026-11 R2 / SALE-09: only once as many different questions were missed as R1 rule N3 needs, look for a framework prerequisite of
  // the competencies these sections are ACCEPTED-linked to. With one, a missing foundation can be suggested even with no earlier lesson.
  let prerequisite: PrerequisiteHint | null = null;
  const cur = outcomeOf(o.current);
  if (policy.scholarPrerequisiteSuggestions === "on" && (cur === "wrong" || cur === "partly")) {
    const missed = new Set([o.current.questionId, ...[...lessonItems, ...sectionItems].filter(i => { const x = priorOf(i).outcome; return x === "wrong" || x === "partly"; }).map(i => i.questionId)]);
    if (missed.size >= Math.max(2, policy.scholarAdaptivePrerequisiteMisses)) {
      const s = await lessonPrerequisite(admin, userId, policy, { chunkIds: o.chunkIds, label: "this lesson", missed: missed.size, evidence: items.map(checkEvidence) }).catch(() => null);
      if (s) prerequisite = { ...s, href: prerequisiteHref(s), primary: !earlier };
    }
  }
  const f = parseFollowUp(o.followUp);
  const followed = f ? items.find(i => i.attemptId === f.attemptId) ?? null : null;
  const record = decideNext({
    current: o.current, lesson: lessonItems.map(priorOf), section: sectionItems.map(priorOf),
    availability: { actions: adaptiveActions(policy), aiAvailable: o.aiAvailable, hasFoundation: earlier || !!prerequisite, applyAvailable: o.applyAvailable },
    follows: f && followed ? { attemptId: followed.attemptId, approach: f.approach, differentQuestion: isDifferentQuestion(followed.question, o.current.stem) } : null,
    thresholds: { reteachMax: policy.scholarAdaptiveReteachMax, prerequisiteMisses: policy.scholarAdaptivePrerequisiteMisses },
  });
  const asked = new Set([o.current.stem, ...lessonItems.map(i => i.question)].map(s => s.trim().toLowerCase()));
  const earlierQuestions = [...new Set(sectionItems.map(i => i.question.trim()).filter(s => s && !asked.has(s.toLowerCase())))].slice(0, 3);
  if (record.need === "prerequisite_gap" && prerequisite) {
    const p = prerequisite;
    const fw = `In ${p.prerequisite.framework}, "${p.prerequisite.title}" is a prerequisite of "${p.competency.title}", which these notes are linked to.`;
    const evidence = earlier ? [...record.evidence, fw] : record.evidence.map(e => (e === EARLIER_LINE ? fw : e));
    const where = p.section ? ` Your notes on it: ${p.section.label}.` : " None of your notes covers it yet.";
    const reason = earlier ? `${record.reason} Your framework also lists "${p.prerequisite.title}" as coming first.${where}`
      : `Several different questions here were not answered well, and your framework lists "${p.prerequisite.title}" as coming first, so the next step is a short review of it.${where}`;
    return { ...record, reason, evidence: evidence.slice(0, 4), earlierQuestions, prerequisite: p };
  }
  return { ...record, earlierQuestions };
}
