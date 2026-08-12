import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DIAGNOSIS WORKING SET (CP-ENC-DIAG-001), write side.
//
// s1: "replaces the current single-diagnosis form with a rapid multi-diagnosis working set."
//
// ⚠ s2 IS THE WHOLE DIFFICULTY, AND IT IS NOT ABOUT BATCHING. An ENCOUNTER DIAGNOSIS and a PROBLEM LIST
// ITEM are related and not identical: the first belongs to today, the second carries across visits.
// "Promoting/keeping a diagnosis as an ongoing problem creates or links a longitudinal problem-list item
// WITHOUT CHANGING THE MEANING OF THE ENCOUNTER DIAGNOSIS", and "an existing active problem may be
// marked as assessed/reviewed today WITHOUT CREATING A DUPLICATE longitudinal problem".
//
// Both halves are one-way traps. Writing the problem row and calling that the diagnosis loses today's
// assessment; linking to an existing problem by re-inserting it gives the patient the same condition
// twice, and a duplicated problem list is the kind of thing nobody notices until a letter prints it.
//
// ⚠ EVERY ROW IS INSERTED SEPARATELY AND REPORTED SEPARATELY, because PostgREST has no cross-call
// transaction and an "all or nothing" claim would be a lie. What comes back is what happened to each
// item -- the same contract recordTreatmentBatch keeps, and for the same reason.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The certainty vocabulary practice_diagnosis actually accepts. Not a superset, not a guess. */
export const DIAGNOSIS_CERTAINTIES = ["suspected", "provisional", "confirmed", "ruled_out"] as const;
export type DiagnosisCertainty = (typeof DIAGNOSIS_CERTAINTIES)[number];
export const DEFAULT_CERTAINTY: DiagnosisCertainty = "provisional";

/** s3's cap on one working set. Named, so a caller is refused rather than silently truncated. */
export const MAX_PENDING_DIAGNOSES = 20;

export type PendingDiagnosis = {
  label: string;
  code?: string | null;
  codeSystem?: string | null;
  certainty?: string | null;
  isPrimary?: boolean;
  /**
   * s2's promotion. TRUE means "this should carry across visits".
   *
   * ⚠ IT DOES NOT REPLACE THE ENCOUNTER DIAGNOSIS. The row is written either way; this only decides
   * whether a longitudinal problem is created or linked beside it.
   */
  keepAsProblem?: boolean;
  /**
   * s2's "assessed today". Set when the clinician ticked an EXISTING active problem rather than typing
   * a new diagnosis -- the problem is linked, never re-created.
   */
  existingProblemId?: string | null;
};

export type DiagnosisResult = {
  index: number;
  label: string;
  ok: boolean;
  diagnosisId?: string;
  problemId?: string | null;
  /** True when a longitudinal problem was CREATED rather than linked. Reported so the screen can say so. */
  problemCreated?: boolean;
  code?: string;
  message?: string;
};

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });

// ⚠ THE SAME CAPABILITY THE SINGLE-DIAGNOSIS ROUTE HAS ALWAYS ENFORCED. This was `encounter.edit` when
// the engine was written, which is a DIFFERENT permission -- a practice that had granted diagnosis.record
// without encounter.edit would have found the new batch path refusing work the old form allowed, and the
// reverse would have let somebody record diagnoses the existing route would not. A batch engine that
// gates differently from the single-item one is two answers to one question.
const CAP_DIAGNOSIS_RECORD = "diagnosis.record";

/**
 * ⚠ ONE PRIMARY, AND THE LAST ONE TICKED WINS RATHER THAN THE FIRST.
 *
 * s2 makes primary an ENCOUNTER-LEVEL designation, so a working set carrying two is a contradiction the
 * screen should not have allowed. Refusing the whole batch over it would lose a clinician's typing;
 * silently keeping the first would contradict the thing they most recently clicked. Pure, so the rule is
 * testable without a database.
 */
export function resolvePrimary(items: PendingDiagnosis[]): { primaryIndex: number | null; demoted: number[] } {
  const ticked = items.map((it, i) => (it.isPrimary === true ? i : -1)).filter(i => i >= 0);
  if (ticked.length === 0) return { primaryIndex: null, demoted: [] };
  const winner = ticked[ticked.length - 1];
  return { primaryIndex: winner, demoted: ticked.filter(i => i !== winner) };
}

/** Normalises one item, or says why it cannot be recorded. Pure. */
export function validateItem(item: PendingDiagnosis): { ok: true; label: string; certainty: DiagnosisCertainty }
  | { ok: false; code: string; message: string } {
  const label = (item.label ?? "").trim();
  if (!label) return { ok: false, code: "LABEL_REQUIRED", message: "a diagnosis needs a name" };
  if (label.length > 300)
    return { ok: false, code: "LABEL_TOO_LONG", message: "that diagnosis name is longer than 300 characters" };
  // ⚠ AN UNKNOWN CERTAINTY IS REFUSED, NOT COERCED. recordDiagnosis silently rewrote anything it did not
  // recognise to `provisional`, so a typo in a caller became a clinical qualifier nobody chose.
  const certainty = (item.certainty ?? DEFAULT_CERTAINTY) as DiagnosisCertainty;
  if (!DIAGNOSIS_CERTAINTIES.includes(certainty))
    return {
      ok: false, code: "CERTAINTY_INVALID",
      message: `certainty must be one of ${DIAGNOSIS_CERTAINTIES.join(", ")}`,
    };
  return { ok: true, label, certainty };
}

/**
 * Record a working set of diagnoses against one encounter.
 *
 * ⚠ THE ENCOUNTER GUARD IS THE ENGINE'S, NOT THIS FUNCTION'S. editableEncounter refuses a signed or
 * absent encounter and is the single place that rule lives; re-implementing it here would be a second
 * opinion about whether a record may still be written to.
 */
export async function recordDiagnosisBatch(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string;
  items: PendingDiagnosis[];
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ results: DiagnosisResult[]; recorded: number }>> {
  if (!hasCapability(ctx, CAP_DIAGNOSIS_RECORD))
    return fail(403, "FORBIDDEN", `recording a diagnosis needs ${CAP_DIAGNOSIS_RECORD}`);

  const items = args.items ?? [];
  if (items.length === 0) return fail(422, "VALIDATION_ERROR", "there is nothing in the working set");
  // ⚠ REFUSED, NOT TRUNCATED. A set quietly cut to 20 would look like it recorded everything.
  if (items.length > MAX_PENDING_DIAGNOSES)
    return fail(422, "TOO_MANY_ITEMS",
      `${items.length} diagnoses were submitted and one encounter takes at most ${MAX_PENDING_DIAGNOSES}`);

  // The encounter must exist, belong to this workspace, and still be open.
  const { data: enc, error: encErr } = await admin.from("practice_encounter")
    .select("id, patient_id, status, signed_at")
    .eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (encErr) return fail(503, "READ_FAILED", `the encounter could not be read: ${encErr.message}`);
  if (!enc) return fail(404, "NOT_FOUND", "Not found");
  if (enc.signed_at) return fail(422, "ENCOUNTER_SIGNED", "this encounter is signed and cannot take new diagnoses");

  const patientId = enc.patient_id as string;
  const { primaryIndex } = resolvePrimary(items);
  const results: DiagnosisResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const check = validateItem(item);
    if (!check.ok) {
      results.push({ index: i, label: (item.label ?? "").trim(), ok: false, code: check.code, message: check.message });
      continue;
    }

    // ── s2's PROBLEM LIST, and the two traps it names ──────────────────────────────────────────────
    let problemId: string | null = null;
    let problemCreated = false;

    if (item.existingProblemId) {
      // ⚠ ASSESSED TODAY: LINK, NEVER RE-CREATE. Verified against THIS patient rather than trusted from
      // the payload -- a problem id from another patient's record would otherwise attach their condition
      // to this consultation.
      const { data: prob } = await admin.from("practice_problem")
        .select("id").eq("id", item.existingProblemId)
        .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).maybeSingle();
      if (!prob) {
        results.push({
          index: i, label: check.label, ok: false, code: "PROBLEM_NOT_FOUND",
          message: "that ongoing problem does not belong to this patient",
        });
        continue;
      }
      problemId = prob.id;
    } else if (item.keepAsProblem === true) {
      // ⚠ MATCH BEFORE INSERT, so promoting a diagnosis the patient already carries links to the problem
      // they have rather than giving them the same condition twice.
      const { data: existing } = await admin.from("practice_problem")
        .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
        .eq("label", check.label).eq("status", "active").maybeSingle();
      if (existing) problemId = existing.id;
      else {
        const { data: created, error: probErr } = await admin.from("practice_problem").insert({
          workspace_id: ctx.workspaceId, patient_id: patientId, label: check.label, created_by: args.actorId,
        }).select("id").maybeSingle();
        // ⚠ A FAILED PROBLEM WRITE DOES NOT COST THE DIAGNOSIS. Today's assessment is the more important
        // record and is still written; the row simply carries no problem link, and the item says so.
        if (probErr || !created) {
          problemId = null;
        } else {
          problemId = created.id;
          problemCreated = true;
        }
      }
    }

    const { data: diag, error } = await admin.from("practice_diagnosis").insert({
      workspace_id: ctx.workspaceId,
      encounter_id: args.encounterId,
      patient_id: patientId,
      problem_id: problemId,
      label: check.label,
      code: item.code ?? null,
      code_system: item.codeSystem ?? null,
      certainty: check.certainty,
      is_primary: primaryIndex === i,
      created_by: args.actorId,
    }).select("id").maybeSingle();

    if (error || !diag) {
      results.push({
        index: i, label: check.label, ok: false, code: "WRITE_FAILED",
        message: error?.message ?? "the diagnosis was not written and no reason was given",
      });
      continue;
    }

    results.push({
      index: i, label: check.label, ok: true,
      diagnosisId: diag.id as string, problemId, problemCreated,
    });
  }

  const recorded = results.filter(r => r.ok).length;
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.diagnosis_batch_recorded",
    payload: {
      encounterId: args.encounterId, submitted: items.length, recorded,
      failed: results.filter(r => !r.ok).map(r => ({ label: r.label, code: r.code })),
    },
    correlationId: args.correlationId,
  });

  // ⚠ ok IS TRUE WHEN ANYTHING LANDED, and the per-item results carry the rest. A blanket false would
  // tell a screen that nine recorded diagnoses did not exist because the tenth was refused.
  return { ok: true, data: { results, recorded } };
}
