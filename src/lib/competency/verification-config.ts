/* eslint-disable @typescript-eslint/no-explicit-any */
// ── COMPETENCY VERIFICATION STUDIO: WHAT A METHOD VERSION SAYS ── COMPETENCY-01 C5, migration 510 ──────────────────
//
// A Holdings capability, reusable by any product. The criteria of an assessment method are DATA in a method version
// (competency_verification_method_version.content), edited by a Verification Studio Administrator as a draft and then
// published, after which they never change and every decision pins them. Nothing about nursing, a country, a method or
// a proficiency scale is written here: the scale is a CFCA scoring scale (384) named by id, and the outcomes, criteria,
// checklist, evidence, workflow and validity are whatever the administrator configures.
//
// ⚠ THE DATABASE IS THE AUTHORITY. checkMethodContent mirrors competency_method_content_problem() in 510 and adds the
// HFE rules a form can explain (labels, limits). The integrity controls themselves -- no self-verification, appointment
// and scope, assignment, pinned criteria, immutable history -- are 510's triggers and are not configuration.
//
// ⚠ 680 (CFCA verification P2). Two method kinds (knowledge exam, clinical reasoning), CCHU components in method content
// (each with its own pass level, mandatory, safety-critical and weight, configured explicitly, never defaulted), assessor
// evidence (an observation or an exam result by the assigned assessor) and the consolidated component outcome of a
// decision, computed by the ONE roll-up rule, componentOutcome (studio-components.ts), which the database mirrors line for
// line in competency_component_outcome().
//
// PURE. It imports only the pure roll-up rule.
import { componentOutcome, type ComponentOutcome, type ComponentRequirement } from "./studio-components";

export const METHOD_KINDS = ["direct_observation", "simulation", "portfolio_review", "practical_assessment", "oral_assessment", "structured_assessment", "other", "knowledge_exam", "clinical_reasoning"] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];
export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  direct_observation: "Direct observation", simulation: "Simulation", portfolio_review: "Portfolio review", practical_assessment: "Practical assessment",
  oral_assessment: "Oral assessment", structured_assessment: "Structured competency assessment", other: "Other authorised method",
  knowledge_exam: "Knowledge examination", clinical_reasoning: "Clinical reasoning assessment",
};

/** The fixed outcome classes (510 CHECK). An administrator names the outcomes; each one is of exactly one class. */
export const OUTCOME_CLASSES = ["verified", "partial", "further_evidence", "not_demonstrated", "unable_to_determine"] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];
export const OUTCOME_CLASS_LABEL: Record<OutcomeClass, string> = {
  verified: "Verified at a specified level", partial: "Partially demonstrated", further_evidence: "Further evidence required",
  not_demonstrated: "Not demonstrated under the assessment conditions", unable_to_determine: "Unable to determine",
};
/** Said wherever an outcome is shown. An assessment outcome is never a general declaration about the person. */
export const NOT_A_DECLARATION = "This is the outcome of one assessment, by the method and against the criteria stated, at the time stated. It is not a general declaration of professional competence or incompetence.";

export const EVIDENCE_KINDS = ["cpd", "learning_record", "evidence", "profile_item", "reflection", "study_achievement"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** 680: evidence the ASSIGNED assessor records under the method version of the request. Never the person's own record. */
export const ASSESSOR_EVIDENCE_KINDS = ["assessor_observation", "exam_result"] as const;
export type AssessorEvidenceKind = (typeof ASSESSOR_EVIDENCE_KINDS)[number];
export type AnyEvidenceKind = EvidenceKind | AssessorEvidenceKind;
export const EVIDENCE_KIND_LABEL: Record<AnyEvidenceKind, string> = {
  cpd: "CPD entry", learning_record: "Competen Learning record", evidence: "Evidence item", profile_item: "Profile record", reflection: "Reflection (deliberately shared by the person)",
  study_achievement: "Competen Scholar study (formative, not a verification)",
  assessor_observation: "Assessor observation", exam_result: "Examination result",
};
export const isAssessorEvidence = (k: string): k is AssessorEvidenceKind => (ASSESSOR_EVIDENCE_KINDS as readonly string[]).includes(k);

export type Outcome = { code: string; class: OutcomeClass; label: string; description?: string };
/**
 * component: a competency_assessment_component code (660) configured in MethodContent.components, or absent.
 * 690: criterionId pins the item to a competency_skills criterion (670). Its words and component must then equal the
 * criterion as the competency has it, which the database checks on review, publication and every request. sourceRef is
 * the criterion's source reference, carried for traceability.
 */
export type Criterion = { id: string; text: string; required: boolean; component?: string | null; criterionId?: string; sourceRef?: string | null };
export type ChecklistItem = { id: string; text: string; critical: boolean; component?: string | null; criterionId?: string; sourceRef?: string | null };
/** 680: one CCHU component this method assesses, with the settings 660 gives a catalogue entry. */
export type MethodComponent = { code: string; passLevelId: string | null; mandatory: boolean; safetyCritical: boolean; weight: number | null };
export type RequiredEvidence = { kind: EvidenceKind | "any"; min: number; description: string };
export type MethodContent = {
  summary: string;
  applicability: { professionTermIds: string[]; specialtyTermIds: string[]; frameworkIds: string[]; competencyIds: string[]; contexts: string[] };
  scaleId: string | null; levelIds: string[];
  outcomes: Outcome[]; criteria: Criterion[]; checklist: ChecklistItem[];
  /** 680. Empty: the method decides as under 510, with no component results. */
  components: MethodComponent[];
  requiredEvidence: RequiredEvidence[]; minEvidence: number;
  decisionGuidance: string;
  /** 690 secondAssessor: a verified or partial outcome stands only once a second appointed assessor confirms it. */
  workflow: { assignment: "administrator" | "self_claim"; allowFurtherEvidence: boolean; secondAssessor: boolean };
  validity: { months: number | null; renewal: "reassessment" | "evidence_review" | null };
  reassessment: { waitDays: number | null };
};

export const EMPTY_CONTENT: MethodContent = {
  summary: "", applicability: { professionTermIds: [], specialtyTermIds: [], frameworkIds: [], competencyIds: [], contexts: ["independent"] },
  scaleId: null, levelIds: [], outcomes: [], criteria: [], checklist: [], components: [], requiredEvidence: [], minEvidence: 0, decisionGuidance: "",
  workflow: { assignment: "administrator", allowFurtherEvidence: true, secondAssessor: false }, validity: { months: null, renewal: null }, reassessment: { waitDays: null },
};

/** A starting point an administrator edits: the five outcome classes, each with its plain label. Not criteria. */
export const STARTER_OUTCOMES: Outcome[] = OUTCOME_CLASSES.map(c => ({ code: c, class: c, label: OUTCOME_CLASS_LABEL[c] }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{1,40}$/;
const COMPONENT = /^[a-z][a-z0-9_]{2,40}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 200) : []);
const codes = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && CODE.test(x)))].slice(0, 50) : []);
const int = (v: unknown, lo: number, hi: number) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isInteger(n) || n < lo || n > hi ? null : n; };
/** An outcome label says what this assessment found, never what the person is. */
const DECLARATION = /\b(in)?competen(t|ce)\b|\bunsafe\b|\bfit to practi[cs]e\b/i;

export type Checked = { ok: true; content: MethodContent; problems: string[] } | { ok: false; error: string };

/**
 * Normalise what a form sent into method content. `forPublish` also applies every rule publication needs (510 refuses
 * the same), and `problems` lists what a draft still lacks so the form can say so.
 */
export function checkMethodContent(input: any, forPublish = false): Checked {
  const a = input?.applicability ?? {};
  const outcomes: Outcome[] = (Array.isArray(input?.outcomes) ? input.outcomes : []).slice(0, 20).map((o: any) => ({
    code: str(o?.code, 41).toLowerCase(), class: o?.class, label: str(o?.label, 120), ...(str(o?.description, 500) ? { description: str(o?.description, 500) } : {}),
  }));
  for (const o of outcomes) {
    if (!CODE.test(o.code)) return { ok: false, error: "Each outcome code is lower-case letters, digits and underscores." };
    if (!(OUTCOME_CLASSES as readonly string[]).includes(o.class)) return { ok: false, error: `${o.code}: choose the kind of outcome.` };
    if (o.label.length < 3) return { ok: false, error: `${o.code}: give the outcome a label.` };
    if (DECLARATION.test(o.label) || DECLARATION.test(o.description ?? "")) return { ok: false, error: `${o.code}: an outcome says what this assessment found, not that a person is or is not competent.` };
  }
  if (new Set(outcomes.map(o => o.code)).size !== outcomes.length) return { ok: false, error: "Outcome codes must be different from each other." };
  const items = (v: unknown, flag: "required" | "critical") => (Array.isArray(v) ? v : []).slice(0, 60).map((c: any) => ({
    id: str(c?.id, 41).toLowerCase(), text: str(c?.text, 500), [flag]: flag === "required" ? c?.required !== false : c?.critical === true,
    ...(typeof c?.component === "string" && c.component ? { component: c.component } : {}),
    // 690: the pin to the competency's criterion, and its source reference, are kept exactly.
    ...(typeof c?.criterionId === "string" && UUID.test(c.criterionId) ? { criterionId: c.criterionId.toLowerCase() } : {}),
    ...(str(c?.sourceRef, 200) ? { sourceRef: str(c?.sourceRef, 200) } : {}),
  }));
  const criteria = items(input?.criteria, "required") as Criterion[];
  const checklist = items(input?.checklist, "critical") as ChecklistItem[];
  for (const c of [...criteria, ...checklist]) {
    if (!ITEM_ID.test(c.id) || c.text.length < 3) return { ok: false, error: "Every criterion and checklist item needs a short id and its words." };
  }
  if (new Set([...criteria, ...checklist].map(c => c.id)).size !== criteria.length + checklist.length) return { ok: false, error: "Criterion and checklist ids must be different from each other." };
  // 680: the CCHU components, each explicit. The database checks the registry and the scale again when it publishes.
  const components: MethodComponent[] = [];
  for (const k of (Array.isArray(input?.components) ? input.components : []).slice(0, 20) as any[]) {
    const code = typeof k?.code === "string" ? k.code : "";
    if (!COMPONENT.test(code)) return { ok: false, error: "Choose each component from the registry." };
    if (components.some(x => x.code === code)) return { ok: false, error: `${code} is listed twice.` };
    const passLevelId = typeof k?.passLevelId === "string" && UUID.test(k.passLevelId) ? k.passLevelId : null;
    const safetyCritical = k?.safetyCritical === true;
    const weight = k?.weight === null || k?.weight === undefined || k?.weight === "" ? null : Number(k.weight);
    if (weight !== null && !(Number.isFinite(weight) && weight > 0 && weight <= 100 && Math.abs(Math.round(weight * 100) - weight * 100) < 1e-9))
      return { ok: false, error: `${code}: the weight is a number above 0 and at most 100, to two decimal places, or blank.` };
    components.push({ code, passLevelId, mandatory: k?.mandatory !== false || safetyCritical, safetyCritical, weight });
  }
  const unconfigured = [...criteria, ...checklist].find(c => c.component && !components.some(k => k.code === c.component));
  if (unconfigured) return { ok: false, error: `${unconfigured.id}: its component is not one of the components of this method. Add it to the components first.` };
  const requiredEvidence: RequiredEvidence[] = (Array.isArray(input?.requiredEvidence) ? input.requiredEvidence : []).slice(0, 20).map((r: any) => ({
    kind: r?.kind === "any" || (EVIDENCE_KINDS as readonly string[]).includes(r?.kind) ? r.kind : "any", min: int(r?.min, 1, 20) ?? 1, description: str(r?.description, 300),
  }));
  const content: MethodContent = {
    summary: str(input?.summary, 2000),
    applicability: { professionTermIds: ids(a.professionTermIds), specialtyTermIds: ids(a.specialtyTermIds), frameworkIds: ids(a.frameworkIds), competencyIds: ids(a.competencyIds), contexts: codes(a.contexts) },
    scaleId: typeof input?.scaleId === "string" && UUID.test(input.scaleId) ? input.scaleId : null,
    levelIds: ids(input?.levelIds),
    outcomes, criteria, checklist, components, requiredEvidence,
    minEvidence: int(input?.minEvidence, 0, 50) ?? 0,
    decisionGuidance: str(input?.decisionGuidance, 4000),
    workflow: { assignment: input?.workflow?.assignment === "self_claim" ? "self_claim" : "administrator", allowFurtherEvidence: input?.workflow?.allowFurtherEvidence !== false,
      secondAssessor: input?.workflow?.secondAssessor === true },
    validity: { months: int(input?.validity?.months, 1, 240), renewal: input?.validity?.renewal === "reassessment" || input?.validity?.renewal === "evidence_review" ? input.validity.renewal : null },
    reassessment: { waitDays: int(input?.reassessment?.waitDays, 0, 3650) },
  };
  const problems: string[] = [];
  if (!content.outcomes.length) problems.push("Name at least one outcome.");
  if (content.outcomes.some(o => o.class === "verified") && !content.scaleId) problems.push("An outcome that verifies at a level needs the proficiency scale.");
  if (!content.criteria.length && !content.checklist.length) problems.push("Give the criteria or the checklist the assessor decides against.");
  if (content.summary.length < 10) problems.push("Describe the method in a sentence or two.");
  if (content.components.length && !content.scaleId) problems.push("Components are scored on the proficiency scale: choose it.");
  if (forPublish && problems.length) return { ok: false, error: problems[0] };
  return { ok: true, content, problems };
}

export type DecisionInput = {
  outcomeCode: string; levelId: string | null; rationale: string;
  criteria: { id: string; result: "met" | "not_met" | "not_applicable"; note?: string }[];
  checklist: { id: string; result: "done" | "not_done"; note?: string }[];
  evidenceReviewed: string[];
  /** 680: one per component the assessor answered. levelId null: not assessed. Empty when the method has no components. */
  componentResults: ComponentResultInput[];
};
export type ComponentResultInput = { code: string; levelId: string | null; note?: string };
/** A level of the method scale, with its score (scoring_levels). */
export type ScaleLevel = { id: string; scaleId: string; score: number; label: string };

// ── 680: CCHU COMPONENTS, CONSOLIDATED BY THE ONE RULE ─────────────────────────────────────────────────────────

/** Pure: the method's components as the roll-up rule reads them, pass levels as scores. Mirrors competency_method_components(). */
export function methodRequirements(content: Pick<MethodContent, "components">, levels: readonly ScaleLevel[]): ComponentRequirement[] {
  const byId = new Map(levels.map(l => [l.id, l]));
  return (content.components ?? []).map(k => {
    const l = k.passLevelId ? byId.get(k.passLevelId) : undefined;
    return { code: k.code, passLevel: l ? { id: l.id, score: l.score, label: l.label } : null, mandatory: k.mandatory !== false || k.safetyCritical === true,
      safetyCritical: k.safetyCritical === true, weight: k.weight ?? null };
  });
}

/**
 * Pure: the consolidated component outcome of a decision -- componentOutcome over the method's components, the
 * component levels the assessor stated, and the target: the level verified for a verified outcome, otherwise the level
 * the request asked about. Exactly what 680's decision guard computes and stores. null when the method has no components.
 */
export function consolidatedOutcome(content: Pick<MethodContent, "components">, results: readonly ComponentResultInput[], levels: readonly ScaleLevel[],
  targetLevelId: string | null): ComponentOutcome | null {
  if (!content.components?.length) return null;
  const byId = new Map(levels.map(l => [l.id, l]));
  const target = targetLevelId ? byId.get(targetLevelId)?.score ?? null : null;
  return componentOutcome(methodRequirements(content, levels), results.map(r => ({ code: r.code, score: r.levelId ? byId.get(r.levelId)?.score ?? null : null })), target);
}

export const COMPONENT_STATUS_LABEL: Record<ComponentOutcome["status"], string> = {
  achieved: "All components reached", not_achieved: "Not reached in every component", incomplete: "Incomplete: a mandatory component is not assessed",
};

/** Pure: the decision a stored component outcome reads as (680 component_outcome jsonb), or null. */
export function componentOutcomeOf(stored: any): (Omit<ComponentOutcome, "reasons"> & { target: number | null }) | null {
  if (!stored || typeof stored !== "object" || !["achieved", "not_achieved", "incomplete"].includes(stored.status)) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { status: stored.status, overall: typeof stored.overall === "number" ? stored.overall : null, target: typeof stored.target === "number" ? stored.target : null,
    failedMandatory: list(stored.failedMandatory), failedSafetyCritical: list(stored.failedSafetyCritical), missingMandatory: list(stored.missingMandatory) };
}

export type AssessorRecord =
  | { kind: "assessor_observation"; record: { summary: string; observedOn: string; setting?: string; component?: string } }
  | { kind: "exam_result"; record: { title: string; score: number; maxScore: number; passMark?: number; takenOn: string; component?: string } };

/** Pure: an assessor observation or exam result, checked as 680's competency_assessor_record_problem() checks it. */
export function checkAssessorRecord(input: any, content: Pick<MethodContent, "components">, today: string): { ok: true; value: AssessorRecord } | { ok: false; error: string } {
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null);
  const component = typeof input?.component === "string" && input.component ? input.component : undefined;
  if (component && !(content.components ?? []).some(k => k.code === component)) return { ok: false, error: "That component is not one this method assesses." };
  if (input?.kind === "assessor_observation") {
    const summary = str(input?.summary, 4000);
    if (summary.length < 10) return { ok: false, error: "Say what you observed, in at least 10 characters." };
    const observedOn = day(input?.observedOn);
    if (!observedOn) return { ok: false, error: "State the day of the observation." };
    if (observedOn > today) return { ok: false, error: "An observation cannot be dated in the future." };
    const setting = str(input?.setting, 200);
    return { ok: true, value: { kind: "assessor_observation", record: { summary, observedOn, ...(setting ? { setting } : {}), ...(component ? { component } : {}) } } };
  }
  if (input?.kind === "exam_result") {
    const title = str(input?.title, 200);
    if (title.length < 3) return { ok: false, error: "Name the examination." };
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
    const score = num(input?.score), maxScore = num(input?.maxScore), passMark = num(input?.passMark);
    if (score === null || maxScore === null || Number.isNaN(score) || Number.isNaN(maxScore) || Number.isNaN(passMark as number)) return { ok: false, error: "State the score and the maximum score as numbers." };
    if (maxScore <= 0 || score < 0 || score > maxScore) return { ok: false, error: "The score is between 0 and the maximum score." };
    if (passMark !== null && (passMark < 0 || passMark > maxScore)) return { ok: false, error: "The pass mark is between 0 and the maximum score." };
    const takenOn = day(input?.takenOn);
    if (!takenOn) return { ok: false, error: "State the day the examination was taken." };
    if (takenOn > today) return { ok: false, error: "An exam result cannot be dated in the future." };
    return { ok: true, value: { kind: "exam_result", record: { title, score, maxScore, ...(passMark !== null ? { passMark } : {}), takenOn, ...(component ? { component } : {}) } } };
  }
  return { ok: false, error: "Choose an observation or an exam result." };
}

/**
 * Pure: a decision as the assessor form sent it, checked against the pinned method content the way 510 will check it,
 * so the form explains a refusal before the database makes it. With 680 components, `scale` gives the method's levels
 * and the request's target level, so the consolidated outcome is checked here by the same rule the database applies.
 */
export function checkDecision(input: any, content: MethodContent, evidenceIds: readonly string[], scale: { levels: readonly ScaleLevel[]; requestTargetLevelId: string | null } = { levels: [], requestTargetLevelId: null }):
  { ok: true; value: DecisionInput; outcome: Outcome; components: ComponentOutcome | null } | { ok: false; error: string } {
  const outcome = content.outcomes.find(o => o.code === input?.outcomeCode);
  if (!outcome) return { ok: false, error: "Choose the outcome of this assessment." };
  const rationale = str(input?.rationale, 4000);
  if (rationale.length < 10) return { ok: false, error: "Give the reasons for the outcome, with what you observed or reviewed." };
  const levelId = typeof input?.levelId === "string" && UUID.test(input.levelId) ? input.levelId : null;
  if ((outcome.class === "verified") !== (levelId !== null)) return { ok: false, error: outcome.class === "verified" ? "State the level verified." : "Only a verified outcome states a level." };
  if (levelId && content.levelIds.length && !content.levelIds.includes(levelId)) return { ok: false, error: "The method does not verify at that level." };
  const criteria = content.criteria.map(c => { const r = (input?.criteria ?? []).find((x: any) => x?.id === c.id); return r && ["met", "not_met", "not_applicable"].includes(r.result) ? { id: c.id, result: r.result, ...(str(r.note, 500) ? { note: str(r.note, 500) } : {}) } : null; });
  const missing = content.criteria.find((c, i) => c.required && !criteria[i]);
  if (missing) return { ok: false, error: `Answer the criterion: ${missing.text}` };
  const checklist = content.checklist.map(c => { const r = (input?.checklist ?? []).find((x: any) => x?.id === c.id); return r && ["done", "not_done"].includes(r.result) ? { id: c.id, result: r.result, ...(str(r.note, 500) ? { note: str(r.note, 500) } : {}) } : null; });
  const missingCheck = content.checklist.find((c, i) => c.critical && !checklist[i]);
  if (missingCheck) return { ok: false, error: `Answer the critical checklist item: ${missingCheck.text}` };
  if (outcome.class === "verified" && content.criteria.some((c, i) => c.required && criteria[i]?.result === "not_met")) return { ok: false, error: "A verified outcome cannot leave a required criterion not met." };
  if (outcome.class === "further_evidence" && !content.workflow.allowFurtherEvidence) return { ok: false, error: "This method decides on the evidence submitted. It does not ask for more." };
  const reviewed = ids(input?.evidenceReviewed).filter(id => evidenceIds.includes(id));
  if ((outcome.class === "verified" || outcome.class === "partial") && reviewed.length < content.minEvidence) return { ok: false, error: `This method needs at least ${content.minEvidence} evidence item${content.minEvidence === 1 ? "" : "s"} reviewed.` };
  // 680: one level (or not assessed) per component, and a verified outcome only when the components are reached.
  const componentResults: ComponentResultInput[] = [];
  const comps = content.components ?? [];
  const raw = Array.isArray(input?.componentResults) ? input.componentResults : [];
  if (!comps.length && raw.length) return { ok: false, error: "This method assesses no components." };
  const onScale = new Set(scale.levels.filter(l => l.scaleId === content.scaleId).map(l => l.id));
  for (const r of raw.slice(0, 20) as any[]) {
    const k = comps.find(c => c.code === r?.code);
    if (!k) return { ok: false, error: "Answer only the components of this method." };
    if (componentResults.some(x => x.code === k.code)) return { ok: false, error: `${k.code} is answered twice.` };
    const lv = typeof r?.levelId === "string" && r.levelId ? r.levelId : null;
    if (lv && !onScale.has(lv)) return { ok: false, error: `Choose the level for ${k.code} from the scale of this method.` };
    const note = str(r?.note, 500);
    componentResults.push({ code: k.code, levelId: lv, ...(note ? { note } : {}) });
  }
  const components = consolidatedOutcome(content, componentResults, scale.levels, levelId ?? scale.requestTargetLevelId);
  if (outcome.class === "verified" && components && components.status !== "achieved")
    return { ok: false, error: `A verified outcome needs every component reached. ${components.reasons[0] ?? "The weighted level is below the level verified."}` };
  return { ok: true, outcome, components, value: { outcomeCode: outcome.code, levelId, rationale, criteria: criteria.filter(Boolean) as DecisionInput["criteria"], checklist: checklist.filter(Boolean) as DecisionInput["checklist"], evidenceReviewed: reviewed, componentResults } };
}

// ── STATE, AS 510 DERIVES IT ──────────────────────────────────────────────────────────────────────────────────

export type RequestState = "open" | "assigned" | "awaiting_evidence" | "awaiting_confirmation" | "decided" | "withdrawn";
export const STATE_LABEL: Record<RequestState, string> = {
  open: "Waiting for an assessor", assigned: "With an assessor", awaiting_evidence: "Further evidence requested",
  awaiting_confirmation: "Waiting for a second assessor", decided: "Decided", withdrawn: "Withdrawn",
};

/** 690: a second assessor's confirmation of a decision, or that they did not confirm it. */
export type Confirmation = { decision_id: string; result: "confirmed" | "not_confirmed"; created_at?: string };

/**
 * Pure mirror of competency_verification_state() (510, with 690 confirmation): the database decides, this explains
 * it on a page. A decision a second assessor did not confirm is set aside. A decision still awaiting its confirmation
 * leaves the request awaiting_confirmation.
 */
export function deriveState(events: readonly { event: string; created_at: string }[],
  decisions: readonly { id?: string; outcome_class: string | null; created_at: string; confirmation_required?: boolean | null }[],
  evidence: readonly { created_at: string }[], confirmations: readonly Confirmation[] = []): RequestState {
  if (events.some(e => e.event === "withdrawn")) return "withdrawn";
  const setAside = new Set(confirmations.filter(c => c.result === "not_confirmed").map(c => c.decision_id));
  const last = [...decisions].filter(d => !(d.id && setAside.has(d.id))).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (last && last.outcome_class !== "further_evidence") {
    if (last.confirmation_required && !confirmations.some(c => c.decision_id === last.id)) return "awaiting_confirmation";
    return "decided";
  }
  if (last && !evidence.some(e => e.created_at > last.created_at)) return "awaiting_evidence";
  const assign = [...events].filter(e => e.event === "assigned" || e.event === "assignment_declined").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return assign?.event === "assigned" ? "assigned" : "open";
}

export type Standing = "current" | "expired" | "revoked" | "superseded" | "awaiting_confirmation" | "not_confirmed" | "not_a_verification";

/**
 * Pure: what one decision means today. Expiry is its valid_until read against today, revocation is an event, and a
 * later verified decision on the same competency supersedes it. 690: a decision needing a second assessor stands only
 * once confirmed, and one that was not confirmed never stands. Nothing is rewritten to say so. `later` holds only
 * decisions that stand on their own (confirmed where required), so an unconfirmed one supersedes nothing.
 */
export function standingOf(d: { id: string; outcome_class: string | null; valid_until: string | null; created_at: string; confirmation_required?: boolean | null },
  revoked: ReadonlySet<string>, later: readonly { outcome_class: string | null; created_at: string }[], today: string,
  confirmation: Confirmation["result"] | null = null): Standing {
  if (d.outcome_class !== "verified" && d.outcome_class !== "partial") return "not_a_verification";
  if (confirmation === "not_confirmed") return "not_confirmed";
  if (revoked.has(d.id)) return "revoked";
  if (d.confirmation_required && confirmation !== "confirmed") return "awaiting_confirmation";
  if (later.some(x => x.outcome_class === "verified" && x.created_at > d.created_at)) return "superseded";
  if (d.valid_until && d.valid_until < today) return "expired";
  return "current";
}
export const STANDING_LABEL: Record<Standing, string> = {
  current: "Current", expired: "Expired", revoked: "Revoked", superseded: "Superseded by a later verification",
  awaiting_confirmation: "Waiting for a second assessor to confirm", not_confirmed: "Not confirmed by the second assessor", not_a_verification: "Not a verification",
};

// ── 690: A METHOD DRAFT MADE FROM A COMPETENCY'S APPROVED CRITERIA ────────────────────────────────────────────────

export type SourceCriterion = { id: string; name: string; componentCode: string | null; sourceRef: string | null };
export type SourceComponent = { code: string; passLevelId: string | null; mandatory: boolean; safetyCritical: boolean; weight: number | null };

/**
 * Pure: the content of a new method draft for one competency, made from its criteria exactly as the competency has
 * them. Every criterion keeps its id (as criterionId and as the item id), its words, its component and its source
 * reference, so the database can hold the method to them. Components come from the programme's component requirements
 * (660) where they are configured, otherwise each component the criteria use is listed for the author to configure.
 * Nothing clinical is decided here: outcomes are the five plain starter outcomes, and the draft goes through clinical
 * review and independent publication like any other.
 */
export function methodDraftFromCompetency(c: { id: string; name: string }, criteria: readonly SourceCriterion[],
  configured: readonly SourceComponent[], scaleId: string | null): { ok: true; content: MethodContent; problems: string[] } | { ok: false; error: string } {
  if (!criteria.length) return { ok: false, error: "This competency has no assessment criteria to make a method from." };
  if (criteria.length > 60) return { ok: false, error: "This competency has more than 60 criteria. A method holds at most 60: split it with the author." };
  const long = criteria.find(k => k.name.trim().length > 500);
  if (long) return { ok: false, error: "A criterion is longer than 500 characters, so it cannot be held word for word. Shorten it in the competency first." };
  const used = [...new Set(criteria.map(k => k.componentCode).filter((x): x is string => !!x))];
  const components: MethodComponent[] = used.map(code => {
    const k = configured.find(x => x.code === code);
    return k ? { code, passLevelId: k.passLevelId, mandatory: k.mandatory || k.safetyCritical, safetyCritical: k.safetyCritical, weight: k.weight }
      : { code, passLevelId: null, mandatory: true, safetyCritical: false, weight: null };
  });
  const content: MethodContent = {
    ...EMPTY_CONTENT,
    summary: `Assessment of ${c.name.trim()} against its ${criteria.length} approved criteri${criteria.length === 1 ? "on" : "a"}.`,
    applicability: { ...EMPTY_CONTENT.applicability, competencyIds: [c.id] },
    scaleId, outcomes: STARTER_OUTCOMES, components,
    criteria: criteria.map(k => ({ id: k.id.toLowerCase(), criterionId: k.id.toLowerCase(), text: k.name.trim(), required: true,
      ...(k.componentCode ? { component: k.componentCode } : {}), ...(k.sourceRef ? { sourceRef: k.sourceRef } : {}) })),
    workflow: { ...EMPTY_CONTENT.workflow, secondAssessor: components.some(k => k.safetyCritical) },
  };
  const checked = checkMethodContent(content);
  if (!checked.ok) return checked;
  const problems = [...checked.problems];
  for (const k of components) if (!configured.some(x => x.code === k.code)) problems.push(`Configure the ${k.code} component: its pass level, whether it is mandatory or safety critical, and its weight.`);
  if (!scaleId) problems.push("Choose the proficiency scale the components and outcomes are scored on.");
  return { ok: true, content: checked.content, problems };
}

/** Pure: whether an item is pinned to its competency's criterion (its words are then not edited in the method). */
export const isPinned = (c: { criterionId?: string }) => typeof c.criterionId === "string" && c.criterionId.length > 0;

// ── 690: AN ASSESSOR'S WORKING DRAFT ──────────────────────────────────────────────────────────────────────────────

/** What a decision draft keeps: the form as the assessor left it. Not a record, and never read as one. */
export type DecisionDraft = { outcomeCode?: string; levelId?: string | null; rationale?: string;
  criteria?: { id: string; result: string; note?: string }[]; checklist?: { id: string; result: string; note?: string }[];
  componentResults?: { code: string; levelId: string | null; note?: string }[]; evidenceReviewed?: string[] };

/** Pure: a draft as the form sent it, bounded. Only known keys, only strings and short lists. */
export function cleanDraft(input: any): DecisionDraft {
  const list = (v: unknown, keys: string[]) => (Array.isArray(v) ? v : []).slice(0, 80).filter((x: any) => x && typeof x === "object")
    .map((x: any) => Object.fromEntries(keys.filter(k => x[k] !== undefined).map(k => [k, k === "levelId" ? (typeof x[k] === "string" ? x[k] : null) : str(x[k], 500)]))) as any[];
  return {
    ...(typeof input?.outcomeCode === "string" ? { outcomeCode: str(input.outcomeCode, 41) } : {}),
    ...(typeof input?.levelId === "string" || input?.levelId === null ? { levelId: input.levelId ? str(input.levelId, 40) : null } : {}),
    ...(typeof input?.rationale === "string" ? { rationale: str(input.rationale, 4000) } : {}),
    criteria: list(input?.criteria, ["id", "result", "note"]), checklist: list(input?.checklist, ["id", "result", "note"]),
    componentResults: list(input?.componentResults, ["code", "levelId", "note"]),
    evidenceReviewed: Array.isArray(input?.evidenceReviewed) ? input.evidenceReviewed.filter((x: unknown) => typeof x === "string" && UUID.test(x)).slice(0, 50) : [],
  };
}

// ── 690: WHAT AN UNSUCCESSFUL OR INCOMPLETE OUTCOME LEAVES TO DEVELOP ─────────────────────────────────────────────

export type DevelopmentNeed = { competencyId: string; title: string; reason: string; detail: string[]; decidedAt: string; decisionId: string };

/**
 * Pure: the development needs an assessment outcome points to. Only outcomes that did not verify (partial, further
 * evidence, not demonstrated) and components below their pass level or not assessed. Offered to the person to add to
 * their own development plan, never written for them.
 */
export function developmentNeedsOf(item: { competencyId: string; title: string; decisions: readonly { decisionId: string; outcomeClass: string | null; outcomeLabel: string; decidedAt: string;
  components: { results: readonly { code: string; label: string | null }[]; outcome: { failedMandatory: readonly string[]; missingMandatory: readonly string[] } } | null }[] },
  componentLabel: (code: string) => string = c => c): DevelopmentNeed | null {
  const last = [...item.decisions].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
  if (!last || !["partial", "further_evidence", "not_demonstrated"].includes(last.outcomeClass ?? "")) return null;
  const detail = [
    ...(last.components?.outcome.failedMandatory ?? []).map(c => `${componentLabel(c)}: below the level required`),
    ...(last.components?.outcome.missingMandatory ?? []).map(c => `${componentLabel(c)}: not yet assessed`),
  ];
  return { competencyId: item.competencyId, title: item.title, reason: last.outcomeLabel, detail, decidedAt: last.decidedAt, decisionId: last.decisionId };
}
