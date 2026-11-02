/* eslint-disable @typescript-eslint/no-explicit-any */
import { caseDecisionTimes, learningEventTimes, progressRows, reviewRows, type Read } from "./store";
import type { StudyStamp } from "./learning-definitions";
import { buildIntelligence, type LearningIntelligence } from "./intelligence";
import { COMPETENCY_SOURCES, type CompetencyCatalogueSource, type CompetencyMappingSource } from "./competency-sources";
import type { IndividualPolicy } from "../policy";

// ── LEARNING INTELLIGENCE: THE READS ── COMPETEN-SCHOLAR-01 S5 ─────────────────────────────────────────────
//
// Every read is keyed on the caller's own user id (the guard resolved it), and the measures are computed by
// the pure module (intelligence.ts). The review history (migration 391) and the competency sources (S1, S2)
// may be absent: an absent review table is "not installed" (recall and review counts render Not measured),
// and an unconnected competency source is "not available" (coverage renders Not measured). Neither is ever
// turned into a zero.

type Rows = Awaited<ReturnType<typeof progressRows>>;
type Reviews = Awaited<ReturnType<typeof reviewRows>>;

export async function loadLearningIntelligence(admin: any, userId: string, policy: IndividualPolicy, today: string, opts: {
  sources?: { catalogue: CompetencyCatalogueSource; mappings: CompetencyMappingSource };
  /** Rows the caller has already read (the progress page), so nothing is read twice. */
  pre?: { rows: Rows; reviews: Reviews };
  /** PLP-01..04: the learner's time zone, so a study day is their local day (UTC when not given). */
  tz?: string;
} = {}): Promise<Read<LearningIntelligence>> {
  const sources = opts.sources ?? COMPETENCY_SOURCES;
  const [rows, reviews] = opts.pre ? [opts.pre.rows, opts.pre.reviews] : await Promise.all([progressRows(admin, userId), reviewRows(admin, userId)]);
  if (!rows.ok) return rows;
  if (!reviews.ok) return reviews;
  // PLP-01..04: the other recorded learning (lesson events, case decisions) so a study day is the shared definition. An unreadable source adds none.
  const [lessons, decisions] = await Promise.all([learningEventTimes(admin, userId), caseDecisionTimes(admin, userId)]);
  const activity: StudyStamp[] = [
    ...(lessons.ok ? lessons.data.map(at => ({ kind: "lesson" as const, at })) : []), ...(decisions.ok ? decisions.data.map(at => ({ kind: "decision" as const, at })) : []),
  ];
  const questionIds = rows.data.questions.map(q => q.id);
  const [catalogue, mappings] = await Promise.all([
    sources.catalogue.competenciesFor(admin, userId),
    sources.mappings.mappingsFor(admin, userId, questionIds),
  ]);
  return {
    ok: true,
    data: buildIntelligence({
      materials: rows.data.materials, questions: rows.data.questions, attempts: rows.data.attempts, cards: rows.data.cards,
      reviews: reviews.data,
      catalogue: catalogue.ok ? catalogue.value : null, mappings: mappings.ok ? mappings.value : null,
      competencyUnreadable: !catalogue.ok || !mappings.ok,
      today, t: { minAnswers: policy.scholarInsightMinAnswers, windowDays: policy.scholarInsightWindowDays }, tz: opts.tz, activity,
    }),
  };
}
