// ── SCHOLAR-CONTINUITY-01 item 2: KEEPING THE SNAPSHOT, AND RECORDING A CORRECTION (migration 791) ──────────────────────
//
// Server only. The two writes the answer routes and a future HQ action make, through the Scholar store (the only write
// site), each with its audit rule:
//
//   keepAttemptSnapshot      after an attempt is stored, in the same request. NEVER fails the answer. 791 absent: nothing
//                            is kept and nothing is said (the feature is not provisioned). Any other failure is NOT silently
//                            dropped: an audit_log row (codes only) says the snapshot was not kept, and the answer stands.
//   keepCheckSnapshot        SQIE WS-D (990): the same for a kept understanding check (CYU, both write sites), which kept no
//                            snapshot before. 990 absent: nothing is kept, exactly as before. Never fails the learner's answer.
//   recordAttemptCorrection  HQ-free: a future HQ action (or a system rule) calls it with the learner's id and its own actor
//                            id. Appends one correction (the original is never overwritten) and writes one audit_log row,
//                            codes only (no reason text, no answer, no question content).

import { currentTraceId } from "@/lib/trace";
import { rubricOf } from "./question-intel";
import { buildAttemptSnapshot, withObjective, CORRECTION_BASES, type CorrectionBasis, type CorrectionRow, type Outcome } from "./attempt-snapshot";
import { competencyProvenance, getQuestion, insertAttemptCorrection, insertAttemptSnapshot, questionContentVersion, snapshotProvenanceAbsent, type Admin, type QuestionRow } from "./store";

export const SNAPSHOT_FAILED_ACTION = "individual_scholar_attempt_snapshot_failed";
export const CORRECTION_ACTION = "individual_scholar_attempt_corrected";

async function auditRow(admin: Admin, actor: { id: string | null; name: string | null }, action: string, entityId: string, value: Record<string, unknown>) {
  await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name,
    action, entity_type: "individual_scholar_attempt", entity_id: entityId, new_value: value,
  }).then((r: unknown) => r, () => {});
}

/** Keep the snapshot of an attempt just recorded. Returns what happened; the caller's answer is returned either way. */
export async function keepAttemptSnapshot(ctx: { admin: Admin; userId: string; profile?: { fullName?: string | null } }, q: QuestionRow, a: {
  attempt?: { id: string; answeredAt: string }; chosenIndex: number | null; response: Record<string, unknown> | null; correct: boolean; score: number | null; marking: string;
}): Promise<"ok" | "absent" | "failed" | "too_large" | "no_attempt"> {
  const actor = { id: ctx.userId, name: ctx.profile?.fullName ?? null };
  if (!a.attempt) return "no_attempt";
  try {
    // An understanding check (learn-check-record.ts checkResponse) needs 990: without it no snapshot is kept, as before.
    const needs990 = a.response?.kind === "check" || a.marking === "unmarked";
    if (needs990 && snapshotProvenanceAbsent()) return "absent";
    const [contentVersion, provenance] = await Promise.all([
      q.library ? Promise.resolve(null) : questionContentVersion(ctx.admin, ctx.userId, q.id),
      // 990: what the competency said at answer time (skipped once 990 is known absent: nothing would keep it).
      snapshotProvenanceAbsent() ? Promise.resolve(undefined) : competencyProvenance(ctx.admin, q.competencyId ? [q.competencyId] : []),
    ]).then(([v, p]) => [v, p ? withObjective(p, rubricOf(q.answer)?.objective) : p] as const);
    const snap = buildAttemptSnapshot(q, { attemptId: a.attempt.id, answeredAt: a.attempt.answeredAt, chosenIndex: a.chosenIndex, response: a.response, correct: a.correct, score: a.score, marking: a.marking, contentVersion, provenance });
    if (!snap) { await auditRow(ctx.admin, actor, SNAPSHOT_FAILED_ACTION, a.attempt.id, { code: "too_large", kind: q.kind }); return "too_large"; }
    const r = await insertAttemptSnapshot(ctx.admin, ctx.userId, snap, { needs990 });
    if (r === "failed") await auditRow(ctx.admin, actor, SNAPSHOT_FAILED_ACTION, a.attempt.id, { code: "insert_failed", kind: q.kind });
    return r;
  } catch {
    await auditRow(ctx.admin, actor, SNAPSHOT_FAILED_ACTION, a.attempt.id, { code: "error", kind: q.kind });
    return "failed";
  }
}

/**
 * SQIE WS-D: keep the snapshot of an understanding check just kept (store.ts recordCheckAttempt): the question as shown, the
 * typed answer, the lesson's key points as its key and rubric (with the rubric hash), the judgement, the five-part feedback where
 * an AI gave it, the competency and its 990 provenance. Never throws and never fails the answer.
 */
export async function keepCheckSnapshot(ctx: { admin: Admin; userId: string; profile?: { fullName?: string | null } }, kept: { id: string; answeredAt: string } | null, a: {
  questionId: string; response: Record<string, unknown>; correct: boolean; score: number | null; marking: string;
}): Promise<"ok" | "absent" | "failed" | "too_large" | "no_attempt"> {
  if (!kept) return "no_attempt";
  if (snapshotProvenanceAbsent()) return "absent";
  try {
    const q = await getQuestion(ctx.admin, ctx.userId, a.questionId);
    if (!q) return "failed";
    return await keepAttemptSnapshot(ctx, q, { attempt: kept, chosenIndex: null, response: a.response, correct: a.correct, score: a.score, marking: a.marking });
  } catch { return "failed"; }
}

const OUTCOMES: readonly Outcome[] = ["correct", "partial", "incorrect"];

/** Pure. A correction request, validated: the score 0..1 or null, a known outcome and basis, a reason of 10..500 characters. */
export function parseCorrection(input: { correctedScore: unknown; correctedOutcome: unknown; reason: unknown; basis: unknown }):
  { ok: true; value: { correctedScore: number | null; correctedOutcome: Outcome; reason: string; basis: CorrectionBasis } } | { ok: false; error: string } {
  const s = input.correctedScore;
  if (s !== null && (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 1)) return { ok: false, error: "score" };
  if (!OUTCOMES.includes(input.correctedOutcome as Outcome)) return { ok: false, error: "outcome" };
  if (!CORRECTION_BASES.includes(input.basis as CorrectionBasis)) return { ok: false, error: "basis" };
  const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < 10 || reason.length > 500) return { ok: false, error: "reason" };
  return { ok: true, value: { correctedScore: s as number | null, correctedOutcome: input.correctedOutcome as Outcome, reason, basis: input.basis as CorrectionBasis } };
}

/**
 * Record a correction of one learner attempt. `learnerId` is the learner the attempt belongs to; `actor` is who corrects
 * (an HQ actor's profile id and name), or null for a system rule. The caller is responsible for the actor's authority
 * (a future HQ action checks its capability before calling this). One audit_log row, codes only.
 */
export async function recordAttemptCorrection(admin: Admin, input: {
  learnerId: string; attemptId: string; correctedScore: unknown; correctedOutcome: unknown; reason: unknown; basis: unknown;
  actor: { id: string; name: string | null } | null;
}): Promise<{ ok: true; correction: CorrectionRow } | { ok: false; error: string }> {
  const v = parseCorrection(input);
  if (!v.ok) return v;
  const r = await insertAttemptCorrection(admin, input.learnerId, { attemptId: input.attemptId, ...v.value, correctedBy: input.actor?.id ?? null });
  if (!r.ok) return r;
  await auditRow(admin, { id: input.actor?.id ?? null, name: input.actor?.name ?? "system rule" }, CORRECTION_ACTION, input.attemptId, {
    learner_id: input.learnerId, correction_id: r.correction.id, basis: r.correction.basis, by: r.correction.correctedByKind,
    from: r.correction.previousOutcome, to: r.correction.correctedOutcome,
  });
  return r;
}
