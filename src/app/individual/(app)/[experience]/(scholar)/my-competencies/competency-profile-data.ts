/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadLearnerCatalogue, type LearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { competencyProgressRows, learningActivityByCompetency, listProgrammes, studyPlanSchema } from "@/lib/individual/scholar/store";
import { buildCompetencyProgress, type CompetencyProgress } from "@/lib/individual/scholar/competency-progress";
import { loadLearningIntelligence } from "@/lib/individual/scholar/intelligence-data";
import { isMyPlanOn, loadIndividualPolicy } from "@/lib/individual/policy";
import type { CompetencyCoverage } from "@/lib/competency/progress-model";

// ── WHAT THE MY COMPETENCIES PAGES READ ── SCHOLAR-MODULES-01 ──────────────────────────────────────────────
//
// The same reads study/progress makes for its competency section, in one place for My Competency Profile, Development
// Gaps and Frameworks -- no new query, no new table. The catalogue comes ONLY through loadLearnerCatalogue (published,
// fail-closed, HQ allowlist: never loadCatalogueForPreview), and coverage only from Learning Intelligence, so a gap
// here is the one the Progress page reports. No AI.
//
// ⚠ UNREADABLE IS ITS OWN STATE: `unreadable` / a null coverage are never an empty list.

type Admin = any;

/** How many programmes Competen offers (null: unreadable). Read only when the learner has none chosen, as Progress does. */
export async function programmesOffered(admin: Admin, learner: LearnerCatalogue): Promise<number | null> {
  if (!learner.provisioned || learner.programme) return null;
  const list = await listProgrammes(admin);
  return list.ok ? list.data.length : null;
}

/** The learner's coverage of their programme's competencies (null: could not be read). Not asked when there is no programme. */
export async function loadCoverage(admin: Admin, userId: string, learner: LearnerCatalogue, today: string, tz: string): Promise<CompetencyCoverage | null> {
  if (!learner.provisioned || !learner.programme) return null;
  try {
    const policy = await loadIndividualPolicy(admin);
    const li = await loadLearningIntelligence(admin, userId, policy, today, { tz });
    return li.ok ? li.data.coverage : null;
  } catch { return null; }
}

/** Whether My Plan is on for this learner (HQ policy AND migration 780), so a gap can point to it. */
export async function myPlanOn(admin: Admin, userId: string): Promise<boolean> {
  try { return isMyPlanOn(await loadIndividualPolicy(admin), await studyPlanSchema(admin, userId)); } catch { return false; }
}

export type CompetencyProfileData = {
  learner: LearnerCatalogue;
  offered: number | null;
  progress: CompetencyProgress | null;
  coverage: CompetencyCoverage | null;
  activity: Awaited<ReturnType<typeof learningActivityByCompetency>> | null;
  unreadable: boolean;
};

export async function loadCompetencyProfile(admin: Admin, userId: string, today: string, tz: string): Promise<CompetencyProfileData> {
  const learner = await loadLearnerCatalogue(admin, userId);
  const offered = await programmesOffered(admin, learner);
  const rows = learner.provisioned && learner.programme && learner.competencies ? await competencyProgressRows(admin, userId) : null;
  const progress = rows?.ok && learner.competencies
    ? buildCompetencyProgress({
      competencies: learner.competencies,
      mappings: rows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
      questions: rows.data.questions, attempts: rows.data.attempts,
    })
    : null;
  const unreadable = !!learner.programme && (learner.competencies === null || (rows !== null && !rows.ok));
  const [coverage, activity] = await Promise.all([
    loadCoverage(admin, userId, learner, today, tz),
    progress ? learningActivityByCompetency(admin, userId) : Promise.resolve(null),
  ]);
  return { learner, offered, progress, coverage, activity, unreadable };
}
