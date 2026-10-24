/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE CLINICAL CASE BLUEPRINT ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR3/5B and AI-CONSUMPTION-01 C3/CI5 ───
//
// ONE versioned structure for every clinical case -- a student's private AI-generated case, an educator-authored case
// and a governed library case (owner, Stage 5 case interface approval s2). What differs between them is how much a
// case must carry (the validation PROFILE), never its shape. Clinical approval is not in the blueprint: it is a fact of
// the governance record (clinical_content_version, kind 'case', migration 422) about one exact version.
//
// ⚠ GOVERNED FACTS VERSUS AI NARRATIVE. Everything clinically significant -- every finding and its value, what may be
// revealed and when, every decision point, its options and the deterministic key, every consequence of a choice, the
// safety-critical criteria -- is a FACT here, approved with the exact version. AI may voice the patient, phrase a
// reveal, explain and give feedback within aiBoundary, but never invents a physiological consequence, changes a value
// or adds a finding. Progression is deterministic: a choice leads where the blueprint says.
//
// ⚠ ANSWERS STAY ON THE SERVER. learnerView() is the only projection a browser receives: no correct flags, no
// rationales before answering, no expected responses, no rubrics, no consequences or facts not yet revealed.
//
// ⚠ VARIATIONS STAY INSIDE APPROVED BOUNDARIES. A delivered variation that only picks allowed values for allowed,
// non-safety-critical facts is still the approved version. Anything else is a new version needing renewed approval.
//
// ⚠ NO REAL PATIENT. Patient details are synthetic and coarse (an age band). The patient-identifier screen runs over
// every text field before any blueprint is stored or offered (candidates.ts), a deterministic gate, not an AI verdict.

export const BLUEPRINT_SCHEMA = "case-blueprint/1";
export type Level = "foundation" | "intermediate" | "advanced";
export type Risk = "standard" | "high";
export type Profile = "private" | "library";

export type CaseFact = {
  id: string;                 // unique in the blueprint
  kind: "history" | "observation" | "examination" | "result" | "context";
  label: string;              // "Respiratory rate"
  value: string;              // "28" -- the governed value
  unit?: string | null;       // "breaths/min"
  revealedAt: string;         // "start", or a stage id where it is revealed automatically
  safetyCritical: boolean;    // a finding the learner must not miss, and that never varies
};
export type CaseOption = { id: string; text: string; correct: boolean; rationale: string };
export type RubricCriterion = { id: string; criterion: string; weight: number; safetyCritical: boolean };
export type DecisionPoint = {
  id: string; stageId: string; prompt: string;
  kind: "single" | "multiple" | "free_text";
  options: CaseOption[];                   // the deterministic key is the options' correct flags (empty for free_text)
  permittedReveals: string[];              // facts the learner may ask for at this point (governed, not invented)
  expectedResponse?: string | null;        // free_text: what a good answer contains (server-side only)
  rubric?: RubricCriterion[];              // free_text: how it is assessed (server-side only)
};
export type Stage = { id: string; title: string; reveals: string[]; decisionPointIds: string[]; narrativeHint?: string | null };
/** Deterministic progression. With none, the stages run in order. */
export type Transition = { from: string; onOptions?: string[]; isDefault?: boolean; to: string; consequenceFactIds: string[] };
/** A machine-checkable safety-critical criterion over one decision point's answer. */
export type SafetyCriterion = { id: string; text: string; decisionPointId: string; mustSelect?: string[]; mustNotSelect?: string[] };

export type Blueprint = {
  schema: typeof BLUEPRINT_SCHEMA;
  title: string;
  summary?: string | null;
  patient?: { ageBand: string; sex?: "female" | "male" | "unspecified"; setting: string; presentingComplaint: string; background: string[] } | null;
  facts: CaseFact[];
  stages: Stage[];
  decisionPoints: DecisionPoint[];
  progression: Transition[];
  learningObjectives: { id: string; text: string; competencyIds: string[] }[];
  safetyCriteria: SafetyCriterion[];
  feedback?: { debrief: string; onSafetyEvent: string } | null;
  assessment?: { rubric: RubricCriterion[]; passMark?: number | null } | null;
  references: { citation: string; url?: string | null }[];
  variation: { rules: { factId: string; values?: string[]; range?: { min: number; max: number } }[] };
  aiBoundary: { patientVoice: boolean; phraseReveals: boolean; explain: boolean };
  metadata: {
    level: Level; complexity: 1 | 2 | 3 | 4 | 5; risk: Risk;
    professionTermId: string | null; specialtyTermIds: string[];     // one case, several specialties: no copies
    cfcaDomainIds: string[]; cpuIds: string[];
    provenance: { kind: "private" | "candidate" | "educator" | "variation" | "revision"; candidateId?: string | null; parentVersionId?: string | null;
      rights: "student_private" | "educator_original" | "own_notes" | "licensed_to_share"; attestationVersion?: string | null; note?: string | null };
  };
};

const ID = /^[a-z][a-z0-9_-]{0,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Pure: every structural rule the database cannot see. Empty when sound. 'private' is the minimal form (a student's
 * own case, including Scholar's existing 2-5 step single-choice cases); 'library' adds what a governed shared case must
 * carry: the patient, CFCA-linked objectives, feedback, the rights it rests on.
 */
export function validateBlueprint(b: any, profile: Profile): string[] {
  const p: string[] = [];
  if (!b || typeof b !== "object") return ["not a blueprint"];
  if (b.schema !== BLUEPRINT_SCHEMA) p.push(`schema must be ${BLUEPRINT_SCHEMA}`);
  if (!str(b.title, 200)) p.push("title is required (up to 200 characters)");
  const facts = arr(b.facts), stages = arr(b.stages), dps = arr(b.decisionPoints), trans = arr(b.progression);
  const factIds = new Set(facts.map(f => f?.id)), stageIds = new Set(stages.map(s => s?.id)), dpIds = new Set(dps.map(d => d?.id));
  if (!stages.length || !dps.length) p.push("at least one stage and one decision point");
  if (factIds.size !== facts.length || stageIds.size !== stages.length || dpIds.size !== dps.length) p.push("ids must be unique");
  for (const f of facts) {
    if (!ID.test(f?.id ?? "") || !str(f?.label, 120) || typeof f?.value !== "string" || typeof f?.safetyCritical !== "boolean") p.push(`fact ${f?.id ?? "?"}: id, label, value and safetyCritical are required`);
    if (f?.revealedAt !== "start" && !stageIds.has(f?.revealedAt)) p.push(`fact ${f?.id}: revealed at an unknown stage`);
  }
  for (const s of stages) {
    if (!ID.test(s?.id ?? "") || !str(s?.title, 120)) p.push(`stage ${s?.id ?? "?"}: id and title are required`);
    for (const r of arr(s?.reveals)) if (!factIds.has(r)) p.push(`stage ${s?.id}: reveals unknown fact ${r}`);
    for (const d of arr(s?.decisionPointIds)) if (!dpIds.has(d)) p.push(`stage ${s?.id}: names unknown decision point ${d}`);
  }
  for (const d of dps) {
    if (!ID.test(d?.id ?? "") || !stageIds.has(d?.stageId) || !str(d?.prompt, 1000)) p.push(`decision ${d?.id ?? "?"}: id, a known stage and a prompt are required`);
    const opts = arr(d?.options);
    if (d?.kind === "single" && (opts.length < 2 || opts.filter(o => o?.correct === true).length !== 1)) p.push(`decision ${d?.id}: a single choice needs at least two options and exactly one correct`);
    if (d?.kind === "multiple" && (opts.length < 2 || !opts.some(o => o?.correct === true))) p.push(`decision ${d?.id}: at least two options and one correct`);
    if (d?.kind === "free_text" && !str(d?.expectedResponse, 4000)) p.push(`decision ${d?.id}: a free-text decision needs its expected response`);
    if (!["single", "multiple", "free_text"].includes(d?.kind)) p.push(`decision ${d?.id}: kind single, multiple or free_text`);
    for (const o of opts) if (!ID.test(o?.id ?? "") || !str(o?.text, 500) || !str(o?.rationale, 2000) || typeof o?.correct !== "boolean") p.push(`decision ${d?.id}: every option needs an id, text, its key and a rationale`);
    for (const r of arr(d?.permittedReveals)) if (!factIds.has(r)) p.push(`decision ${d?.id}: permits revealing unknown fact ${r}`);
  }
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
  for (const c of arr(b.safetyCriteria)) {
    const dp = dps.find(d => d?.id === c?.decisionPointId);
    if (!dp || !str(c?.text, 500) || (!arr(c?.mustSelect).length && !arr(c?.mustNotSelect).length)) p.push(`safety criterion ${c?.id ?? "?"}: a decision point, its text and what must or must not be selected`);
    else for (const o of [...arr(c.mustSelect), ...arr(c.mustNotSelect)]) if (!arr(dp.options).some((x: any) => x?.id === o)) p.push(`safety criterion ${c.id}: unknown option ${o}`);
  }
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
  if (profile === "library") {
    if (!str(b.summary, 2000)) p.push("library: a summary");
    if (!b.patient || !str(b.patient.ageBand, 40) || !str(b.patient.setting, 120) || !str(b.patient.presentingComplaint, 500)) p.push("library: the patient's age band, setting and presenting complaint");
    const los = arr(b.learningObjectives);
    if (!los.length || !los.every(l => str(l?.text, 500) && arr(l?.competencyIds).length && arr(l?.competencyIds).every((c: any) => UUID.test(c)))) p.push("library: learning objectives, each naming the CFCA competencies it serves");
    if (!b.feedback || !str(b.feedback.debrief, 4000)) p.push("library: a debrief");
    if (m.provenance?.kind === "private" || m.provenance?.rights === "student_private") p.push("library: a private case cannot be a library case until it is offered, screened and promoted");
  }
  return p;
}

/** Pure: the competencies a blueprint teaches: what its version links to, and what a reviewer's scope must cover. */
export const blueprintCompetencies = (b: Blueprint) => [...new Set(b.learningObjectives.flatMap(l => l.competencyIds))];

/** Pure: the order the stages run in. Explicit progression where given, otherwise the stages in order. */
export function nextStage(b: Blueprint, from: string, chosen: string[]): { stageId: string | null; consequenceFactIds: string[] } {
  const out = b.progression.filter(t => t.from === from);
  if (!out.length) { const i = b.stages.findIndex(s => s.id === from); return { stageId: b.stages[i + 1]?.id ?? null, consequenceFactIds: [] }; }
  const hit = out.find(t => (t.onOptions ?? []).some(o => chosen.includes(o))) ?? out.find(t => t.isDefault);
  return hit ? { stageId: hit.to, consequenceFactIds: hit.consequenceFactIds } : { stageId: null, consequenceFactIds: [] };
}

/** Pure: the safety criteria an answer breaks. Machine-checkable, so a safety event never rests on an AI judgement. */
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

export type LearnerView = {
  title: string; summary: string | null;
  patient: Blueprint["patient"];
  facts: { id: string; label: string; value: string; unit: string | null }[];
  stages: { id: string; title: string }[];
  decisionPoints: { id: string; stageId: string; prompt: string; kind: DecisionPoint["kind"]; options: { id: string; text: string }[]; canReveal: { id: string; label: string }[] }[];
};

/**
 * Pure: the only projection of a blueprint a browser receives. The facts revealed so far, the stages, and for each
 * decision point its prompt, its option texts and the LABELS of what may be revealed -- never the key, the rationales,
 * expected responses, rubrics, consequences, safety flags or facts not yet revealed.
 */
export function learnerView(b: Blueprint, revealed: ReadonlySet<string>): LearnerView {
  const shown = (f: CaseFact) => f.revealedAt === "start" || revealed.has(f.id);
  return {
    title: b.title, summary: b.summary ?? null, patient: b.patient ?? null,
    facts: b.facts.filter(shown).map(f => ({ id: f.id, label: f.label, value: f.value, unit: f.unit ?? null })),
    stages: b.stages.map(s => ({ id: s.id, title: s.title })),
    decisionPoints: b.decisionPoints.map(d => ({ id: d.id, stageId: d.stageId, prompt: d.prompt, kind: d.kind, options: d.options.map(o => ({ id: o.id, text: o.text })),
      canReveal: d.permittedReveals.filter(r => !revealed.has(r)).map(r => ({ id: r, label: b.facts.find(f => f.id === r)?.label ?? r })) })),
  };
}
