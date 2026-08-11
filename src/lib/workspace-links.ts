import { orgRolesOf, workspacesFor, WORKSPACE_CATALOGUE, type AppRole, type WorkspaceLink } from "@/lib/roles";
import { resolveHqPositions } from "@/lib/hq/context";
import { readEnterpriseMembership } from "@/lib/enterprise-membership";

// ⚠ NOT "Super Admin". CP-HQ-NAV-001. The people this link exists for are HQ APPOINTEES -- they hold a
// position, not the super_admin role, and most of them never will. A switcher entry labelled "Super Admin"
// would tell somebody they hold the most powerful role in the product on the strength of an appointment
// that opens three pages. The href is unchanged because the /hq rename comes later, once every page carries
// its own guard (see src/lib/hq/spaces.ts).
const HQ_WORKSPACE: WorkspaceLink = { label: "Competen HQ", icon: "🏛️", href: "/super-admin" };

// Server helper: the dedicated org-role workspaces a user can switch into, given
// the AppRole portals they already hold. Reads org_role/org_roles off the profile
// (columns added by migration 040) with an explicit `.returns<>()` cast, since the
// generated Supabase types don't carry them. Fail-soft: on any error → no links.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function workspaceLinksForUser(
  admin: any,
  userId: string,
  userRoles: AppRole[],
): Promise<WorkspaceLink[]> {
  // ⚠ tenant_id rides the read that already happens, so the Enterprise probe below costs nothing for
  // the majority who carry none.
  const { data } = await admin
    .from("profiles")
    .select("org_role, org_roles, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  // `admin` is loosely typed (service-role client), so `data` is `any` — orgRolesOf
  // accepts the { org_role?, org_roles? } shape and reads only those two fields.
  const links = workspacesFor(orgRolesOf(data ?? null), userRoles);
  // Frontline special-case (HWW-001): a plain `nurse` portal role IS the
  // Healthcare Worker Workspace audience even when no org role has been
  // activated (orgRolesOf → [null] matches nothing in the catalogue). Every
  // nurse gets the bedside workspace without needing a data migration.
  if (userRoles.includes("nurse") && !links.some(l => l.href === "/healthcare-worker")) {
    const hww = WORKSPACE_CATALOGUE.find(w => w.href === "/healthcare-worker");
    if (hww) links.unshift({ label: hww.label, icon: hww.icon, href: hww.href });
  }
  // ── CP-HQ-NAV-001: the way IN to Competen HQ for somebody who is not a super admin ──────────────────
  //
  // /super-admin is not in WORKSPACE_CATALOGUE and never was: super admins reach it through ROLE_CONFIG,
  // which maps the ROLE to the portal. An HQ appointment grants no AppRole, so an appointee held a live
  // position that opened the door and had no link to it anywhere in the product -- they landed in their
  // estate portal (/admin) with no way across. That is the fifth "engine built, screen missing" of this
  // programme, and this is the screen.
  //
  // Adding it here rather than in each layout means the ONE resolver feeds both switchers: the sidebar's
  // RoleSwitcher and GlobalHeader's workspace menu (loadHeaderContext calls this function).
  if (!userRoles.includes("super_admin") && !links.some(l => l.href === HQ_WORKSPACE.href)) {
    try {
      // ⚠ A CHEAP PROBE FIRST, BECAUSE THIS RUNS ON EVERY AUTHENTICATED PAGE LOAD FOR EVERY USER.
      // resolveHqPositions costs up to four queries and begins by reading ogs_offices; almost nobody holds
      // an appointment of any kind, so one indexed lookup by person_id ends it for them. Only somebody who
      // holds SOME office appointment pays for the full HQ resolution.
      const { data: anyAppointment } = await admin
        .from("ogs_office_appointments")
        .select("id")
        .eq("person_id", userId)
        .limit(1);
      if (anyAppointment?.length) {
        // ⚠ CAPABILITIES, NOT POSITIONS -- the same distinction the /super-admin door turns on. A
        // DEACTIVATED position still reports a non-empty `positions` list while granting nothing
        // (src/lib/hq/context.ts:128), so offering the link on `positions` would keep advertising a door
        // that has been shut. It also matches the layout gate exactly, so the switcher cannot offer a
        // destination that gate then refuses.
        const { capabilities } = await resolveHqPositions(admin, userId);
        if (capabilities.length) links.unshift(HQ_WORKSPACE);
      }
    } catch {
      // ⚠ FAIL-SOFT TOWARD NO LINK, and unusually that is the safe direction here rather than the harmful
      // one. This function only decides what is OFFERED; the /super-admin layout decides what is admitted.
      // A missing link costs an appointee a URL they can still type and the owner can still send. A link
      // added on a failed read would advertise a console to someone the gate will refuse.
    }
  }
  // ── ENT-DEC-001 D5: the way IN to Competen Enterprise ───────────────────────────────────────────
  //
  // /enterprise shipped gated and REACHABLE and nothing linked to it -- the owner signed in as a seeded
  // administrator and asked "where do I find enterprise?". That is the SIXTH "engine built, screen
  // missing" of this programme (the HQ block above records the fifth), and /practice/offline was the
  // fourth. Reachable is not discoverable.
  //
  // ⚠ THE CONDITION IS THE GATE'S OWN CONDITION, no looser and no tighter: a tenant on the profile AND
  // an active membership of that tenant, read by the same module the gate reads. Offering the link on
  // anything else -- the hospital_admin role, say -- would advertise a door gate 3 then refuses.
  if (data?.tenant_id && !links.some(l => l.href === "/enterprise")) {
    try {
      const membership = await readEnterpriseMembership(admin, userId, data.tenant_id as string);
      if (membership.state === "member")
        links.push({ label: "Competen Enterprise", icon: "🏢", href: "/enterprise" });
    } catch {
      // ⚠ FAIL-SOFT TOWARD NO LINK -- the HQ block's reasoning, unchanged: this function decides what is
      // OFFERED, the gate decides what is admitted, and a link added on a failed read advertises a door
      // the fail-closed gate will refuse.
    }
  }
  return links;
}
