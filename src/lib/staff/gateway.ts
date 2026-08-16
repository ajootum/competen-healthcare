// ── THE STAFF GATEWAY LOADER ── COMP-STAFF-ACCESS-001 s7, composed from what exists ─────────────────
//
// ⚠ COMPOSE, DO NOT REBUILD (COMP-ACCESS-IMP-001 s1) -- and here that is literal: this file contains
// no authorisation arithmetic of its own. Gate 1 is admitToEstate (the same call the eleven estate
// layouts make), destinations are workspaceLinksForUser (the same resolver the Workspace Launcher
// and GlobalHeader use), governance contexts are listGovernanceContexts (the same resolver the HQ
// context switcher uses), and the decision itself is the pure decideStaffGateway. A second spelling
// of any of these is the drift class the identity harness exists to catch.
//
// ⚠ THE OWNER BRANCH SKIPS THE HQ READS, matching /super-admin/layout.tsx ("an owner never pays for
// this read") and rule zero in platform-membership.ts: no read of ogs_offices -- succeeding, failing
// or mid-migration -- may decide anything for the two accounts with nobody above them. The pure
// decision adds HQ_DOOR back for them without consulting a table.

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { estateRolesOf, hasPlatformRole, type AppRole } from "@/lib/roles";
import { admitToEstate } from "@/lib/platform-membership";
import { listGovernanceContexts } from "@/lib/hq/governance-context";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import { decideStaffGateway, type StaffGatewayDecision, type StaffGovernanceContext } from "./selector";

export type StaffGatewayResolution =
  | { state: "AUTH_REQUIRED" }
  | { state: "RESOLVED"; decision: StaffGatewayDecision; fullName: string | null };

type ProfileRow = {
  full_name: string | null;
  role: string | null;
  roles: string[] | null;
  platform_role: string | null;
  platform_roles: string[] | null;
};

export async function resolveStaffGateway(): Promise<StaffGatewayResolution> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "AUTH_REQUIRED" };

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("full_name, role, roles, platform_role, platform_roles")
    .eq("id", user.id)
    .single();
  const profile = (data ?? null) as ProfileRow | null;

  const roles = estateRolesOf(profile) as AppRole[];
  // The same pair, in the same order, as /super-admin/layout.tsx:103 -- the two doors must not
  // disagree about who owns this platform.
  const isOwner = roles.includes("super_admin") || hasPlatformRole(profile, "platform_owner");

  const admission = await admitToEstate(admin, user.id, roles, { breakGlass: isOwner });

  // The one resolver that feeds every switcher. For an owner it returns their org-role workspaces
  // (usually none) and skips the HQ probe -- the pure decision restores HQ for them.
  const workspaces = await workspaceLinksForUser(admin, user.id, roles);

  // Live HQ appointments, shown under the HQ card so a multi-appointment person sees WHAT they hold,
  // not merely that a door exists. Skipped for owners -- ownership is not an appointment (GOV-MC-001).
  const governanceContexts: StaffGovernanceContext[] = isOwner
    ? []
    : (await listGovernanceContexts(admin, user.id)).map(c => ({
        appointmentId: c.appointmentId,
        positionCode: c.positionCode,
        positionName: c.positionName,
        productLineCode: c.productLineCode,
      }));

  // EVERY appointment row, any status, any office -- the no-access states need to distinguish
  // "withdrawn" from "never appointed", and only the raw statuses can say which is true.
  // ⚠ Fail-soft toward []: a failed read here collapses to NO_APPOINTMENT, which offers nothing and
  // grants nothing -- the safe direction for a router (the workspaces list above is unaffected).
  let appointmentStatuses: (string | null)[] = [];
  try {
    const { data: apptRows } = await admin
      .from("ogs_office_appointments")
      .select("status")
      .eq("person_id", user.id)
      .limit(500);
    appointmentStatuses = ((apptRows ?? []) as { status: string | null }[]).map(r => r.status);
  } catch {
    // Pre-migration estate or transient failure -- the decision falls to the honest ground state.
  }

  return {
    state: "RESOLVED",
    fullName: profile?.full_name ?? null,
    decision: decideStaffGateway({
      isOwner,
      platformMember: admission.admitted,
      workspaces,
      governanceContexts,
      appointmentStatuses,
    }),
  };
}
