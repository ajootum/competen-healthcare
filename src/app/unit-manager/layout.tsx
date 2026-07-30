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
  "Administration & Configuration": "unit-manager.admin",
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
  { title: "Platform Engines", items: [
    { label: "Workforce Planning Studio", href: "/unit-manager/planning-studio", icon: "🏗️" },
    { label: "Unit Workforce Planning",  href: "/unit-manager/workforce-management/establishment", icon: "📐" },
    { label: "AI Scheduling Engine",     href: "/unit-manager/scheduling-engine", icon: "🗓️" },
    { label: "Competency Engine",        href: "/unit-manager/competency", icon: "🎯" },
    // Workforce analytics = WFM-008 Analytics & Reports; intelligence = the rule-based Workforce
    // Intelligence Engine (risk / gaps / deployment recommendations over the live workforce).
    { label: "Workforce Analytics Engine",   href: "/unit-manager/workforce-management/analytics", icon: "📊" },
    { label: "Workforce Intelligence Engine", href: "/unit-manager/workforce-intelligence", icon: "🧠" },
  ] },
  { title: "Unit Command", items: [
    { label: "Overview Dashboard",      href: "/unit-manager",                       icon: "📊", exact: true },
    { label: "Unit Operations Centre",  href: "/unit-manager/operations-centre",     icon: "🎛️" },
    { label: "Shift Intelligence",      href: "/unit-manager/shift-intelligence",    icon: "🧭" },
    { label: "Executive Actions",       href: "/unit-manager/action-centre",         icon: "✅" },
  ] },
  // Workforce Management (UMW-WFM-001..009) — section COMPLETE: all ten modules
  // are live. Keep in sync with WfmTabs.tsx (the in-page section tab bar).
  { title: "Workforce Management", items: [
    { label: "Overview",                 href: "/unit-manager/workforce-management", icon: "👥", exact: true },
    { label: "Unit Workforce Planning",  href: "/unit-manager/workforce-management/establishment", icon: "📐" },
    { label: "Staffing Engine",          href: "/unit-manager/workforce-management/staffing-engine", icon: "🧑‍⚕️" },
    { label: "Team Assignments",         href: "/unit-manager/workforce-management/team-assignments", icon: "🧩" },
    { label: "Roster Governance",        href: "/unit-manager/workforce-management/roster-governance", icon: "🗓️" },
    { label: "Availability & Attendance", href: "/unit-manager/workforce-management/attendance", icon: "📋" },
    { label: "Exceptions & Approvals",   href: "/unit-manager/workforce-management/exceptions-approvals", icon: "⚖️" },
    { label: "Development & Readiness",   href: "/unit-manager/workforce-management/development", icon: "🎯" },
    { label: "Analytics & Reports",      href: "/unit-manager/workforce-management/analytics", icon: "📊" },
    { label: "Configuration",            href: "/unit-manager/workforce-management/configuration", icon: "🔧" },
  ] },
  // Patient Operations Platform (POS-001) — the operational source of truth. Primary
  // surfaces here; the full twelve modules are the in-page tab bar (PosTabs).
  { title: "Patient Operations", items: [
    { label: "Dashboard",         href: "/unit-manager/patient-operations", icon: "📊", exact: true },
    { label: "Census & Registry", href: "/unit-manager/patient-operations/census", icon: "🧑‍🤝‍🧑" },
    { label: "Patient Flow",      href: "/unit-manager/patient-operations/flow", icon: "🔄" },
    { label: "Bed & Capacity",    href: "/unit-manager/patient-operations/beds", icon: "🛏️" },
    { label: "Ward Map",          href: "/unit-manager/patient-operations/ward-map", icon: "🗺️" },
    { label: "Governance",        href: "/unit-manager/patient-operations/governance", icon: "🛡️" },
    { label: "Clinical Safety",   href: "/unit-manager/patient-operations/safety", icon: "🚨" },
    { label: "Patient Card",      href: "/unit-manager/patient-operations/patient-card", icon: "🪪" },
    { label: "Timeline",          href: "/unit-manager/patient-operations/timeline", icon: "🕐" },
    { label: "Analytics",         href: "/unit-manager/patient-operations/analytics", icon: "📈" },
  ] },
  // Competency Management (UMG-CM) — the unit-scoped manager lens: a Command Centre + dedicated Coverage,
  // Expiries and Delivered-Assignments surfaces over the real competency system. Deep org-wide governance
  // (analytics / credentialing / frameworks) still cross-links to the Competency Office (managers are in-scope).
  { title: "Competency Management", items: [
    { label: "Command Centre",        href: "/unit-manager/competency",   icon: "🎯", exact: true },
    { label: "Coverage & Gaps",       href: "/unit-manager/competency/coverage", icon: "📊" },
    { label: "Expiries & Recert",     href: "/unit-manager/competency/recertification", icon: "⏳" },
    { label: "Delivered Assignments", href: "/unit-manager/competency/assignments", icon: "📬" },
    { label: "Validation Queue",      href: "/unit-manager/competency-validations", icon: "🗂️" },
    { label: "Assessment Status",     href: "/unit-manager/assessment",    icon: "📝" },
    { label: "Competency Analytics",  href: "/competency-office/analytics", icon: "📈" },
    { label: "Credentialing",         href: "/competency-office/credentialing", icon: "🎓" },
    { label: "Frameworks",            href: "/competency-office/frameworks", icon: "🧩" },
  ] },
  { title: "Learning & Development", items: [
    { label: "Learning Dashboard",   href: "/unit-manager/learning", icon: "📚", exact: true },
    { label: "Mandatory Learning",   href: "/unit-manager/learning/mandatory", icon: "📌" },
    { label: "Professional Development", href: "/unit-manager/learning/development", icon: "🚀" },
    { label: "Career Pathways",      href: "/unit-manager/learning/pathways", icon: "🧗" },
    { label: "Education Planning",   href: "/unit-manager/learning/schedule", icon: "🗓️" },
    { label: "Learning Analytics",   href: "/unit-manager/learning/analytics", icon: "📊" },
  ] },
  // Quality & Safety (UMG-QS-001..011) — the Command Centre is the real exec dashboard (consolidation over
  // op_incidents / op_quality_actions / audits / gov_risks / quality_indicators). Sub-modules route to their
  // authoritative surface: CAPA → the CAPA Centre, Patient Safety → the Clinical Safety centre (both real),
  // the rest via the section's honest cross-link pages. Full module list is the in-page tab bar (QualityTabs).
  // Quality & Safety (UMG-QS-001..011) — the full eleven-module command centre; labels
  // mirror the design + each module's page header. Exec Dashboard is exact-match so its
  // sub-modules don't all highlight it. CAPA + Patient Safety route to their authoritative
  // surfaces (/unit-manager/capa, /patient-operations/safety).
  { title: "Quality & Safety", items: [
    { label: "Executive Dashboard",     href: "/unit-manager/quality", icon: "🛡️", exact: true },
    { label: "Incident Management",     href: "/unit-manager/quality/incidents", icon: "🚩" },
    { label: "Audit & Compliance",      href: "/unit-manager/quality/audits", icon: "🔍" },
    { label: "CAPA & Improvement",      href: "/unit-manager/capa", icon: "📈" },
    { label: "Accreditation Readiness", href: "/unit-manager/quality/accreditation", icon: "🏅" },
    { label: "Risk Register",           href: "/unit-manager/quality/risk", icon: "⚠️" },
    { label: "Patient Safety Centre",   href: "/unit-manager/quality/patient-safety", icon: "🚑" },
    { label: "Clinical Indicators",     href: "/unit-manager/quality/indicators", icon: "📊" },
    { label: "Mortality & Morbidity",   href: "/unit-manager/quality/mortality", icon: "🩺" },
    { label: "Executive Command Centre", href: "/unit-manager/quality/analytics", icon: "📉" },
    { label: "AI Quality Intelligence", href: "/unit-manager/quality/ai", icon: "🤖" },
  ] },
  // UMW-OPC-001..011 Operational Command Centre (updated architecture: real-time command/coordination/execution;
  // AI & Config split out to UMW-AI / UMW-CFG). Command Dashboard is the real command-centre; other modules route
  // to their authoritative operational surface where one exists, else honest next-phase.
  { title: "Operational Command", items: [
    { label: "Command Dashboard",        href: "/unit-manager/ops-performance", icon: "🎛️" },        // OPC-001
    { label: "Live Unit Status",         href: "/unit-manager/ops-command/live-status", icon: "🏥" },  // OPC-002
    { label: "Capacity & Bed Coordination", href: "/unit-manager/ops-command/capacity", icon: "🛏️" },  // OPC-003
    { label: "Staffing & Assignment Oversight", href: "/unit-manager/ops-command/staffing", icon: "🧑‍⚕️" }, // OPC-004
    { label: "Patient Flow Coordination", href: "/unit-manager/ops-command/patient-flow", icon: "🔄" }, // OPC-005
    { label: "Safety & Escalation",      href: "/unit-manager/ops-command/safety", icon: "🚨" },        // OPC-006
    { label: "Operational Action Manager", href: "/unit-manager/ops-command/actions", icon: "✅" },     // OPC-007
    { label: "Shift Timeline & Handover", href: "/unit-manager/ops-command/handover", icon: "🕒" },     // OPC-008
    { label: "Operational Forecasting",  href: "/unit-manager/ops-command/forecasting", icon: "🔮" },   // OPC-009
    { label: "Operations Config & Rules", href: "/unit-manager/ops-command/config-rules", icon: "⚙️" }, // OPC-010 (→ UMW-CFG)
    { label: "Audit, Reporting & Analytics", href: "/unit-manager/ops-command/analytics", icon: "📉" }, // OPC-011
  ] },
  // UMW-PA-001..009 Performance Analytics — metadata-driven KPI + balanced-scorecard + benchmark analytics over the
  // performance stores (migration 108); operational KPIs resolve live from op_ops_snapshots.
  { title: "Performance Analytics", items: [
    { label: "Unit Performance Dashboard", href: "/unit-manager/performance", icon: "📊", exact: true }, // PA-001
    { label: "KPI & Scorecard Centre",     href: "/unit-manager/performance/scorecard", icon: "🎯" },    // PA-002
    { label: "Trends & Benchmarking",      href: "/unit-manager/performance/trends", icon: "📈" },        // PA-003
    { label: "Workforce Analytics",        href: "/unit-manager/performance/workforce", icon: "👥" },     // PA-004
    { label: "Operational Analytics",      href: "/unit-manager/performance/operational", icon: "⚙️" },   // PA-005
    { label: "Financial Analytics",        href: "/unit-manager/performance/financial", icon: "💷" },     // PA-006
    { label: "Predictive & AI Intelligence", href: "/unit-manager/performance/predictive", icon: "🔮" }, // PA-007
    { label: "Executive Reporting & Governance", href: "/unit-manager/performance/reporting", icon: "🧾" }, // PA-008
    { label: "Performance Configuration",  href: "/unit-manager/performance/configuration", icon: "🔧" }, // PA-009
  ] },
  // AI & Intelligence (UMG-AI) — the Command Centre + Executive Recommendations are the unit-scoped cross-domain
  // hub (consolidated signals + live copilot); the per-domain intelligence lenses route to their authoritative
  // surfaces (ops performance, workforce intelligence engine, patient analytics, quality AI, predictive) rather
  // than being duplicated.
  { title: "AI & Intelligence", items: [
    { label: "AI Command Centre",         href: "/unit-manager/ai", icon: "✨", exact: true },
    { label: "Executive Recommendations", href: "/unit-manager/ai/recommendations", icon: "💡" },
    { label: "Operational Intelligence",  href: "/unit-manager/ops-performance", icon: "🧠" },
    { label: "Workforce Intelligence",    href: "/unit-manager/workforce-intelligence", icon: "👥" },
    { label: "Patient Intelligence",      href: "/unit-manager/patient-operations/analytics", icon: "🩺" },
    { label: "Quality Intelligence",      href: "/unit-manager/quality/ai", icon: "🛡️" },
    { label: "Predictive Analytics",      href: "/unit-manager/performance/predictive", icon: "🔮" },
  ] },
  // UMW-ADM-001..009 Administration & Configuration — no-code unit admin over adm_* stores (migrations 109/110),
  // reusing op_beds / departments / positions / break_glass for structure & governance.
  { title: "Administration & Configuration", items: [
    { label: "Admin Dashboard",       href: "/unit-manager/administration", icon: "🗂️", exact: true },        // ADM-001
    { label: "Unit Structure",        href: "/unit-manager/administration/structure", icon: "🏛️" },           // ADM-002
    { label: "Policies & Documents",  href: "/unit-manager/administration/documents", icon: "📄" },            // ADM-003
    { label: "Resources & Assets",    href: "/unit-manager/administration/assets", icon: "🖥️" },              // ADM-004
    { label: "Forms & Registers",     href: "/unit-manager/administration/forms", icon: "📋" },                // ADM-005
    { label: "Configuration Centre",  href: "/unit-manager/administration/configuration", icon: "🔧" },        // ADM-006
    { label: "Permissions & Governance", href: "/unit-manager/administration/governance", icon: "🛡️" },       // ADM-007
    { label: "Audit & Change Management", href: "/unit-manager/administration/change", icon: "🕓" },           // ADM-008
    { label: "AI Administration Assistant", href: "/unit-manager/administration/ai-assistant", icon: "🤖" },   // ADM-009
    { label: "Workspace Settings",    href: "/unit-manager/settings", icon: "⚙️" },
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
  // Dedupe destinations that intentionally appear in more than one nav group (e.g.
  // "Unit Workforce Planning" sits under both Platform Engines and Workforce Management)
  // — otherwise the flattened mobile bar renders duplicate pills with colliding React keys.
  const mobileItems = visibleGroups.flatMap(g => g.items.filter(i => i.href))
    .filter((it, i, arr) => arr.findIndex(x => x.href === it.href) === i);

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
