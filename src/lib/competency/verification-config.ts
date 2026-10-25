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
// PURE, AND IMPORTS NOTHING.

export const METHOD_KINDS = ["direct_observation", "simulation", "portfolio_review", "practical_assessment", "oral_assessment", "structured_assessment", "other"] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];
export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  direct_observation: "Direct observation", simulation: "Simulation", portfolio_review: "Portfolio review", practical_assessment: "Practical assessment",
  oral_assessment: "Oral assessment", structured_assessment: "Structured competency assessment", other: "Other authorised method",
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
export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  cpd: "CPD entry", learning_record: "Competen Learning record", evidence: "Evidence item", profile_item: "Profile record", reflection: "Reflection (deliberately shared by the person)",
  study_achievement: "Competen Scholar study (formative, not a verification)",
};

export type Outcome = { code: string; class: OutcomeClass; label: string; description?: string };
export type Criterion = { id: string; text: string; required: boolean };
export type ChecklistItem = { id: string; text: string; critical: boolean };
export type RequiredEvidence = { kind: EvidenceKind | "any"; min: number; description: string };
export type MethodContent = {
  summary: string;
  applicability: { professionTermIds: string[]; specialtyTermIds: string[]; frameworkIds: string[]; competencyIds: string[]; contexts: string[] };
  scaleId: string | null; levelIds: string[];
  outcomes: Outcome[]; criteria: Criterion[]; checklist: ChecklistItem[];
  requiredEvidence: RequiredEvidence[]; minEvidence: number;
  decisionGuidance: string;
  workflow: { assignment: "administrator" | "self_claim"; allowFurtherEvidence: boolean };
  validity: { months: number | null; renewal: "reassessment" | "evidence_review" | null };
  reassessment: { waitDays: number | null };
};

export const EMPTY_CONTENT: MethodContent = {
  summary: "", applicability: { professionTermIds: [], specialtyTermIds: [], frameworkIds: [], competencyIds: [], contexts: ["independent"] },
  scaleId: null, levelIds: [], outcomes: [], criteria: [], checklist: [], requiredEvidence: [], minEvidence: 0, decisionGuidance: "",
  workflow: { assignment: "administrator", allowFurtherEvidence: true }, validity: { months: null, renewal: null }, reassessment: { waitDays: null },
};

/** A starting point an administrator edits: the five outcome classes, each with its plain label. Not criteria. */
export const STARTER_OUTCOMES: Outcome[] = OUTCOME_CLASSES.map(c => ({ code: c, class: c, label: OUTCOME_CLASS_LABEL[c] }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{1,40}$/;
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
  const items = (v: unknown, flag: "required" | "critical") => (Array.isArray(v) ? v : []).slice(0, 60).map((c: any) => ({ id: str(c?.id, 41).toLowerCase(), text: str(c?.text, 500), [flag]: flag === "required" ? c?.required !== false : c?.critical === true }));
  const criteria = items(input?.criteria, "required") as Criterion[];
  const checklist = items(input?.checklist, "critical") as ChecklistItem[];
  for (const c of [...criteria, ...checklist]) {
    if (!ITEM_ID.test(c.id) || c.text.length < 3) return { ok: false, error: "Every criterion and checklist item needs a short id and its words." };
  }
  if (new Set([...criteria, ...checklist].map(c => c.id)).size !== criteria.length + checklist.length) return { ok: false, error: "Criterion and checklist ids must be different from each other." };
  const requiredEvidence: RequiredEvidence[] = (Array.isArray(input?.requiredEvidence) ? input.requiredEvidence : []).slice(0, 20).map((r: any) => ({
    kind: r?.kind === "any" || (EVIDENCE_KINDS as readonly string[]).includes(r?.kind) ? r.kind : "any", min: int(r?.min, 1, 20) ?? 1, description: str(r?.description, 300),
  }));
  const content: MethodContent = {
    summary: str(input?.summary, 2000),
    applicability: { professionTermIds: ids(a.professionTermIds), specialtyTermIds: ids(a.specialtyTermIds), frameworkIds: ids(a.frameworkIds), competencyIds: ids(a.competencyIds), contexts: codes(a.contexts) },
    scaleId: typeof input?.scaleId === "string" && UUID.test(input.scaleId) ? input.scaleId : null,
    levelIds: ids(input?.levelIds),
    outcomes, criteria, checklist, requiredEvidence,
    minEvidence: int(input?.minEvidence, 0, 50) ?? 0,
    decisionGuidance: str(input?.decisionGuidance, 4000),
    workflow: { assignment: input?.workflow?.assignment === "self_claim" ? "self_claim" : "administrator", allowFurtherEvidence: input?.workflow?.allowFurtherEvidence !== false },
    validity: { months: int(input?.validity?.months, 1, 240), renewal: input?.validity?.renewal === "reassessment" || input?.validity?.renewal === "evidence_review" ? input.validity.renewal : null },
    reassessment: { waitDays: int(input?.reassessment?.waitDays, 0, 3650) },
  };
  const problems: string[] = [];
  if (!content.outcomes.length) problems.push("Name at least one outcome.");
  if (content.outcomes.some(o => o.class === "verified") && !content.scaleId) problems.push("An outcome that verifies at a level needs the proficiency scale.");
  if (!content.criteria.length && !content.checklist.length) problems.push("Give the criteria or the checklist the assessor decides against.");
  if (content.summary.length < 10) problems.push("Describe the method in a sentence or two.");
  if (forPublish && problems.length) return { ok: false, error: problems[0] };
  return { ok: true, content, problems };
}

export type DecisionInput = {
  outcomeCode: string; levelId: string | null; rationale: string;
  criteria: { id: string; result: "met" | "not_met" | "not_applicable"; note?: string }[];
  checklist: { id: string; result: "done" | "not_done"; note?: string }[];
  evidenceReviewed: string[];
};

/**
 * Pure: a decision as the assessor form sent it, checked against the pinned method content the way 510 will check it,
 * so the form explains a refusal before the database makes it.
 */
export function checkDecision(input: any, content: MethodContent, evidenceIds: readonly string[]): { ok: true; value: DecisionInput; outcome: Outcome } | { ok: false; error: string } {
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
  return { ok: true, outcome, value: { outcomeCode: outcome.code, levelId, rationale, criteria: criteria.filter(Boolean) as DecisionInput["criteria"], checklist: checklist.filter(Boolean) as DecisionInput["checklist"], evidenceReviewed: reviewed } };
}

// ── STATE, AS 510 DERIVES IT ──────────────────────────────────────────────────────────────────────────────────

export type RequestState = "open" | "assigned" | "awaiting_evidence" | "decided" | "withdrawn";
export const STATE_LABEL: Record<RequestState, string> = {
  open: "Waiting for an assessor", assigned: "With an assessor", awaiting_evidence: "Further evidence requested", decided: "Decided", withdrawn: "Withdrawn",
};

/** Pure mirror of competency_verification_state(): the database decides, this explains it on a page. */
export function deriveState(events: readonly { event: string; created_at: string }[], decisions: readonly { outcome_class: string | null; created_at: string }[],
  evidence: readonly { created_at: string }[]): RequestState {
  if (events.some(e => e.event === "withdrawn")) return "withdrawn";
  const last = [...decisions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (last && last.outcome_class !== "further_evidence") return "decided";
  if (last && !evidence.some(e => e.created_at > last.created_at)) return "awaiting_evidence";
  const assign = [...events].filter(e => e.event === "assigned" || e.event === "assignment_declined").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return assign?.event === "assigned" ? "assigned" : "open";
}

export type Standing = "current" | "expired" | "revoked" | "superseded" | "not_a_verification";

/**
 * Pure: what one decision means today. Expiry is its valid_until read against today, revocation is an event, and a
 * later verified decision on the same competency supersedes it. Nothing is rewritten to say so.
 */
export function standingOf(d: { id: string; outcome_class: string | null; valid_until: string | null; created_at: string },
  revoked: ReadonlySet<string>, later: readonly { outcome_class: string | null; created_at: string }[], today: string): Standing {
  if (d.outcome_class !== "verified" && d.outcome_class !== "partial") return "not_a_verification";
  if (revoked.has(d.id)) return "revoked";
  if (later.some(x => x.outcome_class === "verified" && x.created_at > d.created_at)) return "superseded";
  if (d.valid_until && d.valid_until < today) return "expired";
  return "current";
}
export const STANDING_LABEL: Record<Standing, string> = {
  current: "Current", expired: "Expired", revoked: "Revoked", superseded: "Superseded by a later verification", not_a_verification: "Not a verification",
};
