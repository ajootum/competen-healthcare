import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { type AppRole } from "@/lib/roles";
import { holdsOfficeAppointment } from "@/lib/ogs/office";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// Quality & Accreditation Workspace (QAS-001) — enterprise clinical quality,
// accreditation, audit, compliance and improvement. Role-scoped to quality
// managers, accreditation coordinators, safety officers and audit teams.

const NAV = [
  { label: "Dashboard",              href: "/quality-accreditation",               icon: "📊", exact: true },
  { label: "Accreditation Standards", href: "/quality-accreditation/standards",    icon: "🎯" },
  { label: "Clinical Audit Centre",  href: "/quality-accreditation/audits",        icon: "📋" },
  { label: "Improvement & CAPA",     href: "/quality-accreditation/improvements",  icon: "🛠️" },
  { label: "Risk Management",        href: "/quality-accreditation/risk",          icon: "⚠️" },
  { label: "Compliance Monitoring",  href: "/quality-accreditation/compliance",    icon: "✅" },
  { label: "Quality Indicators",     href: "/quality-accreditation/indicators",    icon: "📏" },
  { label: "Analytics & Reporting",  href: "/quality-accreditation/analytics",     icon: "📈" },
  { label: "Documents & Evidence",   href: "/quality-accreditation/documents",     icon: "📄" },
  { label: "Accreditation Readiness", href: "/quality-accreditation/readiness",    icon: "🗂️" },
  { label: "Incident & Safety",      href: "/quality-accreditation/safety",        icon: "🚑" },
  { label: "Governance & Committees", href: "/quality-accreditation/governance",   icon: "🏛️" },
  { label: "AI Quality Intelligence", href: "/quality-accreditation/ai",           icon: "✨" },
  { label: "Audit Trail & Regulatory", href: "/quality-accreditation/audit-trail", icon: "🧾" },
  { label: "Administration",         href: "/quality-accreditation/administration", icon: "⚙️" },
];

const ALLOWED = ["hospital_admin", "super_admin", "assessor"];

export default async function QualityAccreditationLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/quality-accreditation" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  // R001 appointment-based access (additive, mirrors CMO): a role holder OR an active Quality Office appointee
  // may enter. Fail-soft — no OGS tables / no appointment → role-only, nothing removed.
  const roleOk = userRoles.some(r => ALLOWED.includes(r));
  const apptOk = roleOk ? false : await holdsOfficeAppointment(admin, "quality", (profile?.hospital_id as string) ?? null, userRoles.includes("super_admin"), user.id);
  if (!roleOk && !apptOk) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Quality &amp; Accreditation workspace is for quality, accreditation and audit teams.</p>
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
            <span className="block text-teal-300/60 text-[10px] leading-tight">Quality &amp; Accreditation</span>
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
          workspaceTitle="Quality &amp; Accreditation"
          workspaceHref="/quality-accreditation"
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
          <Link href="/quality-accreditation" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Quality &amp; Accreditation</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
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
