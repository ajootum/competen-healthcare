import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";

// Sidebar IA aligned to the Mission Control model (MC-001). Every item routes to
// a real, existing super-admin surface — sections named per the spec's platform
// domains without introducing dead links.
const NAV = [
  { group: "MISSION CONTROL", items: [
    { label: "Overview",          href: "/super-admin",                    icon: "🎛️" },
    { label: "Command Centre",    href: "/super-admin/command-centre",     icon: "📡" },
  ]},
  { group: "ENTERPRISE ADMINISTRATION", items: [
    { label: "Overview",          href: "/super-admin/enterprise",              icon: "🏢" },
    { label: "Organisations",     href: "/super-admin/enterprise/organisations", icon: "🏛️" },
    { label: "Networks",          href: "/super-admin/enterprise/networks",      icon: "🌐" },
    { label: "Facilities",        href: "/super-admin/enterprise/facilities",    icon: "🏥" },
    { label: "Structure Builder", href: "/super-admin/enterprise/structure",     icon: "🗂️" },
    { label: "People & Roles",    href: "/super-admin/enterprise/people",        icon: "👥" },
    { label: "Enterprise Templates", href: "/super-admin/enterprise/templates",  icon: "📦" },
    { label: "Bulk Import",       href: "/super-admin/import",                  icon: "📥" },
  ]},
  { group: "PLATFORM OPERATIONS", items: [
    { label: "Control Plane",     href: "/platform/control-plane",         icon: "🧭" },
    { label: "Platform Workspace",href: "/platform-admin",                 icon: "🛰️" },
  ]},
  { group: "CLINICAL KNOWLEDGE", items: [
    { label: "Studio",            href: "/super-admin/studio",             icon: "🧰" },
    { label: "Frameworks",        href: "/super-admin/content",            icon: "📐" },
    { label: "Competency Library",href: "/super-admin/competencies",       icon: "🪪" },
    { label: "Assessment Methods",href: "/super-admin/assessment-methods", icon: "🩺" },
    { label: "Scoring Rules",     href: "/super-admin/scoring",            icon: "📊" },
    { label: "Reassessment",      href: "/super-admin/schedules",          icon: "🔄" },
  ]},
  { group: "AI & INTELLIGENCE", items: [
    { label: "AI Assistant",      href: "/super-admin/assistant",          icon: "🤖" },
    { label: "Knowledge Graph",   href: "/super-admin/knowledge-graph",    icon: "🕸️" },
  ]},
  { group: "GOVERNANCE & COMPLIANCE", items: [
    { label: "Committees",        href: "/super-admin/governance/committees", icon: "⚖️" },
    { label: "Policies",          href: "/super-admin/policy-manager",     icon: "📄" },
    { label: "Workflows",         href: "/super-admin/workflows",          icon: "⚡" },
    { label: "Report Templates",  href: "/super-admin/reports",            icon: "📈" },
    { label: "Audit Log",         href: "/super-admin/audit",              icon: "🗒️" },
  ]},
  { group: "SYSTEM & SETTINGS", items: [
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
  // Dedicated org-role workspaces this user can switch into (normally none for landlord-only super admins).
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

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
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1923] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/super-admin" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-rose-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <div className="flex flex-col leading-none" data-sb-label>
              <span className="text-white font-semibold text-sm">Competen</span>
              <span className="text-rose-300/70 text-[10px] font-medium">Mission Control</span>
            </div>
          </Link>

          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-rose-400/70 uppercase tracking-widest">Super Admin Workspace</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ group, items }) => (
              <NavGroup key={group} title={group} hrefs={items.map(i => i.href)} headerClass="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                {items.map(({ label, href, icon }) => (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/super-admin"}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium" />
                ))}
              </NavGroup>
            ))}
          </nav>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-rose-500 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.[0] ?? "S"}
              </div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-rose-300/60 text-[10px]">Super Admin</p>
              </div>
            </div>
            {(userRoles.length > 1 || workspaces.length > 0) && (
              <div className="mb-2" data-sb-label>
                <RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} />
              </div>
            )}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        {/* Pages stay readable at max-w-6xl; a workspace page opts out of the
            cap by rendering data-wide on its root (rule in globals.css). */}
        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
