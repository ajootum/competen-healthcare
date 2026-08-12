import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { recordProcedure } from "@/lib/practice/procedures";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PROCEDURE WORKING SET (CP-ENC-PROC-001), write side.
//
// s1: "replaces the current one-procedure-at-a-time form with a rapid multi-procedure capture
// workspace."
//
// ⚠ THIS FILE CONTAINS NO PROCEDURE RULES, AND THAT IS THE ENTIRE DESIGN. recordProcedure already holds
// them: a procedure type must be PUBLISHED, a SIDED type must record left/right/bilateral, the label is
// written down rather than joined so a renamed catalogue entry cannot rewrite history. Re-deciding any
// of those here would be a second rulebook for the same clinical act -- and the sided-laterality rule is
// the one where a second opinion is a wrong-site record.
//
// ⚠ SO THE BATCH IS A LOOP OVER THE SINGLE ENGINE, deliberately, and the cost is one round trip per
// procedure. That is the right trade: an encounter holds a handful, and the alternative is duplicating
// safety checks that exist precisely because they must never be duplicated.
//
// ⚠ PER-ITEM OUTCOMES, NEVER A BLANKET FAILURE (s12). A refused fourth procedure must not tell the
// screen that the three already recorded do not exist -- the practitioner would enter them all again,
// and a duplicated procedure record is a claim that something was done to a patient twice.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** s6's cap on one working set. Refused rather than truncated. */
export const MAX_PENDING_PROCEDURES = 15;

export type PendingProcedure = {
  procedureTypeId?: string | null;
  label?: string;
  site?: string;
  laterality?: string;
  indication?: string;
  consentStatus?: string;
  consentNote?: string;
  anaesthesia?: string;
  materials?: string;
  immediateOutcome?: string;
  status?: string;
  abandonedReason?: string;
};

export type ProcedureResult = {
  index: number;
  label: string;
  ok: boolean;
  procedureId?: string;
  code?: string;
  message?: string;
};

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const CAP_PROCEDURE_RECORD = "procedure.record";

/**
 * Record a working set of procedures against one encounter.
 *
 * ⚠ THE CAPABILITY MATCHES THE SINGLE-PROCEDURE ROUTE'S. A batch endpoint that gated differently would
 * be a second answer to who may record that something was done to a patient -- the same mistake the
 * diagnosis engine shipped with and had to be corrected for.
 */
export async function recordProcedureBatch(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string;
  items: PendingProcedure[];
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ results: ProcedureResult[]; recorded: number }>> {
  if (!hasCapability(ctx, CAP_PROCEDURE_RECORD))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `recording a procedure needs ${CAP_PROCEDURE_RECORD}` };

  const items = args.items ?? [];
  if (items.length === 0)
    return { ok: false, status: 422, code: "VALIDATION_ERROR", message: "there is nothing in the working set" };
  if (items.length > MAX_PENDING_PROCEDURES)
    return {
      ok: false, status: 422, code: "TOO_MANY_ITEMS",
      message: `${items.length} procedures were submitted and one encounter takes at most ${MAX_PENDING_PROCEDURES}`,
    };

  const results: ProcedureResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // ⚠ SEQUENTIAL, NOT Promise.all. Two procedures written concurrently against one encounter would
    // race the same editable-encounter guard, and a refusal whose loser varies between runs is a
    // refusal nobody can reproduce.
    const res = await recordProcedure(admin, {
      workspaceId: ctx.workspaceId,
      encounterId: args.encounterId,
      procedureTypeId: it.procedureTypeId ?? null,
      label: it.label,
      site: it.site,
      laterality: it.laterality,
      indication: it.indication,
      consentStatus: it.consentStatus,
      consentNote: it.consentNote,
      anaesthesia: it.anaesthesia,
      materials: it.materials,
      immediateOutcome: it.immediateOutcome,
      status: it.status,
      abandonedReason: it.abandonedReason,
      actorId: args.actorId,
      correlationId: args.correlationId,
    });
    results.push(res.ok
      ? { index: i, label: res.data.label, ok: true, procedureId: res.data.id }
      : { index: i, label: (it.label ?? "").trim(), ok: false, code: res.code, message: res.message });
  }

  return { ok: true, data: { results, recorded: results.filter(r => r.ok).length } };
}
