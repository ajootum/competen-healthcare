import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import SidebarToggle from "@/components/SidebarToggle";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";
import WorkspaceSidebar from "./_components/WorkspaceSidebar";
import { highestRole, hasPlatformRole, type AppRole } from "@/lib/roles";
import { resolveHqPositions } from "@/lib/hq/context";

// Sidebar IA aligned to the Mission Control model (MC-001). The nav config and
// its Clinical Knowledge Platform branch live in the WorkspaceSidebar client
// component (it swaps to the CKP shell on /super-admin/ckp routes).

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, roles, platform_role, platform_roles")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  // Dedicated org-role workspaces this user can switch into (normally none for landlord-only super admins).
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/super-admin" });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ THE DOOR TO HQ. This is the ONLY change in this product that widens who can reach /super-admin,
  // so it is written to be read by somebody deciding whether to trust it.
  //
  // It used to be one line: super_admin, or nothing. That made every HQ appointment inert -- a person
  // holding a live position was refused HERE, in the layout, before requireHqContext on the page below
  // ever ran and before hq_access_observation could record that they had tried. Observe mode was
  // observing an empty room.
  //
  // ⚠ THE OWNER BRANCH IS FIRST AND TOUCHES NO HQ TABLE. Platform ownership is one or two accounts, and
  // no read of ogs_offices -- succeeding, failing, or against a table somebody has just altered -- can
  // lock them out of the console they would use to fix it. That ordering is the break-glass.
  //
  // ⚠ AND A FAILED READ IS A REFUSAL, NOT AN ADMISSION. resolveHqPositions returns an empty list both
  // when a person holds no position and when the read did not complete; on a GATE those two collapse
  // safely, because empty means refused. It is the one place in this codebase where "a failed read is
  // never a zero" resolves toward denial rather than toward a visible gap, and it does so deliberately:
  // the cost of a false refusal is an owner letting somebody back in, and the cost of a false admission
  // is a stranger inside the estate console.
  //
  // The predicate matches resolveHqContext():189 exactly (super_admin OR platform_owner), so the layout
  // and the page guard cannot disagree about who owns this platform.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ CAPABILITIES, NOT POSITIONS, AND THE DIFFERENCE IS A DOOR THAT WOULD NOT SHUT.
  //
  // resolveHqPositions():121 returns a NON-EMPTY `positions` list alongside an empty `capabilities` list
  // when the position has been DEACTIVATED -- it reports what the person was appointed to, then withholds
  // what it grants. Gating on `positions.length` would therefore have kept admitting somebody whose
  // position was switched off, which is the one action an owner takes when they want a door shut now.
  // `capabilities` is non-empty only via an ACTIVE position holding an in-date grant, so it is the
  // strictly narrower of the two, and it is the one that tracks the withdrawal.
  //
  // A live position that grants nothing yet is refused here too, and correctly: every page below calls
  // requireHqContext(capability), so such a person could open the shell and then be refused by all 204
  // pages inside it. A door onto nothing is worse than a closed one.
  const isOwner = userRoles.includes("super_admin") || hasPlatformRole(profile, "platform_owner");
  // Only asked when it can change the answer. An owner never pays for this read.
  const hqCapabilities = isOwner ? [] : (await resolveHqPositions(admin, user.id)).capabilities;

  if (!isOwner && hqCapabilities.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Competen HQ</h1>
          {/* ⚠ THE OLD SENTENCE SAID "Super Admin only" AND THAT IS NO LONGER TRUE. It is now reachable
              by appointment, and a refusal that misdescribes the rule sends people to ask the wrong
              person for the wrong thing. It still names no position and no office: what somebody is
              missing is not something a refused stranger should be told. */}
          <p className="text-gray-400 text-sm mt-1">You do not hold a position that opens this platform.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Platform Super Admin"
          workspaceHref="/super-admin"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1923] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <WorkspaceSidebar profileName={profile?.full_name ?? null} roles={userRoles} activeRole={activeRole} workspaces={workspaces} />
        </aside>

        {/* Pages stay readable at max-w-6xl; a workspace page opts out of the
            cap by rendering data-wide on its root (rule in globals.css). */}
        <main id="main-content" data-content className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
