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
import { rememberStaffWorkspace } from "@/lib/staff/workspace-preference";
import { hqSearchCatalogue } from "@/lib/hq/search-catalogue";
import HqSearchLauncher from "./_components/HqSearchLauncher";
import { ALL_NAV_TABLES } from "./_components/nav-tables";
import SessionIdentityNotice, { RememberSessionIdentity } from "@/components/SessionIdentityNotice";
import { resolveMissionProfile } from "@/lib/hq/mission-profile";
import ProductDirectorSidebar from "./_components/ProductDirectorSidebar";
import { PD_SIDEBAR_COOKIE, readPdSidebarMode } from "./_components/pd-sidebar-mode";

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

  // ⚠ AFTER THE GATE, NEVER BEFORE IT (COMP-HQ-ACCESS-001 s7, migration 310). Recording an arrival
  // the gate would have refused would teach the resolver to send somebody back to a door that then
  // turns them away -- so this line sits below the admission, where the visit is a fact.
  //
  // Only useful to staff holding SEVERAL destinations; for everyone else the resolver already lands
  // them directly and never reads this. It never throws and never blocks the render: a failed write
  // costs a convenience, and costing somebody their workspace instead would be the wrong trade.
  await rememberStaffWorkspace(admin, user.id, "/super-admin");

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
  // ⚠ THE WHOLE RESULT IS KEPT NOW, NOT JUST `.capabilities` (CPR-PD-001 s6). The position NAMES come
  // back on the same reads -- the resolver selects them as one extra column on a query it already
  // makes -- so the identity line can say which appointment somebody is here by without this layout,
  // which runs on all 205 HQ pages, paying for a second resolution.
  const hqPositions = isOwner
    ? { positions: [] as string[], capabilities: [] as string[], positionNames: [] as string[] }
    : await resolveHqPositions(admin, user.id);
  const hqCapabilities = hqPositions.capabilities;

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

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ WHICH SIDEBAR? (CPR-PD-001 s7.) Competen HQ governs all four product lines; a Product Director
  // governs one. The two are separate navigations by specification -- "product switching occurs through
  // the HQ/product context architecture rather than by mixing unrelated product sidebars" -- so the shell
  // this layout renders is a decision, not a variant.
  //
  // ⚠ IT IS THE GOVERNANCE CONTEXT THAT DECIDES, NEVER A JOB TITLE OR A POSITION CODE. resolveMissionProfile
  // is the same resolver Mission Control composes itself from (PLAT-GOV-MC-001 s10, "selected by governance
  // context"), so the sidebar and the dashboard inside it cannot disagree about which product this person
  // is here to run -- and a second Practice position, added later, needs no change here.
  //
  // ⚠ AN OWNER IS NEVER PRODUCT-SCOPED AND KEEPS THE HQ SIDEBAR. That is correct: the owner governs four
  // product lines and must not be handed one product's navigation. It is also why this branch cannot be
  // seen from a super_admin account, which is the account most likely to be used to check it.
  //
  // ⚠ AND IT DECIDES PRESENTATION ONLY. Every destination below still calls requireHqCapability on
  // arrival (s7: "a hidden navigation item does not constitute authorization"). Rendering this sidebar
  // grants nothing, and rendering the HQ one withholds nothing.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  const mission = isOwner
    ? null
    : await resolveMissionProfile(admin, {
        isOwner: false,
        positions: hqPositions.positions,
        capabilities: hqCapabilities,
      });
  const isProductDirector = mission?.profile.governanceLevel === "product"
    && mission.profile.productLineCode === "practice";

  if (isProductDirector) {
    return (
      <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
        <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
        <RememberSessionIdentity userId={user.id} displayName={profile?.full_name ?? null} />
        {/* ⚠ THE COLLAPSE PREFERENCE IS READ HERE, ON THE SERVER, AND THAT IS THE WHOLE POINT OF THE
            COOKIE (PD-014 build 1: persist it "without making navigation dependent on client-only
            state"). The width is correct in the first byte, so there is no wrong-width frame and no
            pre-paint script. The sidebar writes it back on toggle; see pd-sidebar-mode.ts. */}
        <ProductDirectorSidebar
          initialMode={readPdSidebarMode(cookieStore.get(PD_SIDEBAR_COOKIE)?.value)}
          capabilities={hqCapabilities}
          isOwner={isOwner}
          profileName={profile?.full_name ?? null}
          positionNames={hqPositions.positionNames}
          workspaces={workspaces}
          header={
            <GlobalHeader
              // s6: the product context, named. And no header hamburger -- this sidebar carries its own
              // persistent toggle (s4), and the header's one is wired to the estate's localStorage
              // mechanism, which would be a second answer to the same question.
              workspaceTitle="Competen Practice"
              workspaceHref="/super-admin"
              showSidebarToggle={false}
              user={header.user}
              workspaces={header.workspaces}
              units={header.units}
              activeUnitId={header.activeUnitId}
              notifications={header.notifications}
              messages={header.messages}
            />
          }
          search={
            <HqSearchLauncher destinations={hqSearchCatalogue(ALL_NAV_TABLES, { isOwner, capabilities: hqCapabilities })} />
          }
        >
          {children}
        </ProductDirectorSidebar>
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
            isOwner={isOwner} hqCapabilities={hqCapabilities} positionNames={hqPositions.positionNames} />
        </aside>

        {/* Pages stay readable at max-w-6xl; a workspace page opts out of the
            cap by rendering data-wide on its root (rule in globals.css). */}
        <main id="main-content" data-content className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {/* COMP-HQ-ACCESS-001 s15's "Search HQ / Go to...". The corpus is built on the SERVER and
              already filtered, so an unauthorised destination's name never reaches this HTML -- and
              the launcher itself holds no permission logic to read around. It grants nothing: every
              destination re-authorises on arrival. */}
          <div className="mb-4 flex justify-end">
            <HqSearchLauncher destinations={hqSearchCatalogue(ALL_NAV_TABLES, { isOwner, capabilities: hqCapabilities })} />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
