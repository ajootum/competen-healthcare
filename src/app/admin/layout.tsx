import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, ORG_ROLE_CONFIG, type AppRole, type OrgRole } from "@/lib/roles";

const ALL_NAV = [
  // Overview: all management and functional roles
  { label: "Overview",       href: "/admin/dashboard",    icon: "🏛️", orgRoles: ["chief_officer","org_admin","governance_committee","manager","competency_coordinator","quality_manager","hr_manager","it_admin",null] },
  { label: "Executive",      href: "/admin/executive",    icon: "🛰️", orgRoles: ["chief_officer","org_admin","governance_committee","quality_manager",null] },
  // Worker roster: HR, managers, quality (staff-facing)
  { label: "Worker Roster",  href: "/admin/nurses",       icon: "👩‍⚕️", orgRoles: ["org_admin","manager","competency_coordinator","quality_manager","hr_manager",null] },
  // Departments: structural roles + IT admin
  { label: "Departments",    href: "/admin/departments",  icon: "🏢", orgRoles: ["org_admin","manager","it_admin",null] },
  { label: "Positions",      href: "/admin/positions",    icon: "🧩", orgRoles: ["chief_officer","org_admin","hr_manager","manager",null] },
  { label: "Operations",     href: "/admin/operations",   icon: "🩺", orgRoles: ["chief_officer","org_admin","manager","competency_coordinator","quality_manager",null] },
  { label: "Shift Supervisor", href: "/supervisor",       icon: "🖥️", orgRoles: ["chief_officer","org_admin","manager",null] },
  { label: "Unit Manager",   href: "/unit-manager",       icon: "📊", orgRoles: ["chief_officer","org_admin","manager",null] },
  { label: "Competency Office", href: "/competency-office", icon: "🏛️", orgRoles: ["chief_officer","org_admin","governance_committee","competency_coordinator",null] },
  { label: "Quality & Accreditation", href: "/quality-accreditation", icon: "🎯", orgRoles: ["chief_officer","org_admin","quality_manager","governance_committee",null] },
  { label: "Human Resources", href: "/human-resources", icon: "👥", orgRoles: ["chief_officer","org_admin","hr_manager",null] },
  { label: "Hospital Executive", href: "/hospital-executive", icon: "🛰️", orgRoles: ["chief_officer","org_admin",null] },
  // Cycles: those who run and monitor assessments
  { label: "Cycles",         href: "/admin/cycles",       icon: "🔄", orgRoles: ["org_admin","manager","competency_coordinator","quality_manager",null] },
  { label: "Assessment Plans", href: "/admin/plans",      icon: "🗓️", orgRoles: ["org_admin","manager","competency_coordinator","educator",null] },
  // Workforce reports: exec + quality
  { label: "Workforce",      href: "/admin/workforce",    icon: "📊", orgRoles: ["chief_officer","org_admin","quality_manager",null] },
  { label: "Intelligence",   href: "/admin/intelligence", icon: "🧠", orgRoles: ["chief_officer","org_admin","quality_manager","manager",null] },
  { label: "Quality",        href: "/admin/quality",      icon: "🛡️", orgRoles: ["chief_officer","org_admin","quality_manager","governance_committee","manager",null] },
  { label: "Accreditation",  href: "/admin/accreditation", icon: "🎯", orgRoles: ["chief_officer","org_admin","quality_manager","governance_committee",null] },
  { label: "Resources",      href: "/admin/resources",    icon: "📚", orgRoles: ["org_admin","educator","competency_coordinator","manager",null] },
  // Competencies: governance committee + content roles
  { label: "Competencies",   href: "/admin/competencies", icon: "🪪", orgRoles: ["chief_officer","org_admin","governance_committee","manager","competency_coordinator","quality_manager",null] },
  // Approvals: governance committee reviews pending frameworks
  { label: "Approvals",      href: "/admin/approvals",    icon: "⚖️", orgRoles: ["chief_officer","org_admin","governance_committee",null] },
  { label: "Authorizations", href: "/admin/authorizations", icon: "🔑", orgRoles: ["chief_officer","org_admin","governance_committee","manager","educator",null] },
  { label: "Credentials",    href: "/admin/credentials",  icon: "🎖️", orgRoles: ["org_admin","hr_manager","educator","manager",null] },
  { label: "Recognition",    href: "/admin/recognitions", icon: "🏆", orgRoles: ["org_admin","hr_manager","educator","manager",null] },
  { label: "Curricula",      href: "/admin/curricula",    icon: "📖", orgRoles: ["org_admin","educator","competency_coordinator",null] },
  // Invite / import: HR + managers
  { label: "Invite Workers", href: "/admin/invite",       icon: "➕", orgRoles: ["org_admin","manager","hr_manager",null] },
  { label: "Bulk Import",    href: "/admin/import",       icon: "📥", orgRoles: ["chief_officer","org_admin","manager","competency_coordinator","hr_manager",null] },
  // Settings: org admin + IT admin
  { label: "Studio",         href: "/admin/studio",       icon: "🎛️", orgRoles: ["org_admin","it_admin",null] },
  { label: "Settings",       href: "/admin/settings",     icon: "⚙️", orgRoles: ["org_admin","it_admin",null] },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("full_name, role, roles, hospital_id, organisation_id")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  const { data: orgProfile, error: orgErr } = await adminClient
    .from("profiles")
    .select("org_role")
    .eq("id", user.id)
    .returns<{ org_role: string | null }[]>()
    .maybeSingle();
  const orgRole = (!orgErr && orgProfile ? orgProfile.org_role as OrgRole : null) ?? null;

  if (!userRoles.includes("hospital_admin")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for organisation administrators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const orgRoleCfg = orgRole ? ORG_ROLE_CONFIG[orgRole] : null;
  const portalLabel = orgRoleCfg?.label ?? "Admin";
  const filteredNav = ALL_NAV.filter(item => item.orgRoles.includes(orgRole));

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      {/* Mobile top bar with horizontally scrollable nav — the desktop rail is hidden below md. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2e38] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-teal-300/60 text-[10px] leading-tight">{portalLabel} Portal</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">
            ⊞ My Dashboard
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {filteredNav.map(({ label, href }) => (
            <Link key={label} href={href}
              className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/admin/dashboard" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>

          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">{portalLabel}</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {filteredNav.map(({ label, href, icon }) => (
              <NavLink key={label} href={href} icon={icon} label={label}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
            ))}
            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-xs font-bold">
                {profile?.full_name?.[0] ?? "A"}
              </div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-amber-300/60 text-[10px]">{portalLabel}</p>
              </div>
            </div>
            {userRoles.length > 1 && (
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

        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
