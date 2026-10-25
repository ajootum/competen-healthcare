// ── EDUCATIONAL EVALUATION IN THE PASSPORT ── COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) P5 ──────────────
//
// The Passport keeps three kinds of evidence apart:
//   1. personal learning activity     the study achievements a student chose (375), labelled self-directed
//   2. educational evaluation         an evaluation of their own learning (426) they chose to show (427)
//   3. verified clinical competence   what an organisation issued or verified
// This file is the second. What is shown is DERIVED from the kept evaluation each time it is rendered: its scope,
// method and date, the band or state of each dimension (never a percentage, which would read as a measure of
// competence), its confidence and how many limitations it lists. It is labelled formative and not verified
// wherever it appears, and nothing turns it into a credential.
//
// Pure.

import { EVALUATION_BAND_LABEL, EVALUATION_CONFIDENCE_LABEL, EVALUATION_METHOD_LABEL } from "./config";

export const EDUCATIONAL_EVALUATION_LABEL = "Educational evaluation of own learning: formative, not an assessment of competence, not verified";

export type PassportEvaluation = {
  evaluationId: string; label: string; scope: string; method: string; madeAt: string; confidence: string;
  dimensions: { name: string; reads: string }[]; limitations: number; includedAt: string;
};

type Kept = { id: string; scope: any; method: string; kind: string; createdAt: string; confidence: string; results: any; limitations: string[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

const reads = (m: any): string => // eslint-disable-line @typescript-eslint/no-explicit-any
  !m ? "Not measured" : m.state === "measured" ? (m.band ? EVALUATION_BAND_LABEL[m.band as keyof typeof EVALUATION_BAND_LABEL] : "Measured") : m.state === "insufficient" ? "Too little evidence to say" : "Not measured";

/** Pure. One chosen evaluation, as the Passport shows it. */
export function passportEvaluationOf(k: Kept, choice: { label: string; includedAt: string }): PassportEvaluation {
  const r = k.results ?? {};
  const coverage = r.coverage?.state === "measured" ? `${r.coverage.sections.worked} of ${r.coverage.sections.total} sections worked on` : "Not measured";
  return {
    evaluationId: k.id, label: choice.label, scope: k.scope?.label ?? "Learning evaluation",
    method: k.kind === "continuous" ? "From existing evidence" : EVALUATION_METHOD_LABEL[k.method as keyof typeof EVALUATION_METHOD_LABEL] ?? k.method,
    madeAt: k.createdAt, confidence: EVALUATION_CONFIDENCE_LABEL[k.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? k.confidence,
    dimensions: [
      { name: "Knowledge", reads: reads(r.knowledge) }, { name: "Retention", reads: reads(r.retention) }, { name: "Application", reads: reads(r.application) },
      { name: "Clinical reasoning", reads: reads(r.reasoning) }, { name: "Coverage", reads: coverage },
    ],
    limitations: (k.limitations ?? []).length, includedAt: choice.includedAt,
  };
}
