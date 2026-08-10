import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup, { NavGroupOrPlain } from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { type AppRole } from "@/lib/roles";
import { admitToEstate, NO_MEMBERSHIP_DESTINATION } from "@/lib/platform-membership";
import { loadConfigOverrides, isEnabled } from "@/lib/config/workspace-config";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// ─────────────────────────────────────────────────────────────────────────────
// UMW-000 NAVIGATION — restructured to the platform architecture.
//
// UMW-000 defines TWO things that had drifted apart in this sidebar: twelve CORE
// FUNCTIONAL DOMAINS, and a six-entry sidebar (Dashboard / Operations / Quality /
// People / AI Intelligence / Tools). The nav had grown to thirteen flat groups by
// accretion, with duplicate destinations across them. It is now the spec's six
// sections, with the twelve domains as the sub-headings inside them.
//
// NOTHING WAS TRIMMED. Every route reachable from this sidebar before is still
// reachable; what changed is where it sits and that a destination now appears
// ONCE. Dropping a link whose only entry point was the sidebar would orphan the
// page silently — Operational Command has no in-page tab bar (unlike Workforce,
// Quality, Patient Ops, Competency, Learning, AI, Performance and Administration),
// so all eleven of its modules stay listed: nine on the command floor, with
// Config & Rules and its analytics filed under the domains that own them.
// scripts/umw-nav-harness.ts checks this against a frozen list of the old links.
//
// THREE SUB-HEADINGS ARE NOT AMONG THE SPEC'S TWELVE DOMAINS and each declares
// spec:false: Dashboard (a section name, carrying domain 1's daily landings —
// the heading is suppressed because it matches its section), Patient Operations
// (POS-001, the operational source of truth — burying its twelve modules inside
// Unit Operations Command would hide the busiest part of the workspace) and
// Platform Engines (cross-domain authoring tools). Naming them honestly beats
// forcing them into a domain they are not.
// ─────────────────────────────────────────────────────────────────────────────

type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: number };
type Domain = {
  key: string;
  title: string;
  cfg: string;               // WCE config path for this domain
  legacy?: string[];         // pre-restructure paths, still honoured so an existing override cannot silently lapse
  spec?: boolean;            // false = a sub-heading UMW-000's twelve domains do not name
  items: NavItem[];
};

const DOMAINS: Domain[] = [
  // ── 1. Unit Operations Command (a) daily landings ─────────────────────────
  // Titled "Dashboard" so it matches its section and the heading is suppressed — the domain's
  // canonical name is carried by its command floor below, which is where the spec puts the work.
  { key: "command", title: "Dashboard", cfg: "unit-manager.operations-command", spec: false,
    legacy: ["unit-manager.unit-command"], items: [
    { label: "Overview Dashboard",     href: "/unit-manager",                    icon: "📊", exact: true },
    { label: "Unit Operations Centre", href: "/unit-manager/operations-centre",  icon: "🎛️" },
    { label: "Shift Intelligence",     href: "/unit-manager/shift-intelligence", icon: "🧭" },
    { label: "Executive Actions",      href: "/unit-manager/action-centre",      icon: "✅" },
  ] },
  // ── 1. Unit Operations Command (b) real-time floor ────────────────────────
  // UMW-OPC-001..009. No in-page tab bar exists for this section, so every module stays in
  // the sidebar or it becomes unreachable.
  { key: "opc", title: "Unit Operations Command", cfg: "unit-manager.operational-command",
    legacy: ["unit-manager.operations-capacity"], items: [
    { label: "Command Dashboard",              href: "/unit-manager/ops-performance",             icon: "🖥️" },  // OPC-001
    { label: "Live Unit Status",               href: "/unit-manager/ops-command/live-status",     icon: "🏥" },  // OPC-002
    { label: "Capacity & Bed Coordination",    href: "/unit-manager/ops-command/capacity",        icon: "🛏️" },  // OPC-003
    { label: "Staffing & Assignment Oversight", href: "/unit-manager/ops-command/staffing",       icon: "🧑‍⚕️" }, // OPC-004
    { label: "Patient Flow Coordination",      href: "/unit-manager/ops-command/patient-flow",    icon: "🔄" },  // OPC-005
    { label: "Safety & Escalation",            href: "/unit-manager/ops-command/safety",          icon: "🚨" },  // OPC-006
    { label: "Operational Action Manager",     href: "/unit-manager/ops-command/actions",         icon: "🗒️" },  // OPC-007
    { label: "Shift Timeline & Handover",      href: "/unit-manager/ops-command/handover",        icon: "🕒" },  // OPC-008
    { label: "Operational Forecasting",        href: "/unit-manager/ops-command/forecasting",     icon: "🔮" },  // OPC-009
  ] },
  // POS-001. Not one of the spec's twelve names, but the operational source of truth.
  { key: "patient-ops", title: "Patient Operations", cfg: "unit-manager.patient-operations", spec: false, items: [
    { label: "Dashboard",         href: "/unit-manager/patient-operations",              icon: "📋", exact: true },
    { label: "Census & Registry", href: "/unit-manager/patient-operations/census",       icon: "🧑‍🤝‍🧑" },
    { label: "Patient Flow",      href: "/unit-manager/patient-operations/flow",         icon: "🔀" },
    { label: "Bed & Capacity",    href: "/unit-manager/patient-operations/beds",         icon: "🛏️" },
    { label: "Ward Map",          href: "/unit-manager/patient-operations/ward-map",     icon: "🗺️" },
    { label: "Governance",        href: "/unit-manager/patient-operations/governance",   icon: "🛡️" },
    { label: "Clinical Alerts",   href: "/unit-manager/patient-operations/safety",       icon: "🚨" },
    { label: "Patient Card",      href: "/unit-manager/patient-operations/patient-card", icon: "🪪" },
    { label: "Timeline",          href: "/unit-manager/patient-operations/timeline",     icon: "🕐" },
    { label: "Patient Analytics", href: "/unit-manager/patient-operations/analytics",    icon: "📈" },
  ] },

  // ── 4. Resources & Logistics ──────────────────────────────────────────────
  { key: "resources", title: "Resources & Logistics", cfg: "unit-manager.resources", items: [
    { label: "Resource Operations", href: "/unit-manager/resources",                    icon: "📦" },  // RES-001
    { label: "Assets & Biomedical", href: "/unit-manager/administration/assets",        icon: "🖥️" },  // RES-002 / ADM-004
  ] },

  // ── 3. Clinical Quality & Safety ──────────────────────────────────────────
  { key: "quality", title: "Clinical Quality & Safety", cfg: "unit-manager.quality", items: [
    { label: "Executive Dashboard",      href: "/unit-manager/quality",            icon: "🛡️", exact: true },
    { label: "Incident Management",      href: "/unit-manager/quality/incidents",  icon: "🚩" },
    { label: "Patient Safety Centre",    href: "/unit-manager/quality/patient-safety", icon: "🚑" },
    { label: "Clinical Indicators",      href: "/unit-manager/quality/indicators", icon: "📊" },
    { label: "Mortality & Morbidity",    href: "/unit-manager/quality/mortality",  icon: "🩺" },
    { label: "Quality Command Centre",   href: "/unit-manager/quality/analytics",  icon: "📉" },
    { label: "AI Quality Intelligence",  href: "/unit-manager/quality/ai",         icon: "🤖" },
  ] },
  // ── 7. Improvement & Innovation ───────────────────────────────────────────
  // One real surface today. Given its own heading because the spec names it as a
  // domain, not padded with borrowed links to look fuller than it is.
  { key: "improvement", title: "Improvement & Innovation", cfg: "unit-manager.improvement", items: [
    { label: "CAPA & Improvement", href: "/unit-manager/capa", icon: "📈" },
  ] },
  // ── 8. Accreditation & Governance ─────────────────────────────────────────
  { key: "accreditation", title: "Accreditation & Governance", cfg: "unit-manager.accreditation", items: [
    { label: "Accreditation Readiness", href: "/unit-manager/quality/accreditation", icon: "🏅" },
    { label: "Audit & Compliance",      href: "/unit-manager/quality/audits",        icon: "🔍" },
    { label: "Risk Register",           href: "/unit-manager/quality/risk",          icon: "⚠️" },
  ] },

  // ── 2. Workforce Operations ───────────────────────────────────────────────
  { key: "workforce", title: "Workforce Operations", cfg: "unit-manager.workforce-operations",
    legacy: ["unit-manager.workforce"], items: [
    { label: "Overview",                  href: "/unit-manager/workforce-management",                        icon: "👥", exact: true },
    { label: "Unit Workforce Planning",   href: "/unit-manager/workforce-management/establishment",          icon: "📐" },
    { label: "Staffing Engine",           href: "/unit-manager/workforce-management/staffing-engine",        icon: "🧑‍⚕️" },
    { label: "Team Assignments",          href: "/unit-manager/workforce-management/team-assignments",       icon: "🧩" },
    { label: "Roster Governance",         href: "/unit-manager/workforce-management/roster-governance",      icon: "🗓️" },
    { label: "Availability & Attendance", href: "/unit-manager/workforce-management/attendance",             icon: "📋" },
    { label: "Wellbeing & Fatigue",       href: "/unit-manager/wellbeing",                                   icon: "💚" },
    { label: "Exceptions & Approvals",    href: "/unit-manager/workforce-management/exceptions-approvals",   icon: "⚖️" },
    { label: "Development & Readiness",   href: "/unit-manager/workforce-management/development",            icon: "🎯" },
    { label: "Workforce Analytics",       href: "/unit-manager/workforce-management/analytics",              icon: "📊" },
    { label: "Workforce Configuration",   href: "/unit-manager/workforce-management/configuration",          icon: "🔧" },
  ] },
  // ── 5. Competency & Workforce Development ─────────────────────────────────
  { key: "competency", title: "Competency & Workforce Development", cfg: "unit-manager.competency",
    legacy: ["unit-manager.learning"], items: [
    { label: "Command Centre",         href: "/unit-manager/competency",                 icon: "🎯", exact: true },
    { label: "Coverage & Gaps",        href: "/unit-manager/competency/coverage",        icon: "📊" },
    { label: "Expiries & Recert",      href: "/unit-manager/competency/recertification", icon: "⏳" },
    { label: "Delivered Assignments",  href: "/unit-manager/competency/assignments",     icon: "📬" },
    { label: "Validation Queue",       href: "/unit-manager/competency-validations",     icon: "🗂️" },
    { label: "Assessment Status",      href: "/unit-manager/assessment",                 icon: "📝" },
    { label: "Learning Dashboard",     href: "/unit-manager/learning",                   icon: "📚" },
    { label: "Mandatory Learning",     href: "/unit-manager/learning/mandatory",         icon: "📌" },
    { label: "Professional Development", href: "/unit-manager/learning/development",     icon: "🚀" },
    { label: "Career Pathways",        href: "/unit-manager/learning/pathways",          icon: "🧗" },
    { label: "Education Planning",     href: "/unit-manager/learning/schedule",          icon: "🗓️" },
    { label: "Learning Analytics",     href: "/unit-manager/learning/analytics",         icon: "📊" },
    // Org-wide competency governance lives in the Competency Office; managers are in scope there.
    { label: "Competency Analytics",   href: "/competency-office/analytics",             icon: "📈" },
    { label: "Credentialing",          href: "/competency-office/credentialing",         icon: "🎓" },
    { label: "Frameworks",             href: "/competency-office/frameworks",            icon: "🧩" },
  ] },
  // ── 9. Communications & Collaboration ─────────────────────────────────────
  { key: "comms", title: "Communications & Collaboration", cfg: "unit-manager.communications", items: [
    { label: "Communications Hub", href: "/unit-manager/communications", icon: "📣" },   // TLS-004
  ] },

  // ── 10. AI Intelligence ───────────────────────────────────────────────────
  { key: "ai", title: "AI Intelligence", cfg: "unit-manager.ai", items: [
    { label: "AI Command Centre",         href: "/unit-manager/ai",                            icon: "✨", exact: true },
    { label: "Executive Recommendations", href: "/unit-manager/ai/recommendations",            icon: "💡" },
    { label: "Operational Intelligence",  href: "/unit-manager/ops-performance",               icon: "🧠" },
    { label: "Workforce Intelligence",    href: "/unit-manager/workforce-intelligence",        icon: "👥" },
    { label: "Patient Intelligence",      href: "/unit-manager/patient-operations/analytics",  icon: "🩺" },
    { label: "Quality Intelligence",      href: "/unit-manager/quality/ai",                    icon: "🛡️" },
    { label: "Predictive Analytics",      href: "/unit-manager/performance/predictive",        icon: "🔮" },
  ] },

  // ── 6. Performance Intelligence ───────────────────────────────────────────
  { key: "performance", title: "Performance Intelligence", cfg: "unit-manager.performance",
    legacy: ["unit-manager.analytics"], items: [
    { label: "Unit Performance Dashboard",   href: "/unit-manager/performance",               icon: "📊", exact: true }, // PA-001
    { label: "KPI & Scorecard Centre",       href: "/unit-manager/performance/scorecard",     icon: "🎯" },              // PA-002
    { label: "Trends & Benchmarking",        href: "/unit-manager/performance/trends",        icon: "📈" },              // PA-003
    { label: "Workforce Performance",        href: "/unit-manager/performance/workforce",     icon: "👥" },              // PA-004
    { label: "Operational Performance",      href: "/unit-manager/performance/operational",   icon: "⚙️" },              // PA-005
    { label: "Financial Analytics",          href: "/unit-manager/performance/financial",     icon: "💷" },              // PA-006
    { label: "Predictive & AI Intelligence", href: "/unit-manager/performance/predictive",    icon: "🔮" },              // PA-007
    { label: "Performance Configuration",    href: "/unit-manager/performance/configuration", icon: "🔧" },              // PA-009
  ] },
  // ── 11. Reports & Analytics ───────────────────────────────────────────────
  { key: "reports", title: "Reports & Analytics", cfg: "unit-manager.reports", items: [
    { label: "Executive Reporting",     href: "/unit-manager/performance/reporting",     icon: "🧾" },  // PA-008
    { label: "Operational Reporting",   href: "/unit-manager/ops-command/analytics",     icon: "📉" },  // OPC-011
  ] },

  // ── 12. Administration & Configuration ────────────────────────────────────
  { key: "admin", title: "Administration & Configuration", cfg: "unit-manager.admin", items: [
    { label: "Admin Dashboard",         href: "/unit-manager/administration",                icon: "🗂️", exact: true }, // ADM-001
    { label: "Unit Structure",          href: "/unit-manager/administration/structure",      icon: "🏛️" },              // ADM-002
    { label: "Policies & Documents",    href: "/unit-manager/administration/documents",      icon: "📄" },              // ADM-003
    { label: "Forms & Registers",       href: "/unit-manager/administration/forms",          icon: "📋" },              // ADM-005
    { label: "Configuration Centre",    href: "/unit-manager/administration/configuration",  icon: "🔧" },              // ADM-006
    { label: "Roles & Permissions",     href: "/unit-manager/administration/permissions",    icon: "🔐" },              // TLS-002
    { label: "Permissions & Governance", href: "/unit-manager/administration/governance",    icon: "🛡️" },              // ADM-007
    { label: "Audit & Change Management", href: "/unit-manager/administration/change",       icon: "🕓" },              // ADM-008
    { label: "AI Administration Assistant", href: "/unit-manager/administration/ai-assistant", icon: "🤖" },            // ADM-009
    { label: "Operations Config & Rules", href: "/unit-manager/ops-command/config-rules",    icon: "⚙️" },              // OPC-010
    { label: "Personalisation",         href: "/unit-manager/personalisation",               icon: "🎨" },              // TLS-005
    { label: "Workspace Settings",      href: "/unit-manager/settings",                      icon: "⚙️" },
  ] },
  // Cross-domain authoring engines. Not one of the spec's twelve.
  { key: "engines", title: "Platform Engines", cfg: "unit-manager.platform-engines", spec: false, items: [
    { label: "Workforce Planning Studio",     href: "/unit-manager/planning-studio",       icon: "🏗️" },
    { label: "AI Scheduling Engine",          href: "/unit-manager/scheduling-engine",     icon: "🗓️" },
    { label: "Workforce Intelligence Engine", href: "/unit-manager/workforce-intelligence", icon: "🧠" },
  ] },
];

// UMW-000's six-entry sidebar. Each section holds the domains above; a section
// with a single domain whose title matches its own renders without a sub-heading.
const SIDEBAR: { title: string; domains: string[] }[] = [
  { title: "Dashboard",       domains: ["command"] },
  { title: "Operations",      domains: ["opc", "patient-ops", "resources"] },
  { title: "Quality",         domains: ["quality", "improvement", "accreditation"] },
  { title: "People",          domains: ["workforce", "competency", "comms"] },
  { title: "AI Intelligence", domains: ["ai"] },
  { title: "Tools",           domains: ["performance", "reports", "admin", "engines"] },
];

// Module-level config paths, unchanged from before the restructure.
const ITEM_CFG: Record<string, string> = {
  "Unit Operations Centre": "unit-manager.unit-command.operations-centre",
  "Shift Intelligence": "unit-manager.unit-command.shift-intelligence",
  "Executive Actions": "unit-manager.unit-command.action-centre",
};

const ALLOWED = ["hospital_admin", "super_admin"];

export default async function UnitManagerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/unit-manager" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  // -- CP-SPLIT-002 stage 3 -- GATE 1: THE ESTATE ADMITS COMPETEN PLATFORM MEMBERS ------------------
  // COMP-ARCH-PSA-001 s7 and s14. An identity with no platform_membership row is a Competen Practice
  // practitioner (or nobody yet), reaches no estate surface, and is sent to the product it DOES belong
  // to -- not to a 404 and not to a dead "Access restricted" panel.
  //
  // The whole decision lives in one module so these eleven layouts cannot drift from each other: a
  // super_admin is answered WITHOUT reading the table (the break-glass), and a store that cannot be
  // read ADMITS and falls back to the estate role gate below rather than blanking the platform for all
  // 47 people. Both choices are argued at length in src/lib/platform-membership.ts.
  if (!(await admitToEstate(admin, user.id, userRoles)).admitted) redirect(NO_MEMBERSHIP_DESTINATION);


  // WCE-001 runtime enforcement — hide any section/module a super-admin disabled
  // in the Workspace Configuration Engine Designer (published, resolved along the
  // hierarchy for this user's hospital/role). Fail-soft: no engine tables → all shown.
  const { rows: cfgRows } = await loadConfigOverrides(admin);
  const hid = (profile as { hospital_id?: string | null } | null)?.hospital_id ?? null;
  const cfgCtx = { hospitalId: hid, roles: userRoles as string[], userId: user.id };

  // Live "Clinical Alerts" badge — active safety alerts + open escalations for the
  // unit's hospital. Fail-soft: any query error → no badge. (UMW-003 mockup "(4)".)
  const NONE = "00000000-0000-0000-0000-000000000000";
  const isSuperUser = userRoles.includes("super_admin");
  const alertQ = admin.from("op_safety_alerts").select("id", { count: "exact", head: true }).eq("active", true);
  const escQ = admin.from("op_escalations").select("id", { count: "exact", head: true }).in("status", ["open", "acknowledged"]);
  const [safetyCnt, escCnt] = await Promise.all([
    isSuperUser ? alertQ : alertQ.eq("hospital_id", hid ?? NONE),
    isSuperUser ? escQ : escQ.eq("hospital_id", hid ?? NONE),
  ]);
  const clinicalAlerts = (safetyCnt.error ? 0 : safetyCnt.count ?? 0) + (escCnt.error ? 0 : escCnt.count ?? 0);

  // A domain is shown unless its own config path OR any legacy path it inherited from the
  // pre-UMW-000 grouping is disabled. Honouring the legacy paths means the restructure cannot
  // silently re-enable something a super-admin had switched off under the old names.
  const domainOn = (d: Domain) =>
    isEnabled(cfgRows, cfgCtx, d.cfg) && (d.legacy ?? []).every(p => isEnabled(cfgRows, cfgCtx, p));

  const visibleSections = SIDEBAR.map(sec => ({
    title: sec.title,
    domains: sec.domains
      .map(k => DOMAINS.find(d => d.key === k)!)
      .filter(d => d && domainOn(d))
      .map(d => ({ ...d, items: d.items
        .filter(it => { const p = ITEM_CFG[it.label]; return !p || isEnabled(cfgRows, cfgCtx, p); })
        .map(it => it.label === "Clinical Alerts" && clinicalAlerts ? { ...it, badge: clinicalAlerts } : it) }))
      .filter(d => d.items.length > 0),
  })).filter(sec => sec.domains.length > 0);

  // Dedupe destinations that legitimately appear under more than one domain (a cross-link such as
  // Predictive Analytics under both AI Intelligence and Performance) — otherwise the flattened
  // mobile bar renders duplicate pills with colliding React keys.
  const mobileItems = visibleSections
    .flatMap(sec => sec.domains.flatMap(d => d.items.filter(i => i.href)))
    .filter((it, i, arr) => arr.findIndex(x => x.href === it.href) === i);

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Unit Manager workspace is for unit, ward and department managers.</p>
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
            <span className="block text-teal-300/60 text-[10px] leading-tight">Unit Manager</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileItems.map(({ label, href }) => (
            <Link key={label} href={href!} className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Unit Manager"
          workspaceHref="/unit-manager"
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
          <Link href="/unit-manager" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label>
            <span className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Unit Manager</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {visibleSections.map(section => {
              // A section whose only domain shares its name needs no sub-heading — repeating
              // "Dashboard / Dashboard" would be noise rather than structure.
              const showHeadings = !(section.domains.length === 1 && section.domains[0].title === section.title);
              return (
                <NavGroup key={section.title} title={section.title}
                  hrefs={section.domains.flatMap(d => d.items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0]))}
                  headerClass="text-[10px] font-bold uppercase tracking-wider text-teal-400/60">
                  {section.domains.map(domain => (
                    // The domain heading is an accordion too, so both levels collapse: the section, and
                    // each domain within it. Same NavGroup as the section above, which keeps the icon rail
                    // correct -- the CSS force-shows every nested details' items, so a collapsed domain
                    // still appears as icons rather than vanishing from the rail.
                    <NavGroupOrPlain key={domain.key} heading={showHeadings ? domain.title : null}
                      hrefs={domain.items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                      headerClass="text-[9px] font-semibold uppercase tracking-wider text-teal-500/50">
                      {domain.items.map(item => item.soon || !item.href ? (
                        <span key={domain.key + item.label} data-sb-item title={`${item.label}${item.badge ? "" : " · soon"}`}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm cursor-default select-none ${item.badge ? "text-teal-100/60" : "text-teal-100/25"}`}>
                          <span className="w-5 text-center text-sm">{item.icon}</span>
                          <span data-sb-label className="flex-1 truncate">{item.label}</span>
                          {item.badge ? (
                            <span className="text-[9px] font-bold bg-[var(--cmp-color-error)] text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{item.badge > 99 ? "99+" : item.badge}</span>
                          ) : (
                            <span data-sb-label className="text-[8px] font-bold uppercase tracking-wider bg-teal-950 text-teal-400/40 rounded px-1 py-0.5">soon</span>
                          )}
                        </span>
                      ) : (
                        <NavLink key={domain.key + item.label} href={item.href} icon={item.icon} label={item.label} exact={item.exact}
                          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors"
                          activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm bg-teal-700/60 text-white font-medium" />
                      ))}
                    </NavGroupOrPlain>
                  ))}
                </NavGroup>
              );
            })}
            <div className="my-2 border-t border-teal-800/30" />
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
