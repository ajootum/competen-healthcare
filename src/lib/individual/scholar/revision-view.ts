// ── STAGE 4: WHAT A REVISION SESSION SENDS THE BROWSER ── COMPETEN-SCHOLAR-REVISION-01 ────────────────────────────
//
// Before an answer: revisionItemView, the learner projection (revision.ts learnerItem) and where it comes from. After
// an answer: feedbackView, the key in words, the rationale, the source quote, and HOW it was marked -- by code, by the
// student, or by AI evaluation, each labelled. Nothing here calls a model.

import { citeChunk } from "./extract";
import { MARKING_LABEL, NOT_COMPETENCE_LABEL, REVISION_LABEL, type Marking } from "./config";
import { answerText, keyOf, learnerItem, type LearnerItem } from "./revision";
import type { QuestionRow } from "./store";

export type RevisionItemView = LearnerItem & { materialId: string; materialTitle: string; chunkId: string; citation: string; label: string };

export const citationOf = (q: QuestionRow) =>
  `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }, q.unit) : "source section"}`;

/** Pure. One question as a session shows it before it is answered: no key, rationale or source quote. */
export function revisionItemView(q: QuestionRow): RevisionItemView {
  return { ...learnerItem(q), materialId: q.materialId, materialTitle: q.materialTitle, chunkId: q.chunkId, citation: citationOf(q), label: REVISION_LABEL };
}

export type RevisionFeedback = {
  questionId: string; correct: boolean; score: number | null; marking: Marking; markingLabel: string;
  answer: string; rationale: string; source: { quote: string; citation: string; materialId: string; chunkId: string };
  /** The key's indexes for the choice kinds, so the card can mark the options. */
  key: { index?: number; indexes?: number[]; order?: number[]; matches?: string[] } | null;
  /** AI evaluation of a short answer: its feedback, labelled. */
  evaluation?: { feedback: string; label: string } | null;
  card?: "created" | "reset" | "reviewed" | null; nextReviewAt?: string | null;
  /** R2: the CFCA competency and learning outcome the question practises, where its section is still linked. */
  practises?: { competency: string; outcome: string | null; label: string } | null;
};

/** Pure. What a student sees after answering one question. */
export function feedbackView(q: QuestionRow, m: { correct: boolean; score: number | null; marking: Marking; evaluation?: string | null; card?: RevisionFeedback["card"]; nextReviewAt?: string | null; link?: { competency: string; outcome: string | null } | null }): RevisionFeedback {
  const k = keyOf(q);
  return {
    questionId: q.id, correct: m.correct, score: m.score, marking: m.marking, markingLabel: MARKING_LABEL[m.marking],
    answer: answerText(q), rationale: q.rationale,
    source: { quote: q.sourceQuote, citation: citationOf(q), materialId: q.materialId, chunkId: q.chunkId },
    key: !k ? null : k.kind === "choice" ? { index: k.index } : k.kind === "set" ? { indexes: k.indexes } : k.kind === "order" ? { order: k.order } : k.kind === "matches" ? { matches: k.matches } : null,
    evaluation: m.evaluation ? { feedback: m.evaluation, label: MARKING_LABEL.ai_evaluation } : null,
    card: m.card ?? null, nextReviewAt: m.nextReviewAt ?? null,
    practises: m.link ? { ...m.link, label: NOT_COMPETENCE_LABEL } : null,
  };
}
