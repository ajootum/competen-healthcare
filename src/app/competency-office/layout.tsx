import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { type AppRole } from "@/lib/roles";
import { holdsOfficeAppointment } from "@/lib/ogs/office";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// Competency Management Operations workspace (CMO-000) — Competency Intelligence. The enterprise
// competency engine: seven CMO modules (§2 information architecture) plus a quick-actions rail.
// The Dashboard, Frameworks and CPUs are real; the operational modules surface live data on the
// dashboard and route to their authoritative surfaces (§6) until each gains a dedicated page.
// Role-scoped to competency leads, educators and admins.

// CMO-000/001 workflow-oriented navigation — the 8 L1 sections. All 23 modules grouped beneath them.
const NAV_SECTIONS: { section: string; items: { label: string; href: string; icon: string; exact?: boolean }[] }[] = [
  { section: "Executive", items: [
    { label: "Executive Dashboard", href: "/competency-office", icon: "📊", exact: true },
  ] },
  { section: "Competency Governance", items: [
    { label: "Program Management", href: "/competency-office/program-management", icon: "📋" }, // CMO-006
    { label: "Lifecycle Engine", href: "/competency-office/lifecycle", icon: "🔄" },           // CMO-004
    { label: "Lifecycle State Machine", href: "/competency-office/lifecycle-state", icon: "🧬" }, // COMP-017
    { label: "Competency Frameworks", href: "/competency-office/frameworks", icon: "🗂️" },
    { label: "Standards Library", href: "/competency-office/standards", icon: "📚" },
    { label: "Governance & Publication", href: "/competency-office/publishing", icon: "🚀" },   // COMP-011
    { label: "Review & Approval", href: "/competency-office/review-board", icon: "⚖️" },        // COMP-011
  ] },
  { section: "Assessment Operations", items: [
    { label: "Assessment Status", href: "/competency-office/assessments", icon: "📝" },
    { label: "Validation Queue", href: "/competency-office/validation", icon: "✅" },
  ] },
  { section: "Competency Assurance", items: [
    { label: "Compliance Centre", href: "/competency-office/compliance", icon: "✔️" },
    { label: "Accreditation Mapping", href: "/competency-office/accreditation", icon: "🏅" },
    { label: "Workforce Readiness", href: "/competency-office/readiness", icon: "🎯" },
    { label: "Workforce Mapping", href: "/competency-office/workforce-mapping", icon: "🗺️" },   // CMO-007
    { label: "Readiness States", href: "/competency-office/readiness-states", icon: "🚦" },     // COMP-019
  ] },
  { section: "Credential Management", items: [
    { label: "Credential Management", href: "/competency-office/credentialing", icon: "🎓" },
    { label: "Certification Manager", href: "/competency-office/certifications", icon: "📜" },
    { label: "Recertification & Renewal", href: "/competency-office/recertification", icon: "♻️" }, // COMP-020
    { label: "Clinical Privileging", href: "/competency-office/privileging", icon: "🏥" },
    { label: "Mobility & Recognition", href: "/competency-office/recognition", icon: "🌍" },     // COMP-024
  ] },
  { section: "Improvement Centre", items: [
    { label: "Gap Management", href: "/competency-office/gaps", icon: "🕳️" },
    { label: "Remediation Centre", href: "/competency-office/remediation", icon: "🩺" },        // COMP-021
    { label: "Quality Feedback Loop", href: "/competency-office/quality-feedback", icon: "🔁" }, // COMP-028
    { label: "Enterprise Planning", href: "/competency-office/planning", icon: "🗺️" },
    { label: "Forecasting", href: "/competency-office/forecasting", icon: "🔮" },
    { label: "Campaigns & Initiatives", href: "/competency-office/campaigns", icon: "📣" }, // CMO-011
  ] },
  { section: "Analytics & Intelligence", items: [
    { label: "Competency Analytics", href: "/competency-office/analytics", icon: "📈" },
    { label: "Benchmarking", href: "/competency-office/benchmarking", icon: "🏆" },             // COMP-026
    { label: "AI Intelligence", href: "/competency-office/ai-intelligence", icon: "🤖" },
  ] },
  { section: "Office Administration", items: [
    { label: "Assignment Centre", href: "/competency-office/assignments", icon: "🧩" },         // CMO-010
    { label: "Assignment Rules", href: "/competency-office/assignment-rules", icon: "⚙️" },     // COMP-018
    { label: "Office & Membership", href: "/competency-office/membership", icon: "🏛️" },        // CMO-003
    { label: "Workspace Integration", href: "/competency-office/integration", icon: "🔗" },     // CMO-005
    { label: "Configuration & Rules", href: "/competency-office/configuration", icon: "🔧" },   // CMO-020
    { label: "Operating Model", href: "/competency-office/operating-model", icon: "🏛️" },       // CMO-017
  ] },
];
// Flat list for the mobile nav strip.
const NAV = NAV_SECTIONS.flatMap(s => s.items);

// Quick-actions rail (§5) — cross-links to the authoritative surface for each action.
const QUICK_ACTIONS = [
  { label: "Create Assessment",   href: "/admin/competencies",           icon: "📝", tint: "bg-emerald-500/90" },
  { label: "Upload Evidence",     href: "/educator/evidence",            icon: "📎", tint: "bg-sky-500/90" },
  { label: "Add Competency",      href: "/competency-office/frameworks", icon: "➕", tint: "bg-amber-500/90" },
  { label: "Assign Learning",     href: "/admin/curricula",              icon: "📖", tint: "bg-violet-500/90" },
  { label: "Run Readiness Report", href: "/competency-office/readiness", icon: "🧾", tint: "bg-teal-500/90" },
];

const ALLOWED = ["hospital_admin", "educator", "super_admin"];

export default async function CompetencyOfficeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/competency-office" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  // R001 appointment-based access (additive): a role holder OR an active member of the Competency Office may enter.
  const roleOk = userRoles.some(r => ALLOWED.includes(r));
  const apptOk = roleOk ? false : await holdsOfficeAppointment(admin, "competency", (profile?.hospital_id as string) ?? null, userRoles.includes("super_admin"), user.id);
  if (!roleOk && !apptOk) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Competency Office workspace is for competency coordinators, educators and governance leads.</p>
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
            <span className="block text-teal-300/60 text-[10px] leading-tight">Competency Intelligence</span>
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

      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Competency Intelligence"
          workspaceHref="/competency-office"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/competency-office" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-bold text-sm leading-tight tracking-wide">COMPETEN</span>
              <span className="block text-teal-300/60 text-[9px] leading-tight">Competency Intelligence</span>
            </span>
          </Link>
          <div className="px-3 mb-2" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Competency Operations</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV_SECTIONS.map(({ section, items }) => (
              <div key={section}>
                {section !== "Executive" && <div className="px-3 mt-3 mb-1" data-sb-label><span className="text-[10px] font-bold text-teal-400/60 uppercase tracking-widest">{section}</span></div>}
                {items.map(({ label, href, icon, exact }) => (
                  <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                    activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
                ))}
              </div>
            ))}

            <div className="px-3 mt-4 mb-1.5" data-sb-label>
              <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Quick Actions</span>
            </div>
            {QUICK_ACTIONS.map(({ label, href, icon, tint }) => (
              <Link key={label} href={href} data-sb-item title={label} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] shrink-0 ${tint}`}>{icon}</span>
                <span data-sb-label className="flex-1">{label}</span>
                <span data-sb-label className="text-teal-400/40">›</span>
              </Link>
            ))}

            <div className="my-2 border-t border-teal-800/30" />
            {userRoles.some(r => ["hospital_admin", "super_admin"].includes(r)) && (
              <Link href="/office-governance" data-sb-item title="Office Governance" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className="w-5 text-center text-sm">🏛️</span>
                <span data-sb-label>Office Governance</span>
              </Link>
            )}
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
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
