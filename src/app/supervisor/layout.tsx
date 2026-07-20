import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";

// Shift Command Centre (SSW-001) — the real-time operational command surface for
// a clinical shift, organised into the six+ operational domains a supervisor
// actually works in. Role-scoped to operational coordinators (charge nurse /
// shift supervisor = assessor tier, and admins). Items link to live surfaces;
// capabilities without a built surface yet are shown muted ("soon") rather than
// as dead links.
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean };
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: "Shift Command", items: [
    { label: "Dashboard",          href: "/supervisor",                            icon: "🖥️", exact: true },
    { label: "Current Shift",      href: "/supervisor/current-shift",              icon: "🩺" },
    { label: "Today's Priorities", href: "/supervisor/priorities",                icon: "⚠️" },
    { label: "Shift Timeline",     href: "/supervisor/timeline",                  icon: "🕑" },
  ]},
  { group: "Patient Operations", items: [
    { label: "Patient Ops Dashboard",     href: "/supervisor/patient-ops",         icon: "📊" },
    { label: "Patient Census",            href: "/supervisor/patient-list",        icon: "👤" },
    { label: "Patient Shift Management",  href: "/supervisor/patient-shift",       icon: "🔁" },
    { label: "Patient Flow",              href: "/supervisor/patient-flow",        icon: "🔀" },
    { label: "Clinical Safety",           href: "/supervisor/clinical-safety",     icon: "🛡️" },
    { label: "Bed & Capacity",            href: "/supervisor/bed-management",       icon: "🛏️" },
    { label: "Ward Map",                  href: "/supervisor/ward-map",            icon: "🗺️" },
    { label: "Patient Operations Center", href: "/supervisor/patient-ops-center",  icon: "🗂️" },
  ]},
  { group: "Workforce Operations", items: [
    { label: "Assignments",        href: "/supervisor/operations?section=assignments", icon: "🧩" },
    { label: "Roster & Attendance", href: "/supervisor/operations?section=shifts", icon: "📋" },
    { label: "Skill Mix",          href: "/supervisor#workforce",                  icon: "👥" },
    { label: "Breaks",             icon: "☕", soon: true },
    { label: "Competencies",       icon: "🎖️", soon: true },
  ]},
  { group: "Task Centre", items: [
    { label: "Tasks",              href: "/supervisor/operations?section=care",    icon: "✅" },
    { label: "Escalations",        href: "/supervisor/operations?section=safety",  icon: "⬆️" },
    { label: "Incidents",          href: "/supervisor/operations?section=safety",  icon: "🚩" },
    { label: "Approvals",          icon: "⚖️", soon: true },
    { label: "Handover",           href: "/supervisor/handover",                   icon: "🔄" },
  ]},
  { group: "Communication", items: [
    { label: "Messages",           href: "/supervisor/communication",              icon: "💬" },
    { label: "Announcements",      icon: "📣", soon: true },
    { label: "Calls",              icon: "📞", soon: true },
  ]},
  { group: "Analytics", items: [
    { label: "Live Metrics",       href: "/supervisor#performance",                icon: "📊" },
    { label: "Shift Performance",  href: "/supervisor#performance",                icon: "📈" },
    { label: "Quality Indicators", href: "/supervisor/analytics",                  icon: "🎯" },
  ]},
  { group: "AI & Intelligence", items: [
    { label: "Operational Copilot", href: "/supervisor#copilot",                   icon: "✨" },
    { label: "Recommendations",    href: "/supervisor/ai",                         icon: "💡" },
    { label: "Predictions",        icon: "🔮", soon: true },
  ]},
  { group: "Tools & Settings", items: [
    { label: "Ward Configuration", href: "/supervisor/settings",                   icon: "🛠️" },
    { label: "Support",            href: "mailto:gabriel@semacast.com?subject=Shift Command Centre support", icon: "🎧" },
  ]},
];

const ALLOWED = ["assessor", "hospital_admin", "super_admin"];
const linkCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors";
const activeCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-teal-700/60 text-white font-medium";

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
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
          <p className="text-gray-400 text-sm mt-1">The Shift Command Centre is for charge nurses, shift supervisors and managers.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Flat list of real (non-soon) destinations for the mobile pill bar, deduped by href.
  const mobileItems = [...new Map(NAV_GROUPS.flatMap(g => g.items).filter(i => i.href && !i.soon && !i.href.startsWith("mailto")).map(i => [i.href, i] as const)).values()];

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2e38] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-teal-300/60 text-[10px] leading-tight">Shift Command Centre</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileItems.map(({ label, href }) => (
            <Link key={href} href={href!} className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/supervisor" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
              <span className="block text-teal-300/60 text-[9px] leading-tight">Shift Command Centre</span>
            </span>
          </Link>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({ group, items }) => {
              const nodes = items.map(({ label, href, icon, exact, soon }) => soon || !href ? (
                <span key={label} title={label} data-sb-item
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/25 cursor-default select-none">
                  <span className="w-5 text-center text-sm leading-none opacity-60">{icon}</span>
                  <span className="flex-1" data-sb-label>{label}</span>
                  <span className="text-[8px] font-bold uppercase tracking-wider bg-teal-950 text-teal-400/40 rounded px-1 py-0.5" data-sb-label>soon</span>
                </span>
              ) : href.startsWith("mailto") ? (
                <a key={label} href={href} data-sb-item title={label} className={linkCls}>
                  <span className="w-5 text-center text-sm leading-none">{icon}</span>
                  <span data-sb-label>{label}</span>
                </a>
              ) : (
                <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                  className={linkCls} activeClassName={activeCls} />
              ));
              return (
                <NavGroup key={group} title={group} hrefs={items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                  headerClass="text-[9px] font-bold uppercase tracking-widest text-teal-400/50">{nodes}</NavGroup>
              );
            })}
            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-xs font-bold">{profile?.full_name?.[0] ?? "S"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-amber-300/60 text-[10px]">Shift Supervisor</p>
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
