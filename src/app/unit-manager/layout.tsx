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
import { loadConfigOverrides, isEnabled } from "@/lib/config/workspace-config";

// Workspace Configuration Engine (WCE-001) wiring — maps nav sections/modules to
// their config paths so a super-admin disabling one in the Designer removes it
// from this live sidebar. Sections not listed are always shown.
const SECTION_CFG: Record<string, string> = {
  "Unit Command": "unit-manager.unit-command",
  "Workforce Management": "unit-manager.workforce",
  "Patient Operations": "unit-manager.patient-operations",
  "Competency Management": "unit-manager.competency",
  "Learning & Development": "unit-manager.learning",
  "Quality & Safety": "unit-manager.quality",
  "Operations & Capacity": "unit-manager.operations-capacity",
  "Performance Analytics": "unit-manager.analytics",
  "AI & Intelligence": "unit-manager.ai",
  "Administration & Tools": "unit-manager.admin",
};
const ITEM_CFG: Record<string, string> = {
  "Unit Operations Centre": "unit-manager.unit-command.operations-centre",
  "Shift Intelligence": "unit-manager.unit-command.shift-intelligence",
  "Executive Actions": "unit-manager.unit-command.action-centre",
};

// Unit Manager Workspace (UMW-001) — operational & tactical management for a
// clinical unit: workforce readiness, competency compliance, staffing, quality,
// learning and assessments in one leadership workspace. Role-scoped to managers.

// UMW-001 workspace structure: 10 domain groups, each with sub-modules. Only the
// Unit Command modules (+ a few group landings that reuse an existing surface or
// the [section] placeholder) are live; every other sub-module is marked "soon"
// rather than shown as a dead link — honest about what is and isn't built.
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: number };
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Unit Command", items: [
    { label: "Overview Dashboard",      href: "/unit-manager",                       icon: "📊", exact: true },
    { label: "Unit Operations Centre",  href: "/unit-manager/operations-centre",     icon: "🎛️" },
    { label: "Shift Intelligence",      href: "/unit-manager/shift-intelligence",    icon: "🧭" },
    { label: "Executive Actions",       href: "/unit-manager/action-centre",         icon: "✅" },
  ] },
  { title: "Workforce Management", items: [
    { label: "Overview",             href: "/unit-manager/workforce-management", icon: "👥" },
    { label: "Staffing Engine",      href: "/unit-manager/workforce-management/staffing-engine", icon: "🧑‍⚕️" },
    { label: "Team Assignments",     href: "/unit-manager/workforce-management/team-assignments", icon: "🧩" },
    { label: "Roster & Scheduling",  icon: "🗓️", soon: true },
    { label: "Competency Readiness", icon: "🎯", soon: true },
    { label: "Break Management",     icon: "☕", soon: true },
    { label: "Supervisor Notes",     icon: "📝", soon: true },
    { label: "Analytics",            icon: "📊", soon: true },
  ] },
  { title: "Patient Operations", items: [
    { label: "Unit Census",     icon: "🧑‍🤝‍🧑", soon: true },
    { label: "Patient Flow",    icon: "🔄", soon: true },
    { label: "Bed & Capacity",  icon: "🛏️", soon: true },
    { label: "Ward Map",        icon: "🗺️", soon: true },
    { label: "Clinical Alerts", icon: "🚨", soon: true },
  ] },
  { title: "Competency Management", items: [
    { label: "Competency Dashboard", href: "/unit-manager/competency",   icon: "🪪" },
    { label: "Compliance",           icon: "✔️", soon: true },
    { label: "Credential Management", icon: "🎓", soon: true },
    { label: "Assessment Status",    href: "/unit-manager/assessment",    icon: "📝" },
    { label: "Validation Queue",     icon: "🗂️", soon: true },
    { label: "Competency Analytics", icon: "📊", soon: true },
    { label: "Competency Frameworks", icon: "🧩", soon: true },
  ] },
  { title: "Learning & Development", items: [
    { label: "Learning Dashboard",   href: "/unit-manager/learning", icon: "📚" },
    { label: "Mandatory Learning",   icon: "📌", soon: true },
    { label: "Professional Development", icon: "🚀", soon: true },
    { label: "Career Pathways",      icon: "🧗", soon: true },
    { label: "Education Planning",   icon: "🗓️", soon: true },
    { label: "Learning Analytics",   icon: "📊", soon: true },
  ] },
  { title: "Quality & Safety", items: [
    { label: "Quality Dashboard",    href: "/unit-manager/quality", icon: "🛡️" },
    { label: "Incidents",            icon: "🚩", soon: true },
    { label: "Audit Centre",         icon: "🔍", soon: true },
    { label: "Improvement Projects", icon: "📈", soon: true },
    { label: "Accreditation Readiness", icon: "🏅", soon: true },
    { label: "Risk Register",        icon: "⚠️", soon: true },
    { label: "Patient Safety",       icon: "🚑", soon: true },
  ] },
  { title: "Operations & Capacity", items: [
    { label: "Capacity Dashboard",   href: "/unit-manager/operations", icon: "🏥" },
    { label: "Equipment Readiness",  icon: "🩺", soon: true },
    { label: "Resource Management",  icon: "📦", soon: true },
    { label: "Stock & Consumables",  icon: "🧰", soon: true },
    { label: "Budget Monitoring",    href: "/unit-manager/budget", icon: "💷" },
    { label: "Operational Forecasting", icon: "🔮", soon: true },
    { label: "Service Continuity",   icon: "♻️", soon: true },
  ] },
  { title: "Performance Analytics", items: [
    { label: "Unit Scorecard",       icon: "🏆", soon: true },
    { label: "Workforce Analytics",  icon: "👥", soon: true },
    { label: "Clinical Analytics",   icon: "🩻", soon: true },
    { label: "Competency Analytics", icon: "🪪", soon: true },
    { label: "Financial Analytics",  icon: "💹", soon: true },
    { label: "Benchmarking",         icon: "📊", soon: true },
    { label: "Executive Reports",    href: "/unit-manager/reports", icon: "🧾" },
  ] },
  { title: "AI & Intelligence", items: [
    { label: "AI Unit Copilot",      href: "/unit-manager/ai", icon: "✨" },
    { label: "Operational Intelligence", icon: "🧠", soon: true },
    { label: "Workforce Intelligence", icon: "👥", soon: true },
    { label: "Patient Intelligence", icon: "🩺", soon: true },
    { label: "Quality Intelligence", icon: "🛡️", soon: true },
    { label: "Predictive Analytics", icon: "🔮", soon: true },
    { label: "Executive Recommendations", icon: "💡", soon: true },
  ] },
  { title: "Administration & Tools", items: [
    { label: "Team Communications",  icon: "💬", soon: true },
    { label: "Reports & Exports",    href: "/unit-manager/reports", icon: "🧾" },
    { label: "Policies & Documents", icon: "📄", soon: true },
    { label: "Templates & Forms",    icon: "🗒️", soon: true },
    { label: "Unit Configuration",   icon: "🔧", soon: true },
    { label: "Workspace Settings",   href: "/unit-manager/settings", icon: "⚙️" },
    { label: "Activity Log",         icon: "📜", soon: true },
  ] },
];

const ALLOWED = ["hospital_admin", "super_admin"];

export default async function UnitManagerLayout({ children }: { children: React.ReactNode }) {
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

  // WCE-001 runtime enforcement — hide any section/module a super-admin disabled
  // in the Workspace Configuration Engine Designer (published, resolved along the
  // hierarchy for this user's hospital/role). Fail-soft: no engine tables → all shown.
  const { rows: cfgRows } = await loadConfigOverrides(admin);
  const hid = (profile as { hospital_id?: string | null } | null)?.hospital_id ?? null;
  const cfgCtx = { hospitalId: hid, roles: userRoles as string[], userId: user.id };

  // Live "Clinical Alerts" badge — active safety alerts + open escalations for the
  // unit's hospital. Fail-soft: any query error → no badge. (UMW-003 mockup "(4)".)
  const NONE = "00000000-0000-0000-0000-000000000000";
  const isSuperUser = userRoles.includes("super_admin");
  const alertQ = admin.from("op_safety_alerts").select("id", { count: "exact", head: true }).eq("active", true);
  const escQ = admin.from("op_escalations").select("id", { count: "exact", head: true }).in("status", ["open", "acknowledged"]);
  const [safetyCnt, escCnt] = await Promise.all([
    isSuperUser ? alertQ : alertQ.eq("hospital_id", hid ?? NONE),
    isSuperUser ? escQ : escQ.eq("hospital_id", hid ?? NONE),
  ]);
  const clinicalAlerts = (safetyCnt.error ? 0 : safetyCnt.count ?? 0) + (escCnt.error ? 0 : escCnt.count ?? 0);

  const visibleGroups = NAV_GROUPS
    .filter(g => { const p = SECTION_CFG[g.title]; return !p || isEnabled(cfgRows, cfgCtx, p); })
    .map(g => ({ ...g, items: g.items
      .filter(it => { const p = ITEM_CFG[it.label]; return !p || isEnabled(cfgRows, cfgCtx, p); })
      .map(it => it.label === "Clinical Alerts" && clinicalAlerts ? { ...it, badge: clinicalAlerts } : it) }));
  const mobileItems = visibleGroups.flatMap(g => g.items.filter(i => i.href));

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Unit Manager workspace is for unit, ward and department managers.</p>
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
            <span className="block text-teal-300/60 text-[10px] leading-tight">Unit Manager</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileItems.map(({ label, href }) => (
            <Link key={label} href={href!} className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/unit-manager" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Unit Manager</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {visibleGroups.map(group => {
              const nodes = group.items.map(item => item.soon || !item.href ? (
                <span key={group.title + item.label} data-sb-item title={`${item.label}${item.badge ? "" : " · soon"}`}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm cursor-default select-none ${item.badge ? "text-teal-100/60" : "text-teal-100/25"}`}>
                  <span className="w-5 text-center text-sm">{item.icon}</span>
                  <span data-sb-label className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="text-[9px] font-bold bg-rose-500 text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{item.badge > 99 ? "99+" : item.badge}</span>
                  ) : (
                    <span data-sb-label className="text-[8px] font-bold uppercase tracking-wider bg-teal-950 text-teal-400/40 rounded px-1 py-0.5">soon</span>
                  )}
                </span>
              ) : (
                <NavLink key={group.title + item.label} href={item.href} icon={item.icon} label={item.label} exact={item.exact}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                  activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
              ));
              return (
                <NavGroup key={group.title} title={group.title}
                  hrefs={group.items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                  headerClass="text-[10px] font-bold uppercase tracking-wider text-teal-400/60">
                  {nodes}
                </NavGroup>
              );
            })}
            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-xs font-bold">{profile?.full_name?.[0] ?? "U"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-amber-300/60 text-[10px]">Unit Manager</p>
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
