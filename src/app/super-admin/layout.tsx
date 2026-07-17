import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import { highestRole, type AppRole } from "@/lib/roles";

const NAV = [
  { group: "PLATFORM", items: [
    { label: "Overview",          href: "/super-admin",                    icon: "🌍" },
    { label: "Command Centre",    href: "/super-admin/command-centre",     icon: "🛰️" },
    { label: "Organisations",     href: "/super-admin/organisations",      icon: "🏛️" },
    { label: "All Facilities",    href: "/super-admin/hospitals",          icon: "🏥" },
    { label: "All Users",         href: "/super-admin/users",              icon: "👥" },
    { label: "Bulk Import",       href: "/super-admin/import",             icon: "📥" },
  ]},
  { group: "CONTENT", items: [
    { label: "Studio",            href: "/super-admin/studio",             icon: "🎛️" },
    { label: "Competency Studio", href: "/super-admin/content",            icon: "📐" },
    { label: "Knowledge Graph",   href: "/super-admin/knowledge-graph",    icon: "🕸️" },
    { label: "AI Assistant",      href: "/super-admin/assistant",          icon: "🤖" },
    { label: "Scoring Rules",     href: "/super-admin/scoring",            icon: "📊" },
    { label: "Assessment Methods",href: "/super-admin/assessment-methods", icon: "🩺" },
    { label: "Reassessment",      href: "/super-admin/schedules",          icon: "🔄" },
  ]},
  { group: "GOVERNANCE", items: [
    { label: "Committees",        href: "/super-admin/governance/committees", icon: "⚖️" },
    { label: "Policies",          href: "/super-admin/policy-manager",     icon: "📄" },
    { label: "Workflows",         href: "/super-admin/workflows",          icon: "⚡" },
    { label: "Report Templates",  href: "/super-admin/reports",            icon: "📈" },
    { label: "Audit Log",         href: "/super-admin/audit",              icon: "🗒️" },
  ]},
  { group: "SETTINGS", items: [
    { label: "Competency Library",href: "/super-admin/competencies",       icon: "🪪" },
    { label: "Metadata & Tags",   href: "/super-admin/metadata",           icon: "🏷️" },
    { label: "Platform Settings", href: "/super-admin/settings",           icon: "⚙️" },
  ]},
];

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, roles")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  if (!userRoles.includes("super_admin")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Super Admin only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for platform administrators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <div className="flex">
        <aside className="hidden md:flex w-56 h-screen bg-[#0f1923] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <Link href="/" className="flex items-center gap-2 mb-6 px-2">
            <div className="w-7 h-7 rounded bg-rose-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>

          <div className="px-3 mb-4">
            <span className="text-[10px] font-bold text-rose-400/70 uppercase tracking-widest">Super Admin</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ group, items }) => (
              <div key={group} className="mb-1">
                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-3 py-1.5 mt-1">{group}</p>
                {items.map(({ label, href, icon }) => (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/super-admin"}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium" />
                ))}
              </div>
            ))}
          </nav>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-rose-500 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.[0] ?? "S"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-rose-300/60 text-[10px]">Super Admin</p>
              </div>
            </div>
            {userRoles.length > 1 && (
              <div className="mb-2">
                <RoleSwitcher roles={userRoles} activeRole={activeRole} />
              </div>
            )}
            <form action="/api/auth/logout" method="POST">
              <button type="submit"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        {/* Pages stay readable at max-w-6xl; a workspace page opts out of the
            cap by rendering data-wide on its root (rule in globals.css). */}
        <main className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
