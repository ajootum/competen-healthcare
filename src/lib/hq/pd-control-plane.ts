/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Launch-control metadata — CPR-PD-014 §7.2 B.
 *
 * !! THE HISTORY IS DERIVED, NOT DUPLICATED. §7.2 B wants each toggle to show its current state, who
 * last changed it, when and why. Adding those as columns on practice_platform_flags would create a
 * second copy of a fact the audit trail already holds, and the two would disagree the first time a row
 * was updated by anything that forgot to maintain them.
 *
 * !! AND IT DOES NOT OPEN THE AUDIT TRAIL. practice_audit_event is deliberately outside the platform
 * plane — its payloads carry clinical detail, and plane-boundary.ts says reaching it from a super-admin
 * page must turn the harness red. The allowlist is table-and-column, so it cannot express "only rows of
 * this event type". Migration 342 solves that with a function fixed to ONE event type and FOUR named
 * payload keys, which is the same shape used for the onboarding projection.
 */

export type FlagChange = {
  flag: string;
  changedAt: string;
  actorId: string | null;
  fromEnabled: boolean | null;
  toEnabled: boolean | null;
  reason: string | null;
};

export type FlagControlHistory = {
  byFlag: Record<string, FlagChange>;
  unavailable: boolean;
  unavailableReason: string | null;
};

export async function loadFlagChangeHistory(admin: any): Promise<FlagControlHistory> {
  const { data, error } = await admin.rpc("plat_launch_flag_change_history");
  if (error) {
    return {
      byFlag: {},
      unavailable: true,
      unavailableReason: /could not find the function/i.test(error.message)
        ? "the change-history projection is not present on this database"
        : `the change history could not be read: ${error.message.slice(0, 80)}`,
    };
  }
  const byFlag: Record<string, FlagChange> = {};
  for (const r of ((data ?? []) as any[])) {
    byFlag[r.flag] = {
      flag: r.flag,
      changedAt: r.changed_at,
      actorId: r.actor_id ?? null,
      fromEnabled: r.from_enabled ?? null,
      toEnabled: r.to_enabled ?? null,
      reason: r.reason ?? null,
    };
  }
  return { byFlag, unavailable: false, unavailableReason: null };
}
