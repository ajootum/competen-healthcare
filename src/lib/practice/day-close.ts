// CPR-ADOPT-001 section 3 - Close My Day.
//
// ⚠ THE RULE THIS FILE EXISTS TO KEEP: "allows defer with reason, NEVER SILENTLY MARKS INCOMPLETE CLINICAL
// INFORMATION AS COMPLETE" (section 3), and "no destructive bulk completion of unresolved clinical
// exceptions" (section 7). Every function below closes ONE encounter at a time on an explicit practitioner
// action. There is no close-all, and completeSession deliberately leaves unresolved encounters open.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { CLOSE_ACTIONS, CLOSE_ACTION_CODES, DEFER_ACTION } from "./adoption-constants";
import { emitActivation } from "./activation";
import { onEncounterClosed } from "./activation-hooks";
import type { EngineResult } from "./capture-later";

export const DAY_CLOSE_TABLE = "practice_day_close";

export type DayCloseSession = { id: string; closeDate: string; status: string; resumed: boolean };

/**
 * Open today's session, or resume the one already open.
 *
 * ⚠ SELECT-THEN-INSERT, NOT UPSERT, AND THE REASON IS IN MIGRATION 283. The uniqueness that matters here is
 * partial -- one OPEN session per practitioner per day, while completed ones may accumulate -- and
 * PostgREST resolves on_conflict against a full unique constraint only. An upsert would have written
 * NOTHING and returned no error, which is how two silent write failures already got into this codebase.
 *
 * ⚠ AND THE INSERT ERROR IS NEVER DISCARDED. A lost race is recognised by its unique violation and resolved
 * by re-reading, so two tabs opening Close My Day at once converge on one session rather than one of them
 * silently working in a session that does not exist.
 */
export async function openOrResumeSession(admin: any, args: {
  workspaceId: string; practitionerId: string; closeDate: string; actorId: string;
}): Promise<EngineResult<DayCloseSession>> {
  const find = async () => admin.from(DAY_CLOSE_TABLE)
    .select("id, close_date, status")
    .eq("workspace_id", args.workspaceId)
    .eq("practitioner_id", args.practitionerId)
    .eq("close_date", args.closeDate)
    .eq("status", "open")
    .limit(1);

  const { data: open, error: findErr } = await find();
  if (findErr) return { ok: false, status: 503, code: "READ_FAILED", message: findErr.message };
  if ((open ?? []).length)
    return { ok: true, data: { id: open[0].id, closeDate: open[0].close_date, status: "open", resumed: true } };

  const { data, error } = await admin.from(DAY_CLOSE_TABLE).insert({
    workspace_id: args.workspaceId,
    practitioner_id: args.practitionerId,
    close_date: args.closeDate,
    status: "open",
    created_by: args.actorId,
  }).select("id, close_date, status").single();

  if (!error) return { ok: true, data: { id: data.id, closeDate: data.close_date, status: data.status, resumed: false } };

  if (error.code === "23505") {
    // Somebody else opened it between our read and our write.
    const { data: raced } = await find();
    if ((raced ?? []).length)
      return { ok: true, data: { id: raced[0].id, closeDate: raced[0].close_date, status: "open", resumed: true } };
  }
  return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };
}

export type CloseOutcome = { encounterId: string; action: string; completed: boolean };

/**
 * Apply one quick action to one encounter.
 *
 * ⚠ "No change" IS A CONFIRMATION AND IS RECORDED AS ONE. Section 7 says a Seen status must not imply
 * review "unless explicitly confirmed" -- choosing No change IS that confirmation, so the encounter moves
 * to COMPLETED and capture_mode is promoted off 'capture_later', because a practitioner has now looked at
 * it. That promotion is the only thing that distinguishes a reviewed encounter from an untouched shell.
 *
 * ⚠ DEFER COMPLETES NOTHING. It records a reason and leaves the encounter open, which is the whole point of
 * section 3 allowing it.
 *
 * ⚠ AN ACTION THAT OPENS CAPTURE DOES NOT WRITE THE CLINICAL DATA. "New diagnosis" here means the
 * practitioner has said there IS one -- the diagnosis itself is captured by the encounter workflow that
 * already exists. Writing a diagnosis row from a quick-action button would be inventing clinical content
 * from a label.
 */
export async function applyCloseAction(admin: any, args: {
  workspaceId: string; encounterId: string; action: string; actorId: string;
  sessionId?: string | null; deferReason?: string | null;
}): Promise<EngineResult<CloseOutcome>> {
  if (!CLOSE_ACTION_CODES.includes(args.action))
    return { ok: false, status: 400, code: "UNKNOWN_ACTION", message: `${args.action} is not a Close My Day action` };

  const spec = CLOSE_ACTIONS.find(a => a.code === args.action)!;

  if (args.action === DEFER_ACTION && !args.deferReason?.trim())
    // Section 3 allows deferral WITH REASON. A deferral with no reason is an encounter quietly skipped.
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "Deferring needs a reason" };

  const { data: enc, error: encErr } = await admin.from("practice_encounter")
    .select("id, status, capture_mode")
    .eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (encErr) return { ok: false, status: 503, code: "READ_FAILED", message: encErr.message };
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const patch: Record<string, unknown> = {
    day_close_id: args.sessionId ?? null,
    updated_by: args.actorId,
    updated_at: new Date().toISOString(),
  };

  if (args.action === DEFER_ACTION) {
    patch.deferred_reason = args.deferReason!.trim();
  } else {
    patch.status = "COMPLETED";
    patch.completed_at = new Date().toISOString();
    patch.capture_mode = "full";
    // A previously deferred encounter that is now being closed no longer carries the deferral.
    patch.deferred_reason = null;
  }

  const { error } = await admin.from("practice_encounter").update(patch).eq("workspace_id", args.workspaceId).eq("id", args.encounterId);
  if (error) return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };

  // CPR-GROWTH-001 s2 "continuity adoption". Only a COMPLETING action can have produced a closed
  // encounter -- a deferral leaves it open, so firing here would claim the milestone for the one action
  // that explicitly declines to finish anything. onEncounterClosed counts settled encounters itself, so
  // it is right even if this condition is ever wrong.
  if (spec.confirmsReview) await onEncounterClosed(admin, args.workspaceId, args.actorId);

  return { ok: true, data: { encounterId: args.encounterId, action: args.action, completed: spec.confirmsReview } };
}

/**
 * Finish the session.
 *
 * ⚠ IT COMPLETES THE SESSION, NOT THE ENCOUNTERS. Section 7 forbids "destructive bulk completion of
 * unresolved clinical exceptions", so anything still open stays open and is waiting tomorrow. The returned
 * `stillOpen` count is what the screen must show rather than a finished tick, because a practitioner told
 * their day was closed while six encounters remain would stop believing the number.
 */
export async function completeSession(admin: any, args: {
  workspaceId: string; sessionId: string; practitionerId: string; actorId: string;
}): Promise<EngineResult<{ stillOpen: number | null; firstEver: boolean }>> {
  const { error } = await admin.from(DAY_CLOSE_TABLE)
    .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", args.sessionId).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };

  // ⚠ null, NOT 0, WHEN THE COUNT CANNOT BE READ. "Nothing left to do" and "we could not check" are
  // different sentences and only one of them should let a practitioner walk away.
  const { count, error: countErr } = await admin.from("practice_encounter")
    .select("id", { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .in("status", ["DRAFT", "ACTIVE", "PAUSED"])
    .limit(1);

  const emitted = await emitActivation(admin, {
    workspaceId: args.workspaceId, eventKey: "close_day.first_completed", actorId: args.actorId,
  });

  return {
    ok: true,
    data: {
      stillOpen: countErr ? null : (count ?? null),
      // Only true the first time, so a prompt fires once. emitActivation reports which this was.
      firstEver: emitted.ok ? emitted.recorded : false,
    },
  };
}
