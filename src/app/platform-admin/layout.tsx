import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";

// Platform Super Admin Workspace (PSA-001) — the platform operational control
// centre: tenant lifecycle, platform configuration, security, analytics and AI
// operations. super_admin only.

const NAV = [
  { label: "Platform Dashboard",       href: "/platform-admin",                icon: "🛰️", exact: true },
  { label: "Tenant Management",        href: "/platform-admin/tenants",        icon: "🏛️" },
  { label: "Platform Configuration",   href: "/platform-admin/configuration",  icon: "🎛️" },
  { label: "Licensing",                href: "/platform-admin/licensing",      icon: "🎫" },
  { label: "Infrastructure Monitoring", href: "/platform-admin/infrastructure", icon: "🖥️" },
  { label: "API Management",           href: "/platform-admin/api",            icon: "🔌" },
  { label: "Integration Centre",       href: "/platform-admin/integrations",   icon: "🔗" },
  { label: "Security Centre",          href: "/platform-admin/security",       icon: "🛡️" },
  { label: "System Health",            href: "/platform-admin/health",         icon: "💓" },
  { label: "Platform Analytics",       href: "/platform-admin/analytics",      icon: "📈" },
  { label: "AI Platform Operations",   href: "/platform-admin/ai",             icon: "✨" },
  { label: "Settings",                 href: "/platform-admin/settings",       icon: "⚙️" },
];

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles").eq("id", user.id).single();
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  // Dedicated org-role workspaces this user can switch into (normally none for landlord-only super admins).
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

  if (!userRoles.includes("super_admin")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Super Admin only</h1>
          <p className="text-gray-400 text-sm mt-1">The Platform Super Admin workspace is for platform administrators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0f1923] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-rose-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-rose-300/60 text-[10px] leading-tight">Platform Super Admin</span>
          </span>
          <span className="flex-1" />
          <Link href="/super-admin" className="text-[11px] text-slate-300/70 border border-slate-700 rounded-lg px-2.5 py-1">Super Admin</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ label, href }) => (
            <Link key={label} href={href} className="shrink-0 text-[11px] text-slate-300/80 bg-slate-800/50 hover:bg-slate-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1923] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/platform-admin" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-rose-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-rose-400/70 uppercase tracking-widest">Platform Super Admin</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium" />
            ))}
            <div className="my-2 border-t border-slate-800/40" />
            <Link href="/super-admin" data-sb-item title="Super Admin portal" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-800/40 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">🌍</span>
              <span data-sb-label>Super Admin portal</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-rose-500 flex items-center justify-center text-white text-xs font-bold">{profile?.full_name?.[0] ?? "S"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-rose-300/60 text-[10px]">Platform Super Admin</p>
              </div>
            </div>
            {(userRoles.length > 1 || workspaces.length > 0) && <div className="mb-2" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} /></div>}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
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
