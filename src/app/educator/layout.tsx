import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { type AppRole } from "@/lib/roles";

// Educator Workspace sidebar — enterprise education operations centre
// (Final Dashboard & Sidebar Enhancement Specification). Grouped navigation
// per the approved mockup; Education Studio and AI & Intelligence modules from
// the spec render as muted "soon" rows until their stores exist — visible
// structure, no dead links. Existing URLs preserved (/educator/courses,
// /questions, /students, /seniors, /library, /import).
type NavItem = { label: string; href?: string; icon: string; badge?: "queue" | "unread"; soon?: boolean };
const NAV_GROUPS: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [
    { label: "Dashboard",           href: "/educator",               icon: "🏠" },
    { label: "Notifications",       href: "/educator/notifications", icon: "🔔", badge: "unread" },
  ]},
  { group: "Validation Centre", items: [
    { label: "Pending Validation",  href: "/educator/validations",   icon: "✅", badge: "queue" },
    { label: "My Reviews",          href: "/educator/reviews",       icon: "🗳️" },
    { label: "Evidence Review",     href: "/educator/evidence",      icon: "🖇️" },
    { label: "Moderation Queue",    href: "/educator/moderation",    icon: "📋" },
    { label: "Escalations",         href: "/educator/escalations",   icon: "⬆️" },
    { label: "Passport Approvals",  href: "/educator/approvals",     icon: "🛂" },
    { label: "Quality Flags",       href: "/educator/quality-flags", icon: "🚩" },
    { label: "Validation Analytics", href: "/educator/validation-analytics", icon: "📐" },
  ]},
  { group: "Teach & Assess", items: [
    { label: "Teach & Assess",      href: "/educator/teach",         icon: "🎓" },
    { label: "Assessments",         href: "/educator/assessments",   icon: "📝" },
    { label: "Question Bank",       href: "/educator/questions",     icon: "❓" },
    { label: "Learning Resources",  href: "/educator/library",       icon: "🗂️" },
    { label: "CPD & Courses",       href: "/educator/courses",       icon: "📚" },
    { label: "Simulation Scenarios", href: "/educator/simulation",   icon: "🧪" },
  ]},
  { group: "Learner Support", items: [
    { label: "Learner Success Dashboard", href: "/educator/support",  icon: "🏠" },
    { label: "Learner Directory",   href: "/educator/students",      icon: "👩‍⚕️" },
    { label: "Learner Profiles",    href: "/educator/profiles",      icon: "🧬" },
    { label: "Progress Monitoring", href: "/educator/progress",      icon: "📈" },
    { label: "At-Risk Learners",    href: "/educator/at-risk",       icon: "⚠️" },
    { label: "Learning Plans",      href: "/educator/plans",         icon: "🎓" },
    { label: "Coaching Sessions",   href: "/educator/coaching",      icon: "🗓️" },
    { label: "Interventions",       href: "/educator/interventions", icon: "🎯" },
    { label: "Feedback & Comments", href: "/educator/feedback",      icon: "💬" },
    { label: "Senior Assessor Reviews", href: "/educator/seniors",   icon: "⭐" },
    { label: "Competency Gaps",     href: "/educator/gaps",          icon: "🧩" },
    { label: "Evidence Support",    href: "/educator/evidence-support", icon: "🖇️" },
    { label: "AI Learning Insights", href: "/educator/ai-insights",  icon: "✨" },
    { label: "Communication Centre", href: "/educator/communication", icon: "📣" },
    { label: "Meetings & Follow-ups", href: "/educator/meetings",     icon: "🤝" },
    { label: "Referrals",           href: "/educator/referrals",     icon: "📤" },
    { label: "Support Analytics",   href: "/educator/support-analytics", icon: "📊" },
  ]},
  { group: "Education Studio", items: [
    { label: "Studio Overview",     href: "/educator/studio",             icon: "✨" },
    { label: "Curriculum & Framework", href: "/educator/studio/curriculum", icon: "🏛️" },
    { label: "Assessment Design",   href: "/educator/studio/assessment",  icon: "📝" },
    { label: "Learning Content",    href: "/educator/studio/content",     icon: "🎬" },
    { label: "Blueprint & Mapping", href: "/educator/studio/mapping",     icon: "🧭" },
    { label: "CKO & CPU Studio",    href: "/educator/studio/cko",         icon: "💠" },
    { label: "AI Studio",           href: "/educator/studio/ai",          icon: "🤖" },
    { label: "Publishing & Governance", href: "/educator/studio/publishing", icon: "🏛️" },
  ]},
  { group: "Analytics & Quality", items: [
    { label: "Analytics Overview",  href: "/educator/analytics",              icon: "📊" },
    { label: "Learning Analytics",  href: "/educator/analytics/learning",     icon: "📈" },
    { label: "Competency Analytics", href: "/educator/analytics/competency",  icon: "🎯" },
    { label: "Curriculum Analytics", href: "/educator/analytics/curriculum",  icon: "📚" },
    { label: "Assessment Analytics", href: "/educator/analytics/assessment",  icon: "📝" },
    { label: "Learner Outcomes",    href: "/educator/analytics/outcomes",     icon: "🎓" },
    { label: "Program Quality",     href: "/educator/analytics/quality",      icon: "🛡️" },
    { label: "Accreditation & Standards", href: "/educator/analytics/accreditation", icon: "📜" },
    { label: "Improvement Centre",  href: "/educator/analytics/improvement",  icon: "🎯" },
  ]},
  { group: "AI & Intelligence", items: [
    { label: "Intelligence Hub",    href: "/educator/ai",            icon: "🧠" },
    { label: "AI Copilot",          href: "/educator/ai/copilot",    icon: "✨" },
    { label: "Predictive Alerts",   href: "/educator/at-risk",       icon: "🔮" },
    { label: "Executive Intelligence", href: "/educator/analytics/quality", icon: "👑" },
  ]},
  { group: "Tools & Settings", items: [
    { label: "Bulk Import",         href: "/educator/import",        icon: "📥" },
    { label: "Educator CPD",        icon: "🏅", soon: true },
    { label: "Settings",            href: "/dashboard/billing",      icon: "⚙️" },
  ]},
];

export default async function EducatorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("full_name, role, roles, hospital_id, avatar_url")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  if (!userRoles.includes("educator")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Educator access only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for nurse educators and content creators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Live sidebar badges — validation queue and unread notifications, fail-soft.
  const { data: hospitalNurses } = await adminClient
    .from("profiles").select("id")
    .eq("hospital_id", profile?.hospital_id ?? "").eq("role", "nurse");
  const nurseIds = (hospitalNurses ?? []).map(n => n.id);

  const [{ count: queueCount }, { count: unreadCount }] = await Promise.all([
    nurseIds.length
      ? adminClient.from("competency_scores").select("id", { count: "exact", head: true })
          .eq("educator_validated", false).in("nurse_id", nurseIds)
      : Promise.resolve({ count: 0 }),
    adminClient.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("read", false),
  ]);
  const badgeValue = { queue: queueCount ?? 0, unread: unreadCount ?? 0 };

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      {/* Mobile top bar with horizontally scrollable nav — desktop rail hidden below md. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#1a0a38] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-purple-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <WorkspaceSwitcher roles={userRoles} activeRole="educator" variant="mobile" />
          </span>
          <span className="flex-1" />
          <Link href="/educator/notifications" aria-label="Notifications" className="relative w-9 h-9 rounded-lg flex items-center justify-center text-base">
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
            .filter(i => i.href && !i.soon)
            .map(({ label, href, badge }) => (
            <Link key={label} href={href!}
              className="shrink-0 text-[11px] text-purple-100/80 bg-purple-900/40 hover:bg-purple-800/60 rounded-full px-3 py-1 transition-colors">
              {label}{badge && badgeValue[badge] > 0 ? ` (${badgeValue[badge]})` : ""}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-60 h-screen bg-[#1a0a38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/educator" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-purple-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-bold text-sm leading-tight tracking-wide">COMPETEN</span>
              <span className="block text-purple-300/60 text-[9px] leading-tight">Educator Workspace</span>
            </span>
          </Link>
          <div data-sb-label><WorkspaceSwitcher roles={userRoles} activeRole="educator" /></div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({ group, items }) => {
              const nodes = items.map(({ label, href, icon, badge, soon }) => soon || !href ? (
                <span key={label} title={label} data-sb-item
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-purple-200/25 cursor-default select-none">
                  <span className="w-5 text-center text-sm leading-none opacity-50">{icon}</span>
                  <span className="flex-1" data-sb-label>{label}</span>
                  <span className="text-[8px] font-bold uppercase tracking-wider bg-purple-950 text-purple-400/40 rounded px-1 py-0.5" data-sb-label>soon</span>
                </span>
              ) : (
                <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/educator" || href === "/educator/studio" || href === "/educator/analytics" || href === "/educator/ai"}
                  badge={badge ? badgeValue[badge] : undefined}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-purple-200/60 hover:bg-purple-900/40 hover:text-white transition-colors"
                  activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-purple-900/60 text-white font-medium" />
              ));
              return group ? (
                <NavGroup key={group} title={group} hrefs={items.filter(i => i.href).map(i => i.href!)} headerClass="text-[9px] font-bold uppercase tracking-widest text-purple-400/50">{nodes}</NavGroup>
              ) : (
                <div key="root" className="flex flex-col gap-0.5">{nodes}</div>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-purple-900/60">
            <div className="flex items-center gap-2 px-3 py-2">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-purple-800" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-bold">
                  {profile?.full_name?.[0] ?? "E"}
                </div>
              )}
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-purple-300/60 text-[10px]">Educator</p>
              </div>
            </div>
            <div className="mb-2" data-sb-label>
              <WorkspaceSwitcher roles={userRoles} activeRole="educator" variant="footer" />
            </div>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-purple-200/40 hover:bg-purple-900/30 hover:text-white transition-colors">
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
