// ── STAGE 4: WHAT A REVISION SESSION SENDS THE BROWSER ── COMPETEN-SCHOLAR-REVISION-01 ────────────────────────────
//
// Before an answer: revisionItemView, the learner projection (revision.ts learnerItem) and where it comes from. After
// an answer: feedbackView, the key in words, the rationale, the source quote, and HOW it was marked -- by code, by the
// student, or by AI evaluation, each labelled. Nothing here calls a model.
// SCHOLAR-SQIE-CLOSE-01 (710): a governed library copy says so (its provenance, no notes quote), and a structured
// question's feedback is part by part, with its practice marks (formative).

import { citeChunk } from "./extract";
import { EXTENDED_LABEL, FORMATIVE_FEEDBACK_LABEL, SCENARIO_LABEL, LEARNER_CARD, LEARNER_CARD_LABEL, LIBRARY_QUESTION_LABEL, LIBRARY_REVISION_LABEL, MARKING_LABEL, NOT_COMPETENCE_LABEL, PRACTICE_MARKS_LABEL, REVISION_LABEL, type Marking } from "./config";
import { answerText, effectiveKind, keyOf, learnerItem, practiceMarks, structuredParts, type LearnerItem, type PartResult } from "./revision";
import { markedAgainstLine } from "./marked-against";
import { scenarioMarks, scenarioSpecOf, stageKeyText, storedStageResults, type StageResult } from "./scenario";
import type { LibraryProvenance, QuestionRow } from "./store";
import { extendedMarks, extendedSpecOf, isExtendedQuestion, storedMatched } from "./formats";
import { applySnapshot, rubricChanged, rubricHash, snapshotOf, type RubricSnapshot } from "./rubric-snapshot";
import { CORRECTION_BASIS_LABEL, QUESTION_CHANGED_NOTE, applyAssessedSnapshot, effectiveResult, outcomeOf, questionChanged, type AttemptIntegrity, type Outcome } from "./attempt-snapshot";
import { formativeOf, formativeText, storedPartResults } from "./written-feedback";
import { GENERATION_DIFFICULTIES as STEPS, GROUNDING_LABEL, LEVEL_LABEL, rubricOf, type FeedbackParts, type GenerationDifficulty } from "./question-intel";
import {
  ROLE_LABEL, SAFETY_EXPLAINER, SAFETY_LABEL, VARIANT_LABEL, calculationSpecOf, findingsOf, markCalculation, storedSafety, structuredVariantOf, toleranceOf, toleranceText,
  type CalculationMark, type Finding, type PartRole, type SafetyRecord, type StructuredVariant,
} from "./scoring-rules";
import { CALCULATION_LABEL } from "./config";

/** SQIE-CLOSE-2026-11 WS-B: how a safety outcome is shown (rules v2). Never shown for an attempt marked before those rules. */
export type SafetyView = { outcome: SafetyRecord["outcome"]; label: string; explainer: string; statement: string | null; missed: string[]; by: SafetyRecord["by"]; byLabel: string };
export const safetyView = (s: SafetyRecord | null | undefined): SafetyView | null => !s ? null : {
  outcome: s.outcome, label: SAFETY_LABEL[s.outcome], explainer: SAFETY_EXPLAINER[s.outcome], statement: s.statement ?? null, missed: s.missed ?? [], by: s.by,
  byLabel: s.by === "code" ? "Recognised by code against the question's marking guide." : `${MARKING_LABEL.ai_evaluation}: formative, not a verified judgement.`,
};

export type RevisionItemView = LearnerItem & {
  materialId: string; materialTitle: string; chunkId: string; citation: string; label: string;
  /** SCHOLAR-SQIE-01: what the question rests on, in words ("From your notes" / "... + approved references"). */
  grounding: string;
  /** SCHOLAR-SQIE-CLOSE-01: a governed library question -- its resource, version and approval. Absent for the student's own. */
  library?: LibraryProvenance;
};

export const citationOf = (q: QuestionRow) =>
  q.library ? `Competen library, version ${q.library.versionNo}`
    : `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }, q.unit) : "source section"}`;

/**
 * Pure. One question as a session shows it before it is answered: no key, rationale, source quote or rubric. Only
 * the rubric's source becomes a label: an item written before rubrics, or an mcq (which keeps none), is from the notes.
 */
export function revisionItemView(q: QuestionRow): RevisionItemView {
  return {
    ...learnerItem(q), materialId: q.materialId, materialTitle: q.materialTitle, chunkId: q.chunkId, citation: citationOf(q),
    label: q.library ? LIBRARY_REVISION_LABEL : REVISION_LABEL,
    // SCHOLAR-FLASHCARDS-01: a hand-written card rests on no notes and no library: it says it is the learner's own.
    grounding: q.library ? LIBRARY_QUESTION_LABEL : q.model === LEARNER_CARD.model ? LEARNER_CARD_LABEL : GROUNDING_LABEL[rubricOf(q.answer)?.source ?? "notes"],
    ...(q.library ? { library: q.library } : {}),
  };
}

/** SCHOLAR-SQIE-CLOSE-01: one part of a structured answer after marking. */
export type StructuredPartFeedback = {
  prompt: string; marks: number; awarded: number | null; by: PartResult["by"] | null; accepted: string; keyPoints: string[];
  evaluation: { feedback: string; label: string; parts: FeedbackParts | null; formative?: string } | null;
  /** WS-C: what the part asks for, the options of a choice part (the key is `accepted`), and its weighted criteria with which were met (null: not AI-judged). */
  role?: PartRole; roleLabel?: string; options?: string[];
  criteria?: { text: string; weight: number; safetyCritical: boolean; met: boolean | null }[];
  /** WS-B: the part is safety-critical. */
  safetyCritical?: boolean;
};

/** CE-05: one stage of a scenario after marking. `score` is null for an attempt that kept no per-stage record. */
export type ScenarioStageFeedback = {
  index: number; reveal: string; prompt: string; weight: number; score: number | null; awarded: number | null; by: StageResult["by"] | null;
  yourAnswer: string | null; key: string; keyPoint: string; source: string; evaluation: { feedback: string; label: string; formative: string } | null;
};

export type RevisionFeedback = {
  questionId: string; correct: boolean; score: number | null; marking: Marking; markingLabel: string;
  answer: string; rationale: string; source: { quote: string; citation: string; materialId: string; chunkId: string };
  /** The key's indexes for the choice kinds, so the card can mark the options. */
  key: { index?: number; indexes?: number[]; order?: number[]; matches?: string[] } | null;
  /** AI evaluation of a short answer: its feedback, labelled, and its five parts where it wrote them (evaluate v2). */
  evaluation?: { feedback: string; label: string; parts?: FeedbackParts | null; formative?: string } | null;
  /** SCHOLAR-QUESTION-INTELLIGENCE-01: after answering only -- what the question checks, at what level, its key points. */
  rubric?: { objective: string | null; level: string; keyPoints: string[]; grounding: string } | null;
  /** SCHOLAR-SQIE-01: the difficulty a follow-up practice on this material starts at -- a step up after a right answer, down after a miss. */
  nextDifficulty?: GenerationDifficulty;
  card?: "created" | "reset" | "reviewed" | null; nextReviewAt?: string | null;
  /** R2: the CFCA competency and learning outcome the question practises, where its section is still linked. */
  practises?: { competency: string; outcome: string | null; label: string } | null;
  /** SCHOLAR-SQIE-CLOSE-01: a governed library question (its provenance). Its source is the library, not the notes. */
  library?: LibraryProvenance & { label: string };
  /**
   * SCHOLAR-SQIE-LEARNER-01: an extended response, against its key points. `matched` is null where the answer was not AI-evaluated
   * (marked by the student, or an older attempt): the marks are then the stored share of the total, and no point is ticked.
   */
  extended?: { marks: { awarded: number; total: number; label: string }; modelAnswer: string; points: { text: string; matched: boolean | null }[]; label: string };
  /**
   * SCHOLAR-CE-2026 CE-05: what this answer was marked against, in one short honest line, for every format (marked-against.ts). Says only
   * what the attempt kept: where it kept no snapshot the line is the plain statement and carries no count or version.
   */
  markedAgainst: string;
  /** CE-05: an evolving scenario, stage by stage: the new information, the question, how each stage was marked, its key and its key point. */
  scenario?: { stages: ScenarioStageFeedback[]; practiceMarks: { awarded: number; total: number; label: string }; label: string };
  /** SCHOLAR-SQIE-LEARNER-01: the attempt was marked against a guide the question no longer has; what is shown is the guide at the time. */
  rubricNote?: string;
  /** SCHOLAR-SQIE-CLOSE-01: a structured question, part by part, and its practice marks (formative). WS-C: its variant and findings table. */
  structured?: { parts: StructuredPartFeedback[]; practiceMarks: { awarded: number; total: number; label: string }; variant?: StructuredVariant; variantLabel?: string; findings?: Finding[] };
  /**
   * SQIE-CLOSE-2026-11 WS-B (rules v2): the answer was clinically unsafe, or missed a safety-critical point: what, said plainly, and
   * that its marks were capped. Absent for a safe answer and for every attempt marked before the v2 rules (nothing is invented for it).
   */
  safety?: SafetyView;
  /**
   * SQIE-CLOSE-2026-11 WS-A: a calculation, marked by code: what was given, the answer, why it was marked so (a wrong unit is said
   * plainly), the tolerance and unit rule it was marked under, any number-writing warnings, and the working from the notes.
   */
  calculation?: {
    given: { value: number | null; unit: string }; expected: { value: number; unit: string }; reason: CalculationMark["reason"]; feedback: string;
    inKeyUnit: number | null; tolerance: string; unitRule: string; warnings: string[]; working: string | null; label: string;
  };
  /**
   * SCHOLAR-CONTINUITY-01 (791): the question has changed since it was answered. `asAnswered` is the stem and options as they
   * were shown (the key, rationale and answer above are the ones at the time too).
   */
  questionChanged?: { note: string; asAnswered: { stem: string; options: string[] } };
  /** SCHOLAR-CONTINUITY-01 (791): the result was corrected. `correct` and `score` above are the effective result; the original is kept here. */
  corrections?: { original: { correct: boolean; score: number | null; outcome: Outcome }; entries: { at: string; reason: string; basis: string; from: Outcome; to: Outcome }[] };
};

/**
 * Pure. What an attempt kept that feedback shown again reads (SCHOLAR-WRITTEN-FEEDBACK-01, SCHOLAR-SQIE-LEARNER-01): the rubric
 * snapshot it was marked against, the key points an extended answer made, and -- for an AI-evaluated answer only -- the formative
 * feedback it was shown. Spread into feedbackView's second argument. Nothing for a code-marked or self-graded answer but its snapshot.
 */
export function keptAttemptView(q: QuestionRow, a: { response?: Record<string, unknown> | null; marking: string; integrity?: AttemptIntegrity | null }) {
  // SCHOLAR-CONTINUITY-01 (791): read against the question as it was answered, where its snapshot was kept.
  const assessed = a.integrity ?? null;
  if (assessed?.snapshot) q = applyAssessedSnapshot(q, assessed.snapshot);
  const kept = keptView(q, a);
  return assessed ? { ...kept, assessed } : kept;
}

function keptView(q: QuestionRow, a: { response?: Record<string, unknown> | null; marking: string }) {
  const snapshot = snapshotOf(a.response);
  // SQIE-CLOSE-2026-11 WS-B: the safety outcome the attempt kept (rules v2 only; an older attempt has none and shows none).
  const safety = storedSafety(a.response);
  const kept = keptKind(q, a, snapshot);
  return safety ? { ...kept, safety } : kept;
}

/**
 * Pure (WS-A). A calculation attempt's code mark, re-derived from what it kept: the number and unit given and the tolerance and unit rule
 * it was marked under, against its key as it was (the rubric snapshot laid over the row). null for an attempt that kept none (legacy).
 */
export function keptCalculation(q: QuestionRow, response: unknown, snapshot: RubricSnapshot | null): CalculationMark | null {
  const spec = calculationSpecOf(applySnapshot(q, snapshot).answer);
  const r = (response ?? {}) as Record<string, unknown>;
  const rec = (r.calc ?? null) as Record<string, unknown> | null;
  if (!spec || r.kind !== "calc" || typeof r.value !== "string" || typeof r.unit !== "string" || !rec || typeof rec !== "object") return null;
  const tolerance = toleranceOf(rec.tolerance), units = rec.units === "exact_unit" || rec.units === "convert" ? rec.units : null;
  if (!tolerance || !units) return null;
  return markCalculation({ ...spec, tolerance, units }, { value: r.value, unit: r.unit });
}

function keptKind(q: QuestionRow, a: { response?: Record<string, unknown> | null; marking: string }, snapshot: RubricSnapshot | null) {
  const calc = keptCalculation(q, a.response, snapshot);
  if (calc) return { snapshot, calc };
  const parts = structuredParts(applySnapshot(q, snapshot));
  if (parts.length) { const structured = storedPartResults(a.response, a.marking, parts.length); return { snapshot, ...(structured ? { structured } : {}) }; }
  // CE-05: a scenario keeps its per-stage record (what was answered and scored at each stage) on the attempt's response.
  const sc = scenarioSpecOf(q.answer);
  if (sc) {
    const stages = storedStageResults(a.response, sc.stages.length);
    const fb = formativeOf(a.response, a.marking);
    const withFeedback = stages?.map((r, i) => { const it = fb?.items.find(x => x.part === i + 1); return it ? { ...r, feedback: formativeText(it) } : r; }) ?? null;
    return { snapshot, ...(withFeedback ? { scenario: withFeedback } : {}) };
  }
  const spec = isExtendedQuestion(q) ? extendedSpecOf(applySnapshot(q, snapshot).answer) : null;
  const whole = formativeOf(a.response, a.marking)?.items.find(i => i.part === null);
  return { snapshot, extendedMatched: spec ? storedMatched(a.response, a.marking, spec.keyPoints.length) : null, ...(whole ? { evaluation: formativeText(whole), evaluationParts: whole.parts } : {}) };
}

/** Pure. What a student sees after answering one question. */
export function feedbackView(row: QuestionRow, m: {
  correct: boolean; score: number | null; marking: Marking; evaluation?: string | null; evaluationParts?: FeedbackParts | null; card?: RevisionFeedback["card"]; nextReviewAt?: string | null;
  link?: { competency: string; outcome: string | null } | null; structured?: readonly PartResult[] | null;
  /** SCHOLAR-SQIE-LEARNER-01: the rubric snapshot kept on the attempt (rubric-snapshot.ts), and the key points an extended answer made. */
  snapshot?: RubricSnapshot | null; extendedMatched?: readonly number[] | null;
  /** CE-05: a scenario's stage results (read from the attempt, or just marked). */
  scenario?: readonly StageResult[] | null;
  /** CE-05: the answer was marked just now, against the question as it stands: its guide is this guide (the provenance line names it). */
  justMarked?: boolean;
  /** SCHOLAR-CONTINUITY-01 (791): what the attempt was assessed against (its snapshot) and any corrections of its result. */
  assessed?: AttemptIntegrity | null;
  /** SQIE-CLOSE-2026-11 WS-B: the safety outcome (just marked, or kept on the attempt). */
  safety?: SafetyRecord | null;
  /** SQIE-CLOSE-2026-11 WS-A: a calculation's code mark (just marked, or re-derived from what the attempt kept). */
  calc?: CalculationMark | null;
}): RevisionFeedback {
  // SCHOLAR-CONTINUITY-01: the question as it was presented when answered (791 snapshot), where it has changed since.
  const live = row;
  const changed = !!m.assessed?.snapshot && questionChanged(live, m.assessed.snapshot);
  row = applyAssessedSnapshot(row, m.assessed?.snapshot ?? null);
  // The effective result: the latest correction, else the original. The original stays visible beside it.
  const original = { correct: m.correct, score: m.score, outcome: outcomeOf(m.correct, m.score) };
  const eff = m.assessed?.corrections.length ? effectiveResult(original, m.assessed.corrections) : null;
  if (eff) m = { ...m, correct: eff.correct, score: eff.score };
  // The question as it read when the attempt was marked, where the attempt kept a snapshot of its guide; otherwise the row itself.
  const q = applySnapshot(row, m.snapshot ?? null);
  const k = keyOf(q);
  const rubric = rubricOf(q.answer);
  const parts = structuredParts(q);
  let structured: RevisionFeedback["structured"];
  if (parts.length) {
    const results = m.structured ?? null;
    const total = parts.reduce((n, p) => n + p.marks, 0);
    // Resumed later, only the share is stored with the attempt: the marks are that share of the total.
    // WS-B (rules v2): a capped answer shows its capped marks (the share it was recorded at), never the parts' sum.
    const summed = results ? practiceMarks(parts, results).awarded : Math.round((m.score ?? 0) * total);
    const awarded = m.safety ? Math.min(summed, Math.floor((m.score ?? 0) * total + 1e-9)) : summed;
    const variant = structuredVariantOf(q.answer), findings = findingsOf(q.answer);
    structured = {
      parts: parts.map((p, i) => {
        const r = results?.[i] ?? null;
        const c = p.contract;
        return {
          prompt: p.prompt, marks: p.marks, awarded: r ? r.awarded : null, by: r ? r.by : null, accepted: p.accepted.join("; "), keyPoints: p.rubric?.keyPoints ?? [],
          evaluation: r?.by === "ai" && r.feedback ? { feedback: r.feedback, label: MARKING_LABEL.ai_evaluation, parts: r.parts ?? null, formative: FORMATIVE_FEEDBACK_LABEL } : null,
          // SQIE-CLOSE-2026-11 WS-C / WS-B: only what the part carries (a plain part adds nothing, so older feedback is unchanged).
          ...(c.role !== "answer" ? { role: c.role, roleLabel: ROLE_LABEL[c.role] } : {}),
          ...(c.options ? { options: c.options } : {}),
          ...(c.criteria ? { criteria: c.criteria.map((x, k) => ({ ...x, met: r?.matched ? r.matched.includes(k) : null })) } : {}),
          ...(c.safetyCritical ? { safetyCritical: true } : {}),
        };
      }),
      practiceMarks: { awarded, total, label: PRACTICE_MARKS_LABEL },
      ...(variant ? { variant, variantLabel: VARIANT_LABEL[variant] } : {}),
      ...(findings.length ? { findings } : {}),
    };
  }
  let extended: RevisionFeedback["extended"];
  const spec = isExtendedQuestion(q) ? extendedSpecOf(q.answer) : null;
  if (spec) {
    const total = spec.keyPoints.length * spec.marksPerPoint;
    const made = m.extendedMatched ? extendedMarks(spec, m.extendedMatched) : null;
    const shareMarks = Math.round((m.score ?? 0) * total);
    extended = {
      // WS-B (rules v2): a capped answer shows the marks it was recorded at.
      marks: { awarded: made ? (m.safety ? Math.min(made.awarded, shareMarks) : made.awarded) : shareMarks, total, label: PRACTICE_MARKS_LABEL },
      modelAnswer: spec.modelAnswer, label: EXTENDED_LABEL,
      points: spec.keyPoints.map((text, i) => ({ text, matched: made ? made.matched.includes(i) : null })),
    };
  }
  // CE-05: a scenario after marking, stage by stage. The practice marks are the weighted sum of the stage scores.
  let scenario: RevisionFeedback["scenario"];
  const sc = scenarioSpecOf(q.answer);
  if (sc) {
    const res = m.scenario ?? null;
    const marks = res && res.length === sc.stages.length ? scenarioMarks(sc, res) : null;
    scenario = {
      stages: sc.stages.map((st, i) => {
        const r = res?.[i] ?? null;
        return {
          index: i, reveal: st.reveal, prompt: st.prompt, weight: st.weight, score: r ? r.score : null, awarded: r ? Math.round(st.weight * r.score * 100) / 100 : null, by: r ? r.by : null,
          yourAnswer: r ? r.answer : null, key: stageKeyText(st), keyPoint: st.keyPoint, source: st.source,
          evaluation: r?.by === "ai" && r.feedback ? { feedback: r.feedback, label: MARKING_LABEL.ai_evaluation, formative: FORMATIVE_FEEDBACK_LABEL } : null,
        };
      }),
      // Resumed later without a per-stage record, only the share is stored with the attempt: the marks are that share of the total.
      practiceMarks: { awarded: marks && !m.safety ? marks.awarded : Math.round((m.score ?? 0) * sc.totalWeight * 100) / 100, total: sc.totalWeight, label: PRACTICE_MARKS_LABEL },
      label: SCENARIO_LABEL,
    };
  }
  // CE-05: the provenance line. Counts and the guide's fingerprint come only from what the attempt kept (its rubric snapshot, else its 791 snapshot).
  const kept = m.snapshot ?? null, rec = m.assessed?.snapshot ?? null;
  const recKey = (rec?.answerKey ?? {}) as { parts?: unknown[]; stages?: { weight?: number }[] };
  const recRubric = rec?.rubric ?? null;
  const markedAgainst = markedAgainstLine({
    format: effectiveKind(q), marking: m.marking, libraryVersion: q.library?.versionNo ?? null,
    guide: kept?.hash ?? rec?.rubricHash ?? rec?.contentHash ?? (m.justMarked && q.answer ? rubricHash(q.answer) : null),
    // Marked just now, the guide is the question as it stands; shown later, only what the attempt kept is named.
    keyPoints: kept?.keyPoints?.length ?? recRubric?.keyPoints?.length ?? (m.justMarked ? rubric?.keyPoints.length ?? 0 : 0),
    parts: kept?.parts?.length ?? (Array.isArray(recKey.parts) ? recKey.parts.length : m.justMarked ? parts.length : 0),
    weights: sc ? (kept?.parts?.map(p => p.marks) ?? recKey.stages?.map(x => Number(x.weight)).filter(n => Number.isFinite(n)) ?? (m.justMarked ? sc.stages.map(st => st.weight) : undefined)) : undefined,
  });
  return {
    markedAgainst,
    ...(scenario ? { scenario } : {}),
    rubric: rubric ? { objective: rubric.objective, level: LEVEL_LABEL[rubric.level], keyPoints: rubric.keyPoints, grounding: q.library ? LIBRARY_QUESTION_LABEL : GROUNDING_LABEL[rubric.source] } : null,
    nextDifficulty: STEPS[Math.max(0, Math.min(2, (q.difficulty ?? 2) - 1 + (m.correct ? 1 : -1)))],
    questionId: q.id, correct: m.correct, score: m.score, marking: m.marking, markingLabel: MARKING_LABEL[m.marking],
    answer: answerText(q), rationale: q.rationale,
    source: { quote: q.library ? "" : q.sourceQuote, citation: citationOf(q), materialId: q.materialId, chunkId: q.chunkId },
    key: !k ? null : k.kind === "choice" ? { index: k.index } : k.kind === "set" ? { indexes: k.indexes } : k.kind === "order" ? { order: k.order } : k.kind === "matches" ? { matches: k.matches } : null,
    evaluation: m.evaluation ? { feedback: m.evaluation, label: MARKING_LABEL.ai_evaluation, parts: m.evaluationParts ?? null, formative: FORMATIVE_FEEDBACK_LABEL } : null,
    card: m.card ?? null, nextReviewAt: m.nextReviewAt ?? null,
    practises: m.link ? { ...m.link, label: NOT_COMPETENCE_LABEL } : null,
    ...(q.library ? { library: { ...q.library, label: LIBRARY_QUESTION_LABEL } } : {}),
    ...(structured ? { structured } : {}),
    ...(extended ? { extended } : {}),
    ...(m.safety ? { safety: safetyView(m.safety)! } : {}),
    ...(m.calc ? { calculation: {
      given: m.calc.given, expected: m.calc.expected, reason: m.calc.reason, feedback: m.calc.feedback, inKeyUnit: m.calc.inKeyUnit,
      tolerance: toleranceText(m.calc.tolerance, m.calc.expected.unit), unitRule: m.calc.units === "exact_unit" ? "The answer must be in the unit the question asks for." : "The same amount in an equivalent unit counts.",
      warnings: m.calc.warnings, working: calculationSpecOf(q.answer)?.working ?? null, label: CALCULATION_LABEL,
    } } : {}),
    ...(!changed && rubricChanged(row, m.snapshot ?? null) ? { rubricNote: "This question's marking guide has been updated since you answered. What is shown here is the guide your answer was marked against." } : {}),
    ...(changed ? { questionChanged: { note: QUESTION_CHANGED_NOTE, asAnswered: { stem: row.stem, options: [...row.options] } } } : {}),
    ...(eff && m.assessed ? { corrections: { original, entries: m.assessed.corrections.map(c => ({ at: c.createdAt, reason: c.reason, basis: CORRECTION_BASIS_LABEL[c.basis], from: c.previousOutcome, to: c.correctedOutcome })) } } : {}),
  };
}
