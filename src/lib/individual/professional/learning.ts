/* eslint-disable @typescript-eslint/no-explicit-any */
import { learningEnabled } from "@/lib/learning/policy";
import { learningCpdLines, loadLearningRecords, type LearningReference } from "@/lib/learning/products";
import type { CpdYear } from "./progress";

// ── COMPLETED LEARNING, READ BY REFERENCE ── COMPETEN-IND-007 x COMPETEN-LEARNING-01 hand-off H1/H2 ──────────────
//
// Owner, "COMPETEN LEARNING -- STAGING ACCEPTANCE CONTINUATION" s3: Professional CPD, Evidence, Progress and the Passport
// "read the authoritative Holdings Learning record by reference. Do not duplicate completion or evidence records."
//
// ⚠ NOTHING IS COPIED. The one record is learning_record, read through src/lib/learning/products.ts by the person's own
// id. No row is written to individual_professional_cpd, _evidence or any other 373 table, so there is nothing to drift.
//
// ⚠ PROVENANCE EXACTLY, NEVER "VERIFIED". A hosted completion is "Course completion, issued by Competen Holdings" or
// "Assessed knowledge, issued by Competen Holdings". An external completion stays what the person declared: self-declared,
// or self-declared with a document attached. None of them claims competence.
//
// ⚠ LEARNING IS OPTIONAL. Behind Learning's own server flag (learning_app, off unless its row is on): off, this returns
// `enabled: false` with no references and every Professional page renders exactly as it did without Learning. A person
// with no learning records loses nothing (product definition s13: every other CPD route stays).
//
// null refs = could not be read (say so), [] = none (render nothing).

export type ProfessionalLearning = { enabled: boolean; refs: LearningReference[] | null };

/** The person's completed learning, or nothing at all while Learning is off. Never throws. */
export async function loadProfessionalLearning(admin: any, userId: string): Promise<ProfessionalLearning> {
  if (!(await learningEnabled(admin))) return { enabled: false, refs: [] };
  return { enabled: true, refs: await loadLearningRecords(admin, userId) };
}

const ISSUED = { course_completion: "Course completion, issued by Competen Holdings", assessed_knowledge: "Assessed knowledge, issued by Competen Holdings" } as const;

/** Pure: what the record is, in words. Platform-recorded hosted outcomes name their issuer; anything else keeps Learning's own label. */
export function learningProvenance(r: Pick<LearningReference, "evidenceClass" | "completionKind" | "evidenceLabel">): string {
  if (r.evidenceClass === "platform_recorded" && (r.completionKind === "course_completion" || r.completionKind === "assessed_knowledge")) return ISSUED[r.completionKind];
  return r.evidenceLabel;
}

export type CpdYearWithLearning = CpdYear & { fromLearning: number; learningEntries: number; learningWithoutHours: number };

/**
 * Pure: the person's own CPD hours by year, with completed learning counted IN, and shown as "of which from Competen
 * Learning". A learning record with no hours (an external course that gave none) counts as an entry and adds no hours --
 * it is reported as such, never as zero hours.
 */
export function cpdYearsWithLearning(own: readonly CpdYear[], refs: readonly LearningReference[]): CpdYearWithLearning[] {
  const by = new Map<number, CpdYearWithLearning>(own.map(y => [y.year, { ...y, fromLearning: 0, learningEntries: 0, learningWithoutHours: 0 }]));
  for (const line of learningCpdLines(refs)) {
    const year = Number(String(line.activityDate).slice(0, 4));
    if (!Number.isInteger(year) || year < 1900) continue;
    const y = by.get(year) ?? { year, hours: 0, entries: 0, withDocument: 0, fromLearning: 0, learningEntries: 0, learningWithoutHours: 0 };
    y.entries++;
    y.learningEntries++;
    if (line.evidenceClass === "source_linked") y.withDocument++;
    if (line.hours == null) y.learningWithoutHours++;
    else {
      y.hours = Math.round((y.hours + Number(line.hours)) * 10) / 10;
      y.fromLearning = Math.round((y.fromLearning + Number(line.hours)) * 10) / 10;
    }
    by.set(year, y);
  }
  return [...by.values()].sort((a, b) => b.year - a.year);
}

/** The person's own links to records in Learning (gated pages there: shown only while Learning is on). */
export const learningRecordHref = (recordId: string) => `/individual/learning/record/${encodeURIComponent(recordId)}`;
export const learningCertificateHref = (no: string) => `/individual/learning/certificate/${encodeURIComponent(no)}`;
export const findLearningHref = (competencyId: string) => `/individual/learning?competency=${encodeURIComponent(competencyId)}`;
