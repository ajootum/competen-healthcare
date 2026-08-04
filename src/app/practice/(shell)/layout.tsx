import Link from "next/link";
import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { visibleNav, NAV_GROUP_ORDER, NAV_LAYER_ORDER, GROUP_LAYER } from "@/lib/practice/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePreferences } from "@/lib/practice/preferences";
import SidebarNav from "./SidebarNav";
import PracticeSignOut from "./PracticeSignOut";
import PracticeAppearance from "./PracticeAppearance";
import PracticeShortcuts from "./PracticeShortcuts";

// CPR-V2-020 authenticated application shell (SHELL-001 s7, CPR-V2-020 V3).
//
// GUARDS RUN HERE, ONCE, IN SHELL-001 s6.1 ORDER, for every route in this group. A page inside (shell)
// can assume READY: authentication, membership, workspace status, entitlement and onboarding have all
// been answered, and every non-READY state redirects to its dedicated surface rather than rendering a
// broken frame. The layout never renders protected content in any other state (s5 "load the shell
// without rendering protected content").
//
// NAVIGATION IS GENERATED, TWICE FILTERED: by the caller's effective capability set (never role names,
// s7.2) and by what is actually BUILT -- an unshipped module renders nothing at all, not a disabled
// promise. Today that means Home alone, which is honest: Phase 0 ships the shell and the command centre.
//
// The environment indicator (s15) renders outside production so a pilot user cannot mistake a test
// workspace for a live one -- the same reason the workspace name is always in the header (s7).

export default async function PracticeShellLayout({ children }: { children: React.ReactNode }) {
  const shell = await resolvePracticeShell();

  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/home");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice");
  if (shell.state === "CHOOSER_REQUIRED") redirect("/practice/select-workspace");
  if (shell.state === "ONBOARDING_REQUIRED") redirect("/practice/onboarding");
  if (shell.state === "ACCESS_RESTRICTED") redirect("/practice/access-status");
  // CPR-370: a revoked device and an unmet MFA policy are refusals like any other, and are refused on
  // EVERY practice surface rather than only in the shell layout.
  if (shell.state === "SESSION_REVOKED" || shell.state === "MFA_REQUIRED") redirect("/practice/access-status");

  const { ctx } = shell;
  const nav = visibleNav(ctx.capabilities);
  // Headings follow the DECLARED order, not the order items happen to appear in. Deriving it from the
  // item list means moving one route silently moves a whole section heading with it. CPR-SET-000 Part I
  // adds the layer above the group; an empty layer renders nothing at all rather than a bare heading.
  const layers = NAV_LAYER_ORDER
    .map(layer => ({
      layer,
      groups: NAV_GROUP_ORDER.filter(g => GROUP_LAYER[g] === layer && nav.some(i => i.group === g)),
    }))
    .filter(l => l.groups.length > 0);

  // CPR-360: the personalisation, resolved server-side and applied as data attributes the stylesheet
  // reads. Server-side because a theme applied by client JavaScript flashes the wrong one first, and
  // because "personal over practice, except where the practice has locked it" is a rule the client
  // cannot be trusted to evaluate.
  const admin = createAdminClient();
  const { effective } = await resolvePreferences(admin, ctx.workspaceId, ctx.userId);

  // ── THE COMP'S SIDEBAR BADGES ──────────────────────────────────────────────────────────────────
  //
  // Real counts, or no badge. The comp shows "Tasks 6" and "Messages 4"; a badge is a promise that
  // something is waiting, and a decorative one is the fastest way to teach people to ignore all of them.
  // Both are head+count reads, and BOTH ERRORS ARE CHECKED -- a failed count returning null must render
  // no badge rather than a zero, because "nothing waiting" and "could not tell" are different answers.
  const [taskCount, messageCount] = await Promise.all([
    ctx.capabilities.includes("task.view")
      ? admin.from("practice_task").select("*", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).eq("assigned_to", ctx.userId)
        .in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"])
        .then(r => (r.error ? null : r.count))
      : Promise.resolve(null),
    ctx.capabilities.includes("inbox.record")
      ? admin.from("practice_incoming_document").select("*", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).eq("status", "RECEIVED")
        .then(r => (r.error ? null : r.count))
      : Promise.resolve(null),
  ]);

  const BADGES: Record<string, number | null> = {
    "/practice/tasks": taskCount,
    "/practice/inbox": messageCount,
  };
  const navItems = nav.map(i => ({
    href: i.href, label: i.label, icon: i.icon, group: i.group,
    badge: BADGES[i.href] ?? null,
  }));

  return (
    <div
      className="cp-surface min-h-screen bg-gray-50 flex"
      // "system" is resolved in the browser, since only the browser knows what the device prefers. It
      // is the one appearance decision that cannot be made here.
      data-practice-theme={effective.theme === "system" ? undefined : effective.theme}
      data-practice-theme-preference={effective.theme}
      data-practice-accent={effective.accent}
      data-practice-size={effective.fontScale}
      data-practice-density={effective.density}
      data-practice-noise={effective.reduceVisualNoise ? "reduced" : undefined}
    >
      {/* Sidebar (s7: primary navigation) */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[var(--cp-shell)] text-white">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10">
          <span className="w-8 h-8 rounded-full bg-[var(--cp-primary)] flex items-center justify-center text-white text-sm font-bold">C</span>
          <span className="font-bold text-[15px]">competen<span className="text-blue-300">Practice</span></span>
        </div>
        {/* Who is signed in. The comp puts a name and a role here; this build has neither reliably --
            names live in `profiles` and a practice-only user may have no row (CPR-340). So it shows the
            PRACTICE, which is always known, rather than inventing a person. */}
        <div className="border-b border-white/10 px-4 py-3">
          <p className="truncate text-[13px] font-semibold text-white">{ctx.workspaceName}</p>
          <p className="text-[10px] text-blue-200/60">
            {ctx.workspaceType === "individual_practice" ? "Individual practice" : "Managed practice"}
            {" · "}{ctx.entitlementStatus === "trial" ? "Trial" : "Licensed"}
          </p>
        </div>

        <SidebarNav layers={layers} items={navItems} />

        <Link href="/practice/settings"
          className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3 text-[12px] text-blue-100/70 hover:bg-white/8 hover:text-white">
          <span aria-hidden className="text-blue-200/60">⇄</span> Switch workspace
        </Link>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header (s7: workspace name, environment indicator, user menu) */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center gap-3 px-4">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-gray-900 truncate">{ctx.workspaceName}</p>
            <p className="text-[10px] text-gray-400">
              {ctx.workspaceType === "individual_practice" ? "Individual practice" : "Managed practice"}
              {" · "}{ctx.entitlementStatus === "trial" ? "Trial" : "Licensed"}
            </p>
          </div>
          {process.env.NODE_ENV !== "production" && (
            <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]">
              NON-PRODUCTION
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <PracticeSignOut />
          </div>
        </header>

        {/* `practice-scale` is what size and density are applied to -- the content, not the chrome. A
            zoomed sidebar would push the page off the screen at the setting that exists to make things
            easier to see. */}
        <main className="practice-scale flex-1 min-w-0 p-5">{children}</main>
      </div>

      {/* The two client behaviours that cannot be server-rendered: resolving "match my device", and
          listening for a keypress. Both are inert when the preference is off. */}
      <PracticeAppearance preference={effective.theme} />
      {effective.shortcutsEnabled && <PracticeShortcuts />}
    </div>
  );
}
