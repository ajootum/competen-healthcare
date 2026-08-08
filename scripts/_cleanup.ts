/**
 * Tearing down a harness workspace, in the order the foreign keys actually require.
 *
 * THE SECOND SHARED MODULE IN scripts/, for the reason _registry.ts gives for the first: a control
 * copied into eighty-one files drifts the moment somebody edits one of them.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH THE HOUSE PATTERN, AND WHY IT LOOKED LIKE AN ENGINE BUG
 *
 * Every harness in scripts/ carried this:
 *
 *     const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
 *     for (const w of ws ?? []) await admin.from("practice_workspace").delete().eq("id", w.id);
 *
 * The delete's error is DISCARDED. That is the whole defect -- not the schema, which is deliberate.
 *
 * Migration 246 gives six tables a reference to practice_parameter_definition(id) with NO on-delete
 * clause, on purpose: CPL s24, "Retiring a pack preserves all previous patient data and definitions".
 * So `delete from practice_workspace` cascades down two paths at once -- to the definitions, and to the
 * rows that name them -- and Postgres does not guarantee which it processes first. Reach the definition
 * first and it RESTRICTS against the child that still names it.
 *
 * The delete therefore fails INTERMITTENTLY, says nothing, and the workspace survives. The next run then
 * fails with a wall of DUPLICATE_CODE that reads exactly like an engine bug. That is how it presented in
 * cpl-catalogue-harness: 5 packs, 38 pack items, a cleanup that quietly did nothing, and 37 duplicates
 * on the following run.
 *
 * ⚠ THE FIX THAT WAS ALREADY APPLIED THERE UNPICKS ONLY practice_parameter_pack_item, WHICH IS ONE OF
 * SIX. It works for that harness because that harness only makes pack items. Any harness that records a
 * measurement, an activation, a monitoring plan, a derived value or an alert would still restrict.
 * All six are unpicked here.
 *
 * ⚠ AND ONE CASE CANNOT BE UNPICKED AT ALL. practice_lifecycle_transition (migration 247) references the
 * workspace with no on-delete clause AND carries an append-only trigger refusing DELETE. A workspace that
 * has recorded a lifecycle transition is therefore PERMANENTLY UNDELETABLE, by design -- 247 calls it a
 * brake. There is no order that fixes it, so this reports it plainly instead of retrying forever.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The six tables that reference practice_parameter_definition(id) with no on-delete clause, and so
 * RESTRICT the workspace cascade. Every one of them carries workspace_id with its own cascade, which is
 * why they can be cleared directly rather than walked definition by definition.
 *
 * ⚠ Derived from migration 246 by reading the file, not from memory. If a seventh is added, the symptom
 * will be an intermittent cleanup failure that this module now REPORTS -- which is the point.
 */
export const DEFINITION_DEPENDANTS = [
  "practice_parameter_activation",
  "practice_patient_monitoring_plan",
  "practice_parameter_measurement",
  "practice_parameter_derived",
  "practice_parameter_alert",
] as const;

/**
 * ⚠ practice_parameter_pack_item IS THE SIXTH, AND IT IS NOT IN THE LIST ABOVE because it has NO
 * workspace_id COLUMN -- it is reached only through its pack. It has to be cleared pack by pack.
 *
 * This was found by the reporting this module exists to add: the first run against a real leaked
 * workspace printed
 *   "practice_parameter_pack_item ... column practice_parameter_pack_item.workspace_id does not exist"
 * where the old code would have discarded it and left the workspace standing. The defect it caught was
 * my own, in the fix for the defect.
 */
export const PACK_SCOPED_DEPENDANT = "practice_parameter_pack_item";

/**
 * ⚠ practice_audit_event IS NOT DELETED HERE, AND THAT IS NOT AN OMISSION.
 *
 * Migration 247 made it append-only with a trigger that refuses DELETE outright:
 *   "practice_audit_event is append only. DELETE refused on audit row ..."
 *
 * Every harness's `practice_audit_event.delete().eq("actor_id", u)` has therefore been a SILENT NO-OP
 * since 247 landed -- the error was discarded, so nobody noticed. Repeating a call that cannot succeed
 * would be theatre, and reporting it on every run of eighty-one harnesses would be noise.
 *
 * The consequence is real and belongs to the caller: audit rows accumulate across runs. A harness that
 * counts them must scope its assertions to its own run -- a per-run correlation id, or a timestamp taken
 * before the fixture is built. Two harnesses have already been bitten by assuming otherwise.
 */
export const AUDIT_IS_APPEND_ONLY_SINCE = "247-practice-lifecycle-brakes";

export type PurgeResult = {
  /** Workspaces that were found and successfully deleted. */
  deleted: string[];
  /** Workspaces that survived, each with the reason the database gave. */
  blocked: { id: string; reason: string; permanent: boolean }[];
  /** True when the workspace list itself could not be read -- so `deleted` proves nothing. */
  unreadable: string | null;
};

/**
 * Remove every practice workspace owned by the given users, unpicking the references that would
 * otherwise restrict the cascade.
 *
 * Prints a line for anything that survived. ⚠ It does NOT throw: a harness whose teardown throws leaves
 * the fixture behind AND loses the run, which is worse than one that reports and carries on. Callers who
 * want to fail on a blocked purge can read the result.
 */
export async function purgeWorkspacesOwnedBy(
  admin: any,
  owners: string[],
  opts: { quiet?: boolean } = {},
): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: [], blocked: [], unreadable: null };
  const say = (m: string) => { if (!opts.quiet) console.log(m); };

  for (const owner of owners) {
    const { data: ws, error } = await admin
      .from("practice_workspace").select("id").eq("owner_person_id", owner);

    // ⚠ A FAILED READ IS NOT AN EMPTY LIST. Without this the purge reports success over a database it
    // could not talk to, which is the same shape as the discarded delete error this module exists to fix.
    if (error) {
      result.unreadable = error.message;
      say(`  cleanup: the workspace list for ${owner} could not be read -- ${error.message}`);
      continue;
    }

    for (const w of (ws ?? []) as { id: string }[]) {
      // Pack items first, by pack -- they carry no workspace_id of their own.
      const { data: packs, error: packErr } = await admin
        .from("practice_parameter_pack").select("id").eq("workspace_id", w.id);
      if (packErr) say(`  cleanup: packs for ${w.id} could not be listed -- ${packErr.message}`);
      for (const p of (packs ?? []) as { id: string }[]) {
        const { error: itemErr } = await admin.from(PACK_SCOPED_DEPENDANT).delete().eq("pack_id", p.id);
        if (itemErr) say(`  cleanup: ${PACK_SCOPED_DEPENDANT} for pack ${p.id} -- ${itemErr.message}`);
      }
      // Then the workspace-scoped dependants, in any order -- they do not reference each other.
      for (const table of DEFINITION_DEPENDANTS) {
        const { error: childErr } = await admin.from(table).delete().eq("workspace_id", w.id);
        // Reported, never discarded. A table that refused here is the reason the workspace will refuse.
        if (childErr) say(`  cleanup: ${table} for ${w.id} -- ${childErr.message}`);
      }
      // Then the packs and definitions themselves. practice_parameter_definition_version cascades from
      // the definition, so it needs no unpick of its own.
      await admin.from("practice_parameter_pack").delete().eq("workspace_id", w.id);
      await admin.from("practice_parameter_definition").delete().eq("workspace_id", w.id);

      const { error: delErr } = await admin.from("practice_workspace").delete().eq("id", w.id);
      if (!delErr) { result.deleted.push(w.id); continue; }

      // ⚠ THE UNDELETABLE CASE, NAMED RATHER THAN RETRIED. practice_lifecycle_transition refuses DELETE
      // (append-only, migration 247) and holds the workspace with no on-delete clause, so no unpick order
      // exists. Saying "could not be deleted" without saying why is how the original defect survived.
      const permanent = /lifecycle_transition/i.test(delErr.message);
      result.blocked.push({ id: w.id, reason: delErr.message, permanent });
      say(permanent
        ? `  cleanup: workspace ${w.id} CANNOT be deleted -- it has lifecycle transitions, which migration 247 makes append-only. This is a brake working as designed, not a bug. Reuse the fixture or use a fresh owner id.`
        : `  cleanup: workspace ${w.id} could not be deleted -- ${delErr.message}`);
    }

    await admin.from("provisioning_request").delete().eq("target_user_id", owner);
    // practice_audit_event is deliberately not touched -- see AUDIT_IS_APPEND_ONLY_SINCE above.
  }

  return result;
}
