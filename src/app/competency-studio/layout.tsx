import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { type AppRole } from "@/lib/roles";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// Competency Studio (CST-000) as a PEER workspace — the no-code authoring platform, reachable directly
// by its author audience (educators, assessors, competency coordinators, admins) rather than only via the
// super-admin portal. The same 26-module Studio surfaces run here, hospital-scoped for non-super users.
// Authoring builders (framework/competency/assessment) are role-routed from the hub.

const NAV_SECTIONS: { section: string; items: { label: string; href: string; icon: string; exact?: boolean }[] }[] = [
  { section: "Studio", items: [
    { label: "Studio Home", href: "/competency-studio", icon: "🎨", exact: true },
  ] },
  { section: "Authoring & Analysis", items: [
    { label: "Quality Assurance", href: "/competency-studio/qa", icon: "✅" },
    { label: "Dependencies", href: "/competency-studio/dependencies", icon: "🔗" },
    { label: "Rules Engine", href: "/competency-studio/rules", icon: "⚙️" },
    { label: "Mapping Studio", href: "/competency-studio/mapping", icon: "🗺️" },
    { label: "Standards Mapping", href: "/competency-studio/standards", icon: "📏" },
    { label: "Learning Paths", href: "/competency-studio/learning", icon: "📚" },
    { label: "Simulation Studio", href: "/competency-studio/simulations", icon: "🎬" },
  ] },
  { section: "Reference & Distribution", items: [
    { label: "Template Library", href: "/competency-studio/templates", icon: "🧩" },
    { label: "Package Manager", href: "/competency-studio/packages", icon: "📦" },
    { label: "Marketplace", href: "/competency-studio/marketplace", icon: "🛍️" },
  ] },
  { section: "Validation", items: [
    { label: "Release Readiness", href: "/competency-studio/testing", icon: "🧪" },
  ] },
];
const NAV = NAV_SECTIONS.flatMap(s => s.items);
const ALLOWED = ["hospital_admin", "educator", "assessor", "super_admin"];

export default async function CompetencyStudioLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/competency-studio" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Competency Studio is for competency authors — educators, assessors, coordinators and admins.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#1e1b4b] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-indigo-300/60 text-[10px] leading-tight">Competency Studio</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-indigo-100/70 border border-indigo-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ label, href }) => (
            <Link key={label} href={href} className="shrink-0 text-[11px] text-indigo-100/80 bg-indigo-800/50 hover:bg-indigo-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Competency Studio"
          workspaceHref="/competency-studio"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#1e1b4b] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/competency-studio" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-bold text-sm leading-tight tracking-wide">COMPETEN</span>
              <span className="block text-indigo-300/60 text-[9px] leading-tight">Competency Studio</span>
            </span>
          </Link>
          <div className="px-3 mb-2" data-sb-label>
            <span className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest">Authoring Platform</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_SECTIONS.map(({ section, items }) => (
              <div key={section}>
                {section !== "Studio" && <div className="px-3 mt-3 mb-1" data-sb-label><span className="text-[10px] font-bold text-indigo-400/60 uppercase tracking-widest">{section}</span></div>}
                {items.map(({ label, href, icon, exact }) => (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-indigo-100/70 hover:bg-indigo-800/50 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-indigo-700/60 text-white font-medium" />
                ))}
              </div>
            ))}

            <div className="my-3 border-t border-indigo-800/30" />
            <Link href="/competency-office" data-sb-item title="Competency Office" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-indigo-100/40 hover:bg-indigo-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">🏛️</span>
              <span data-sb-label>Competency Office</span>
            </Link>
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-indigo-100/40 hover:bg-indigo-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          {/* PUI-002: user controls live in the global header; the sidebar is workflow navigation only. */}
        </aside>

        <main id="main-content" data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
