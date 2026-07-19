import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { ORG_ROLE_CONFIG, type AppRole, type OrgRole } from "@/lib/roles";

// Assessor Workspace sidebar — Assessment Operations Centre structure
// (Enterprise Assessor Workspace V2 mockup). Items whose module doesn't exist
// yet render as muted "soon" rows — visible structure, no dead links. Some
// entries open in the clinician shell; Hospital Dashboard is role-gated.
type NavItem = { label: string; href?: string; icon: string; badge?: "queue" | "logbook" | "unread"; soon?: boolean; adminOnly?: boolean };
const NAV_GROUPS: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [
    { label: "Dashboard",              href: "/assessor",                   icon: "🏠" },
    { label: "Notifications",          href: "/assessor/notifications",     icon: "🔔", badge: "unread" },
  ]},
  { group: "Assessment Management", items: [
    { label: "Assessment Inbox",       href: "/assessor/queue",             icon: "📥", badge: "queue" },
    { label: "Learners",               href: "/assessor/nurses",            icon: "👩‍⚕️" },
    { label: "Assessment Schedule",    href: "/assessor/schedule",          icon: "🗓️" },
    { label: "Assessment Calendar",    href: "/assessor/calendar",          icon: "📅" },
  ]},
  { group: "Competency & Evidence", items: [
    { label: "Assessment Frameworks",  href: "/assessor/frameworks",        icon: "🗂️" },
    { label: "Evidence Validation",    href: "/assessor/logbook",           icon: "🖊️", badge: "logbook" },
    { label: "Competency Passport Centre", href: "/assessor/passports",     icon: "🛂" },
  ]},
  { group: "Assessment Activities", items: [
    { label: "Conduct Assessment",     href: "/assessor/assess",            icon: "📝" },
    { label: "OSCE Centre",            href: "/assessor/osce",              icon: "🩺" },
    { label: "Simulation Centre",      href: "/assessor/simulation",        icon: "🧪" },
  ]},
  { group: "Quality & Governance", items: [
    { label: "Live Quality Monitor",   href: "/assessor/quality",               icon: "📈" },
    { label: "Concurrent Reviews",     href: "/assessor/quality/concurrent",    icon: "📋" },
    { label: "Retrospective Reviews",  href: "/assessor/quality/retrospective", icon: "🗂️" },
    { label: "Clinical Audits",        href: "/assessor/quality/clinical",      icon: "🩹" },
    { label: "Improvement Actions",    href: "/assessor/quality/capa",          icon: "🛠️" },
    { label: "Quality Indicators",     href: "/assessor/quality/indicators",    icon: "📐" },
    { label: "Compliance Dashboard",   href: "/admin/dashboard",                icon: "🛡️", adminOnly: true },
    { label: "Audit Library",          href: "/assessor/quality/library",       icon: "📚" },
  ]},
  { group: "Analytics & Reports", items: [
    { label: "Assessment Dashboard",   href: "/assessor/reports",               icon: "📊" },
    { label: "Learner Performance",    href: "/assessor/reports/learners",      icon: "👩‍⚕️" },
    { label: "Competency Analytics",   href: "/assessor/reports/competencies",  icon: "🧩" },
    { label: "Assessment Quality",     href: "/assessor/reports/quality",       icon: "🎖️" },
    { label: "Evidence Analytics",     href: "/assessor/reports/evidence",      icon: "🖇️" },
    { label: "Productivity & Workload", href: "/assessor/reports/productivity", icon: "⚡" },
    { label: "Risk & Remediation",     href: "/assessor/remediation",           icon: "🎯" },
    { label: "Department Reports",     href: "/assessor/reports/departments",   icon: "🏥" },
    { label: "Benchmarking",           href: "/assessor/reports/benchmarking",  icon: "⚖️" },
    { label: "Workforce Intelligence", href: "/assessor/reports/workforce",     icon: "🔮" },
    { label: "Report Builder",         href: "/assessor/reports/builder",       icon: "🧱" },
    { label: "Report Library",         href: "/assessor/history",               icon: "📁" },
    { label: "Scheduled Reports",      href: "/assessor/reports/scheduled",     icon: "⏰" },
  ]},
  { group: "AI & Intelligence", items: [
    { label: "AI Assessment Copilot",  href: "/assessor/ai/copilot",        icon: "✨" },
    { label: "Assessment Insights",    href: "/assessor/ai/insights",       icon: "💡" },
    { label: "Competency Intelligence", href: "/assessor/ai/competency",    icon: "🧠" },
    { label: "Risk Engine",            href: "/assessor/ai/risk",           icon: "📡" },
    { label: "Learner Intelligence",   href: "/assessor/ai/learner",        icon: "🧬" },
    { label: "Workforce Intelligence", href: "/assessor/reports/workforce", icon: "🔮" },
    { label: "Knowledge Hub",          href: "/assessor/ai/knowledge",      icon: "🔬" },
    { label: "AI Report Writer",       href: "/assessor/ai/report-writer",  icon: "📄" },
    { label: "Learning Recommendations", href: "/assessor/ai/learning",     icon: "🎓" },
    { label: "AI Automation Centre",   href: "/assessor/ai/automation",     icon: "⚙️" },
    { label: "Simulation Intelligence", href: "/assessor/ai/simulation",    icon: "🧪" },
    { label: "AI Assistant History",   href: "/assessor/ai/history",        icon: "🕘" },
  ]},
  { group: "Administration", items: [
    { label: "Assessment Studio",      href: "/assessor/studio",            icon: "🎛️" },
    { label: "Settings",               href: "/dashboard/billing",          icon: "⚙️" },
  ]},
];

export default async function AssessorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("full_name, role, roles, avatar_url")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  const { data: orgProfile, error: orgError } = await adminClient
    .from("profiles")
    .select("org_role")
    .eq("id", user.id)
    .returns<{ org_role: string | null }[]>()
    .maybeSingle();
  const orgRole = (!orgError && orgProfile ? orgProfile.org_role as OrgRole : null) ?? null;

  if (!userRoles.includes("assessor")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Assessor access only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for clinical assessors and supervisors.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Live counters for the sidebar badges (all real, fail-soft to 0).
  const [{ count: queueCount }, { count: logbookCount }, { count: unreadCount }] = await Promise.all([
    adminClient.from("assessments").select("id", { count: "exact", head: true })
      .eq("assessor_id", user.id).in("status", ["pending", "in_progress"]),
    adminClient.from("skill_log_entries").select("id", { count: "exact", head: true })
      .eq("status", "pending").neq("nurse_id", user.id),
    adminClient.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("read", false),
  ]);
  const badgeValue = { queue: queueCount ?? 0, logbook: logbookCount ?? 0, unread: unreadCount ?? 0 };

  const orgRoleCfg = orgRole ? ORG_ROLE_CONFIG[orgRole] : null;
  const portalLabel = orgRoleCfg?.label ?? "Assessor";

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      {/* Mobile top bar with horizontally scrollable nav — the desktop rail is hidden below md. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0f172a] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <WorkspaceSwitcher roles={userRoles} activeRole="assessor" variant="mobile" />
          </span>
          <span className="flex-1" />
          <Link href="/assessor/notifications" aria-label="Notifications" className="relative w-9 h-9 rounded-lg flex items-center justify-center text-base">
            🔔
            {badgeValue.unread > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center">
                {badgeValue.unread > 99 ? "99+" : badgeValue.unread}
              </span>
            )}
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV_GROUPS.flatMap(g => g.items)
            .filter(i => i.href && !i.soon && (!i.adminOnly || userRoles.includes("hospital_admin")))
            .map(({ label, href, badge }) => (
            <Link key={label} href={href!}
              className="shrink-0 text-[11px] text-indigo-100/80 bg-indigo-900/40 hover:bg-indigo-800/60 rounded-full px-3 py-1 transition-colors">
              {label}{badge && badgeValue[badge] > 0 ? ` (${badgeValue[badge]})` : ""}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-60 h-screen bg-[#0f172a] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/assessor" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-bold text-sm leading-tight tracking-wide">COMPETEN</span>
              <span className="block text-indigo-300/60 text-[9px] leading-tight">Competency Management Platform</span>
            </span>
          </Link>
          <div data-sb-label><WorkspaceSwitcher roles={userRoles} activeRole="assessor" /></div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({ group, items }) => (
              <div key={group ?? "root"} className="flex flex-col gap-0.5">
                {group && <p className="px-3 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-indigo-400/50" data-sb-label>{group}</p>}
                {items.filter(i => !i.adminOnly || userRoles.includes("hospital_admin")).map(({ label, href, icon, badge, soon }) => soon || !href ? (
                  <span key={label} title={label} data-sb-item
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-slate-600 cursor-default select-none">
                    <span className="w-5 text-center text-sm leading-none opacity-50">{icon}</span>
                    <span className="flex-1" data-sb-label>{label}</span>
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-slate-800 text-slate-500 rounded px-1 py-0.5" data-sb-label>soon</span>
                  </span>
                ) : (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/assessor"}
                    badge={badge ? badgeValue[badge] : undefined}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-slate-400 hover:bg-indigo-900/40 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-indigo-900/60 text-white font-medium" />
                ))}
              </div>
            ))}
          </nav>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-indigo-800" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                  {profile?.full_name?.[0] ?? "A"}
                </div>
              )}
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-indigo-300/60 text-[10px]">{portalLabel}</p>
              </div>
            </div>
            <div className="mb-2" data-sb-label>
              <WorkspaceSwitcher roles={userRoles} activeRole="assessor" variant="footer" />
            </div>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main data-content className="flex-1 md:ml-60 px-4 md:px-6 pt-24 md:pt-8 pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
