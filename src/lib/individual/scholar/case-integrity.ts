/* eslint-disable @typescript-eslint/no-explicit-any */
// ── SCHOLAR-CASE-INTEGRITY-01: A COMPLETED CASE ATTEMPT, KEPT AS IT WAS (migration 810) ───────────────────────────────
//
// SERVER-ONLY (it reads blueprints). Owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt
// Integrity", items 3 and 4 for clinical cases.
//
// When a case is completed -- a private one (435/436) or a library one (423, played by src/lib/cases/library.ts) -- ONE
// immutable record is kept of what the learner played and did: the case and its version (with the database's hash of
// it), the stages reached, the findings shown, every decision (choice or written answer, the reason given, how it was
// marked, the safety criteria broken, any AI feedback, labelled formative), the rubric excerpt that applied, and the
// debrief summary. Read back, it is the attempt as completed, whatever happens to the case later. A result can be
// corrected, append-only, with a reason: the original is never overwritten.
//
// ⚠ FORMATIVE. A kept attempt is a private practice record: never an assessment outcome, never verified competence,
// never Passport evidence (810 holds standing = formative only). Nothing here writes anywhere else.
// ⚠ FAIL CLOSED. Where 810 is absent nothing is kept and nothing is said to the learner: the case plays as before.

import type { Blueprint } from "@/lib/cases/blueprint";
import { sessionAttemptSource } from "@/lib/cases/library";
import { brokenSafety, caseDebrief, markDecision, type Debrief } from "./clinical";
import {
  getCaseAttemptSnapshot, getPrivateCase, getPrivateCaseSession, insertCaseAttemptCorrection, insertCaseAttemptSnapshot,
  type CaseAttemptCorrectionRow, type CaseAttemptSnapshotRow,
} from "./store";

export const CASE_ATTEMPT_RECORD_VERSION = 1;
export const CASE_ATTEMPT_FORMATIVE_LABEL = "Formative practice record: not an assessment, and not evidence of clinical competence.";
export const CASE_AI_FEEDBACK_LABEL = "AI evaluation (formative)";
/** What the database will hold (810 CHECK is 200000 bytes for record + rubric). The builder stays well inside it. */
export const CASE_ATTEMPT_MAX_BYTES = 180000;

export type AttemptAnswer = {
  decisionPointId: string; chosen: string[]; text: string | null; reason: string | null;
  marking: "deterministic" | "self_graded" | "ai_evaluation" | string; correct: boolean | null; score: number | null; safety: string[];
  aiFeedback: { text: string; model: string | null } | null; at: string | null;
};
export type AttemptInput = {
  kind: "private" | "library"; blueprint: Blueprint; mode: string | null; variation: Record<string, string>;
  reached: string[]; revealed: string[]; answers: AttemptAnswer[];
  aiDebrief: { text: string; model: string | null } | null;
};
export type AttemptDecision = {
  id: string; stageId: string; kind: string; dimension: string | null; prompt: string;
  chosen: string[]; chosenText: string[]; text: string | null; reason: string | null;
  marking: string; correct: boolean | null; score: number | null; safety: string[];
  aiFeedback: { label: string; text: string; model: string | null } | null; at: string | null;
};
export type AttemptRecord = {
  v: number; kind: "private" | "library"; title: string; mode: string | null; variation: Record<string, string>;
  stagesReached: { id: string; title: string; category: string | null }[];
  factsShown: string[]; factsRequested: string[];
  decisions: AttemptDecision[];
  debrief: Omit<Debrief, "objectives">;
  aiDebrief: { label: string; text: string; model: string | null } | null;
  completion: { state: "completed"; answered: number; of: number };
  label: string;
};
export type AttemptRubric = {
  decisions: { id: string; key: string[]; rationale: string | null; expectedResponse: string | null; rubric: { id: string; criterion: string; weight: number; safetyCritical: boolean; dimension: string | null }[] }[];
  safetyCriteria: { id: string; decisionPointId: string; text: string }[];
  assessment: { criterion: string; weight: number; dimension: string | null }[] | null;
};

const cut = (s: string | null | undefined, n: number) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

/**
 * Pure. The record and the rubric excerpt of ONE completed attempt, from the blueprint it was played on and what was
 * done. Only the answered decisions' rubric applies. Bounded: if it would not fit, the long texts are cut back in a
 * fixed order (AI feedback, then written answers, then reasons) -- never a decision dropped.
 */
export function buildCaseAttemptRecord(x: AttemptInput): { record: AttemptRecord; rubric: AttemptRubric } {
  const b = x.blueprint;
  const by = new Map(x.answers.map(a => [a.decisionPointId, a]));
  const visible = new Set([...x.revealed, ...b.facts.filter(f => f.revealedAt === "start" || x.reached.includes(f.revealedAt)).map(f => f.id)]);
  const decisions = (limits: { ai: number; text: number; reason: number }): AttemptDecision[] => b.decisionPoints.filter(d => by.has(d.id)).map(d => {
    const a = by.get(d.id)!;
    return {
      id: d.id, stageId: d.stageId, kind: d.kind, dimension: d.dimension ?? null, prompt: d.prompt,
      chosen: a.chosen, chosenText: a.chosen.map(id => d.options.find(o => o.id === id)?.text ?? "").filter(Boolean),
      text: cut(a.text, limits.text), reason: cut(a.reason, limits.reason),
      marking: a.marking, correct: a.correct, score: a.score, safety: a.safety,
      aiFeedback: a.aiFeedback ? { label: CASE_AI_FEEDBACK_LABEL, text: cut(a.aiFeedback.text, limits.ai) ?? "", model: a.aiFeedback.model } : null,
      at: a.at,
    };
  });
  const full = caseDebrief(b, x.answers.map(a => ({ decisionPointId: a.decisionPointId, chosen: a.chosen, text: a.text, correct: a.correct, safety: a.safety, marking: a.marking })), x.revealed, x.reached);
  const { objectives: _o, ...debrief } = full; void _o;
  const rubric: AttemptRubric = {
    decisions: b.decisionPoints.filter(d => by.has(d.id)).map(d => ({
      id: d.id, key: d.options.filter(o => o.correct).map(o => o.id), rationale: d.rationale ?? null, expectedResponse: d.expectedResponse ?? null,
      rubric: (d.rubric ?? []).map(c => ({ id: c.id, criterion: c.criterion, weight: c.weight, safetyCritical: c.safetyCritical, dimension: c.dimension ?? null })),
    })),
    safetyCriteria: b.safetyCriteria.filter(c => by.has(c.decisionPointId)).map(c => ({ id: c.id, decisionPointId: c.decisionPointId, text: c.text })),
    assessment: b.assessment?.rubric?.length ? b.assessment.rubric.map(c => ({ criterion: c.criterion, weight: c.weight, dimension: c.dimension ?? null })) : null,
  };
  const make = (limits: { ai: number; text: number; reason: number }): AttemptRecord => ({
    v: CASE_ATTEMPT_RECORD_VERSION, kind: x.kind, title: b.title, mode: x.mode, variation: x.variation,
    stagesReached: x.reached.map(id => { const s = b.stages.find(st => st.id === id); return { id, title: s?.title ?? id, category: s?.category ?? null }; }),
    factsShown: b.facts.filter(f => visible.has(f.id)).map(f => f.id), factsRequested: [...x.revealed],
    decisions: decisions(limits), debrief,
    aiDebrief: x.aiDebrief ? { label: CASE_AI_FEEDBACK_LABEL, text: cut(x.aiDebrief.text, limits.ai) ?? "", model: x.aiDebrief.model } : null,
    completion: { state: "completed", answered: x.answers.length, of: b.decisionPoints.length },
    label: CASE_ATTEMPT_FORMATIVE_LABEL,
  });
  const size = (r: AttemptRecord) => Buffer.byteLength(JSON.stringify(r)) + Buffer.byteLength(JSON.stringify(rubric));
  for (const limits of [{ ai: 8000, text: 4000, reason: 1500 }, { ai: 1500, text: 4000, reason: 1500 }, { ai: 600, text: 1500, reason: 1500 }, { ai: 300, text: 600, reason: 400 }]) {
    const r = make(limits);
    if (size(r) <= CASE_ATTEMPT_MAX_BYTES) return { record: r, rubric };
  }
  return { record: make({ ai: 120, text: 200, reason: 200 }), rubric };
}

/** Pure: a decision result as an outcome, the way the 810 correction guard reads it. */
export function outcomeOf(correct: boolean | null, score: number | null): "correct" | "partial" | "incorrect" | "unmarked" {
  if (correct === null) return "unmarked";
  if (correct) return "correct";
  return (score ?? 0) > 0 ? "partial" : "incorrect";
}

export type EffectiveDecision = {
  id: string; prompt: string; original: { outcome: string; score: number | null }; effective: { outcome: string; score: number | null };
  corrections: { basis: string; reason: string; from: string; to: string; at: string }[];
};
/** Pure. The effective result of each decision: the latest correction of it, else the attempt as kept. Original beside it. */
export function effectiveDecisions(record: Pick<AttemptRecord, "decisions">, corrections: readonly CaseAttemptCorrectionRow[]): EffectiveDecision[] {
  return (record.decisions ?? []).map(d => {
    const mine = corrections.filter(c => c.decisionPointId === d.id).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = mine[mine.length - 1];
    const original = { outcome: outcomeOf(d.correct, d.score), score: d.score };
    return {
      id: d.id, prompt: d.prompt, original,
      effective: last ? { outcome: last.correctedOutcome, score: last.correctedScore } : original,
      corrections: mine.map(c => ({ basis: c.basis, reason: c.reason, from: c.previousOutcome, to: c.correctedOutcome, at: c.createdAt })),
    };
  });
}

export type CaseAttemptView = {
  keptAt: string; completedAt: string; label: string;
  /** The case is not the one completed any more (a library case superseded or its content changed): the kept record is what was played. */
  changed: boolean;
  corrected: { id: string; prompt: string; original: string; effective: string; corrections: EffectiveDecision["corrections"] }[];
};
/** Pure: what the learner is shown of their kept attempt. */
export function attemptView(s: Pick<CaseAttemptSnapshotRow, "contentHash" | "record" | "corrections" | "createdAt" | "completedAt">, live: { contentHash: string | null; current: boolean }): CaseAttemptView {
  return {
    keptAt: s.createdAt, completedAt: s.completedAt, label: CASE_ATTEMPT_FORMATIVE_LABEL,
    changed: !live.current || !live.contentHash || live.contentHash !== s.contentHash,
    corrected: effectiveDecisions(s.record ?? {}, s.corrections).filter(d => d.corrections.length)
      .map(d => ({ id: d.id, prompt: d.prompt, original: d.original.outcome, effective: d.effective.outcome, corrections: d.corrections })),
  };
}

/** Everything a snapshot needs about one of the caller's own completed sessions, from the database. null: not theirs, not completed. */
async function attemptSource(admin: any, userId: string, kind: "private" | "library", sessionId: string)
  : Promise<{ input: AttemptInput; caseRef: string; contentHash: string; current: boolean; completed: boolean } | null> {
  if (kind === "private") {
    const s = await getPrivateCaseSession(admin, userId, sessionId);
    const c = s ? await getPrivateCase(admin, userId, s.session.caseId) : null;
    if (!s || !c || !c.blueprintHash) return null;
    return {
      caseRef: `own:${c.id}`, contentHash: c.blueprintHash, current: true, completed: s.session.status === "completed",
      input: {
        kind, blueprint: c.blueprint as Blueprint, mode: s.session.mode, variation: {}, reached: s.session.reachedStageIds, revealed: s.session.revealedFactIds,
        answers: s.answers.map(a => ({
          decisionPointId: a.decisionPointId, chosen: a.chosen, text: a.reasoning, reason: a.reason ?? null, marking: a.marking, correct: a.correct, score: a.score,
          safety: a.safety, aiFeedback: a.aiFeedback ? { text: a.aiFeedback, model: a.evaluatorModel } : null, at: a.createdAt,
        })),
        aiDebrief: null,
      },
    };
  }
  const l = await sessionAttemptSource(admin, userId, sessionId);
  if (!l || !l.contentHash) return null;
  const b = l.blueprint;
  return {
    caseRef: `lib:${l.versionId}`, contentHash: l.contentHash, current: l.current, completed: l.status === "completed",
    input: {
      kind, blueprint: b, mode: null, variation: l.variation, reached: l.reached, revealed: l.revealed,
      // A library play keeps the choice, the written answer and the reason (423). Its marking is the blueprint's own key
      // and safety criteria, the same pure rules a private play is marked by; a written answer is AI-evaluated where the
      // shared delivery recorded feedback (424), else the learner reviewed it themselves.
      answers: l.answers.map(a => {
        const d = b.decisionPoints.find(p => p.id === a.decisionPointId);
        const free = d?.kind === "free_text";
        const fb = l.feedback.find(f => f.decisionPointId === a.decisionPointId) ?? null;
        const m = free ? { correct: null, score: null } : markDecision(b, a.decisionPointId, a.chosen ?? []);
        return {
          decisionPointId: a.decisionPointId, chosen: free ? [] : (a.chosen ?? []), text: typeof a.text === "string" ? a.text : null, reason: typeof a.reason === "string" ? a.reason : null,
          marking: free ? (fb ? "ai_evaluation" : "self_graded") : "deterministic", correct: m.correct, score: m.score,
          safety: free ? [] : brokenSafety(b, a.decisionPointId, a.chosen ?? []), aiFeedback: fb ? { text: fb.text, model: fb.model } : null, at: a.at ?? null,
        };
      }),
      aiDebrief: l.debrief ? { text: l.debrief.text, model: l.debrief.model } : null,
    },
  };
}

/**
 * Keep the record of one of the caller's completed attempts, exactly once (idempotent on the session: a second call
 * finds it kept). Called when a case completes, and again when a finished case is opened without one (a failed write,
 * or an attempt finished before 810). Never throws, never an error to the learner.
 */
export async function keepCaseAttemptSnapshot(admin: any, userId: string, kind: "private" | "library", sessionId: string)
  : Promise<"kept" | "exists" | "not_completed" | "not_provisioned" | "failed"> {
  try {
    const src = await attemptSource(admin, userId, kind, sessionId);
    if (!src || !src.completed) return "not_completed";
    const { record, rubric } = buildCaseAttemptRecord(src.input);
    const r = await insertCaseAttemptSnapshot(admin, userId, { kind, sessionId, caseRef: src.caseRef, contentHash: src.contentHash, record, rubric });
    return r.ok ? "kept" : r.reason === "exists" ? "exists" : r.reason === "not_provisioned" ? "not_provisioned" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The learner's kept attempt, as shown on a finished case. Kept now if it is missing (see keepCaseAttemptSnapshot).
 * null: none can be kept here (810 absent, or not completed) -- the page shows the case as before.
 */
export async function readCaseAttempt(admin: any, userId: string, kind: "private" | "library", sessionId: string, live?: { contentHash: string | null; current: boolean })
  : Promise<{ view: CaseAttemptView; record: AttemptRecord } | null> {
  let s = await getCaseAttemptSnapshot(admin, userId, kind, sessionId);
  if (!s.ok) return null;
  if (!s.data) {
    const k = await keepCaseAttemptSnapshot(admin, userId, kind, sessionId);
    if (k !== "kept" && k !== "exists") return null;
    s = await getCaseAttemptSnapshot(admin, userId, kind, sessionId);
    if (!s.ok || !s.data) return null;
  }
  if (!live) { const src = await attemptSource(admin, userId, kind, sessionId); live = src ? { contentHash: src.contentHash, current: src.current } : { contentHash: null, current: false }; }
  return { view: attemptView(s.data, live), record: s.data.record as AttemptRecord };
}

export type CaseCorrectionBasis = "rubric_error" | "key_error" | "marking_error" | "other";
export const CASE_CORRECTION_BASES: readonly CaseCorrectionBasis[] = ["rubric_error", "key_error", "marking_error", "other"];

/**
 * Correct ONE decision result in a learner's kept case attempt. Append-only: the original stays, previous_* is the
 * effective result at that moment (filled by the database), and a correction that changes nothing is refused. One
 * audit_log row, codes only (no reason text, no learner content). There is no HQ screen for this: a caller acting for
 * HQ must check its own capability before calling it, and names the actor; null actor = a system rule.
 */
export async function recordCaseAttemptCorrection(admin: any, args: {
  learnerId: string; kind: "private" | "library"; sessionId: string; decisionPointId: string;
  correctedOutcome: "correct" | "partial" | "incorrect"; correctedScore: number | null; reason: string; basis: CaseCorrectionBasis;
  actor: { id: string; name?: string | null } | null;
}): Promise<{ ok: true; correctionId: string; previousOutcome: string } | { ok: false; error: "invalid" | "not_found" | "unchanged" | "not_provisioned" | "failed" }> {
  const reason = (args.reason ?? "").trim();
  if (reason.length < 10 || reason.length > 500 || !CASE_CORRECTION_BASES.includes(args.basis) || !["correct", "partial", "incorrect"].includes(args.correctedOutcome)
    || (args.correctedScore !== null && !(args.correctedScore >= 0 && args.correctedScore <= 1)) || !/^[a-z][a-z0-9_-]{0,30}$/.test(args.decisionPointId)) return { ok: false, error: "invalid" };
  const s = await getCaseAttemptSnapshot(admin, args.learnerId, args.kind, args.sessionId);
  if (!s.ok) return { ok: false, error: s.notProvisioned ? "not_provisioned" : "failed" };
  if (!s.data || !(s.data.record?.decisions ?? []).some((d: any) => d?.id === args.decisionPointId)) return { ok: false, error: "not_found" };
  const r = await insertCaseAttemptCorrection(admin, args.learnerId, {
    snapshotId: s.data.id, decisionPointId: args.decisionPointId, correctedOutcome: args.correctedOutcome, correctedScore: args.correctedScore,
    reason, basis: args.basis, actorId: args.actor?.id ?? null,
  });
  if (!r.ok) return { ok: false, error: r.reason === "refused" ? "failed" : r.reason };
  await admin.from("audit_log").insert({
    actor_id: args.actor?.id ?? null, actor_name: args.actor?.name ?? (args.actor ? null : "system_rule"),
    action: "individual_scholar_case_attempt_corrected", entity_type: "individual_scholar_case_attempt_snapshot", entity_id: s.data.id,
    new_value: { kind: args.kind, decision: args.decisionPointId, basis: args.basis, from: r.previousOutcome, to: args.correctedOutcome, by: args.actor ? "hq_actor" : "system_rule" },
  }).then((x: unknown) => x, () => {});
  return { ok: true, correctionId: r.id, previousOutcome: r.previousOutcome };
}
