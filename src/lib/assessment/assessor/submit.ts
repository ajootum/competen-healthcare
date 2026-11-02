// Assessor workspace: submit. The server evaluates, the database records.
//
//   1. the actor must be the assessor of an instance still in progress
//   2. the scoring document of the PINNED version is validated again, and its hash must equal the stored scoring_hash
//   3. evaluate() runs on the server over the stored answers (nothing the browser says about the outcome is trusted)
//   4. asmt_submit_instance records the outcome and closes the instance in one transaction. The database applies its own
//      backstop: a failed critical item forces the gate outcome, a missing mandatory item forces incomplete.
//   5. progression is computed for the subject, and can only be skipped, never fail the submit
import { ENGINE_VERSION, evaluate, RulesError, validateRules, type Evaluation } from "@/lib/assessment/core";
import { type Admin, type Res, fail, guardMessage, okRes } from "./common";
import { loadDefinition } from "./definition";
import { own, readEvidence, readOutcome, readResponses, type OutcomeView } from "./instances";
import { recordProgression, type ProgressionNote, type StageScaleLoader } from "./progression";

export interface SubmitResult {
  outcomeId: string;
  outcome: OutcomeView | null;
  /** the engine's own result, before the database backstop */
  engine: { code: string; label: string; class: string };
  backstopApplied: boolean;
  progression: ProgressionNote;
}

/** The outcome record the submit entry point stores. Pure. */
export function outcomePayload(ev: Evaluation) {
  return {
    outcomeCode: ev.outcome.code,
    outcomeClass: ev.class,
    groupOutcomes: ev.groupOutcomes,
    aggregates: ev.aggregates,
    trace: { steps: ev.trace, gates: ev.gates, counts: ev.counts, decidedBy: ev.decided_by, outcome: ev.outcome },
    traceHash: ev.traceHash,
  };
}

export async function submitInstance(admin: Admin, actor: string, instanceId: string, deps: { stageScale?: StageScaleLoader } = {}): Promise<Res<SubmitResult>> {
  const o = await own(admin, actor, instanceId);
  if (!o.ok) return o;
  const inst = o.value;
  if (inst.status !== "in_progress") return fail(409, "This assessment has already been submitted or withdrawn.");

  const d = await loadDefinition(admin, inst.instrument_version_id);
  if (!d.ok) return d;
  const { def, rules, version } = d.value;
  const v = validateRules(def, rules);
  if (v.errors.length) return fail(409, "The scoring rules of this checklist do not validate, so it cannot be submitted.");

  const [a, e] = await Promise.all([readResponses(admin, inst, d.value.itemKeyById), readEvidence(admin, inst, d.value.itemKeyById)]);
  if (!a.ok) return a;
  if (!e.ok) return e;

  let ev: Evaluation;
  try { ev = evaluate(def, rules, a.value.responses, { evidenceCounts: e.value.counts }); }
  catch (err) { return fail(409, err instanceof RulesError ? err.message : "The outcome could not be worked out."); }
  if (!version.scoring_hash || ev.rules_hash !== version.scoring_hash) return fail(409, "The scoring rules do not match the published version, so this cannot be submitted.");

  const rpc = await admin.rpc("asmt_submit_instance", { p_instance: inst.id, p_actor: actor, p_outcome: outcomePayload(ev), p_engine: ENGINE_VERSION, p_hash: ev.rules_hash });
  if (rpc.error || !rpc.data) return fail(422, guardMessage(rpc.error));

  const after = await readOutcome(admin, inst);
  const stored = after.ok ? after.value : null;
  const progression = await recordProgression(admin, inst, deps);
  return okRes({
    outcomeId: rpc.data as string, outcome: stored, engine: { code: ev.outcome.code, label: ev.outcome.label, class: ev.class },
    backstopApplied: !!stored?.backstop_applied, progression,
  });
}
