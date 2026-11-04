// ── SALE-2026-11 R1: WHAT THE LEARNER NEEDS NEXT, AND WHY ── SALE-05 / SALE-06 / SALE-07 ── pure, client-safe, NO AI ──────────
//
// SALE-05 identifyNeed     a kept understanding check (CYU, 416 attempt) -> the likely need: understood, a misconception, a factual
//                          gap, a reasoning error, a prerequisite gap, or unclear. From the rubric parts the judgement returned (what
//                          was missing, what was wrong), repeated errors across DIFFERENT questions on the same sections, and the
//                          known misconception tags of missed questions (question-intel Rubric.misconceptions, misconception.ts).
// SALE-06 TEACHING_RULES   one rule table: need -> approach (an EXISTING Learn action only), with the reason in words. Never random.
// SALE-07 decideNext       the loop: round count capped by policy, a different question next, the record kept on the attempt's
//                          `response.adaptive` (no new table), and the recommendation after a follow-up answer.
//
// ⚠ FORMATIVE. A need is a suggestion for the learner's next step from their own answers, never a diagnosis, never competence.
// ⚠ THE LEARNER DECIDES. Every decision can be skipped; nothing runs by itself and nothing is generated until the learner chooses it.
// ⚠ NO NEW ENGINE. The approaches are the existing Learn actions (config.ts LEARN_ACTIONS) plus two no-AI moves: return to the
//   foundation (the earlier lesson's notes) and review later (the missed check already made a revision card). Model routing,
//   eligibility and question generation are unchanged: a different question is the lesson's own, an earlier kept check of the same
//   section, or the existing Ask me action.

import { isCognitiveLevel, type CognitiveLevel } from "./question-intel";
import { sameMisconception } from "./misconception";

export const LEARNING_NEEDS = ["understood", "misconception", "factual_gap", "reasoning_error", "prerequisite_gap", "unclear"] as const;
export type LearningNeed = (typeof LEARNING_NEEDS)[number];
export const isLearningNeed = (v: unknown): v is LearningNeed => typeof v === "string" && (LEARNING_NEEDS as readonly string[]).includes(v);
export const NEED_LABEL: Record<LearningNeed, string> = {
  understood: "Understood on this question", misconception: "A likely misconception", factual_gap: "A missing fact or idea",
  reasoning_error: "A gap in the reasoning", prerequisite_gap: "Possibly a missing foundation", unclear: "Not enough to tell",
};

/** The approaches the rule table may choose: existing Learn actions, and two moves that need no AI. */
export const ADAPTIVE_APPROACHES = ["challenge", "apply", "mistake", "simplify", "explain", "guide", "examples", "foundation", "review", "continue"] as const;
export type AdaptiveApproach = (typeof ADAPTIVE_APPROACHES)[number];
export const isAdaptiveApproach = (v: unknown): v is AdaptiveApproach => typeof v === "string" && (ADAPTIVE_APPROACHES as readonly string[]).includes(v);
export const APPROACH_LABEL: Record<AdaptiveApproach, string> = {
  challenge: "Challenge me", apply: "Apply it in a case", mistake: "Explain my mistake", simplify: "Simplify", explain: "Explain this",
  guide: "Guide me", examples: "Give examples", foundation: "Go back to the earlier lesson", review: "Save for review and carry on", continue: "Continue learning",
};
/** The approaches that call AI (through the existing Learn route, its gate and its allowance). The others never do. */
export const AI_APPROACHES: ReadonlySet<AdaptiveApproach> = new Set(["challenge", "mistake", "simplify", "explain", "guide", "examples"]);

export type NeedThresholds = {
  /** Different questions on the lesson's sections not answered well (this one included) before a missing foundation is suggested. */
  prerequisiteMisses: number;
  /** Corrective rounds on one lesson before Scholar stops re-teaching and suggests review instead. */
  reteachMax: number;
};
export const DEFAULT_NEED_THRESHOLDS: NeedThresholds = { prerequisiteMisses: 3, reteachMax: 2 };

/** The outcome of the check just answered, as the act route (AI judgement) or the checks route (the learner's own grade) has it. */
export type CheckOutcome = {
  questionId: string; stem: string;
  verdict: "understood" | "partly" | "not_yet" | null;
  selfGrade: "covered" | "partly" | "missed" | null;
  /** The rubric parts of an AI judgement (learn-check.ts CheckFeedbackParts); null for a self-grade. */
  feedback: { right: readonly string[]; missing: readonly string[]; misconceptions: readonly string[] } | null;
  /** The question's level where known (a Challenge rung); null otherwise. */
  level: CognitiveLevel | null;
  /** Known misconception tags of this question (its rubric), where it has any. */
  tags?: readonly string[];
};
/** An earlier kept check on the same lesson or sections, newest first. */
export type PriorCheckOutcome = {
  attemptId: string; questionId: string; stem: string; at: string; step: number | null; sessionId: string | null;
  outcome: "right" | "partly" | "wrong" | null;
  misconceptions: readonly string[];
  adaptive: AdaptiveRecord | null;
};

export const outcomeOf = (o: Pick<CheckOutcome, "verdict" | "selfGrade">): "right" | "partly" | "wrong" | null =>
  o.verdict === "understood" || o.selfGrade === "covered" ? "right" : o.verdict === "partly" || o.selfGrade === "partly" ? "partly" : o.verdict === "not_yet" || o.selfGrade === "missed" ? "wrong" : null;

export type NeedResult = { need: LearningNeed; rule: string; misconception: string | null; evidence: string[] };

/**
 * Pure. A misconceptions entry that says there is none ("Nothing to correct — your answer stayed close to the notes", "None spotted",
 * "No misconceptions in this answer"): not a misconception. learn-check.ts isNonePoint drops only the bare phrase; the staging walk
 * found the judgement adding a clause after it, which must not be read as an incorrect idea.
 */
export const isNoMisconception = (s: string): boolean =>
  /^\s*(?:none|n\/a)\b/i.test(s)
  || /^\s*nothing(?:\s+(?:to\s+correct|to\s+fix|wrong|incorrect|spotted|here|important))?\s*(?:[.!,;:—–-]|$)/i.test(s)
  || /^\s*no\s+(?:\w+\s+){0,2}(?:misconceptions?|errors?|mistakes?|incorrect\s+ideas?)\b/i.test(s);
export const realMisconceptions = (xs: readonly string[]): string[] => xs.map(s => s.trim()).filter(s => s && !isNoMisconception(s));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Pure. SALE-05: the likely need behind the check just answered. Rules, in order (the first that holds wins, its id is kept):
 *   N1 understood        the answer was judged understood, or the learner said they covered the key points.
 *   N2 unclear           kept without a mark: nothing to act on.
 *   N3 prerequisite_gap  an earlier lesson exists AND at least `prerequisiteMisses` DIFFERENT questions on these sections were not
 *                        answered well (this one included). Never from one miss: most difficulty is not a missing foundation.
 *   N4 misconception     the judgement named something incorrect, or a misconception tag of this question was also missed on a
 *                        DIFFERENT question of these sections.
 *   N5 reasoning_error   partly right with some points right (the facts are there, the connection is not), the learner's own
 *                        "some of them", or a miss on an application or reasoning question.
 *   N6 factual_gap       otherwise: the key facts were missing.
 */
export function identifyNeed(current: CheckOutcome, prior: readonly PriorCheckOutcome[], o: { hasFoundation: boolean; thresholds?: Partial<NeedThresholds> }): NeedResult {
  const T = { ...DEFAULT_NEED_THRESHOLDS, ...o.thresholds };
  const out = outcomeOf(current);
  const ev: string[] = [];
  if (out === "right") {
    const before = prior.filter(p => p.outcome === "right" && p.questionId !== current.questionId).length;
    ev.push(current.verdict ? "This answer was judged understood." : "You said you covered the key points.");
    if (before) ev.push(`You have also answered ${plural(before, "other question")} on these sections well.`);
    return { need: "understood", rule: "N1", misconception: null, evidence: ev };
  }
  if (out === null) return { need: "unclear", rule: "N2", misconception: null, evidence: ["This answer was kept without a mark, so there is nothing to act on."] };

  const missedOthers = new Set(prior.filter(p => (p.outcome === "wrong" || p.outcome === "partly") && p.questionId !== current.questionId).map(p => p.questionId));
  const missedDistinct = missedOthers.size + 1;
  if (o.hasFoundation && missedDistinct >= Math.max(2, T.prerequisiteMisses)) {
    ev.push(`${plural(missedDistinct, "different question")} on these sections ${missedDistinct === 1 ? "was" : "were"} not answered well yet.`);
    ev.push("An earlier lesson of this session holds the ideas this one builds on.");
    return { need: "prerequisite_gap", rule: "N3", misconception: null, evidence: ev };
  }
  const named = realMisconceptions(current.feedback?.misconceptions ?? []);
  if (named.length) {
    ev.push(`The feedback named something incorrect: "${clip(named[0])}".`);
    const repeated = prior.find(p => p.questionId !== current.questionId && realMisconceptions(p.misconceptions).some(m => sameMisconception(m, named[0])));
    if (repeated) ev.push("The same idea came up on a different question before.");
    return { need: "misconception", rule: "N4", misconception: clip(named[0]), evidence: ev };
  }
  const tags = (current.tags ?? []).filter(Boolean);
  const tagged = tags.find(t => prior.some(p => p.questionId !== current.questionId && (p.outcome === "wrong" || p.outcome === "partly") && realMisconceptions(p.misconceptions).some(m => sameMisconception(m, t))));
  if (tagged) {
    ev.push(`A known misconception for this question ("${clip(tagged)}") was also missed on a different question.`);
    return { need: "misconception", rule: "N4", misconception: clip(tagged), evidence: ev };
  }
  const right = current.feedback?.right.filter(s => s.trim()).length ?? 0;
  const missing = current.feedback?.missing.filter(s => s.trim()).length ?? 0;
  const higher = current.level === "application" || current.level === "reasoning";
  if ((out === "partly" && (right > 0 || current.selfGrade === "partly")) || higher) {
    if (right) ev.push(`${plural(right, "point")} of your answer ${right === 1 ? "was" : "were"} right${missing ? `, and ${plural(missing, "point")} ${missing === 1 ? "was" : "were"} missing` : ""}.`);
    else if (current.selfGrade === "partly") ev.push("You said you covered some of the key points.");
    if (higher) ev.push("This question asked you to use the idea, not only recall it.");
    return { need: "reasoning_error", rule: "N5", misconception: null, evidence: ev };
  }
  ev.push(missing ? `${plural(missing, "key point")} ${missing === 1 ? "was" : "were"} missing from your answer.` : current.selfGrade === "missed" ? "You said you missed most of the key points." : "The key points were not in your answer yet.");
  return { need: "factual_gap", rule: "N6", misconception: null, evidence: ev };
}

// ── SALE-06: THE RULE TABLE ──

export type TeachingRule = { id: string; need: LearningNeed; approach: AdaptiveApproach; fallbacks: readonly AdaptiveApproach[]; why: string };
/** need -> approach. The first approach available wins; each fallback is said in the reason. Owner examples in SALE-2026-11 §6.2. */
export const TEACHING_RULES: readonly TeachingRule[] = [
  { id: "T1", need: "understood", approach: "challenge", fallbacks: ["examples", "continue"], why: "You showed you understand this, so the next step is a harder question that asks you to use it." },
  { id: "T2", need: "misconception", approach: "mistake", fallbacks: ["explain", "simplify", "foundation"], why: "Your answer suggests an incorrect idea, so the next step corrects that idea directly." },
  { id: "T3", need: "factual_gap", approach: "simplify", fallbacks: ["explain", "foundation"], why: "Key facts were missing, so the next step is a simpler explanation of them." },
  { id: "T4", need: "reasoning_error", approach: "guide", fallbacks: ["examples", "explain"], why: "You had some of the facts but not how they connect, so the next step guides you through the reasoning one question at a time." },
  { id: "T5", need: "prerequisite_gap", approach: "foundation", fallbacks: ["simplify", "review"], why: "Several different questions here were not answered well yet, so the next step returns to the earlier lesson this one builds on." },
  { id: "T6", need: "unclear", approach: "continue", fallbacks: [], why: "There is no mark on this answer, so Scholar does not change what comes next." },
];
export const ruleFor = (need: LearningNeed): TeachingRule => TEACHING_RULES.find(r => r.need === need)!;

/** Where an approach can run: whether the learner is offered it, AI is available now, and an earlier lesson or Apply exist. */
export type ApproachAvailability = {
  /** The Learn actions offered by policy (policy.scholarLearningActions), plus the teaching styles on. */
  actions: readonly string[];
  aiAvailable: boolean;
  hasFoundation: boolean;
  applyAvailable: boolean;
};
export function approachAvailable(a: AdaptiveApproach, av: ApproachAvailability): boolean {
  if (a === "continue" || a === "review") return true;
  if (a === "foundation") return av.hasFoundation;
  if (a === "apply") return av.applyAvailable;
  return av.aiAvailable && av.actions.includes(a);
}

/** The decision kept on the attempt (response.adaptive) and shown to the learner. Bounded; never a score. */
export type AdaptiveRecord = {
  v: 1;
  need: LearningNeed; rule: string; approach: AdaptiveApproach; reason: string;
  misconception: string | null; evidence: string[];
  /** The corrective round of this lesson this decision opens (1 = first re-teach); 0 when understood or unclear. */
  round: number; capped: boolean;
  /** This answer followed a corrective step: the attempt it followed, the approach taken (or skipped), and whether the question differed. */
  follows: { attemptId: string; approach: AdaptiveApproach | "skipped"; differentQuestion: boolean } | null;
  /** A different question is suggested after the corrective step. */
  differentQuestion: boolean;
};

/** Pure. How many corrective rounds this lesson has already had in a row (newest first), stopping at an understood answer. */
export function priorRounds(lesson: readonly PriorCheckOutcome[]): number {
  for (const p of lesson) {
    if (p.outcome === "right") return 0;
    if (p.adaptive) return p.adaptive.round;
  }
  return 0;
}

/**
 * Pure. SALE-06 + SALE-07: the next teaching action for the check just answered, with its reason.
 *   - the need (identifyNeed) picks a rule of TEACHING_RULES; the first available of its approach and fallbacks is chosen;
 *   - a corrective round beyond `reteachMax` stops re-teaching: "review" (the missed check already made a revision card);
 *   - understood after a corrective step says so, which is the loop's evidence of improvement on a different question;
 *   - with AI unavailable only the no-AI moves are chosen (foundation, review, continue).
 */
export function decideNext(input: {
  current: CheckOutcome; lesson: readonly PriorCheckOutcome[]; section: readonly PriorCheckOutcome[];
  availability: ApproachAvailability; follows?: AdaptiveRecord["follows"]; thresholds?: Partial<NeedThresholds>;
}): AdaptiveRecord {
  const T = { ...DEFAULT_NEED_THRESHOLDS, ...input.thresholds };
  const av = input.availability;
  const seen = new Map<string, PriorCheckOutcome>();
  for (const p of [...input.lesson, ...input.section]) if (!seen.has(p.attemptId)) seen.set(p.attemptId, p);
  const need = identifyNeed(input.current, [...seen.values()], { hasFoundation: av.hasFoundation, thresholds: T });
  const follows = input.follows ?? null;
  const corrective = need.need !== "understood" && need.need !== "unclear";
  const round = corrective ? priorRounds(input.lesson) + 1 : 0;
  const capped = corrective && round > Math.max(1, T.reteachMax);
  const rule = ruleFor(need.need);
  let approach: AdaptiveApproach;
  let reason: string;
  if (capped) {
    approach = "review";
    reason = `You have had ${plural(round - 1, "corrective step")} on this lesson already, so Scholar suggests leaving it for now rather than explaining it again. The missed check is in your revision cards for later.`;
  } else {
    const chain = [rule.approach, ...rule.fallbacks];
    let pick = chain.find(a => approachAvailable(a, av));
    // understood on an application or reasoning question with a case available: apply it rather than another question.
    if (need.need === "understood" && av.applyAvailable && (input.current.level === "application" || input.current.level === "reasoning")) pick = "apply";
    approach = pick ?? (corrective ? "review" : "continue");
    reason = rule.why;
    if (approach !== rule.approach && approach !== "apply") {
      const why = AI_APPROACHES.has(rule.approach) && !av.aiAvailable ? "AI help is not available just now" : `${APPROACH_LABEL[rule.approach]} is not offered here`;
      reason += ` ${why}, so the next step is ${APPROACH_LABEL[approach].toLowerCase()} instead.`;
    }
    if (approach === "apply") reason = "You answered a question that asked you to use this idea, so the next step is to apply it in a short case.";
  }
  if (follows && need.need === "understood") {
    reason = follows.differentQuestion
      ? `After ${follows.approach === "skipped" ? "carrying on" : APPROACH_LABEL[follows.approach as AdaptiveApproach].toLowerCase()}, you answered a different question well. That is stronger evidence than the same question again. ${reason}`
      : `You answered the same question well this time. A different question would show it holds. ${reason}`;
  }
  return {
    v: 1, need: need.need, rule: capped ? `${rule.id}/cap` : rule.id, approach, reason, misconception: need.misconception, evidence: need.evidence.slice(0, 4),
    round, capped, follows, differentQuestion: corrective && !capped && approach !== "review",
  };
}

// ── SALE-07: A DIFFERENT QUESTION ──

const norm = (s: string) => s.replace(/\[[SRE]\d+\]/gi, " ").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/**
 * Pure. The different question to ask after a corrective step, with NO new generation where one exists: the lesson's own questions
 * not yet answered in this lesson first, then an earlier kept check of the same sections (from another lesson or session). Null:
 * none left, so the existing Ask me action writes one (the learner's click, the same route and model routing).
 */
export function pickDifferentQuestion(o: { lessonQuestions: readonly string[]; answered: readonly string[]; earlier: readonly string[] }): { stem: string; source: "lesson" | "earlier" } | null {
  const done = new Set(o.answered.map(norm).filter(Boolean));
  const fresh = (s: string) => !!norm(s) && !done.has(norm(s));
  const own = o.lessonQuestions.find(fresh);
  if (own) return { stem: own, source: "lesson" };
  const earlier = o.earlier.find(fresh);
  return earlier ? { stem: earlier, source: "earlier" } : null;
}
export const isDifferentQuestion = (a: string, b: string): boolean => norm(a) !== norm(b);

// ── THE RECORD ──

const strs = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, n).map(x => clip(x, len)) : []);
/** Pure. A stored response.adaptive read back, or null where absent or malformed. */
export function parseAdaptiveRecord(raw: unknown): AdaptiveRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !isLearningNeed(r.need) || !isAdaptiveApproach(r.approach) || typeof r.reason !== "string") return null;
  const f = r.follows && typeof r.follows === "object" ? (r.follows as Record<string, unknown>) : null;
  const fa = f && typeof f.attemptId === "string" && (isAdaptiveApproach(f.approach) || f.approach === "skipped") ? { attemptId: f.attemptId, approach: f.approach as AdaptiveApproach | "skipped", differentQuestion: f.differentQuestion === true } : null;
  return {
    v: 1, need: r.need, rule: typeof r.rule === "string" ? r.rule.slice(0, 16) : "", approach: r.approach, reason: clip(r.reason, 600),
    misconception: typeof r.misconception === "string" && r.misconception.trim() ? clip(r.misconception) : null, evidence: strs(r.evidence, 4, 240),
    round: Number.isInteger(r.round) && Number(r.round) >= 0 ? Math.min(20, Number(r.round)) : 0, capped: r.capped === true, follows: fa, differentQuestion: r.differentQuestion === true,
  };
}
/** Pure. The record as stored: bounded strings, so it always fits the 416 response budget beside the answer. */
export function adaptiveForStorage(a: AdaptiveRecord): Record<string, unknown> {
  return {
    v: 1, need: a.need, rule: a.rule, approach: a.approach, reason: clip(a.reason, 600), misconception: a.misconception ? clip(a.misconception) : null,
    evidence: a.evidence.slice(0, 4).map(e => clip(e, 240)), round: a.round, capped: a.capped, follows: a.follows, differentQuestion: a.differentQuestion,
  };
}

/** Pure. A follow-up the client says this answer is (validated by the route against the learner's own kept attempt). */
export function parseFollowUp(raw: unknown): { attemptId: string; approach: AdaptiveApproach | "skipped" } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.afterAttemptId !== "string" || !/^[0-9a-f-]{36}$/i.test(r.afterAttemptId)) return null;
  const approach = isAdaptiveApproach(r.approach) || r.approach === "skipped" ? (r.approach as AdaptiveApproach | "skipped") : "skipped";
  return { attemptId: r.afterAttemptId, approach };
}
export const parseCheckLevel = (v: unknown): CognitiveLevel | null => (isCognitiveLevel(v) ? v : null);

/** Learner-stated confidence on a check: optional, never evidence of understanding (SALE-2026-11 §5.2). */
export const CONFIDENCE_VALUES = ["sure", "unsure", "guess"] as const;
export type StatedConfidence = (typeof CONFIDENCE_VALUES)[number];
export const isStatedConfidence = (v: unknown): v is StatedConfidence => typeof v === "string" && (CONFIDENCE_VALUES as readonly string[]).includes(v);
export const CONFIDENCE_LABEL: Record<StatedConfidence, string> = { sure: "Sure", unsure: "Not sure", guess: "Guessing" };
