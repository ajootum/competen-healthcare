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
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: string };

// Standalone landing (SSW-001-R2 Ch.4) — the executive overview.
const DASHBOARD: NavItem = { label: "Dashboard", href: "/supervisor", icon: "🏠", exact: true };

// SSW-001 Revision 2.0 navigation hierarchy (Ch.3–13). Nine operational domains
// in clinical-workflow order — shift control → patients → workforce → tasks →
// communication → safety → analytics → decision support → configuration. Items
// map to live surfaces; capabilities without a built surface yet are shown muted
// ("soon") rather than as dead links.
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: "Shift Command", items: [
    { label: "Shift Dashboard",   href: "/supervisor/shift-operations",            icon: "🖥️" },
    { label: "Handover Centre",   href: "/supervisor/handover",                    icon: "🔄", badge: "handover" },
    { label: "Escalation Centre", href: "/supervisor/operations?section=safety",   icon: "⬆️", badge: "escalations" },
    { label: "Shift Analytics",   href: "/supervisor/analytics",                   icon: "📈" },
  ]},
  { group: "Patient Operations", items: [
    { label: "Patient Operations Dashboard", href: "/supervisor/patient-ops",         icon: "📊" },
    { label: "Patient Census",               href: "/supervisor/patient-list",        icon: "👤" },
    { label: "Patient Flow",                 href: "/supervisor/patient-flow",        icon: "🔀" },
    { label: "Bed & Capacity",               href: "/supervisor/bed-management",       icon: "🛏️" },
    { label: "Ward Map",                     href: "/supervisor/ward-map",            icon: "🗺️" },
    { label: "Patient Operations Centre",    href: "/supervisor/patient-ops-center",  icon: "🗂️" },
    { label: "Clinical Safety",              href: "/supervisor/clinical-safety",     icon: "🛡️" },
    { label: "Patient Cards",                href: "/supervisor/patient-list",        icon: "🪪" },
  ]},
  { group: "Workforce Operations", items: [
    { label: "Staffing Allocation",  href: "/supervisor/workforce-operations",        icon: "👥" },
    { label: "Team Assignments",     href: "/supervisor/operations?section=assignments", icon: "🧩" },
    { label: "Competency Readiness", href: "/supervisor/workforce-operations",        icon: "🎖️" },
    { label: "Break Management",     icon: "☕", soon: true },
    { label: "Supervisor Notes",     icon: "🗒️", soon: true },
  ]},
  { group: "Task Centre", items: [
    { label: "Task Assignment",   href: "/supervisor/task-center",                icon: "✅" },
    { label: "Outstanding Tasks", href: "/supervisor/operations?section=care",    icon: "📋", badge: "openTasks" },
    { label: "Critical Tasks",    href: "/supervisor/task-center",                icon: "🔴", badge: "criticalTasks" },
    { label: "Completed Tasks",   href: "/supervisor/task-center",                icon: "✔️" },
    { label: "Task Rules",        icon: "⚙️", soon: true },
  ]},
  { group: "Communication", items: [
    { label: "Team Communications", href: "/supervisor/communication",            icon: "💬", badge: "unread" },
    { label: "Broadcast Centre",    icon: "📣", soon: true },
    { label: "Messages",            href: "/supervisor/communication",            icon: "✉️", badge: "unread" },
  ]},
  { group: "Quality, Safety & Escalation", items: [
    { label: "Safety Dashboard",       href: "/supervisor/clinical-safety",           icon: "🛡️", badge: "safety" },
    { label: "Incident Reporting",     href: "/supervisor/operations?section=safety", icon: "🚩" },
    { label: "Observation Compliance", href: "/supervisor/operations?section=safety", icon: "📋", badge: "overdueObs" },
    { label: "Escalation Tracking",    href: "/supervisor/operations?section=safety", icon: "⬆️", badge: "escalations" },
    { label: "Quality Audits",         icon: "🔍", soon: true },
    { label: "Improvement Actions",    icon: "⚡", soon: true },
  ]},
  { group: "Analytics", items: [
    { label: "Shift Performance",       href: "/supervisor/analytics",             icon: "📈" },
    { label: "Patient Flow Analytics",  href: "/supervisor/analytics",             icon: "🔀" },
    { label: "Workforce Analytics",     href: "/supervisor/analytics",             icon: "👥" },
    { label: "Safety Analytics",        href: "/supervisor/analytics",             icon: "🛡️" },
    { label: "Operational Reports",     icon: "📄", soon: true },
  ]},
  { group: "AI & Intelligence", items: [
    { label: "Shift AI Copilot",          href: "/supervisor/ai",                  icon: "✨" },
    { label: "Staffing Intelligence",     href: "/supervisor/ai",                  icon: "🧠" },
    { label: "Patient Flow Intelligence", icon: "🔮", soon: true },
    { label: "Safety Intelligence",       href: "/supervisor/ai",                  icon: "🛰️" },
    { label: "Predictive Intelligence",   icon: "📡", soon: true },
    { label: "Executive Insights",        icon: "📊", soon: true },
  ]},
  { group: "Tools & Settings", items: [
    { label: "Workspace Settings", href: "/supervisor/settings",                   icon: "⚙️" },
    { label: "Shift Templates",    icon: "📄", soon: true },
    { label: "Professional Tools", icon: "🛠️", soon: true },
    { label: "Reports & Export",   icon: "📤", soon: true },
    { label: "Notifications",      icon: "🔔", soon: true },
    { label: "Administration",     icon: "🏛️", soon: true },
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
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
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

  // ── Live nav badges / unread counts (SSW-001-R2 Ch.14) ──────────────────────
  // Hospital-scoped counts feeding the sidebar attention chips. Fail-soft: any
  // query error (e.g. pre-migration) resolves to 0, so the nav never breaks.
  const bSuper = userRoles.includes("super_admin");
  const bHid = (profile as any)?.hospital_id ?? null;
  const bNONE = "00000000-0000-0000-0000-000000000000";
  const bScope = (q: any) => (bSuper ? q : q.eq("hospital_id", bHid ?? bNONE));
  const bNum = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const OPEN_TASK = "(completed,verified,cancelled)";
  const [unreadRes, escRes, taskRes, critRes, safetyRes, obsRes, handRes] = await Promise.all([
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
    bScope(admin.from("op_escalations").select("id", { count: "exact", head: true })).in("status", ["open", "acknowledged"]),
    bScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).not("status", "in", OPEN_TASK),
    bScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).eq("priority", "urgent").not("status", "in", OPEN_TASK),
    bScope(admin.from("op_safety_alerts").select("id", { count: "exact", head: true })).eq("active", true),
    bScope(admin.from("op_observations").select("id", { count: "exact", head: true })).eq("status", "overdue"),
    bScope(admin.from("op_handovers").select("status").order("created_at", { ascending: false }).limit(1)),
  ]);
  const badges: Record<string, number> = {
    unread: bNum(unreadRes), escalations: bNum(escRes), openTasks: bNum(taskRes),
    criticalTasks: bNum(critRes), safety: bNum(safetyRes), overdueObs: bNum(obsRes),
    handover: (!handRes.error && handRes.data?.[0] && handRes.data[0].status !== "accepted") ? 1 : 0,
  };
  const groupBadge = (items: NavItem[]) =>
    [...new Set(items.filter(i => i.href && !i.soon && i.badge).map(i => i.badge!))].reduce((n, k) => n + (badges[k] ?? 0), 0);

  // Flat list of real (non-soon) destinations for the mobile pill bar, deduped by href.
  const mobileItems = [...new Map([DASHBOARD, ...NAV_GROUPS.flatMap(g => g.items)].filter(i => i.href && !i.soon && !i.href.startsWith("mailto")).map(i => [i.href, i] as const)).values()];

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
            <NavLink href={DASHBOARD.href!} icon={DASHBOARD.icon} label={DASHBOARD.label} exact={DASHBOARD.exact}
              className={linkCls} activeClassName={activeCls} />
            <div className="my-1.5 border-t border-teal-800/30" />
            {NAV_GROUPS.map(({ group, items }) => {
              const nodes = items.map(({ label, href, icon, exact, soon, badge }) => soon || !href ? (
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
                  badge={badge ? badges[badge] : undefined}
                  className={linkCls} activeClassName={activeCls} />
              ));
              return (
                <NavGroup key={group} title={group} hrefs={items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                  badge={groupBadge(items)}
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
