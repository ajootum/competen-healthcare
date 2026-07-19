import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import MobileSidebar from "./MobileSidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";

// Grouped per the Account & Subscription spec §2 / Nurse Workspace mockup.
// "My CPUs" is kept (not in the mockup) so the page isn't orphaned; "Portfolio"
// is omitted — no portfolio feature exists yet.
const NAV_GROUPS: { group: string | null; items: { label: string; href: string; icon: string }[] }[] = [
  { group: null, items: [
    { label: "Dashboard",               href: "/dashboard",              icon: "🏠" },
    { label: "Notifications",           href: "/dashboard/notifications", icon: "🔔" },
    { label: "Career Growth",           href: "/dashboard/career",       icon: "📈" },
  ]},
  { group: "Learning", items: [
    { label: "Learning Pathway",        href: "/dashboard/learning",     icon: "📚" },
    { label: "CPD Academy",             href: "/dashboard/courses",      icon: "🎓" },
    { label: "Question Bank",           href: "/dashboard/questions",    icon: "❓" },
    { label: "Simulation Lab",          href: "/dashboard/simulation",   icon: "🧪" },
    { label: "OSCE Platform",           href: "/dashboard/osce",         icon: "📋" },
  ]},
  { group: "Clinical Practice", items: [
    { label: "Clinical Skills Logbook", href: "/dashboard/logbook",      icon: "📖" },
    { label: "Competency Passport",     href: "/dashboard/passport",     icon: "🛂" },
    { label: "My CPUs",                 href: "/dashboard/cpu",          icon: "🏥" },
    { label: "Clinical Library",        href: "/dashboard/library",      icon: "🔎" },
    { label: "Knowledge Hub",           href: "/dashboard/knowledge",    icon: "🔬" },
    { label: "AI Copilot",              href: "/dashboard/copilot",      icon: "✨" },
  ]},
  { group: "Performance", items: [
    { label: "Assessments",             href: "/dashboard/assessments",  icon: "📝" },
    { label: "My Feedback",             href: "/dashboard/feedback",     icon: "💬" },
    { label: "Audit Centre",            href: "/dashboard/audit",        icon: "🛡️" },
  ]},
  { group: "Professional", items: [
    { label: "CPD Log",                 href: "/dashboard/cpd",          icon: "⏱️" },
    { label: "Certificates",            href: "/dashboard/certificates", icon: "🏆" },
  ]},
  { group: "Administration", items: [
    { label: "Settings",                href: "/dashboard/billing",      icon: "⚙️" },
  ]},
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("full_name, role, roles, avatar_url")
    .eq("id", user.id)
    .single();

  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  // Unread notification count for the sidebar bell (0 until migration 029 runs).
  const { count: unreadCount } = await createAdminClient()
    .from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("read", false);

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <MobileSidebar
        fullName={profile?.full_name ?? "Nurse"}
        role={profile?.role ?? "nurse"}
        isAdmin={profile?.role === "hospital_admin"}
        unread={unreadCount ?? 0}
        avatarUrl={profile?.avatar_url ?? null}
      />

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/dashboard" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
              <span className="block text-teal-400/60 text-[10px] leading-tight">Nurse Workspace</span>
            </span>
          </Link>
          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({ group, items }) => (
              <div key={group ?? "root"} className="flex flex-col gap-0.5">
                {group && <p className="px-3 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-teal-400/40" data-sb-label>{group}</p>}
                {items.map(({ label, href, icon }) => (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/dashboard"}
                    badge={href === "/dashboard/notifications" ? unreadCount ?? 0 : undefined}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-teal-700/60 text-white font-medium" />
                ))}
              </div>
            ))}
            {/* Help & Support opens email — no in-app help centre exists yet. */}
            <a href="mailto:gabriel@semacast.com?subject=Competen support request" data-sb-item title="Help & Support"
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm leading-none">🎧</span>
              <span data-sb-label>Help &amp; Support</span>
            </a>
          </nav>
          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-teal-700" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
                  {firstName[0]}
                </div>
              )}
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-teal-400/60 text-[10px]">Nurse</p>
              </div>
            </div>
            {userRoles.some(r => ["educator", "assessor"].includes(r)) && (
              <div className="mb-2" data-sb-label>
                <RoleSwitcher roles={userRoles} activeRole={activeRole} />
              </div>
            )}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/50 hover:bg-teal-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-16 md:pt-8 pb-8 min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
