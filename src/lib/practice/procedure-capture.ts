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

export type FrequentProcedure = {
  procedureTypeId: string | null;
  label: string;
  timesRecorded: number;
  /**
   * ⚠ EXPLICIT AND OBSERVED STAY TWO FACTS (migration 297, and the same decision as
   * practice_investigation_preference in 275). `favourite` is something a practitioner chose;
   * timesRecorded is something that happened to them. s6 forbids presenting either as a recommendation,
   * and a screen cannot say honestly why an item is on it unless it can tell the two apart.
   */
  favourite: boolean;
};

export type ProcedurePanel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };

/**
 * CPR-PROC-HFE-005 s6's frequently-used shortcuts, DERIVED FROM WHAT THIS PRACTICE HAS ACTUALLY DONE.
 *
 * ⚠ NOT FROM THE CATALOGUE, AND THE DIFFERENCE IS THE WHOLE VALUE. A shortcut list built from the
 * catalogue is just the catalogue in a smaller font -- it would offer the ten seeded platform procedures
 * to a practice that has never performed any of them. Counting recorded events makes the list say
 * something true about this practice, and it is the identical fix the treatment shortcuts needed when
 * every shortcut on that tab came from the drug list.
 *
 * ⚠ THREE STATES, NEVER TWO. A failed read must not return an empty list -- "this practice has no
 * common procedures" and "I could not find out" are different sentences, and the screen prints them
 * differently. `unavailable` carries the second.
 *
 * ⚠ AND THE 1000-ROW CAP IS STATED. PostgREST silently caps an uncapped select at 1000 rows, so an
 * unstated limit turns "I could not see far enough" into a confident count.
 *
 * ⚠ SHORTCUTS STAGE, THEY DO NOT RECORD (s6, s21: "do not auto-record a procedure merely because a
 * shortcut was selected"). That rule lives in the screen -- this function only supplies names.
 */
export async function frequentProcedures(
  admin: any, ctx: WorkspaceContext, practitionerId?: string,
): Promise<ProcedurePanel<FrequentProcedure>> {
  if (!hasCapability(ctx, CAP_PROCEDURE_RECORD))
    return { items: [], permitted: false, unavailable: false, detail: null };

  const [recorded, prefs] = await Promise.all([
    admin.from("practice_procedure")
      .select("procedure_type_id, label")
      .eq("workspace_id", ctx.workspaceId)
      .limit(1000),
    // CPR-PROC-HFE-005 s20 (migration 297). The practitioner's OWN favourites, which is why this is
    // scoped to them and not to the practice: "what I reach for" and "what this clinic does" are
    // different questions, and only the first belongs to one person.
    practitionerId
      ? admin.from("practice_procedure_preference")
        .select("procedure_type_id, favourite")
        .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", practitionerId).eq("favourite", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (recorded.error)
    return { items: [], permitted: true, unavailable: true, detail: `frequently used procedures could not be read: ${recorded.error.message}` };

  const favourites = new Set<string>(((prefs.data ?? []) as any[]).map(p => p.procedure_type_id));

  const counts = new Map<string, FrequentProcedure>();
  for (const r of ((recorded.data ?? []) as any[])) {
    const label = String(r.label ?? "").trim();
    if (!label) continue;
    // ⚠ KEYED ON THE CATALOGUE ID WHERE THERE IS ONE. Two practices can name the same act differently
    // and one practice can record the same name under two catalogue entries; collapsing on the label
    // alone would hand the shortcut the wrong applicability rules, and those rules are what decide
    // whether the screen asks for a side.
    const key = r.procedure_type_id ? `t:${r.procedure_type_id}` : `l:${label.toLowerCase()}`;
    const seen = counts.get(key);
    if (seen) seen.timesRecorded += 1;
    else counts.set(key, {
      procedureTypeId: r.procedure_type_id ?? null, label, timesRecorded: 1,
      favourite: r.procedure_type_id ? favourites.has(r.procedure_type_id) : false,
    });
  }

  return {
    items: [...counts.values()]
      // ⚠ A FAVOURITE SORTS FIRST, AND IS STILL LABELLED AS ONE ON SCREEN. Sorting it up without saying
      // why would make an explicit choice look like an observed frequency, which is the confusion s6
      // forbids -- the screen would be presenting the practitioner's own preference back to them as if
      // the product had worked something out about this patient.
      .sort((a, b) => Number(b.favourite) - Number(a.favourite)
        || b.timesRecorded - a.timesRecorded || a.label.localeCompare(b.label))
      .slice(0, 8),
    permitted: true, unavailable: false, detail: null,
  };
}

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
  /** CPR-PROC-HFE-005 s8. Answers to the catalogue-declared detail fields, keyed by field key. */
  details?: Record<string, string>;
  /**
   * ⚠ THIS FIELD WAS MISSING AND SCHEDULED PROCEDURES COULD NOT BE RECORDED AT ALL.
   *
   * The screen collected a date and time, the route read it off the body and passed it in, and this
   * type did not have it -- so `recordProcedureBatch` never forwarded it, and `recordProcedure` refused
   * every SCHEDULED procedure with "a scheduled procedure needs the date and time it is scheduled for".
   * A field the practitioner had just filled in. The batch endpoint is the ONLY writer this screen has,
   * so the entire SCHEDULED status was a dead end from the encounter workspace.
   *
   * ⚠ AND NOTHING CAUGHT IT. tsc waved the route's excess property through, the engine's refusal was
   * correct and well-worded, and the harness had no assertion that a status offered by the UI could
   * actually be written. That last gap is what 13a-10c in
   * practice-encounter-workspace-harness.ts now closes -- it loops over PROCEDURE_STATUSES itself and
   * writes one procedure per status, so a new status with missing plumbing reddens instead of shipping.
   */
  scheduledAt?: string;
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
      // ⚠ SEE PendingProcedure.scheduledAt. Omitting this line refused every SCHEDULED procedure.
      scheduledAt: it.scheduledAt,
      // s8's configured field answers.
      details: it.details,
      actorId: args.actorId,
      correlationId: args.correlationId,
    });
    results.push(res.ok
      ? { index: i, label: res.data.label, ok: true, procedureId: res.data.id }
      : { index: i, label: (it.label ?? "").trim(), ok: false, code: res.code, message: res.message });
  }

  await bumpUsage(admin, ctx.workspaceId, args.actorId, items, results);

  return { ok: true, data: { results, recorded: results.filter(r => r.ok).length } };
}

/**
 * CPR-PROC-HFE-005 s20's practitioner usage metadata (migration 297).
 *
 * ⚠ ONLY WHAT WAS ACTUALLY RECORDED. Counting refused items would make the shortcut list a record of
 * what somebody kept getting wrong, offered back to them as a convenience.
 *
 * ⚠ AND A FAILURE HERE NEVER FAILS THE PROCEDURE. Every write below is best-effort and its result is
 * ignored on purpose: the clinical fact is already in practice_procedure and committed. Telling a
 * practitioner their procedure was not recorded because a usage counter would not increment would be a
 * false statement about a patient's record, and they would enter it all again -- which is how a
 * duplicated procedure ends up claiming something was done to somebody twice.
 *
 * ⚠ READ-THEN-WRITE, AND THE RACE IS ACCEPTED KNOWINGLY. Two consultations recorded in the same second
 * can each read 4 and each write 5. There is no atomic increment available without a database function,
 * and migration 297 deliberately adds none -- the house rules ban them precisely because this database
 * is hand-applied. A shortcut list that occasionally undercounts by one is worth less than nothing going
 * wrong; a counter is not a clinical fact.
 */
async function bumpUsage(
  admin: any, workspaceId: string, practitionerId: string,
  items: PendingProcedure[], results: ProcedureResult[],
) {
  const wanted = new Map<string, number>();
  for (const r of results) {
    if (!r.ok) continue;
    const typeId = items[r.index]?.procedureTypeId;
    // A free-text procedure has no catalogue row to count against. It still reaches the shortcut list
    // through frequentProcedures, which counts recorded EVENTS and does not need this table.
    if (!typeId) continue;
    wanted.set(typeId, (wanted.get(typeId) ?? 0) + 1);
  }
  if (wanted.size === 0) return;

  const ids = [...wanted.keys()];
  const { data: existing } = await admin.from("practice_procedure_preference")
    .select("procedure_type_id, usage_count")
    .eq("workspace_id", workspaceId).eq("practitioner_id", practitionerId).in("procedure_type_id", ids);
  const current = new Map<string, number>(
    ((existing ?? []) as any[]).map(r => [r.procedure_type_id, Number(r.usage_count) || 0]));

  const now = new Date().toISOString();
  await admin.from("practice_procedure_preference").upsert(
    ids.map(id => ({
      workspace_id: workspaceId, practitioner_id: practitionerId, procedure_type_id: id,
      usage_count: (current.get(id) ?? 0) + (wanted.get(id) ?? 0),
      last_used_at: now, updated_at: now,
    })),
    // ⚠ THE CONFLICT TARGET IS THE FULL UNIQUE INDEX FROM 297, AND IT IS NOT PARTIAL. A partial unique
    // index as an upsert target is a write that silently does nothing -- the house rules ban them for
    // this reason, and ux_practice_proc_preference has no WHERE clause.
    { onConflict: "workspace_id,practitioner_id,procedure_type_id" });
}
