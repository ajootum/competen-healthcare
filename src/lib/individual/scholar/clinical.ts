/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 5A: CLINICAL REASONING -- THE RULES ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR1-CR5 ─────────────────────
//
// SERVER-ONLY (it uses the shared case blueprint, which uses node:crypto). Pure: no I/O, so every rule is run by its
// tests. The store holds the rows (435, 436), generation.ts writes the draft, the routes put them together.
//
// ⚠ ONE STRUCTURE, ONE ENGINE. A private case is a case-blueprint/1 (src/lib/cases/blueprint.ts) in the private
// profile, and it plays on the same pure engine as a library case (blueprint.ts, library.ts applyAnswer). Nothing here
// is a second case format or a second progression.
// ⚠ GOVERNED FACTS ARE THE NOTES' FACTS. A private case is linear (no branches: a branch would need a consequence
// the notes do not give), and every finding, prompt, option, rationale and expected response must add nothing the
// student's sections do not hold (the Holdings grounding verifier), and identify nobody (both screens). A draft that
// fails is not stored. ids are assigned here, by code, never trusted from the model.
// ⚠ FORMATIVE SIMULATION. Nothing here is assessment, competence or Passport evidence. AI feedback is labelled.

import { textGroundingViolations } from "@/lib/ai/grounding";
import { DEFAULT_DIMENSIONS, safetyEvents, validateBlueprint, type Blueprint, type CaseFact, type DecisionPoint } from "@/lib/cases/blueprint";
import { screenBlueprint } from "@/lib/cases/screen";
import { findPatientIdentifiers } from "./extract";
import type { Passage } from "./generation";

// ── THE DRAFT THE MODEL WRITES, AND THE BLUEPRINT CODE MAKES OF IT ──

type DraftFact = { ref?: unknown; kind?: unknown; label?: unknown; value?: unknown; unit?: unknown; shown?: unknown; safetyCritical?: unknown };
type DraftDecision = { stage?: unknown; prompt?: unknown; kind?: unknown; dimension?: unknown; options?: unknown; rationale?: unknown; canAskFor?: unknown; expectedResponse?: unknown; sources?: unknown; safety?: unknown };
export type CaseDraft = { title?: unknown; intro?: unknown; facts?: unknown; stages?: unknown; decisions?: unknown; objectives?: unknown };

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const FACT_KINDS: readonly CaseFact["kind"][] = ["history", "observation", "examination", "result", "context"];

/**
 * Pure. The private blueprint made from a model's draft. ids are assigned in order (s1, f1, d1, a ...), references
 * between parts are resolved by the draft's own refs and positions, and everything structural -- the schema, linear
 * progression, no variation, the AI boundary, provenance -- is fixed by code. Competencies come only from the tags
 * the model was given (C1 ...), sources only from the passage tags (S1 ...). null when nothing usable is there.
 */
export function blueprintFromDraft(draft: CaseDraft, ctx: { passages: readonly Passage[]; competencies: readonly { id: string }[]; dimensions?: readonly string[] }): Blueprint | null {
  const dims = ctx.dimensions?.length ? ctx.dimensions : DEFAULT_DIMENSIONS;
  const stagesIn = list(draft.stages).map(s => str(typeof s === "string" ? s : s?.title, 120)).filter((s): s is string => !!s).slice(0, 6);
  if (!stagesIn.length) return null;
  const stages = stagesIn.map((title, i) => ({ id: `s${i + 1}`, title, reveals: [] as string[], decisionPointIds: [] as string[] }));
  const stageOf = (v: unknown) => { const n = Number(String(v ?? "").replace(/\D/g, "")); return Number.isInteger(n) && n >= 1 && n <= stages.length ? stages[n - 1].id : null; };
  const factRefs = new Map<string, string>();
  const facts: CaseFact[] = [];
  for (const [i, f] of list(draft.facts).slice(0, 20).entries() as IterableIterator<[number, DraftFact]>) {
    const label = str(f?.label, 120), value = typeof f?.value === "string" ? f.value.trim().slice(0, 200) : typeof f?.value === "number" ? String(f.value) : null;
    if (!label || value === null || !value) continue;
    const id = `f${facts.length + 1}`;
    if (typeof f?.ref === "string") factRefs.set(f.ref, id);
    factRefs.set(`F${i + 1}`, id);
    const shown = f?.shown === "start" || f?.shown === "request" ? f.shown : stageOf(f?.shown) ?? "start";
    facts.push({ id, kind: FACT_KINDS.includes(f?.kind as CaseFact["kind"]) ? f.kind as CaseFact["kind"] : "observation", label, value, unit: str(f?.unit, 40),
      revealedAt: shown, safetyCritical: f?.safetyCritical === true });
  }
  const factOf = (v: unknown) => (typeof v === "string" ? factRefs.get(v) ?? null : null);
  const chunkOf = (v: unknown) => { const n = Number(String(v ?? "").replace(/\D/g, "")); return Number.isInteger(n) && n >= 1 && n <= ctx.passages.length ? ctx.passages[n - 1].chunkId : null; };
  const decisionPoints: DecisionPoint[] = [];
  const safetyCriteria: Blueprint["safetyCriteria"] = [];
  for (const d of list(draft.decisions).slice(0, 12) as DraftDecision[]) {
    const stageId = stageOf(d?.stage) ?? stages[Math.min(decisionPoints.length, stages.length - 1)].id;
    const prompt = str(d?.prompt, 1000);
    const kind = d?.kind === "multiple" || d?.kind === "free_text" ? d.kind : "single";
    if (!prompt) continue;
    const id = `d${decisionPoints.length + 1}`;
    const letters = "abcdefgh";
    const options = kind === "free_text" ? [] : list(d?.options).slice(0, 6).map((o, k) => ({
      id: letters[k], text: str(o?.text, 500) ?? "", correct: o?.correct === true, rationale: str(o?.rationale, 2000),
    })).filter(o => o.text);
    decisionPoints.push({
      id, stageId, prompt, kind, dimension: dims.includes(d?.dimension as string) ? d.dimension as string : undefined,
      options, rationale: str(d?.rationale, 2000),
      permittedReveals: [...new Set(list(d?.canAskFor).map(factOf).filter((x): x is string => !!x))],
      expectedResponse: kind === "free_text" ? str(d?.expectedResponse, 4000) : null,
      sourceRefs: [...new Set(list(d?.sources).map(chunkOf).filter((x): x is string => !!x))],
    });
    // A safety-critical decision: the option the notes require must be chosen (machine-checkable, CR3).
    const must = options.filter(o => o.correct).map(o => o.id);
    const safetyText = str(d?.safety, 500);
    if (safetyText && kind !== "free_text" && must.length) safetyCriteria.push({ id: `c${safetyCriteria.length + 1}`, text: safetyText, decisionPointId: id, mustSelect: kind === "single" ? must : undefined, mustNotSelect: kind === "multiple" ? options.filter(o => !o.correct).map(o => o.id) : undefined });
  }
  if (!decisionPoints.length) return null;
  for (const s of stages) s.decisionPointIds = decisionPoints.filter(d => d.stageId === s.id).map(d => d.id);
  // A stage with no decision would stall a linear case: such stages are folded away, their facts shown at the next one.
  const used = stages.filter(s => s.decisionPointIds.length);
  for (const f of facts) if (f.revealedAt !== "start" && f.revealedAt !== "request" && !used.some(s => s.id === f.revealedAt)) f.revealedAt = "start";
  const objectives = list(draft.objectives).slice(0, 6).map((o, i) => ({
    id: `lo${i + 1}`, text: str(typeof o === "string" ? o : o?.text, 500) ?? "",
    competencyIds: [...new Set(list(o?.competencies).map(t => { const n = Number(String(t ?? "").replace(/\D/g, "")); return ctx.competencies[n - 1]?.id; }).filter((x): x is string => !!x))],
  })).filter(o => o.text);
  return {
    schema: "case-blueprint/1",
    title: str(draft.title, 200) ?? "Clinical case from your notes",
    summary: null,
    learnerIntro: str(draft.intro, 1000),
    patient: null,
    facts, stages: used, decisionPoints, progression: [],
    learningObjectives: objectives, safetyCriteria, feedback: null, assessment: null, references: [],
    variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
    metadata: { level: "intermediate", complexity: Math.min(5, Math.max(1, used.length)) as 1 | 2 | 3 | 4 | 5, risk: "standard", professionTermId: null, specialtyTermIds: [],
      cfcaDomainIds: [], cpuIds: [], provenance: { kind: "private", rights: "student_private" } },
  };
}

/** Pure: every human-readable string of a blueprint, for the grounding and identifier checks. */
export function caseTexts(b: Blueprint): string[] {
  return [
    b.title, b.learnerIntro ?? "",
    ...b.facts.flatMap(f => [`${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`]),
    ...b.stages.map(s => s.title),
    ...b.decisionPoints.flatMap(d => [d.prompt, d.rationale ?? "", d.expectedResponse ?? "", ...d.options.flatMap(o => [o.text, o.rationale ?? ""])]),
    ...b.safetyCriteria.map(c => c.text), ...b.learningObjectives.map(l => l.text),
  ].filter(Boolean);
}

export type CaseProblem = { kind: "structure" | "ungrounded" | "identifier"; detail: string };

/**
 * Pure. A private case may be stored only if it is a valid private blueprint, every text adds nothing the student's
 * sections (and what they typed) do not hold, and nothing in it identifies a person. Empty: it may be stored.
 */
export function checkPrivateCase(b: Blueprint, grounding: readonly string[], dimensions: readonly string[] = DEFAULT_DIMENSIONS): CaseProblem[] {
  const p: CaseProblem[] = validateBlueprint(b, "private", dimensions).map(detail => ({ kind: "structure" as const, detail }));
  for (const t of caseTexts(b)) {
    const v = textGroundingViolations(t, [...grounding]);
    if (v.length) p.push({ kind: "ungrounded", detail: v.slice(0, 2).map(x => `${x.kind}${(x as { token?: string }).token ? ` ${(x as { token?: string }).token}` : ""}`).join(", ") });
    if (findPatientIdentifiers(t).length) p.push({ kind: "identifier", detail: "a patient identifier" });
  }
  for (const k of screenBlueprint({ ...b, decisionPoints: b.decisionPoints.map(d => ({ ...d, sourceRefs: [] })) })) p.push({ kind: "identifier", detail: k });
  return p;
}

// ── MARKING AND THE DEBRIEF (CR4): DETERMINISTIC FIRST ──

/** Pure. A choice marked by its key: right only when exactly the key was chosen. A free-text decision is not marked by code. */
export function markDecision(b: Blueprint, dpId: string, chosen: readonly string[]): { correct: boolean | null; score: number | null } {
  const d = b.decisionPoints.find(x => x.id === dpId);
  if (!d || d.kind === "free_text") return { correct: null, score: null };
  const key = d.options.filter(o => o.correct).map(o => o.id);
  const hits = chosen.filter(c => key.includes(c)).length, wrong = chosen.length - hits;
  return { correct: hits === key.length && wrong === 0, score: Math.max(0, (hits - wrong) / Math.max(1, key.length)) };
}

export type CaseAnswerRecord = { decisionPointId: string; chosen: string[]; text?: string | null; correct: boolean | null; safety: string[]; marking: string };
export type Debrief = {
  answered: number; of: number; correct: number;
  dimensions: { dimension: string; answered: number; correct: number; written: number }[];
  safetyEvents: string[];
  missedFindings: { label: string }[];
  objectives: { text: string; competencyIds: string[] }[];
  revisit: { decisionPointId: string; chunkIds: string[] }[];
  label: string;
};
export const CASE_DEBRIEF_LABEL = "Formative simulation from your notes: not an assessment, and not evidence of clinical competence.";

/**
 * Pure. The end-of-case debrief, from the blueprint and the recorded decisions only: per reasoning dimension what was
 * answered and right (written answers counted apart -- they are not marked by code), the safety criteria broken, the
 * safety-critical findings that could have been asked for and never were, the objectives, and where in the notes to
 * go back to for each decision missed.
 */
export function caseDebrief(b: Blueprint, answers: readonly CaseAnswerRecord[], revealed: readonly string[], reached: readonly string[]): Debrief {
  const by = new Map(answers.map(a => [a.decisionPointId, a]));
  const dims = new Map<string, { answered: number; correct: number; written: number }>();
  for (const d of b.decisionPoints) {
    const a = by.get(d.id); if (!a) continue;
    const key = d.dimension ?? "reasoning";
    const t = dims.get(key) ?? { answered: 0, correct: 0, written: 0 };
    t.answered++; if (a.correct) t.correct++; if (d.kind === "free_text") t.written++;
    dims.set(key, t);
  }
  const safety = [...new Set(answers.flatMap(a => a.safety))];
  const visibleIds = new Set([...revealed, ...b.facts.filter(f => f.revealedAt === "start" || reached.includes(f.revealedAt)).map(f => f.id)]);
  const askable = new Set(b.decisionPoints.filter(d => by.has(d.id)).flatMap(d => d.permittedReveals));
  return {
    answered: answers.length, of: b.decisionPoints.length, correct: answers.filter(a => a.correct).length,
    dimensions: [...dims].map(([dimension, t]) => ({ dimension, ...t })),
    safetyEvents: safety.map(id => b.safetyCriteria.find(c => c.id === id)?.text).filter((x): x is string => !!x),
    missedFindings: b.facts.filter(f => f.safetyCritical && askable.has(f.id) && !visibleIds.has(f.id)).map(f => ({ label: f.label })),
    objectives: b.learningObjectives.map(l => ({ text: l.text, competencyIds: l.competencyIds })),
    revisit: answers.filter(a => a.correct === false).map(a => ({ decisionPointId: a.decisionPointId, chunkIds: b.decisionPoints.find(d => d.id === a.decisionPointId)?.sourceRefs ?? [] })),
    label: CASE_DEBRIEF_LABEL,
  };
}

/** Pure. The safety criteria an answer broke, by id (blueprint.ts safetyEvents, the machine check). */
export const brokenSafety = (b: Blueprint, dpId: string, chosen: string[]) => safetyEvents(b, dpId, chosen).map(c => c.id);

// ── OFFERING A CASE TO THE SHARED LIBRARY (5B, the Scholar side) ──

export const VERBATIM_CHECK_VERSION = "scholar-verbatim/1";
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * Pure (C-b). Does the case reproduce the student's notes word for word? Any run of `n` consecutive words shared with
 * a source section fails it: lecture notes may be licensed, and the student's attestation covers the case, not the
 * material it was written from.
 */
export function verbatimCheck(b: Blueprint, sources: readonly string[], n = 12): { passed: boolean; version: string } {
  const grams = new Set<string>();
  for (const s of sources) { const w = words(s); for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" ")); }
  for (const t of caseTexts(b)) { const w = words(t); for (let i = 0; i + n <= w.length; i++) if (grams.has(w.slice(i, i + n).join(" "))) return { passed: false, version: VERBATIM_CHECK_VERSION }; }
  return { passed: true, version: VERBATIM_CHECK_VERSION };
}

/** The opaque key a candidate names its source by (candidates.ts SOURCE_KEY): never Scholar's tables, only a stable key. */
export const caseSourceKey = (kind: "case" | "s4", id: string) => `scholar:${kind}:${id.toLowerCase()}`;

/**
 * Pure (C-a). What is offered of a private case: the blueprint with the student's source references removed (B8) and
 * the provenance a candidate carries -- what the material is (the student's attestation) and which attestation text.
 */
export function privateCaseSnapshot(b: Blueprint, attestation: "own_notes" | "licensed_to_share", attestationVersion: string): Blueprint {
  return {
    ...b,
    decisionPoints: b.decisionPoints.map(d => { const out = { ...d }; delete out.sourceRefs; return out; }),
    metadata: { ...b.metadata, provenance: { kind: "candidate", rights: attestation, attestationVersion } },
  };
}

/** Pure. Scholar's existing S4 practice case (388 rows) as the minimal private blueprint: steps in order, the key, the rationale. */
export function s4CaseBlueprint(steps: readonly { stem: string; options: string[]; correctIndex: number | null; rationale: string; caseTitle?: string | null }[]): Blueprint | null {
  const usable = steps.filter(s => s.correctIndex !== null && s.options.length >= 2);
  if (usable.length < 2) return null;
  const letters = "abcdefgh";
  return {
    schema: "case-blueprint/1", title: usable[0].caseTitle?.trim() || "Practice case from your notes", summary: null, learnerIntro: null, patient: null, facts: [],
    stages: usable.map((_, i) => ({ id: `s${i + 1}`, title: `Step ${i + 1}`, reveals: [], decisionPointIds: [`d${i + 1}`] })),
    decisionPoints: usable.map((s, i) => ({
      id: `d${i + 1}`, stageId: `s${i + 1}`, prompt: s.stem, kind: "single" as const, rationale: s.rationale, permittedReveals: [],
      options: s.options.map((o, k) => ({ id: letters[k], text: o, correct: k === s.correctIndex })),
    })),
    progression: [], learningObjectives: [], safetyCriteria: [], feedback: null, assessment: null, references: [],
    variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
    metadata: { level: "foundation", complexity: 1, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [], provenance: { kind: "private", rights: "student_private" } },
  };
}
