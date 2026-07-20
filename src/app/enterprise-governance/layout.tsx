import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";

// Enterprise Governance Workspace (EGV-001) — multi-organisation governance:
// enterprise standards, multi-tenant governance, benchmarking, regulatory
// compliance, enterprise analytics and strategic governance reporting.

const NAV = [
  { label: "Dashboard",              href: "/enterprise-governance",             icon: "🏛️", exact: true },
  { label: "Enterprise Standards",   href: "/enterprise-governance/standards",   icon: "📐" },
  { label: "Multi-Tenant Governance", href: "/enterprise-governance/tenants",    icon: "🏢" },
  { label: "Enterprise Benchmarking", href: "/enterprise-governance/benchmarking", icon: "📊" },
  { label: "Regulatory Compliance",  href: "/enterprise-governance/regulatory",  icon: "⚖️" },
  { label: "Enterprise Analytics",   href: "/enterprise-governance/analytics",   icon: "📈" },
  { label: "AI Enterprise Intelligence", href: "/enterprise-governance/ai",      icon: "✨" },
  { label: "Reports",                href: "/enterprise-governance/reports",     icon: "📄" },
  { label: "Settings",               href: "/enterprise-governance/settings",    icon: "⚙️" },
];

const ALLOWED = ["hospital_admin", "super_admin"];

export default async function EnterpriseGovernanceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles").eq("id", user.id).single();
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Enterprise Governance workspace is for enterprise governance and multi-tenant leadership.</p>
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
            <span className="block text-teal-300/60 text-[10px] leading-tight">Enterprise Governance</span>
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
          <Link href="/enterprise-governance" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Enterprise Governance</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
            ))}
            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-xs font-bold">{profile?.full_name?.[0] ?? "E"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-amber-300/60 text-[10px]">Enterprise Governance</p>
              </div>
            </div>
            {userRoles.length > 1 && <div className="mb-2" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} /></div>}
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
