// PLAT-GOV-001 section 5 and PLAT-GOV-MC-001 section 8 - one identity, many appointments, one ACTIVE
// governance context.
//
// ⚠ THE DEVIATION THIS CLOSES. resolveHqPositions returns the UNION of every position a person holds, so
// somebody appointed to two products could act in both at once from one screen. GOV-MC-001 acceptance 4 is
// explicit: "a Product Director cannot see another product merely because the same shell is used". The
// union was never wrong for one appointment - it was undefined for two.
//
// ⚠ NOBODY HOLDS TWO TODAY (measured: 2 appointments, 2 people, 1 each), so this narrows nothing for anyone
// currently signed in. That is the good time to change an authorization path, not the reason to skip the
// care -- the whole point is that the second appointment must not be the thing that discovers the bug.
//
// ⚠ THE COOKIE IS A HINT, NEVER A GRANT. It carries an appointment id and nothing else. Every resolution
// re-reads that appointment and re-checks that it belongs to this identity, that its status still grants
// access, and that its position is still active. A forged or stale cookie therefore selects nothing and
// falls back to the default - it can narrow what you see, never widen it. Asserted by the harness.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import { isHqOfficeType } from "./spaces";
import { activeGrants } from "./spaces";

export const HQ_CONTEXT_COOKIE = "hq_context";

export type GovernanceContext = {
  appointmentId: string;
  positionCode: string;
  positionName: string;
  productLineCode: string | null;
  /** The capabilities THIS appointment grants, not the union across all of them. */
  capabilities: string[];
};

export type ActiveGovernance = {
  /** The chosen context, or null when the identity holds none. */
  active: GovernanceContext | null;
  /** Every valid context this identity may switch into. GOV-MC-001 s8: "only valid appointments". */
  available: GovernanceContext[];
  /**
   * ⚠ TRUE WHEN NOTHING WAS CHOSEN AND SOMETHING WAS PICKED FOR THEM. The switcher says so, because a person
   * holding two appointments who was silently placed in one would read the missing half as a bug in the
   * product rather than as a context they can change.
   */
  defaulted: boolean;
};

/**
 * Every governance context an identity may currently act in - one entry per LIVE appointment.
 *
 * Reuses the same three rules resolveHqPositions applies, deliberately: an HQ-typed office that is not
 * dissolved or archived, an appointment whose status is on the access allowlist, and a position that is
 * still active. They are applied per appointment here rather than collapsed into a union.
 */
export async function listGovernanceContexts(admin: any, userId: string): Promise<GovernanceContext[]> {
  const { data: offices, error: oErr } = await admin
    .from("ogs_offices").select("id, office_type, is_active, status").limit(500);
  if (oErr || !offices?.length) return [];

  const hqOfficeIds = new Set((offices as any[])
    .filter(o => isHqOfficeType(o.office_type) && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived")
    .map(o => o.id));
  if (!hqOfficeIds.size) return [];

  const { data: appts, error: aErr } = await admin
    .from("ogs_office_appointments")
    .select("id, office_id, person_id, role, status, product_line_code")
    .eq("person_id", userId)
    .limit(200);
  if (aErr || !appts?.length) return [];

  const live = (appts as any[]).filter(a =>
    hqOfficeIds.has(a.office_id) && appointmentGrantsAccess(a.status) && !!a.role);
  if (!live.length) return [];

  const codes = [...new Set(live.map(a => a.role as string))];
  const { data: posRows } = await admin
    .from("hq_position").select("code, name, is_active, product_line_code").in("code", codes).limit(200);
  const positions = new Map(((posRows ?? []) as any[]).filter(p => p.is_active !== false).map(p => [p.code, p]));

  const { data: grants } = await admin
    .from("hq_position_capability")
    .select("position_code, capability_code, effective_from, effective_to")
    .in("position_code", [...positions.keys()])
    .limit(2000);
  const inDate = activeGrants((grants ?? []) as any[]);

  return live
    .filter(a => positions.has(a.role))
    .map(a => {
      const pos = positions.get(a.role)!;
      return {
        appointmentId: a.id as string,
        positionCode: a.role as string,
        positionName: (pos.name as string) ?? a.role,
        // The appointment's own product line wins over the position's -- s6 puts it on the appointment
        // because that is what the ACTIVE context is resolved from.
        productLineCode: (a.product_line_code ?? pos.product_line_code ?? null) as string | null,
        capabilities: [...new Set(inDate.filter((g: any) => g.position_code === a.role).map((g: any) => g.capability_code))].sort(),
      };
    })
    // Deterministic, so an unchosen default is stable between requests rather than whatever the database
    // happened to return first.
    .sort((x, y) => x.positionCode.localeCompare(y.positionCode) || x.appointmentId.localeCompare(y.appointmentId));
}

/**
 * The active context for this request.
 *
 * ⚠ AN ABSENT OR INVALID SELECTION DEFAULTS, IT DOES NOT DENY. Refusing until somebody chooses would strand
 * a person whose cookie expired behind a screen they cannot reach without the cookie. "Safest" is not "most
 * restrictive" here: the default is one of their OWN valid appointments, so the worst case is that they see
 * less than they expected and can say so with one click.
 */
export async function resolveActiveGovernance(
  admin: any,
  userId: string,
  selectedAppointmentId: string | null | undefined,
): Promise<ActiveGovernance> {
  const available = await listGovernanceContexts(admin, userId);
  if (!available.length) return { active: null, available, defaulted: false };

  const chosen = selectedAppointmentId
    ? available.find(c => c.appointmentId === selectedAppointmentId) ?? null
    : null;

  return chosen
    ? { active: chosen, available, defaulted: false }
    : { active: available[0], available, defaulted: available.length > 1 };
}

/**
 * GOV-001 section 17 requires "governance context switched" as an audit event.
 *
 * ⚠ WRITTEN TO audit_log RATHER THAN A NEW TABLE, and that is a considered choice rather than laziness:
 * audit_log already carries 352 rows with a null hospital_id, so HQ-level events are an established shape
 * there, and a governance event that lives apart from every other audited act is one nobody will join
 * against. Best-effort: a switch that happened must not be undone because its record could not be written.
 */
export async function recordContextSwitch(
  admin: any,
  args: { userId: string; userName: string | null; from: GovernanceContext | null; to: GovernanceContext; traceId?: string | null },
): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      trace_id: args.traceId ?? null,
      actor_id: args.userId,
      actor_name: args.userName,
      action: "governance_context_switched",
      entity_type: "governance_appointment",
      entity_id: args.to.appointmentId,
      entity_name: args.to.positionName,
      old_value: args.from
        ? { appointment_id: args.from.appointmentId, position: args.from.positionCode, product_line: args.from.productLineCode }
        : null,
      // ⚠ THE CLAIM FIELDS GOV-MC-001 s12 REQUIRES: appointment, product and the capability count the
      // context resolved to. Recording the COUNT rather than the list keeps the row readable while still
      // making a silent widening visible when it changes.
      new_value: {
        appointment_id: args.to.appointmentId,
        position: args.to.positionCode,
        product_line: args.to.productLineCode,
        capability_count: args.to.capabilities.length,
      },
    });
  } catch { /* an unrecorded switch is not a failed switch */ }
}
