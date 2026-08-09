// The workspace audit trail, in a module that IMPORTS NOTHING.
//
// ⚠ IT LIVED IN provisioning.ts, AND THAT COST 120.7 kB GZIP ON FOUR SCREENS.
//
// provisioning.ts has exactly one import line and it is node:crypto -- createHash, for the provisioning
// payload hash, nothing to do with audit. Four CONSTANT lists (steps, ATTACHMENT_KINDS, FACILITY_TYPES,
// ACTIVITY_KINDS/PARTICIPATION) live in modules whose own first line imported audit from provisioning,
// and four client components import those constants. So a browserified Node crypto stack
// (readable-stream, asn1.js, elliptic) was bundled into /practice/patients,
// /practice/encounters/[encounterId], /practice/settings and /practice/activity: 120,706 bytes gzip,
// about 30% of the two heaviest clinical screens, roughly 24 seconds of GPRS -- and NEVER EXECUTED.
// Measured in docs/CP-PERF-SURVEY-001.md section 2.3.
//
// audit() needs no crypto. It only needed to not share a file with something that does.
//
// ⚠ KEEP THIS MODULE IMPORT-FREE. Anything imported here lands in four client bundles.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One row in the workspace's audit trail -- CPR-CORE-001 s13's "all state-changing actions require actor,
 * timestamp, source and audit entry", and s16's "all state changes are auditable".
 *
 * ⚠ THE INSERT'S ERROR IS NOT DISCARDED, and this is the table where discarding it costs most: a trail
 * with a hole in it is indistinguishable from a trail of a quiet afternoon, so nobody ever finds out.
 * It is not THROWN either -- an audit write that failed must not unwind a consultation that succeeded --
 * so the failure goes to the server log where somebody is watching, and comes back as `false`. A caller
 * that wants to claim "recorded" can check instead of assuming; the hundred that ignore it behave exactly
 * as they did.
 *
 * `source` is s13's fourth element. The column defaults to 'api' because that is what nearly every write
 * is, and it is OMITTED rather than sent as null when the caller does not know -- an explicit null would
 * be refused by a NOT NULL column that would otherwise have supplied its own default. A cron, an
 * integration or a harness says which surface it is, because the database cannot know.
 */
export async function audit(admin: any, event: {
  workspaceId?: string | null; actorId?: string | null; eventType: string;
  payload?: Record<string, unknown>; correlationId?: string; source?: string;
}): Promise<boolean> {
  const row: Record<string, unknown> = {
    workspace_id: event.workspaceId ?? null,
    actor_id: event.actorId ?? null,
    event_type: event.eventType,
    payload: event.payload ?? {},
    correlation_id: event.correlationId ?? null,
  };
  if (event.source) row.source = event.source;

  const { error } = await admin.from("practice_audit_event").insert(row);
  if (error) {
    console.error(`[practice] audit "${event.eventType}" was NOT recorded: ${error.message}`);
    return false;
  }
  return true;
}
