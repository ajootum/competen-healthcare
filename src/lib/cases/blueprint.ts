/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { REASONING_CAPS, STAGE_CATEGORIES, STAGE_CATEGORY_LABEL, isStageCategory, type StageCategory } from "./categories";

export { STAGE_CATEGORIES, STAGE_CATEGORY_LABEL, type StageCategory };

// ── THE CLINICAL CASE BLUEPRINT ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR2-CR5/5B and AI-CONSUMPTION-01 C3/CI5 ─
//
// ONE versioned structure for every clinical case -- a student's private AI-generated case, an educator-authored case
// and a governed library case (owner, Stage 5 case interface approval s2). What differs is how much a case must carry
// (the validation PROFILE), never its shape. Clinical approval is not in the blueprint: it is a fact of the governance
// record (clinical_content_version, kind 'case', migration 422) about one exact version.
//
// ⚠ GOVERNED FACTS VERSUS AI NARRATIVE. Every finding and its value, what may be revealed and when, every decision
// point, its options and the deterministic key, every consequence of a choice, the safety-critical criteria -- FACTS,
// approved with the exact version. AI may voice the patient, phrase a reveal, explain and give feedback within
// aiBoundary, but never invents a physiological consequence, changes a value or adds a finding.
//
// ⚠ THE BROWSER BOUNDARY (IND-004 review B1-B5, CR2). learnerView() and answeredView() are the ONLY projections a
// browser receives. learnerView shows only the stages the student has REACHED and their decision points -- nothing
// ahead, nothing off their path -- the facts those stages reveal plus what was asked for, and opaque per-view tokens
// instead of author-chosen ids. answeredView gives one decision's rationales, key and safety texts only after it is
// answered. summary, keys, rationales, expected responses, rubrics, consequences and safety flags stay on the server.
//
// ⚠ VARIATIONS STAY INSIDE APPROVED BOUNDARIES. A delivered variation that only picks allowed values for allowed,
// non-safety-critical facts is still the approved version. Anything else is a new version needing renewed approval.
//
// ⚠ NO REAL PATIENT. Patient details are synthetic and coarse (an age band). The patient-identifier screen runs over
// every text field before any blueprint is stored or offered (candidates.ts), a deterministic gate, not an AI verdict.

export const BLUEPRINT_SCHEMA = "case-blueprint/1";
export type Level = "foundation" | "intermediate" | "advanced";
/** standard and high map to the engine's tiers: standard = clinical_educational, high = high_risk_clinical (N3). */
export type Risk = "standard" | "high";
export type Profile = "private" | "library";
/** CR4: the reasoning dimensions a decision exercises. The set is policy (validateBlueprint's dimensions). */
export const DEFAULT_DIMENSIONS = ["recognition", "interpretation", "prioritisation", "decision", "reassessment", "escalation"] as const;

export type CaseFact = {
  id: string;
  kind: "history" | "observation" | "examination" | "investigation" | "result" | "context";
  label: string; value: string; unit?: string | null;
  revealedAt: string;            // "start", a stage id whose reaching reveals it, or "request": only when asked for or a consequence
  safetyCritical: boolean;       // must not be missed, never varies
  aliases?: string[];            // N1: terms a typed request may use for it, matched by the server
};
export type CaseOption = { id: string; text: string; correct: boolean; rationale?: string | null };
export type RubricCriterion = { id: string; criterion: string; weight: number; safetyCritical: boolean; dimension?: string };
export type DecisionPoint = {
  id: string; stageId: string; prompt: string;
  kind: "single" | "multiple" | "free_text";
  dimension?: string;                      // B7: the reasoning dimension it scores (a library case names one)
  options: CaseOption[];                   // the deterministic key is the options' correct flags
  rationale?: string | null;               // B6: the decision's explanation (S4 holds one per step)
  permittedReveals: string[];              // facts the learner may ask for at this point
  hint?: string | null;                    // N2: a governed hint for guided mode
  expectedResponse?: string | null;        // free_text, server-side only
  rubric?: RubricCriterion[];              // free_text, server-side only
  sourceRefs?: string[];                   // B8: private only -- opaque references to the student's own sections
  askReason?: boolean;                     // optional: after choosing, the learner is asked to explain the choice. Marking stays on the choice.
};
export type Stage = { id: string; title: string; reveals: string[]; decisionPointIds: string[]; narrativeHint?: string | null; category?: StageCategory | null };
export type Transition = { from: string; onOptions?: string[]; isDefault?: boolean; to: string; consequenceFactIds: string[] };
export type SafetyCriterion = { id: string; text: string; decisionPointId: string; mustSelect?: string[]; mustNotSelect?: string[] };
/** A recorded learning outcome of a competency (framework_competencies.learning_outcomes, by position), never a copy of it. */
export type OutcomeRef = { competencyId: string; index: number };
/** A competency as it was when the case went for review: 395's competency_content_hash (covers its outcomes and level). */
export type CompetencyVersion = { competencyId: string; contentHash: string };

export type Blueprint = {
  schema: typeof BLUEPRINT_SCHEMA;
  title: string;
  summary?: string | null;                 // B2: catalogue and educator text, server-side only
  learnerIntro?: string | null;            // B2: the spoiler-free opening a learner sees
  /** Optional reasoning sections. Differentials (labels) and management principles reach a learner only as their stage is reached/finished; all of them in the debrief. */
  differentials?: { label: string; reasoning: string }[] | null;
  managementPrinciples?: string[] | null;
  expectedReasoning?: string | null;       // debrief only
  patient?: { ageBand: string; sex?: "female" | "male" | "unspecified"; setting: string; presentingComplaint: string; background: string[] } | null;
  facts: CaseFact[];
  stages: Stage[];
  decisionPoints: DecisionPoint[];
  progression: Transition[];               // empty: the stages run in order
  learningObjectives: { id: string; text: string; competencyIds: string[]; outcomes?: string[]; outcomeRefs?: OutcomeRef[] }[];   // N4
  safetyCriteria: SafetyCriterion[];
  feedback?: { debrief: string; onSafetyEvent: string } | null;
  assessment?: { rubric: RubricCriterion[]; passMark?: number | null } | null;
  references: { citation: string; url?: string | null }[];
  variation: { rules: { factId: string; values?: string[]; range?: { min: number; max: number } }[] };
  aiBoundary: { patientVoice: boolean; phraseReveals: boolean; explain: boolean };
  metadata: {
    level: Level; complexity: 1 | 2 | 3 | 4 | 5; risk: Risk;
    professionTermId: string | null; specialtyTermIds: string[];
    cfcaDomainIds: string[]; cpuIds: string[];
    /** Classification (owner, Stage 5B case classification decision). Every profession the case is for; professionTermId stays its first. */
    professionTermIds?: string[];
    /** The proficiency levels (scoring_levels) the case is pitched at, beside the coarse `level`. */
    proficiencyLevelIds?: string[];
    /** Written by the server at submission, never by an editor: the exact content of each competency the case teaches. */
    competencyVersions?: CompetencyVersion[];
    provenance: { kind: "private" | "candidate" | "educator" | "variation" | "revision"; candidateId?: string | null; parentVersionId?: string | null;
      rights: "student_private" | "educator_original" | "own_notes" | "licensed_to_share"; attestationVersion?: string | null; note?: string | null };
  };
};

const ID = /^[a-z][a-z0-9_-]{0,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Pure: progression problems -- reachability, termination, no cycle, coverage, no overlap (B10, B11). */
function progressionProblems(stages: any[], dps: any[], trans: any[]): string[] {
  const p: string[] = [];
  if (!trans.length) return p;                                   // linear: in order, reachable, terminating
  const ids = stages.map(s => s?.id);
  const out = new Map<string, any[]>(ids.map(id => [id, []]));
  for (const t of trans) out.get(t?.from)?.push(t);
  for (const [from, ts] of out) {
    if (!ts.length) continue;
    // IND-004 R2 (a): an answer picks a branch only where it is ONE choice -- a stage with exactly one decision point,
    // a single choice. Otherwise (several decisions, a multiple or a free-text one) the stage moves on by its default.
    const own = dps.filter(d => d?.stageId === from);
    if (ts.some(t => arr(t?.onOptions).length) && !(own.length === 1 && own[0]?.kind === "single"))
      p.push(`progression from ${from}: option transitions need a stage with exactly one single-choice decision (otherwise the default only)`);
    const opts = new Set(own.flatMap(d => arr(d?.options).map((o: any) => o?.id)));
    const seen = new Set<string>();
    for (const t of ts) for (const o of arr(t?.onOptions)) { if (seen.has(o)) p.push(`progression from ${from}: option ${o} leads to two stages (overlapping transitions)`); seen.add(o); }
    const hasDefault = ts.some(t => t?.isDefault);
    if (!hasDefault && [...opts].some(o => !seen.has(o))) p.push(`progression from ${from}: a stage with option transitions needs a default, or a transition for every option`);
  }
  const reach = new Set<string>(); const stack = [ids[0]];
  while (stack.length) { const s = stack.pop(); if (!s || reach.has(s)) continue; reach.add(s); for (const t of out.get(s) ?? []) stack.push(t?.to); }
  for (const id of ids) if (!reach.has(id)) p.push(`progression: stage ${id} cannot be reached from the first stage`);
  if (![...out.values()].some(ts => !ts.length)) p.push("progression: no stage ends the case");
  const state = new Map<string, number>();                        // 1 visiting, 2 done
  const cyclic = (s: string): boolean => { state.set(s, 1); for (const t of out.get(s) ?? []) { const n = state.get(t?.to); if (n === 1 || (!n && cyclic(t.to))) return true; } state.set(s, 2); return false; };
  if (ids.some(id => !state.get(id) && cyclic(id))) p.push("progression: a cycle (the case must always move forward to an end)");
  return p;
}

/**
 * Pure: every structural rule the database cannot see. Empty when sound. 'private' is the minimal form (including
 * Scholar's existing S4 cases); 'library' adds what a governed shared case must carry. `dimensions` is the configured
 * reasoning-dimension set (CR4).
 */
export function validateBlueprint(b: any, profile: Profile, dimensions: readonly string[] = DEFAULT_DIMENSIONS): string[] {
  const p: string[] = [];
  if (!b || typeof b !== "object") return ["not a blueprint"];
  if (b.schema !== BLUEPRINT_SCHEMA) p.push(`schema must be ${BLUEPRINT_SCHEMA}`);
  if (!str(b.title, 200)) p.push("title is required (up to 200 characters)");
  if (b.learnerIntro !== undefined && b.learnerIntro !== null && !str(b.learnerIntro, 1000)) p.push("learnerIntro, when given, up to 1000 characters");
  const facts = arr(b.facts), stages = arr(b.stages), dps = arr(b.decisionPoints), trans = arr(b.progression);
  const factIds = new Set(facts.map(f => f?.id)), stageIds = new Set(stages.map(s => s?.id)), dpIds = new Set(dps.map(d => d?.id));
  if (!stages.length || !dps.length) p.push("at least one stage and one decision point");
  if (factIds.size !== facts.length || stageIds.size !== stages.length || dpIds.size !== dps.length) p.push("ids must be unique");
  for (const f of facts) {
    if (!ID.test(f?.id ?? "") || !str(f?.label, 120) || typeof f?.value !== "string" || typeof f?.safetyCritical !== "boolean") p.push(`fact ${f?.id ?? "?"}: id, label, value and safetyCritical are required`);
    if (f?.revealedAt !== "start" && f?.revealedAt !== "request" && !stageIds.has(f?.revealedAt)) p.push(`fact ${f?.id}: revealed at start, at a known stage, or on request`);
    if (f?.aliases !== undefined && !arr(f.aliases).every(a => str(a, 60))) p.push(`fact ${f?.id}: aliases are short terms`);
  }
  for (const s of stages) {
    if (!ID.test(s?.id ?? "") || !str(s?.title, 120)) p.push(`stage ${s?.id ?? "?"}: id and title are required`);
    if (s?.category !== undefined && s?.category !== null && !isStageCategory(s.category)) p.push(`stage ${s?.id ?? "?"}: category must be one of ${STAGE_CATEGORIES.join(", ")}`);
    if (s?.category === "reflection" && s?.narrativeHint != null && (typeof s.narrativeHint !== "string" || s.narrativeHint.length > 1000)) p.push(`stage ${s?.id ?? "?"}: a reflection stage's prompt (narrativeHint) is up to 1000 characters`);
    for (const r of arr(s?.reveals)) if (!factIds.has(r)) p.push(`stage ${s?.id}: reveals unknown fact ${r}`);
    for (const d of arr(s?.decisionPointIds)) if (!dpIds.has(d)) p.push(`stage ${s?.id}: names unknown decision point ${d}`);
    // A transition names options by id, so within one stage an option id means one option.
    const own = dps.filter(d => d?.stageId === s?.id).flatMap(d => arr(d?.options).map((o: any) => o?.id));
    if (new Set(own).size !== own.length) p.push(`stage ${s?.id}: option ids repeat between its decision points`);
  }
  for (const d of dps) {
    if (!ID.test(d?.id ?? "") || !stageIds.has(d?.stageId) || !str(d?.prompt, 1000)) p.push(`decision ${d?.id ?? "?"}: id, a known stage and a prompt are required`);
    // B9: a decision point belongs to exactly the stage that lists it.
    const owners = stages.filter(s => arr(s?.decisionPointIds).includes(d?.id));
    if (owners.length !== 1 || owners[0]?.id !== d?.stageId) p.push(`decision ${d?.id}: its stage must list it, and only that stage`);
    // B7: a library case names every decision's dimension. A private one may leave it (Scholar's S4 cases carry none).
    if ((profile === "library" || d?.dimension !== undefined) && !dimensions.includes(d?.dimension)) p.push(`decision ${d?.id}: a reasoning dimension (${dimensions.join(", ")})`);
    const opts = arr(d?.options);
    const dpRationale = str(d?.rationale, 2000);
    if (!["single", "multiple", "free_text"].includes(d?.kind)) p.push(`decision ${d?.id}: kind single, multiple or free_text`);
    if (d?.kind === "single" && (opts.length < 2 || opts.filter(o => o?.correct === true).length !== 1)) p.push(`decision ${d?.id}: a single choice needs at least two options and exactly one correct`);
    if (d?.kind === "multiple" && (opts.length < 2 || !opts.some(o => o?.correct === true))) p.push(`decision ${d?.id}: at least two options and one correct`);
    if (d?.kind === "free_text" && !str(d?.expectedResponse, 4000)) p.push(`decision ${d?.id}: a free-text decision needs its expected response`);
    for (const o of opts) {
      if (!ID.test(o?.id ?? "") || !str(o?.text, 500) || typeof o?.correct !== "boolean") p.push(`decision ${d?.id}: every option needs an id, text and its key`);
      // B6: an option's rationale may be left to the decision's rationale in a private case; a library case explains each option.
      const needOwn = profile === "library" || !dpRationale;
      if (needOwn && !str(o?.rationale, 2000)) p.push(`decision ${d?.id}: option ${o?.id} needs its rationale${profile === "private" ? " (or the decision needs one)" : ""}`);
    }
    for (const r of arr(d?.permittedReveals)) if (!factIds.has(r)) p.push(`decision ${d?.id}: permits revealing unknown fact ${r}`);
    for (const c of arr(d?.rubric)) if ((profile === "library" || c?.dimension !== undefined) && !dimensions.includes(c?.dimension)) p.push(`decision ${d?.id}: rubric criterion ${c?.id} needs a reasoning dimension`);
    if (d?.hint !== undefined && d?.hint !== null && !str(d.hint, 500)) p.push(`decision ${d?.id}: a hint, when given, up to 500 characters`);
    if (d?.askReason !== undefined && d?.askReason !== null && typeof d.askReason !== "boolean") p.push(`decision ${d?.id}: askReason is true or false`);
    if (arr(d?.sourceRefs).length && profile === "library") p.push(`decision ${d?.id}: sourceRefs belong to a private case only`);
  }
  // Optional reasoning sections (all optional, unknown shapes refused, never required).
  if (b.differentials !== undefined && b.differentials !== null) {
    if (!Array.isArray(b.differentials) || b.differentials.length > REASONING_CAPS.differentials) p.push(`differentials: a list of up to ${REASONING_CAPS.differentials}`);
    else for (const x of b.differentials) if (!str(x?.label, REASONING_CAPS.differentialLabel) || !str(x?.reasoning, REASONING_CAPS.differentialReasoning))
      p.push(`differentials: each needs a label (up to ${REASONING_CAPS.differentialLabel} characters) and its reasoning (up to ${REASONING_CAPS.differentialReasoning})`);
  }
  if (b.managementPrinciples !== undefined && b.managementPrinciples !== null) {
    if (!Array.isArray(b.managementPrinciples) || b.managementPrinciples.length > REASONING_CAPS.managementPrinciples || !b.managementPrinciples.every((x: unknown) => str(x, REASONING_CAPS.managementPrinciple)))
      p.push(`managementPrinciples: up to ${REASONING_CAPS.managementPrinciples} statements of up to ${REASONING_CAPS.managementPrinciple} characters`);
  }
  if (b.expectedReasoning !== undefined && b.expectedReasoning !== null && !str(b.expectedReasoning, REASONING_CAPS.expectedReasoning)) p.push(`expectedReasoning, when given, up to ${REASONING_CAPS.expectedReasoning} characters`);
  const optionIds = new Set(dps.flatMap(d => arr(d?.options).map((o: any) => o?.id)));
  const defaults = new Map<string, number>();
  for (const t of trans) {
    if (!stageIds.has(t?.from) || !stageIds.has(t?.to)) p.push(`progression ${t?.from}->${t?.to}: both stages must exist`);
    for (const o of arr(t?.onOptions)) if (!optionIds.has(o)) p.push(`progression from ${t?.from}: unknown option ${o}`);
    for (const c of arr(t?.consequenceFactIds)) if (!factIds.has(c)) p.push(`progression from ${t?.from}: unknown consequence fact ${c}`);
    if (t?.isDefault) defaults.set(t.from, (defaults.get(t.from) ?? 0) + 1);
    if (!t?.isDefault && !arr(t?.onOptions).length) p.push(`progression from ${t?.from}: a transition is either the default or names its options`);
  }
  for (const [s, n] of defaults) if (n > 1) p.push(`progression from ${s}: only one default transition (deterministic)`);
  p.push(...progressionProblems(stages, dps, trans));
  for (const c of arr(b.safetyCriteria)) {
    const dp = dps.find(d => d?.id === c?.decisionPointId);
    if (!dp || !str(c?.text, 500) || (!arr(c?.mustSelect).length && !arr(c?.mustNotSelect).length)) p.push(`safety criterion ${c?.id ?? "?"}: a decision point, its text and what must or must not be selected`);
    else for (const o of [...arr(c.mustSelect), ...arr(c.mustNotSelect)]) if (!arr(dp.options).some((x: any) => x?.id === o)) p.push(`safety criterion ${c.id}: unknown option ${o}`);
  }
  for (const c of arr(b.assessment?.rubric)) if ((profile === "library" || c?.dimension !== undefined) && !dimensions.includes(c?.dimension)) p.push(`assessment criterion ${c?.id}: a reasoning dimension`);
  const safety = new Set(facts.filter(f => f?.safetyCritical).map(f => f.id));
  for (const r of arr(b.variation?.rules)) {
    if (!factIds.has(r?.factId)) p.push(`variation: unknown fact ${r?.factId}`);
    if (safety.has(r?.factId)) p.push(`variation: safety-critical fact ${r?.factId} cannot vary`);
    if (!arr(r?.values).length && !r?.range) p.push(`variation of ${r?.factId}: the allowed values or range`);
  }
  const m = b.metadata ?? {};
  if (!["foundation", "intermediate", "advanced"].includes(m.level) || ![1, 2, 3, 4, 5].includes(m.complexity) || !["standard", "high"].includes(m.risk)) p.push("metadata: level, complexity 1-5 and risk");
  if (!["private", "candidate", "educator", "variation", "revision"].includes(m.provenance?.kind)) p.push("metadata: provenance kind");
  if (!["student_private", "educator_original", "own_notes", "licensed_to_share"].includes(m.provenance?.rights)) p.push("metadata: the rights the content rests on");
  // Classification is OPTIONAL in a draft (owner). What is present must be well formed: references, never copies.
  for (const k of ["professionTermIds", "specialtyTermIds", "cfcaDomainIds", "cpuIds", "proficiencyLevelIds"] as const)
    if (m[k] !== undefined && (!Array.isArray(m[k]) || m[k].length > 50 || !m[k].every((x: any) => UUID.test(x)))) p.push(`metadata: ${k} must be catalogue identifiers`);
  if (m.professionTermId != null && !UUID.test(m.professionTermId)) p.push("metadata: professionTermId must be a catalogue identifier");
  for (const l of arr(b.learningObjectives)) for (const r of arr(l?.outcomeRefs))
    if (!arr(l?.competencyIds).includes(r?.competencyId) || !Number.isInteger(r?.index) || r.index < 0 || r.index > 199) p.push(`objective ${l?.id}: a learning outcome must belong to a competency the objective names`);
  if (m.competencyVersions !== undefined && !(Array.isArray(m.competencyVersions) && m.competencyVersions.every((v: any) => UUID.test(v?.competencyId) && /^[0-9a-f]{32}$/.test(v?.contentHash ?? ""))))
    p.push("metadata: competencyVersions is the server's record of competency content");
  if (profile === "library") {
    if (!str(b.summary, 2000)) p.push("library: a summary (for educators and the catalogue, never shown to a learner)");
    if (!b.patient || !str(b.patient.ageBand, 40) || !str(b.patient.setting, 120) || !str(b.patient.presentingComplaint, 500)) p.push("library: the patient's age band, setting and presenting complaint");
    const los = arr(b.learningObjectives);
    if (!los.length || !los.every(l => str(l?.text, 500) && arr(l?.competencyIds).length && arr(l?.competencyIds).every((c: any) => UUID.test(c)))) p.push("library: learning objectives, each naming the CFCA competencies it serves");
    if (!b.feedback || !str(b.feedback.debrief, 4000)) p.push("library: a debrief");
    if (m.provenance?.kind === "private" || m.provenance?.rights === "student_private") p.push("library: a private case cannot be a library case until it is offered, screened and promoted");
  }
  return p;
}

/** Pure: every profession a case is for. The list, with the single legacy field folded in, de-duplicated. */
export const professionsOf = (md: any): string[] =>
  [...new Set([...arr(md?.professionTermIds), md?.professionTermId].filter((x): x is string => typeof x === "string" && UUID.test(x)))];

/** The classification a case may carry, and the words for each when it is missing (owner, Stage 5B classification). */
export const CLASSIFICATION = ["professions", "specialties", "cfcaDomains", "cpus", "competencies", "learningOutcomes", "proficiency"] as const;
export type ClassificationKey = typeof CLASSIFICATION[number];
export const CLASSIFICATION_LABEL: Record<ClassificationKey, string> = {
  professions: "at least one profession", specialties: "at least one clinical specialty or practice context", cfcaDomains: "at least one CFCA domain",
  cpus: "at least one Competency Practice Unit (CPU)", competencies: "at least one competency", learningOutcomes: "at least one recorded learning outcome",
  proficiency: "at least one proficiency level",
};

/**
 * Pure: what a case lacks of the classification the published case policy requires. Applied at SUBMISSION only, never
 * on saving a draft (owner: incomplete cases may be saved and returned to). Empty when nothing is required.
 */
export function classificationProblems(b: any, required: Partial<Record<ClassificationKey, boolean>>): string[] {
  const m = b?.metadata ?? {};
  const los = arr(b?.learningObjectives);
  const has: Record<ClassificationKey, boolean> = {
    professions: professionsOf(m).length > 0, specialties: arr(m.specialtyTermIds).length > 0, cfcaDomains: arr(m.cfcaDomainIds).length > 0,
    cpus: arr(m.cpuIds).length > 0, competencies: los.some(l => arr(l?.competencyIds).length > 0),
    learningOutcomes: los.some(l => arr(l?.outcomeRefs).length > 0), proficiency: arr(m.proficiencyLevelIds).length > 0,
  };
  return CLASSIFICATION.filter(k => required[k] && !has[k]).map(k => `classification: ${CLASSIFICATION_LABEL[k]} (required by the case policy)`);
}

/** Pure: the competencies a blueprint teaches: what its version links to, and what a reviewer's scope must cover. */
export const blueprintCompetencies = (b: Blueprint) => [...new Set(b.learningObjectives.flatMap(l => l.competencyIds))];

/**
 * Pure: where a choice leads. With no progression, the stages run in order. With explicit progression, the
 * transitions decide, and a stage with none ENDS the case (IND-004 R1: the same reading as validateBlueprint, so a
 * terminal branch stage placed mid-array never runs on into another branch).
 */
export function nextStage(b: Blueprint, from: string, chosen: string[]): { stageId: string | null; consequenceFactIds: string[] } {
  if (!b.progression.length) { const i = b.stages.findIndex(s => s.id === from); return { stageId: i < 0 ? null : b.stages[i + 1]?.id ?? null, consequenceFactIds: [] }; }
  const out = b.progression.filter(t => t.from === from);
  if (!out.length) return { stageId: null, consequenceFactIds: [] };
  const hit = out.find(t => (t.onOptions ?? []).some(o => chosen.includes(o))) ?? out.find(t => t.isDefault);
  return hit ? { stageId: hit.to, consequenceFactIds: hit.consequenceFactIds } : { stageId: null, consequenceFactIds: [] };
}

/** Pure: the safety criteria an answer breaks. Machine-checked, so a safety event never rests on an AI judgement. */
export function safetyEvents(b: Blueprint, decisionPointId: string, chosen: string[]): SafetyCriterion[] {
  return b.safetyCriteria.filter(c => c.decisionPointId === decisionPointId
    && ((c.mustSelect ?? []).some(o => !chosen.includes(o)) || (c.mustNotSelect ?? []).some(o => chosen.includes(o))));
}

/** Pure: a delivered variation is still the approved version only if it picks allowed values for allowed facts. */
export function variationWithinBounds(b: Blueprint, chosen: Record<string, string>): boolean {
  const rules = new Map(b.variation.rules.map(r => [r.factId, r]));
  const critical = new Set(b.facts.filter(f => f.safetyCritical).map(f => f.id));
  return Object.entries(chosen).every(([factId, value]) => {
    const r = rules.get(factId);
    if (!r || critical.has(factId)) return false;
    if (r.values?.length) return r.values.includes(value);
    const n = Number(value);
    return !!r.range && Number.isFinite(n) && n >= r.range.min && n <= r.range.max;
  });
}

// ── The browser boundary (B1-B5) ──────────────────────────────────────────────────────────────────────────────

/** The session's progress, kept by the server: stages reached, and facts requested or revealed as consequences. */
export type ViewState = { reachedStageIds: readonly string[]; revealedFactIds: readonly string[] };
type Kind = "fact" | "stage" | "decision" | "option";
/**
 * Pure: an opaque token for one id in one session view. Without the server's salt it says nothing about the id. An
 * option is keyed by its decision point too (option ids repeat between decisions), so two options never share a token.
 */
export const viewToken = (salt: string, kind: Kind, id: string) => createHash("sha256").update(`${salt}\u0000${kind}\u0000${id}`).digest("base64url").slice(0, 16);
const optionKey = (decisionPointId: string, optionId: string) => `${decisionPointId}\u0000${optionId}`;
/** Pure: the fact, stage or decision id behind a token, for the server resolving a reveal request or an answer. */
export function resolveToken(b: Blueprint, salt: string, kind: Exclude<Kind, "option">, token: string): string | null {
  const ids = kind === "fact" ? b.facts.map(f => f.id) : kind === "stage" ? b.stages.map(s => s.id) : b.decisionPoints.map(d => d.id);
  return ids.find(id => viewToken(salt, kind, id) === token) ?? null;
}
/** Pure: the options an answer's tokens name, within one decision. Null if any token is not one of its options. */
export function resolveOptions(b: Blueprint, salt: string, decisionPointId: string, tokens: string[]): string[] | null {
  const d = b.decisionPoints.find(x => x.id === decisionPointId);
  if (!d) return null;
  const ids = tokens.map(t => d.options.find(o => viewToken(salt, "option", optionKey(d.id, o.id)) === t)?.id);
  return ids.every((id): id is string => !!id) ? [...new Set(ids)] : null;
}

/**
 * Pure: the facts visible now -- at start, revealed by a reached stage (by its revealedAt or the stage's reveals), or
 * in revealedFactIds: the server adds a fact there only when a reached decision permitted asking for it, or an answer
 * made it a consequence. A "request" fact is never revealed by reaching a stage.
 */
export function visibleFacts(b: Blueprint, s: ViewState): Set<string> {
  const reached = new Set(s.reachedStageIds);
  const v = new Set<string>(s.revealedFactIds.filter(id => b.facts.some(f => f.id === id)));
  for (const f of b.facts) if (f.revealedAt === "start" || reached.has(f.revealedAt)) v.add(f.id);
  for (const st of b.stages) if (reached.has(st.id)) for (const r of st.reveals) v.add(r);
  return v;
}

export type LearnerView = {
  title: string; intro: string | null;
  patient: Blueprint["patient"];
  facts: { token: string; label: string; value: string; unit: string | null }[];
  stages: { token: string; title: string; category: StageCategory | null; categoryLabel: string | null; guidance: StageGuidance | null;
    decisionPoints: { token: string; prompt: string; kind: DecisionPoint["kind"]; askReason: boolean; options: { token: string; text: string }[];
      canReveal: { token: string; label: string }[]; hint: string | null }[] }[];
};

/** What a stage's own category adds once the learner is there: differentials as they are weighed, principles once management is behind them. */
export type StageGuidance = { differentials?: { label: string; reasoning?: string }[]; managementPrinciples?: string[] };

/**
 * Pure: the optional guidance a reached stage carries. A differentials stage shows its differentials' labels on reaching
 * it and their reasoning once the learner has moved on; a management stage shows the principles once it is finished
 * (a later stage reached). The final stage's guidance is in the closing, so nothing here answers a decision early.
 */
export function stageGuidance(b: Blueprint, st: Stage, reachedStageIds: readonly string[]): StageGuidance | null {
  const done = reachedStageIds.indexOf(st.id) >= 0 && reachedStageIds.indexOf(st.id) < reachedStageIds.length - 1;
  if (st.category === "differentials" && Array.isArray(b.differentials) && b.differentials.length)
    return { differentials: b.differentials.map(d => (done ? { label: d.label, reasoning: d.reasoning } : { label: d.label })) };
  if (st.category === "management" && done && Array.isArray(b.managementPrinciples) && b.managementPrinciples.length) return { managementPrinciples: [...b.managementPrinciples] };
  return null;
}

/** Pure: a reflection stage that asks nothing (no decision) ends the case on being reached. */
export const endsOnReaching = (b: Blueprint, stageId: string): boolean => {
  const st = b.stages.find(x => x.id === stageId);
  return !!st && st.category === "reflection" && !b.decisionPoints.some(d => d.stageId === st.id);
};

/** What a learner sees when a case ends: everything the optional reasoning sections hold, and the case's own reflection prompt. */
export type CaseClosing = {
  reflectionPrompt: string | null;
  differentials: { label: string; reasoning: string }[];
  managementPrinciples: string[];
  expectedReasoning: string | null;
};
/** Pure: the closing of a case, from the blueprint only. Empty fields where the author wrote none. */
export function caseClosing(b: Blueprint): CaseClosing {
  const reflection = b.stages.find(s => s.category === "reflection" && typeof s.narrativeHint === "string" && s.narrativeHint.trim());
  return {
    reflectionPrompt: reflection?.narrativeHint?.trim() ?? null,
    differentials: Array.isArray(b.differentials) ? b.differentials.map(d => ({ label: d.label, reasoning: d.reasoning })) : [],
    managementPrinciples: Array.isArray(b.managementPrinciples) ? [...b.managementPrinciples] : [],
    expectedReasoning: typeof b.expectedReasoning === "string" && b.expectedReasoning.trim() ? b.expectedReasoning.trim() : null,
  };
}

/**
 * Pure: the only learner projection of a blueprint. Only the stages REACHED, in order, and their decision points --
 * nothing ahead or off the path. The visible facts. Tokens, never ids. No summary, key, rationale, expected response,
 * rubric, consequence or safety flag. `hints` adds governed hints in guided mode.
 */
export function learnerView(b: Blueprint, s: ViewState, salt: string, opts: { hints?: boolean } = {}): LearnerView {
  const reached = new Set(s.reachedStageIds);
  const visible = visibleFacts(b, s);
  const label = (id: string) => b.facts.find(f => f.id === id)?.label ?? "";
  return {
    title: b.title, intro: b.learnerIntro ?? b.patient?.presentingComplaint ?? null, patient: b.patient ?? null,
    facts: b.facts.filter(f => visible.has(f.id)).map(f => ({ token: viewToken(salt, "fact", f.id), label: f.label, value: f.value, unit: f.unit ?? null })),
    stages: b.stages.filter(st => reached.has(st.id)).map(st => ({
      token: viewToken(salt, "stage", st.id), title: st.title,
      category: isStageCategory(st.category) ? st.category : null, categoryLabel: isStageCategory(st.category) ? STAGE_CATEGORY_LABEL[st.category] : null,
      guidance: stageGuidance(b, st, s.reachedStageIds),
      decisionPoints: b.decisionPoints.filter(d => d.stageId === st.id).map(d => ({
        token: viewToken(salt, "decision", d.id), prompt: d.prompt, kind: d.kind, askReason: d.askReason === true && d.kind !== "free_text",
        options: d.options.map(o => ({ token: viewToken(salt, "option", optionKey(d.id, o.id)), text: o.text })),
        canReveal: d.permittedReveals.filter(r => !visible.has(r)).map(r => ({ token: viewToken(salt, "fact", r), label: label(r) })),
        hint: opts.hints ? d.hint ?? null : null,
      })),
    })),
  };
}

/** Pure (B5): what a learner sees after answering ONE decision -- its explanation, the key, and any safety events. */
export function answeredView(b: Blueprint, decisionPointId: string, chosen: string[], salt: string) {
  const d = b.decisionPoints.find(x => x.id === decisionPointId);
  if (!d) return null;
  return {
    token: viewToken(salt, "decision", d.id), dimension: d.dimension, rationale: d.rationale ?? null,
    options: d.options.map(o => ({ token: viewToken(salt, "option", optionKey(d.id, o.id)), correct: o.correct, chosen: chosen.includes(o.id), rationale: o.rationale ?? null })),
    safetyEvents: safetyEvents(b, d.id, chosen).map(c => c.text),
  };
}
