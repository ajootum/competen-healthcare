import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";

// Competency Management Operations workspace (CMO-000) — Competency Intelligence. The enterprise
// competency engine: seven CMO modules (§2 information architecture) plus a quick-actions rail.
// The Dashboard, Frameworks and CPUs are real; the operational modules surface live data on the
// dashboard and route to their authoritative surfaces (§6) until each gains a dedicated page.
// Role-scoped to competency leads, educators and admins.

const NAV = [
  { label: "Competency Dashboard",  href: "/competency-office",              icon: "📊", exact: true },
  { label: "Compliance Centre",     href: "/competency-office/compliance",   icon: "✔️" },
  { label: "Credential Management", href: "/competency-office/credentialing", icon: "🎓" },
  { label: "Assessment Status",     href: "/competency-office/assessments",  icon: "📝" },
  { label: "Validation Queue",      href: "/competency-office/validation",   icon: "✅" },
  { label: "Competency Analytics",  href: "/competency-office/analytics",    icon: "📈" },
  { label: "Competency Frameworks", href: "/competency-office/frameworks",   icon: "🗂️" },
];

// Quick-actions rail (§5) — cross-links to the authoritative surface for each action.
const QUICK_ACTIONS = [
  { label: "Create Assessment",   href: "/admin/competencies",           icon: "📝", tint: "bg-emerald-500/90" },
  { label: "Upload Evidence",     href: "/educator/evidence",            icon: "📎", tint: "bg-sky-500/90" },
  { label: "Add Competency",      href: "/competency-office/frameworks", icon: "➕", tint: "bg-amber-500/90" },
  { label: "Assign Learning",     href: "/admin/curricula",              icon: "📖", tint: "bg-violet-500/90" },
  { label: "Run Readiness Report", href: "/competency-office/readiness", icon: "🧾", tint: "bg-teal-500/90" },
];

const ALLOWED = ["hospital_admin", "educator", "super_admin"];

export default async function CompetencyOfficeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles").eq("id", user.id).single();
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  // Dedicated org-role workspaces this user can switch into.
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Competency Office workspace is for competency coordinators, educators and governance leads.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2e38] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-teal-300/60 text-[10px] leading-tight">Competency Intelligence</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ label, href }) => (
            <Link key={label} href={href} className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/competency-office" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-bold text-sm leading-tight tracking-wide">COMPETEN</span>
              <span className="block text-teal-300/60 text-[9px] leading-tight">Competency Intelligence</span>
            </span>
          </Link>
          <div className="px-3 mb-2" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Competency Operations</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
            ))}

            <div className="px-3 mt-4 mb-1.5" data-sb-label>
              <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Quick Actions</span>
            </div>
            {QUICK_ACTIONS.map(({ label, href, icon, tint }) => (
              <Link key={label} href={href} data-sb-item title={label} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] shrink-0 ${tint}`}>{icon}</span>
                <span data-sb-label className="flex-1">{label}</span>
                <span data-sb-label className="text-teal-400/40">›</span>
              </Link>
            ))}

            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-xs font-bold">{profile?.full_name?.[0] ?? "C"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-amber-300/60 text-[10px]">Competency Intelligence</p>
              </div>
            </div>
            {(userRoles.length > 1 || workspaces.length > 0) && <div className="mb-2" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} /></div>}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/50 hover:bg-teal-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span><span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
