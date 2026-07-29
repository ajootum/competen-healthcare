import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import QuickCreate from "./QuickCreate";
import LibrarySearch from "@/app/dashboard/library/LibrarySearch";

// CST-000 — Competency Studio Platform. The no-code authoring platform and single source of truth
// for the competency definitions every workspace consumes. This hub presents the 12 core studio
// modules (CST-001..012), the reference-library / supply-chain modules (CST-102..112) and the
// governance & lifecycle modules — each linking to its REAL authoring or governance surface.
// Modules still on the Phase-2 backlog are marked "Planned" and left unlinked so nothing dead-ends.
// Architecture flow: Framework → Competency → Evidence → Assessment → Learning → Rules → AI → Test
//                    → Approval → Publishing → Competency Office → Platform Consumption.

export const dynamic = "force-dynamic";

type Mod = { code: string; icon: string; label: string; desc: string; href?: string; stat?: string | null; planned?: boolean };

const PIPELINE = ["Framework", "Competency", "Evidence", "Assessment", "Learning", "Rules", "AI review", "Test", "Approve", "Publish", "Consume"];

function ModuleCard({ m }: { m: Mod }) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-300 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.planned ? "text-gray-500" : "text-gray-900 group-hover:text-teal-700"}`}>{m.label}</p>
        </div>
        {m.planned && <span className="ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">Planned</span>}
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
      {m.stat && <p className="text-[10px] font-semibold text-teal-600 mt-2">{m.stat}</p>}
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-teal-200 hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const today = new Date().toISOString().slice(0, 10);
  // count-only queries; each fails soft to 0 if a table/column is not provisioned yet.
  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0);
  const [
    frameworks, domains, comps, cpus, banks, pathways,
    publications, methods, rules, drafts, inReview, readyToPublish, reviewsDue, respDue,
  ] = await Promise.all([
    c(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("framework_domains").select("id", { count: "exact", head: true })),
    c(admin.from("framework_competencies").select("id", { count: "exact", head: true })),
    c(admin.from("clinical_practice_units").select("id", { count: "exact", head: true })),
    c(admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("learning_pathways").select("id", { count: "exact", head: true })),
    c(admin.from("cmo_publications").select("id", { count: "exact", head: true })),
    c(admin.from("assessment_method_configs").select("id", { count: "exact", head: true })),
    c(admin.from("cmo_assignment_rules").select("id", { count: "exact", head: true })),
    c(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true).eq("pub_status", "draft")),
    c(admin.from("content_approvals").select("id", { count: "exact", head: true }).eq("status", "pending")),
    c(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true).eq("pub_status", "approved")),
    c(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true).lt("review_date", today)),
    c(admin.from("content_responsibilities").select("id", { count: "exact", head: true }).eq("status", "active").lt("review_due", today)),
  ]);

  const PORTFOLIO = [
    { label: "Frameworks", value: frameworks, icon: "🧬" },
    { label: "Competencies", value: comps, icon: "🪪" },
    { label: "CPUs", value: cpus, icon: "🏥" },
    { label: "Assessment configs", value: methods, icon: "🩺" },
    { label: "Learning paths", value: pathways, icon: "📚" },
    { label: "Publications", value: publications, icon: "🚦" },
  ];

  const ATTENTION = [
    { label: "Draft frameworks", value: drafts, icon: "📝", href: "/super-admin/content", on: drafts > 0, tone: "text-blue-600" },
    { label: "Awaiting review", value: inReview, icon: "⚖️", href: "/admin/approvals", on: inReview > 0, tone: "text-amber-600" },
    { label: "Ready to publish", value: readyToPublish, icon: "🚀", href: "/competency-office/publishing", on: readyToPublish > 0, tone: "text-teal-600" },
    { label: "Framework reviews due", value: reviewsDue, icon: "⏰", href: "/super-admin/content", on: reviewsDue > 0, tone: "text-red-500" },
    { label: "Ownership reviews due", value: respDue, icon: "🧾", href: "/super-admin/studio/responsibilities", on: respDue > 0, tone: "text-red-500" },
  ];

  const CORE: Mod[] = [
    { code: "CST-001", icon: "🧬", label: "Framework Designer", desc: "Design framework → domain → category → competency hierarchies with live validation.", href: "/super-admin/content", stat: `${frameworks} frameworks · ${domains} domains` },
    { code: "CST-002", icon: "🪪", label: "Competency Builder", desc: "Author competencies — behaviours, indicators, criteria, evidence & metadata.", href: "/super-admin/content", stat: `${comps} competencies` },
    { code: "CST-003", icon: "🩺", label: "Assessment Studio", desc: "OSCE, DOPS, Mini-CEX, MCQ & viva — blueprints, scoring rules and rubrics.", href: "/super-admin/assessment-methods", stat: `${methods} configs · ${banks} banks` },
    { code: "CST-004", icon: "📎", label: "Evidence Studio", desc: "Evidence requirements per CPU — types, quantities, validity and verification.", href: "/super-admin/content", stat: `${cpus} CPUs` },
    { code: "CST-005", icon: "📚", label: "Learning Path Studio", desc: "Sequence learning journeys linked to competencies, remediation and CPD.", href: "/admin/resources", stat: `${pathways} pathways` },
    { code: "CST-006", icon: "🎬", label: "Simulation Studio", desc: "Branching scenarios, mock codes & team sims. AI drafting is live; a versioned scenario store is Phase 2.", href: "/educator/simulation" },
    { code: "CST-007", icon: "⚙️", label: "Rules Engine", desc: "Progression, scoring, recertification & automation. Assignment rules live; a unified engine consolidates in Phase 2.", href: "/competency-office/assignment-rules", stat: `${rules} assignment rules` },
    { code: "CST-008", icon: "🚦", label: "Publishing & Versioning", desc: "Governed draft → review → approve → release → rollback with impact analysis.", href: "/competency-office/publishing", stat: `${publications} publications` },
    { code: "CST-009", icon: "✨", label: "AI Design Assistant", desc: "Draft, gap-check & optimise assets on the governed AI gateway — human-approved.", href: "/super-admin/assistant" },
    { code: "CST-010", icon: "🧪", label: "Testing & Sandbox", desc: "Persona-driven preview and test-before-publish for authored content.", planned: true },
    { code: "CST-011", icon: "📊", label: "Analytics & Optimisation", desc: "Content quality, adoption, outcome and benchmark analytics across the portfolio.", href: "/competency-office/analytics" },
    { code: "CST-012", icon: "🔌", label: "Integration & API", desc: "Publish approved assets to every workspace over the governed event backbone.", href: "/competency-office/integration" },
  ];

  const REFERENCE: Mod[] = [
    { code: "CST-102", icon: "🧩", label: "Template Library", desc: "Reusable competency, assessment and blueprint starter templates.", planned: true },
    { code: "CST-103", icon: "📐", label: "Blueprint Designer", desc: "Specialty blueprints — pathways, sequencing, assessment and evidence maps.", href: "/super-admin/content", stat: "per-CPU blueprints" },
    { code: "CST-104", icon: "🗺️", label: "Mapping Studio", desc: "Map competencies ↔ roles, curricula, assessments, evidence and objectives.", planned: true },
    { code: "CST-105", icon: "🔗", label: "Dependency Manager", desc: "Prerequisite, co-requisite, equivalency and critical-path graphs.", planned: true },
    { code: "CST-108", icon: "📏", label: "Standards Mapping", desc: "Map assets to WHO, JCI, SafeCare, MOH and council standards.", href: "/competency-office/standards", stat: "library live · mapping Phase 2" },
    { code: "CST-109", icon: "📦", label: "Package Manager", desc: "Bundle competencies into deployable specialty and role packages.", planned: true },
    { code: "CST-110", icon: "🛍️", label: "Marketplace", desc: "Discover, license and install competency packages across the ecosystem.", planned: true },
    { code: "CST-111", icon: "📥", label: "Migration & Import", desc: "Import authored CPU documents → competencies, skills, rules and questions.", href: "/super-admin/studio/import" },
    { code: "CST-112", icon: "🗄️", label: "Archive & Repository", desc: "Long-term preservation, enterprise search and controlled restore of retired assets.", href: "/super-admin/ckp/repository" },
  ];

  const GOVERNANCE: Mod[] = [
    { code: "CST-101", icon: "♻️", label: "Lifecycle Management", desc: "Every asset from request to retirement — persisted state machine.", href: "/competency-office/lifecycle-state" },
    { code: "CST-106", icon: "⚖️", label: "Review & Governance", desc: "Committee review, standards compliance, decisions and e-sign-off.", href: "/competency-office/review-board" },
    { code: "CST-107", icon: "✅", label: "Quality Assurance", desc: "Content-quality linter over authored competencies — completeness, assessment integrity, evidence coverage.", href: "/super-admin/studio/qa" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-000 · Competency Studio Platform</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Studio</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            The no-code authoring platform and single source of truth for every competency the platform consumes.
          </p>
        </div>
        <QuickCreate />
      </div>

      {/* Portfolio at a glance */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
        {PORTFOLIO.map(p => (
          <div key={p.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{p.icon}</span><p className="text-xl font-bold text-gray-900">{p.value}</p></div>
            <p className="text-[10px] text-gray-400 font-medium">{p.label}</p>
          </div>
        ))}
      </div>

      {/* CST-100 — authoring pipeline flow */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">CST-100 · Authoring workflow</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">{s}</span>
              {i < PIPELINE.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* What needs my attention today? */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {ATTENTION.map(w => (
          <Link key={w.label} href={w.href} className="bg-white rounded-xl border border-gray-100 p-4 hover:border-teal-200 transition-colors">
            <div className="flex items-center justify-between mb-1"><span>{w.icon}</span><p className={`text-2xl font-bold ${w.on ? w.tone : "text-gray-300"}`}>{w.value}</p></div>
            <p className="text-[10px] text-gray-400 font-medium">{w.label}</p>
          </Link>
        ))}
      </div>

      {/* Global search across the governed knowledge base */}
      <div className="mb-7"><LibrarySearch /></div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Core studio modules · CST-001–012</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">
        {CORE.map(m => <ModuleCard key={m.code} m={m} />)}
      </div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Reference library &amp; supply chain · CST-102–112</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">
        {REFERENCE.map(m => <ModuleCard key={m.code} m={m} />)}
      </div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Governance &amp; lifecycle · CST-101/106/107</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">
        {GOVERNANCE.map(m => <ModuleCard key={m.code} m={m} />)}
      </div>

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-5">
        <p className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-2">Recommended workflow</p>
        <p className="text-sm text-teal-900">
          Create Domain → Create CPU → Create Competencies → Create Skills → Create Checklist → Create Assessment → Link Learning → Review → Publish.
          Reverse building works too — start with a checklist and link it upward later.
        </p>
      </div>
    </div>
  );
}
