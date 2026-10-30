// ── STAGE 4: WHAT A REVISION SESSION SENDS THE BROWSER ── COMPETEN-SCHOLAR-REVISION-01 ────────────────────────────
//
// Before an answer: revisionItemView, the learner projection (revision.ts learnerItem) and where it comes from. After
// an answer: feedbackView, the key in words, the rationale, the source quote, and HOW it was marked -- by code, by the
// student, or by AI evaluation, each labelled. Nothing here calls a model.
// SCHOLAR-SQIE-CLOSE-01 (710): a governed library copy says so (its provenance, no notes quote), and a structured
// question's feedback is part by part, with its practice marks (formative).

import { citeChunk } from "./extract";
import { LIBRARY_QUESTION_LABEL, LIBRARY_REVISION_LABEL, MARKING_LABEL, NOT_COMPETENCE_LABEL, PRACTICE_MARKS_LABEL, REVISION_LABEL, type Marking } from "./config";
import { answerText, keyOf, learnerItem, practiceMarks, structuredParts, type LearnerItem, type PartResult } from "./revision";
import type { LibraryProvenance, QuestionRow } from "./store";
import { GENERATION_DIFFICULTIES as STEPS, GROUNDING_LABEL, LEVEL_LABEL, rubricOf, type FeedbackParts, type GenerationDifficulty } from "./question-intel";

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
    grounding: q.library ? LIBRARY_QUESTION_LABEL : GROUNDING_LABEL[rubricOf(q.answer)?.source ?? "notes"],
    ...(q.library ? { library: q.library } : {}),
  };
}

/** SCHOLAR-SQIE-CLOSE-01: one part of a structured answer after marking. */
export type StructuredPartFeedback = {
  prompt: string; marks: number; awarded: number | null; by: PartResult["by"] | null; accepted: string; keyPoints: string[];
  evaluation: { feedback: string; label: string; parts: FeedbackParts | null } | null;
};

export type RevisionFeedback = {
  questionId: string; correct: boolean; score: number | null; marking: Marking; markingLabel: string;
  answer: string; rationale: string; source: { quote: string; citation: string; materialId: string; chunkId: string };
  /** The key's indexes for the choice kinds, so the card can mark the options. */
  key: { index?: number; indexes?: number[]; order?: number[]; matches?: string[] } | null;
  /** AI evaluation of a short answer: its feedback, labelled, and its five parts where it wrote them (evaluate v2). */
  evaluation?: { feedback: string; label: string; parts?: FeedbackParts | null } | null;
  /** SCHOLAR-QUESTION-INTELLIGENCE-01: after answering only -- what the question checks, at what level, its key points. */
  rubric?: { objective: string | null; level: string; keyPoints: string[]; grounding: string } | null;
  /** SCHOLAR-SQIE-01: the difficulty a follow-up practice on this material starts at -- a step up after a right answer, down after a miss. */
  nextDifficulty?: GenerationDifficulty;
  card?: "created" | "reset" | "reviewed" | null; nextReviewAt?: string | null;
  /** R2: the CFCA competency and learning outcome the question practises, where its section is still linked. */
  practises?: { competency: string; outcome: string | null; label: string } | null;
  /** SCHOLAR-SQIE-CLOSE-01: a governed library question (its provenance). Its source is the library, not the notes. */
  library?: LibraryProvenance & { label: string };
  /** SCHOLAR-SQIE-CLOSE-01: a structured question, part by part, and its practice marks (formative). */
  structured?: { parts: StructuredPartFeedback[]; practiceMarks: { awarded: number; total: number; label: string } };
};

/** Pure. What a student sees after answering one question. */
export function feedbackView(q: QuestionRow, m: { correct: boolean; score: number | null; marking: Marking; evaluation?: string | null; evaluationParts?: FeedbackParts | null; card?: RevisionFeedback["card"]; nextReviewAt?: string | null; link?: { competency: string; outcome: string | null } | null; structured?: readonly PartResult[] | null }): RevisionFeedback {
  const k = keyOf(q);
  const rubric = rubricOf(q.answer);
  const parts = structuredParts(q);
  let structured: RevisionFeedback["structured"];
  if (parts.length) {
    const results = m.structured ?? null;
    const total = parts.reduce((n, p) => n + p.marks, 0);
    // Resumed later, only the share is stored with the attempt: the marks are that share of the total.
    const awarded = results ? practiceMarks(parts, results).awarded : Math.round((m.score ?? 0) * total);
    structured = {
      parts: parts.map((p, i) => {
        const r = results?.[i] ?? null;
        return {
          prompt: p.prompt, marks: p.marks, awarded: r ? r.awarded : null, by: r ? r.by : null, accepted: p.accepted.join("; "), keyPoints: p.rubric?.keyPoints ?? [],
          evaluation: r?.by === "ai" && r.feedback ? { feedback: r.feedback, label: MARKING_LABEL.ai_evaluation, parts: r.parts ?? null } : null,
        };
      }),
      practiceMarks: { awarded, total, label: PRACTICE_MARKS_LABEL },
    };
  }
  return {
    rubric: rubric ? { objective: rubric.objective, level: LEVEL_LABEL[rubric.level], keyPoints: rubric.keyPoints, grounding: q.library ? LIBRARY_QUESTION_LABEL : GROUNDING_LABEL[rubric.source] } : null,
    nextDifficulty: STEPS[Math.max(0, Math.min(2, (q.difficulty ?? 2) - 1 + (m.correct ? 1 : -1)))],
    questionId: q.id, correct: m.correct, score: m.score, marking: m.marking, markingLabel: MARKING_LABEL[m.marking],
    answer: answerText(q), rationale: q.rationale,
    source: { quote: q.library ? "" : q.sourceQuote, citation: citationOf(q), materialId: q.materialId, chunkId: q.chunkId },
    key: !k ? null : k.kind === "choice" ? { index: k.index } : k.kind === "set" ? { indexes: k.indexes } : k.kind === "order" ? { order: k.order } : k.kind === "matches" ? { matches: k.matches } : null,
    evaluation: m.evaluation ? { feedback: m.evaluation, label: MARKING_LABEL.ai_evaluation, parts: m.evaluationParts ?? null } : null,
    card: m.card ?? null, nextReviewAt: m.nextReviewAt ?? null,
    practises: m.link ? { ...m.link, label: NOT_COMPETENCE_LABEL } : null,
    ...(q.library ? { library: { ...q.library, label: LIBRARY_QUESTION_LABEL } } : {}),
    ...(structured ? { structured } : {}),
  };
}
