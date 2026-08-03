import Link from "next/link";
import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { visibleNav } from "@/lib/practice/navigation";
import PracticeSignOut from "./PracticeSignOut";

// CPR-020 authenticated application shell (SHELL-001 s7, CPR-020 V3).
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

  const { ctx } = shell;
  const nav = visibleNav(ctx.capabilities);
  const groups = [...new Set(nav.map(i => i.group))];

  return (
    <div className="cp-surface min-h-screen bg-gray-50 flex">
      {/* Sidebar (s7: primary navigation) */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[var(--cp-shell)] text-white">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10">
          <span className="w-8 h-8 rounded-full bg-[var(--cp-primary)] flex items-center justify-center text-white text-sm font-bold">C</span>
          <span className="font-bold text-[15px]">competen<span className="text-blue-300">Practice</span></span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Practice navigation">
          {groups.map(g => (
            <div key={g} className="mb-4">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-blue-200/50">{g}</p>
              {nav.filter(i => i.group === g).map(i => (
                <Link key={i.href} href={i.href}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-blue-100/80 hover:bg-white/10 hover:text-white transition-colors">
                  <span aria-hidden className="w-4 text-center">{i.icon}</span>{i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <p className="px-4 py-3 text-[10px] text-blue-200/40 border-t border-white/10">
          Phase 0 shell -- modules appear here as they ship.
        </p>
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

        <main className="flex-1 min-w-0 p-5">{children}</main>
      </div>
    </div>
  );
}
