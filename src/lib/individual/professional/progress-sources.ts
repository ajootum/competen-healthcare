/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCatalogueFor } from "../catalogue";
import { loadLcpdConfig } from "../lcpd-config";
import { loadEvaluationInput } from "./evaluation-sources";
import { loadEvaluationHistory } from "./evaluation-store";
import { loadProfessionalProfile } from "./profile-store";
import { loadCpdSetting, summarise, NOT_VERIFIED } from "./cpd-requirements";
import { loadProgressState, type ProgressState } from "./progress-store";
import type { EvaluationInput } from "./evaluation";
import type { Extra } from "./progress-intel";

// ── MY PROFESSIONAL PROGRESS: WHAT IT READS ── COMPETEN-PROFESSIONAL-PROGRESS-01 s3 ─────────────────────────────────────
//
// CONSUME, DON'T DUPLICATE. The same owners Stage 6 reads (loadEvaluationInput: needs, plan, CPD, evidence, Learning,
// reflections, 393 links, the Passport, Stage 5 and C5), plus the profile with its context history (450), Stage 6's own
// snapshots, the offered catalogue (Domain, CPU) and the CPD requirement the person follows, summarised by Stage 4's own
// code as "recorded" (never "met"). Each keeps its own null for "could not be read".

export async function loadProgressInput(admin: any, userId: string, today: string): Promise<{ input: EvaluationInput; extra: Extra; state: ProgressState }> {
  const [{ input }, profile, evals, catalogue, lcpd, setting, state] = await Promise.all([
    loadEvaluationInput(admin, userId, today), loadProfessionalProfile(admin, userId), loadEvaluationHistory(admin, userId, 100),
    loadCatalogueFor(admin, "professional"), loadLcpdConfig(admin), loadCpdSetting(admin, userId), loadProgressState(admin, userId),
  ]);
  let requirement: Extra["requirement"] = null;
  const req = setting?.setting.requirementCode ? lcpd.requirements.find(r => r.code === setting.setting.requirementCode) : undefined;
  if (req && setting?.setting.cycleStart && input.cpd) {
    const s = summarise(req, setting.setting.cycleStart, input.cpd, input.learning.refs ?? [], today);
    requirement = { label: `${req.label} (${req.body}, source: ${req.source.title})`,
      text: `Recorded in the cycle ${s.cycle.start} to ${s.cycle.end}: ${s.recorded.entries} entries, ${s.recorded.hours} hours${s.requiredHours != null ? ` (the requirement names ${s.requiredHours} hours)` : ""}. ${NOT_VERIFIED}` };
  }
  return { input, state, extra: { items: profile.items, context: profile.history, evaluations: evals.evaluations, catalogue, requirement, decisions: state.decisions } };
}
