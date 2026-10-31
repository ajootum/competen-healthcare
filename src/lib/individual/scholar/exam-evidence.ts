// ── EXAM EVIDENCE FOR HIGH-YIELD ── SCHOLAR-COMPANION-01 P1 ───────────────────────────────────────────────────────
//
// High-yield may say a concept "appears in N of your past-paper questions" ONLY when the app has counted it, with no AI:
// the learner's OWN exam papers (migration 570, the same user) are searched for questions that share key terms with the
// step's passages. Term overlap only, by the same root-and-variant matching Learn's grounding uses (term-match.ts). The
// query is capped. Nothing is sent anywhere; only the two counts reach the prompt, and only when the questions are > 0.

import { termCovered, termIndex } from "./term-match";
import type { ExamEvidence } from "./learn-teaching";
import { listExamQuestionStems } from "./store";

/** The most question stems read for one request, newest first. */
export const EXAM_EVIDENCE_QUESTION_CAP = 600;
/** A question must share this many of the passages' key terms (or all of them where there are fewer, at least two exist). */
export const EXAM_EVIDENCE_MIN_SHARED = 2;
const STEM_CHARS = 1200;

/**
 * Pure. How many of the learner's past-paper questions share key terms with the passages, and in how many papers.
 * Fewer than two key terms is too little to match on, so it is no evidence.
 */
export function matchExamQuestions(rows: readonly { materialId: string; stem: string }[], terms: readonly string[]): ExamEvidence {
  const keys = [...new Set(terms.map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (keys.length < EXAM_EVIDENCE_MIN_SHARED) return { papers: 0, questions: 0 };
  const papers = new Set<string>();
  let questions = 0;
  for (const r of rows.slice(0, EXAM_EVIDENCE_QUESTION_CAP)) {
    const ix = termIndex(String(r.stem ?? "").slice(0, STEM_CHARS));
    if (keys.filter(t => termCovered(t, ix)).length >= EXAM_EVIDENCE_MIN_SHARED) { questions++; papers.add(r.materialId); }
  }
  return { papers: papers.size, questions };
}

/**
 * The learner's own past-paper questions against the key terms. One capped read keyed on the user; any failure is no
 * evidence (null), never a guess. Null also where the counts are zero.
 */
export async function examEvidenceFor(admin: unknown, userId: string, terms: readonly string[]): Promise<ExamEvidence | null> {
  if (terms.length < EXAM_EVIDENCE_MIN_SHARED) return null;
  try {
    const r = await listExamQuestionStems(admin, userId, EXAM_EVIDENCE_QUESTION_CAP);
    if (!r.ok) return null;
    const e = matchExamQuestions(r.data, terms);
    return e.questions > 0 ? e : null;
  } catch {
    return null;
  }
}
