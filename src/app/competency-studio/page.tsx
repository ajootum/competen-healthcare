import Link from "next/link";
import { studioGuard } from "./_studio-ui";

// CST-000 (peer) — Competency Studio home for the author audience. Presents the studio modules (which run
// here at /competency-studio/*, hospital-scoped for non-super users) and role-routes the authoring
// builders to each caller's existing surface. Same platform as the super-admin Studio, opened to authors.

export const dynamic = "force-dynamic";

type Mod = { code: string; icon: string; label: string; desc: string; href: string };

function Grid({ mods }: { mods: Mod[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
      {mods.map(m => (
        <Link key={m.code} href={m.href} className="bg-white rounded-xl border border-gray-100 p-4 hover:border-indigo-200 hover:shadow-sm transition-all group block">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="text-xl shrink-0">{m.icon}</span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-gray-300 tracking-widest">{m.code}</p>
              <p className="font-bold text-sm leading-tight text-gray-900 group-hover:text-indigo-700">{m.label}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
        </Link>
      ))}
    </div>
  );
}

export default async function CompetencyStudioHome() {
  const { admin, isSuper, hid, roles, fullName } = await studioGuard();
  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0);
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`)); // eslint-disable-line @typescript-eslint/no-explicit-any

  const [frameworks, competencies, deps, standards, packages, scenarios] = await Promise.all([
    c(scope(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true))),
    c(admin.from("framework_competencies").select("id", { count: "exact", head: true })),
    c(scope(admin.from("competency_dependencies").select("id", { count: "exact", head: true }))),
    c(scope(admin.from("competency_standard_mappings").select("id", { count: "exact", head: true }))),
    c(scope(admin.from("competency_packages").select("id", { count: "exact", head: true }))),
    c(scope(admin.from("simulation_scenarios").select("id", { count: "exact", head: true }))),
  ]);

  // Role-routed authoring builders — each caller reaches their own authoring surface.
  const authoringHref = isSuper ? "/super-admin/content" : roles.includes("educator") ? "/educator/studio" : roles.includes("assessor") ? "/assessor/studio" : "/educator/studio";
  const assessmentHref = isSuper ? "/super-admin/assessment-methods" : authoringHref;

  const AUTHORING: Mod[] = [
    { code: "CST-001/002", icon: "🧬", label: "Framework & Competency", desc: "Author frameworks, domains, competencies, behaviours and indicators.", href: authoringHref },
    { code: "CST-003", icon: "🩺", label: "Assessment Studio", desc: "Blueprints, methods, checklists, rubrics and question banks.", href: assessmentHref },
    { code: "CST-004", icon: "📎", label: "Evidence Studio", desc: "Evidence requirements per CPU — types, quantities, validity.", href: authoringHref },
  ];

  const MODULES: Mod[] = [
    { code: "CST-107", icon: "✅", label: "Quality Assurance", desc: "Content completeness linter across authored competencies.", href: "/competency-studio/qa" },
    { code: "CST-105", icon: "🔗", label: "Dependencies", desc: "Prerequisite / co-requisite graph — cycle-checked.", href: "/competency-studio/dependencies" },
    { code: "CST-007", icon: "⚙️", label: "Rules Engine", desc: "Consolidated progression, scoring, evidence and recertification rules.", href: "/competency-studio/rules" },
    { code: "CST-104", icon: "🗺️", label: "Mapping Studio", desc: "Traceability across assessment / evidence / learning / standards.", href: "/competency-studio/mapping" },
    { code: "CST-108", icon: "📏", label: "Standards Mapping", desc: "Map competencies to WHO / JCI / SafeCare / MOH standards.", href: "/competency-studio/standards" },
    { code: "CST-005", icon: "📚", label: "Learning Paths", desc: "Programmes, curricula and the learning-resource library.", href: "/competency-studio/learning" },
    { code: "CST-006", icon: "🎬", label: "Simulation Studio", desc: "Author, version and govern simulation scenarios.", href: "/competency-studio/simulations" },
    { code: "CST-102", icon: "🧩", label: "Template Library", desc: "Reusable frameworks, skills, question banks and CPUs to clone.", href: "/competency-studio/templates" },
    { code: "CST-109", icon: "📦", label: "Package Manager", desc: "Bundle competencies into versioned, deployable packages.", href: "/competency-studio/packages" },
    { code: "CST-110", icon: "🛍️", label: "Marketplace", desc: "Discover and adopt published competency packages.", href: "/competency-studio/marketplace" },
    { code: "CST-010", icon: "🧪", label: "Release Readiness", desc: "Validate frameworks before publication — one gate.", href: "/competency-studio/testing" },
  ];

  const GOVERNANCE: Mod[] = [
    { code: "CST-008", icon: "🚦", label: "Publishing & Versioning", desc: "Governed release workflow with impact analysis.", href: "/competency-office/publishing" },
    { code: "CST-106", icon: "⚖️", label: "Review & Governance", desc: "Committee review, decisions and e-sign-off.", href: "/competency-office/review-board" },
    { code: "CST-101", icon: "♻️", label: "Lifecycle Management", desc: "Every asset from request to retirement.", href: "/competency-office/lifecycle-state" },
    { code: "CST-011", icon: "📊", label: "Analytics", desc: "Content quality, adoption and outcome analytics.", href: "/competency-office/analytics" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CST-000 · Competency Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Welcome{fullName ? `, ${fullName.split(" ")[0]}` : ""}</h1>
        <p className="text-gray-400 text-sm mt-0.5">Author, validate, package and govern competencies — {isSuper ? "across the enterprise" : "for your organisation"}.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {[
          { label: "Frameworks", value: frameworks }, { label: "Competencies", value: competencies }, { label: "Dependencies", value: deps },
          { label: "Standard mappings", value: standards }, { label: "Packages", value: packages }, { label: "Scenarios", value: scenarios },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <p className="text-xl font-bold text-gray-900">{k.value}</p>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Authoring builders</h2>
      <div className="mb-6"><Grid mods={AUTHORING} /></div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Studio modules</h2>
      <div className="mb-6"><Grid mods={MODULES} /></div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Governance &amp; publishing</h2>
      <Grid mods={GOVERNANCE} />
    </div>
  );
}
