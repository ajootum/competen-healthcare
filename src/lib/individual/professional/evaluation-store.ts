/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { POLICY_SCOPE, type ProfessionalEvaluationPolicy } from "../policy";
import { createNeed } from "./needs-store";
import { createActivity, createGoal } from "./plan-store";
import { ORIGIN } from "./vocabulary";
import type { Evaluation, Recommendation, StoredEvaluation } from "./evaluation";
import type { ProfessionalContext } from "./evaluation-sources";
import type { Decision } from "./evaluation-vocabulary";

// ── MY PROFESSIONAL EVALUATION: THE STAGE 6 WRITES ── COMPETEN-PROFESSIONAL-EVALUATION-01 s9, migration 530 ───────────────
//
// THE ONE WRITER of 530's tables, by the person's own id: an immutable snapshot, an optional annotation, a decision on
// a recommendation. 530's trigger refuses every update and delete, so a correction is a NEW snapshot naming the one it
// corrects, a revised note is a new note, and a changed mind is a new decision (latest wins).
//
// ⚠ A SNAPSHOT IS REFERENCES AND FINDINGS, NEVER COPIES. It keeps each source's kind, id, label, date, provenance and
// framework version, and the findings that cite them. No reflection body, CPD reflection, note or document is copied:
// 530's CHECK refuses a source carrying a body or text.
//
// ⚠ ACCEPTING NEVER WRITES ANOTHER STAGE'S TABLE HERE. A recommendation that creates a need, goal or activity calls that
// stage's own writer (needs-store createNeed, plan-store createGoal / createActivity), by the person's own id, and only
// the new record's id is kept on the decision. Nothing is created without the person pressing Accept.

export type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "My Professional Evaluation is not set up on this environment yet." }
  : String(error?.code) === "23503" ? { ok: false, status: 404, error: "That evaluation is not on your record." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };

const EVAL_COLUMNS = "id, scope_kind, scope_ref, scope_label, period_from, period_to, context, sources, findings, limitations, recommendations, criteria, "
  + "config_version, framework_versions, interpretation, ai_text, ai_model, ai_policy_version, supersedes_id, correction_note, evaluated_at";

export type EvaluationRow = StoredEvaluation & {
  period_from: string | null; period_to: string | null; context: ProfessionalContext; limitations: string[]; criteria: Record<string, unknown>;
  config_version: string | null; framework_versions: string[]; interpretation: "deterministic" | "deterministic_and_ai";
  ai_text: string | null; ai_model: string | null; ai_policy_version: string | null; supersedes_id: string | null; correction_note: string | null;
};
export type AnnotationRow = { id: string; evaluation_id: string; body: string; template_label: string | null; supersedes_id: string | null; created_at: string };
export type DecisionRow = {
  id: string; evaluation_id: string; recommendation_key: string; decision: Decision; edited_title: string | null; deferred_until: string | null;
  note: string | null; created_kind: "need" | "goal" | "activity" | null; created_id: string | null; decided_at: string;
};
export type EvaluationHistory = { provisioned: boolean; evaluations: EvaluationRow[] | null; annotations: AnnotationRow[] | null; decisions: DecisionRow[] | null };

export async function loadEvaluationHistory(admin: any, userId: string, limit = 50): Promise<EvaluationHistory> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [evaluations, annotations, decisions] = await Promise.all([
    settle(admin.from("individual_professional_evaluation").select(EVAL_COLUMNS).eq("user_id", userId).order("evaluated_at", { ascending: false }).limit(limit)),
    settle(admin.from("individual_professional_evaluation_annotation").select("id, evaluation_id, body, template_label, supersedes_id, created_at").eq("user_id", userId).order("created_at").limit(2000)),
    settle(admin.from("individual_professional_evaluation_decision").select("id, evaluation_id, recommendation_key, decision, edited_title, deferred_until, note, created_kind, created_id, decided_at")
      .eq("user_id", userId).order("decided_at", { ascending: false }).limit(3000)),
  ]);
  if (!provisioned) return { provisioned, evaluations: [], annotations: [], decisions: [] };
  return { provisioned, evaluations, annotations, decisions };
}

/** The latest decision per recommendation of one snapshot. */
export function latestDecisions(decisions: readonly DecisionRow[], evaluationId: string): Map<string, DecisionRow> {
  const out = new Map<string, DecisionRow>();
  for (const d of [...decisions].filter(d => d.evaluation_id === evaluationId).sort((a, b) => b.decided_at.localeCompare(a.decided_at)))
    if (!out.has(d.recommendation_key)) out.set(d.recommendation_key, d);
  return out;
}

/** The WCE version the Individual policy was last published as: the configuration version a snapshot records. */
export async function currentConfigVersion(admin: any): Promise<string | null> {
  try {
    const { data, error } = await admin.from("workspace_config_versions").select("id, created_at")
      .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).order("created_at", { ascending: false }).limit(1);
    return error ? null : (data ?? [])[0]?.id ?? null;
  } catch { return null; }
}

/** The criteria a snapshot was made under: the evaluation policy values, nothing about the person. */
export const criteriaOf = (p: ProfessionalEvaluationPolicy) => ({
  sufficiency: p.sufficiency, recencyDays: p.recencyDays, periodDays: p.periodDays, confidenceFactors: p.confidenceFactors, rules: p.rules,
});

export type AiPart = { text: string; model: string; policyVersion: string };

/** A new immutable snapshot. With `supersedes`, it is a linked correction of the person's own earlier snapshot. */
export async function recordEvaluation(admin: any, userId: string, ev: Evaluation, extra: {
  context: ProfessionalContext; policy: ProfessionalEvaluationPolicy; configVersion: string | null; ai: AiPart | null; supersedes: { id: string; note: string } | null;
}): Promise<Write> {
  // References only: the engine never puts a body in a SourceRef, and 530 refuses one that tries.
  const sources = ev.sources.map(({ key, kind, id, title, date, provenance, classText, dimensions, method, frameworkVersion, competency, outcome, via, href }) =>
    ({ key, kind, id, title: title.slice(0, 300), date, provenance, classText, dimensions, method, frameworkVersion, competency, outcome, via, href }));
  const { data, error } = await admin.from("individual_professional_evaluation").insert({
    user_id: userId, experience_code: ORIGIN, scope_kind: ev.scope.kind, scope_ref: ev.scope.kind === "development" ? null : ev.scope.ref,
    scope_label: ev.scope.label.slice(0, 300), period_from: ev.scope.from ?? null, period_to: ev.scope.to ?? null,
    context: extra.context, sources,
    // The six findings, and beside them (never combined with them) what the person can read off them.
    findings: { ...ev.findings, points: { strengths: ev.strengths, development: ev.development, competencies: ev.competencies, outcome: ev.scope.outcome ?? null } },
    limitations: ev.limitations, recommendations: ev.recommendations, criteria: criteriaOf(extra.policy),
    config_version: extra.configVersion, framework_versions: ev.frameworkVersions,
    interpretation: extra.ai ? "deterministic_and_ai" : "deterministic",
    ai_text: extra.ai?.text ?? null, ai_model: extra.ai?.model ?? null, ai_policy_version: extra.ai?.policyVersion ?? null,
    supersedes_id: extra.supersedes?.id ?? null, correction_note: extra.supersedes?.note ?? null,
  }).select("id").single();
  return error || !data ? failed("evaluation", error) : { ok: true, id: data.id };
}

/** The person's own snapshot, or null. */
export async function evaluationOf(admin: any, userId: string, id: string): Promise<EvaluationRow | null> {
  try {
    const { data } = await admin.from("individual_professional_evaluation").select(EVAL_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
    return data ?? null;
  } catch { return null; }
}

export async function addAnnotation(admin: any, userId: string, evaluationId: string, v: { body: string; template_code: string | null; template_label: string | null; supersedesId: string | null }): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_evaluation_annotation").insert({
    evaluation_id: evaluationId, user_id: userId, experience_code: ORIGIN, body: v.body, template_code: v.template_code, template_label: v.template_label, supersedes_id: v.supersedesId,
  }).select("id").single();
  return error || !data ? failed("note", error) : { ok: true, id: data.id };
}

export type DecisionInput = { decision: Decision; editedTitle: string | null; deferredUntil: string | null; note: string | null };

/**
 * Accept, defer or dismiss one recommendation of the person's own snapshot. An acceptance that creates a need, goal or
 * activity creates it FIRST through its owning service; only if that succeeds is the decision recorded with its id.
 */
export async function decideRecommendation(admin: any, userId: string, ev: Pick<EvaluationRow, "id" | "recommendations">, key: string, d: DecisionInput): Promise<Write & { created?: { kind: string; id: string } }> {
  const rec = (ev.recommendations ?? []).find((r: Recommendation) => r.key === key);
  if (!rec) return { ok: false, status: 404, error: "That recommendation is not part of this evaluation." };
  let created: { kind: "need" | "goal" | "activity"; id: string } | null = null;
  if (d.decision === "accepted" && rec.creates) {
    const title = (d.editedTitle ?? rec.creates.title).trim().slice(0, 200);
    const made = rec.creates.kind === "need"
      ? await createNeed(admin, userId, { title, origin: "evaluation", source_note: rec.basis.slice(0, 500) }, { createdVia: "person" })
      : rec.creates.kind === "goal"
        ? await createGoal(admin, userId, { title }, { createdFrom: "evaluation", needId: rec.creates.needId ?? null, competencyId: rec.creates.competencyId ?? null, offeringId: null, aspirationItemId: null, reflectionId: null })
        : await createActivity(admin, userId, { title, status: "planned" }, rec.creates.goalId ?? null);
    if (!made.ok) return made;
    if (made.id) created = { kind: rec.creates.kind, id: made.id };
  }
  const { data, error } = await admin.from("individual_professional_evaluation_decision").insert({
    evaluation_id: ev.id, user_id: userId, experience_code: ORIGIN, recommendation_key: key, decision: d.decision,
    edited_title: d.decision === "accepted" && d.editedTitle && d.editedTitle !== (rec.creates?.title ?? rec.title) ? d.editedTitle : null, deferred_until: d.decision === "deferred" ? d.deferredUntil : null,
    note: d.note, created_kind: created?.kind ?? null, created_id: created?.id ?? null,
  }).select("id").single();
  if (error || !data) {
    const f = failed("decision", error);
    return created && !f.ok ? { ...f, error: `Your ${created.kind} was added, but the decision could not be recorded. ${f.error}` } : f;
  }
  return { ok: true, id: data.id, ...(created ? { created } : {}) };
}
