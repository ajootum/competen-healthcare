/* eslint-disable @typescript-eslint/no-explicit-any */
import { experienceHref } from "../experiences";
import { loadIndividualPassport } from "../passport";
import { loadProfessionalRecord } from "./record";
import { loadPlanWorkspace } from "./plan-store";
import { loadNeedsWorkspace, versionOf } from "./needs-store";
import { findLearningHref, learningRecordHref, loadProfessionalLearning } from "./learning";
import { loadLearningReflections } from "./learning-reflections";
import { loadMappingView } from "./mapping-store";
import { loadProfessionalProfile } from "./profile-store";
import { loadStage5, loadVerification } from "./evaluation-stage5";
import type { EvaluationHrefs, EvaluationInput } from "./evaluation";

// ── MY PROFESSIONAL EVALUATION: WHAT IT READS ── COMPETEN-PROFESSIONAL-EVALUATION-01 s3 ─────────────────────────────────
//
// CONSUME, DON'T DUPLICATE. Every source is read through its owning module's own reader, by the person's own id:
// Stage 1 profile (profile-store), Stage 2 needs and reflections (needs-store), Stage 3 plan (plan-store), Stage 4 CPD
// and learning reflections (record, learning-reflections), Competen Learning (learning), competency links on records
// (393, mapping-store), the Passport (passport), and Stage 5 + C5 (evaluation-stage5). Nothing here writes.
//
// ⚠ EACH READER KEEPS ITS OWN NULL. null = could not be read (the evaluation says so), [] = none. A module that is not
// provisioned here reads as none, and the evaluation still works without it.

export type ProfessionalContext = { profession: string | null; role: string | null; specialty: string | null; setting: string | null; jurisdiction: string | null };

export function evaluationHrefs(): EvaluationHrefs {
  const p = (s: string) => experienceHref("professional", s);
  return {
    cpd: p("cpd"), development: p("development"),
    goal: id => `${p("development")}?goal=${encodeURIComponent(id)}#plan-h`, need: id => `${p("development")}?need=${encodeURIComponent(id)}#needs-h`,
    competencies: p("competencies"), competency: id => `${p("competencies")}?c=${encodeURIComponent(id)}#competency`,
    learning: cid => (cid ? findLearningHref(cid) : "/individual/learning"), learningRecord: learningRecordHref,
    verification: p("competencies"),
  };
}

export async function loadEvaluationInput(admin: any, userId: string, today: string): Promise<{ input: EvaluationInput; context: ProfessionalContext; catalogueOffered: boolean }> {
  const [record, plan, needs, learning, learningReflections, map, passport, profile, stage5, verification] = await Promise.all([
    loadProfessionalRecord(admin, userId), loadPlanWorkspace(admin, userId), loadNeedsWorkspace(admin, userId), loadProfessionalLearning(admin, userId),
    loadLearningReflections(admin, userId), loadMappingView(admin, userId), loadIndividualPassport(admin, userId, today), loadProfessionalProfile(admin, userId),
    loadStage5(admin, userId), loadVerification(admin, userId, today, experienceHref("professional", "competencies")),
  ]);
  const names = new Map<string, string>(map.names);
  const versions = new Map<string, string | null>();
  for (const c of map.catalogue ?? []) { names.set(c.competencyId, c.title); versions.set(c.competencyId, versionOf(c)); }
  for (const r of learning.refs ?? []) for (const c of r.competencies) if (!names.has(c.id)) names.set(c.id, c.name);
  for (const p of passport.competencies ?? []) if (!names.has(p.competencyId)) names.set(p.competencyId, p.name);
  const pt = profile.pointer ?? null;
  const context: ProfessionalContext = {
    profession: pt?.self_declared_profession ?? record.profile?.self_declared_profession ?? null, role: pt?.self_declared_current_role ?? null,
    specialty: pt?.self_declared_primary_specialty ?? null, setting: pt?.self_declared_practice_setting ?? null, jurisdiction: pt?.self_declared_practice_jurisdiction ?? null,
  };
  // The 480 goal carries more than the 373 goal: the plan's read is the goal record when 480 is here.
  const goals = plan.provisioned && plan.goals ? plan.goals : record.goals;
  return {
    context, catalogueOffered: (map.catalogue ?? []).length > 0,
    input: {
      today, needs: needs.provisioned && needs.needs ? needs.needs : record.needs, goals, cpd: record.cpd, evidence: record.evidence,
      activities: plan.activities, activityGoals: plan.activityGoals, milestones: plan.milestones, planCompetencies: plan.competencies,
      goalEvidence: plan.evidence, reviews: plan.reviews, needCompetencies: needs.competencies, goalNeeds: needs.goalLinks, reflections: needs.reflections,
      learning: { enabled: learning.enabled, refs: learning.refs }, learningReflections, mappings: map.mappings, passport: passport.competencies,
      stage5, verification, names, versions, hrefs: evaluationHrefs(),
    },
  };
}
