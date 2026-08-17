import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import SidebarToggle from "@/components/SidebarToggle";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";
import WorkspaceSidebar from "./_components/WorkspaceSidebar";
import { estateRolesOf, highestRole, hasPlatformRole, type AppRole } from "@/lib/roles";
import { admitToEstate, NO_MEMBERSHIP_DESTINATION } from "@/lib/platform-membership";
import { resolveHqPositions } from "@/lib/hq/context";
import SessionIdentityNotice, { RememberSessionIdentity } from "@/components/SessionIdentityNotice";

// Sidebar IA aligned to the Mission Control model (MC-001). The nav config and
// its Clinical Knowledge Platform branch live in the WorkspaceSidebar client
// component (it swaps to the CKP shell on /super-admin/ckp routes).

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ⚠ A BOOKMARKED HQ ROUTE SURVIVES THE SIGN-IN (COMP-HQ-ACCESS-001 s14: "All authorised routes
  // support bookmarking. If signed out, authenticate then restore the validated route.").
  //
  // This used to redirect to a bare /login, which DROPPED the destination: somebody opening a
  // bookmarked Mission Control while signed out authenticated and then surfaced somewhere else
  // entirely, with no way to tell why. The practice shell already solved exactly this and its idiom
  // is reused rather than reinvented -- a layout cannot know its own pathname, so the path comes
  // from the proxy's x-pathname header.
  //
  // ⚠ VALIDATED, NOT TRUSTED. Only a plain relative /super-admin path is honoured; anything else
  // falls back to the door itself. `//evil.example` is a valid pathname and an open redirect is a
  // real attack, so the shape is tested rather than assumed -- and /login validates `next` again on
  // arrival, as does the estate gate below when the person lands.
  if (!user) {
    const asked = (await headers()).get("x-pathname") ?? "";
    const next = /^\/super-admin(\/[A-Za-z0-9\-/]*)?$/.test(asked) ? asked : "/super-admin";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, roles, platform_role, platform_roles")
    .eq("id", user.id)
    .single();

  // The FIRST repointed site of COMP-SECURITY-SURVEY-001 s6.2's consolidation (one at a time, after
  // identity-resolver-harness proved this fold equals the inline expression for every live profile).
  const userRoles: AppRole[] = estateRolesOf(profile) as AppRole[];

  // -- CP-SPLIT-002 stage 3 -- GATE 1: THE ESTATE ADMITS COMPETEN PLATFORM MEMBERS ------------------
  // COMP-ARCH-PSA-001 s7 and s14, the same call the other ten estate layouts make.
  //
  // !! IT CANNOT SHUT THE OWNERS OUT, AND THAT IS WHY IT IS SAFE TO PUT IT AHEAD OF THE HQ DOOR BELOW.
  // admitToEstate answers super_admin without reading platform_membership at all, and the second
  // predicate passed here is the landlord axis this file already resolves -- so BOTH senses of "owner"
  // are answered before any table is touched. It is the identical ordering the HQ block below uses and
  // for the identical reason, restated rather than shared because the two gates read different stores.
  //
  // It differs from the HQ block in one respect, deliberately: an UNREADABLE platform_membership
  // ADMITS, where an unreadable ogs_offices REFUSES. The argument is in src/lib/platform-membership.ts
  // -- in short, a false refusal here would blank the estate for 47 people, and a false refusal there
  // costs one owner one re-admission.
  //
  // A person refused here is a Competen Practice practitioner, so they are sent to their own product
  // rather than shown the HQ refusal panel, which would tell them nothing they can act on.
  if (!(await admitToEstate(admin, user.id, userRoles, { breakGlass: hasPlatformRole(profile, "platform_owner") })).admitted)
    redirect(NO_MEMBERSHIP_DESTINATION);

  const cookieStore = await cookies();
  // !! THE NULL IS REAL NOW, AND THE CAST USED TO SWALLOW IT. highestRole returns AppRole | null since
  // CP-SPLIT-002, and `as AppRole` would have handed the sidebar `null` typed as a role. Nobody reaches
  // this line without an estate role today -- the gate above and the HQ door below both refuse first --
  // but "nobody can get here" is exactly the assumption that decays. So the null is CARRIED, not
  // replaced: WorkspaceSidebar takes AppRole | null and renders no role switcher when there is no role,
  // because a fabricated one would print a badge the person does not hold.
  const activeRole: AppRole | null = (cookieStore.get("active_role")?.value as AppRole | undefined)
    ?? highestRole(userRoles);
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
          {/* ⚠ THE OLD SENTENCE SAID "Super Admin only" AND THAT IS NO LONGER TRUE -- HQ is reachable by
              appointment now, so a refusal naming only super_admin sends people to ask the wrong person
              for the wrong thing.

              ⚠ BUT THE FIRST REPLACEMENT WAS WORSE FOR THE COMMONEST CASE, AND THE OWNER HIT IT. It said
              only "You do not hold a position that opens this platform", which reads as "your HQ
              appointment is missing" -- so somebody signed in on their OTHER account concluded the
              product had switched their session. It had not. They were simply signed in as themselves
              rather than as the platform account, which is the ordinary reason to land here.

              So it NAMES WHO YOU ARE, and that discloses nothing: it is the viewer's own session, which
              the header already shows on every other page. What it still refuses to name is any position,
              office or capability -- what a refused person is MISSING is not something to tell them. */}
          <p className="text-gray-500 text-sm mt-2">
            You are signed in as <span className="font-semibold text-gray-700">{profile?.full_name ?? "this account"}</span>.
          </p>
          <p className="text-gray-400 text-sm mt-1">
            This platform is open to platform owners and to people holding an HQ position.
          </p>
          {/* ⚠ THE HALF THAT ANSWERS "did something just switch my account?". Renders nothing unless this
              tab was opened by a DIFFERENT account, which is the case the owner hit and reported as a bug. */}
          <SessionIdentityNotice userId={user.id} displayName={profile?.full_name ?? null} />
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <Link href="/dashboard" className="text-teal-600 hover:underline">← Go to your dashboard</Link>
            {/* The actionable half. If this is the wrong account, the way out is to leave it, and making
                somebody hunt for sign-out is how a refusal gets mistaken for a fault.

                ⚠ A POST FORM TO THE SAME ENDPOINT THE SIDEBAR USES, not a link to /logout. There is no
                /logout route -- a link there would 404, which is a worse answer than offering nothing.
                Signing out is a state change and belongs on a POST regardless. */}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-gray-500 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      {/* Records who opened this tab. Writes once; see the module header for why first-write-wins. */}
      <RememberSessionIdentity userId={user.id} displayName={profile?.full_name ?? null} />
      <div className="hidden md:block md:ml-56">
        {/* workspaceTitle matches the sidebar's spaceLabel: an appointee is not a super admin, so the
            header must not call their console one. See WorkspaceSidebar. */}
        <GlobalHeader
          workspaceTitle={isOwner ? "Platform Super Admin" : "Competen HQ"}
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
          {/* CP-HQ-NAV-001. ⚠ isOwner IS PASSED SEPARATELY AND THAT IS LOAD-BEARING: hqCapabilities is []
              for an owner, because the resolution above short-circuits before reading any HQ table. The
              filter must not infer ownership from the list, or every owner gets an empty sidebar. */}
          <WorkspaceSidebar profileName={profile?.full_name ?? null} roles={userRoles} activeRole={activeRole} workspaces={workspaces}
            isOwner={isOwner} hqCapabilities={hqCapabilities} />
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
