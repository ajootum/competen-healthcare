import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";

// CAP-000 — Competency Asset Platform. The enterprise asset-repository layer: "every competency asset
// exists once, is governed once, and is reused everywhere." This hub is the single-source-of-truth view —
// it counts and links every REAL asset type across the platform and presents the 16 CAP engines
// (CAP-001..016) mapped to their existing surfaces. Genuine gaps (a unified asset-object model, semantic/
// vector search, localisation) are flagged "Planned", never dead-linked. Real data, no migration.

export const dynamic = "force-dynamic";

type Mod = { code: string; icon: string; label: string; desc: string; href?: string; planned?: boolean };

function EngineCard({ m }: { m: Mod }) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-500 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.planned ? "text-gray-500" : "text-gray-900 group-hover:text-teal-700"}`}>{m.label}</p>
        </div>
        {m.planned && <span className="ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] px-1.5 py-0.5 rounded">Planned</span>}
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href ? <Link href={m.href} className={`${base} hover:border-teal-200 hover:shadow-sm transition-all group`}>{inner}</Link> : <div className={`${base} opacity-80`}>{inner}</div>;
}

function Layer({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function AssetPlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0);
  const [frameworks, competencies, skills, cpus, blueprints, banks, osce, sims, resources, knowledge, packages, publications] = await Promise.all([
    c(admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("framework_competencies").select("id", { count: "exact", head: true })),
    c(admin.from("skill_library").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("clinical_practice_units").select("id", { count: "exact", head: true })),
    c(admin.from("assessment_blueprints").select("id", { count: "exact", head: true })),
    c(admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("osce_stations").select("id", { count: "exact", head: true })),
    c(admin.from("simulation_scenarios").select("id", { count: "exact", head: true })),
    c(admin.from("learning_resources").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("knowledge_objects").select("id", { count: "exact", head: true })),
    c(admin.from("competency_packages").select("id", { count: "exact", head: true })),
    c(admin.from("cmo_publications").select("id", { count: "exact", head: true })),
  ]);

  const ASSETS = [
    { label: "Frameworks", value: frameworks, icon: "🧬", href: "/super-admin/content" },
    { label: "Competencies", value: competencies, icon: "🪪", href: "/super-admin/content" },
    { label: "Skills", value: skills, icon: "✋", href: "/super-admin/studio/skills" },
    { label: "CPUs", value: cpus, icon: "🏥", href: "/super-admin/studio/cpus" },
    { label: "Assessment blueprints", value: blueprints, icon: "📐", href: "/super-admin/assessment-methods" },
    { label: "Question banks", value: banks, icon: "❓", href: "/super-admin/studio/questions" },
    { label: "OSCE stations", value: osce, icon: "🎭", href: "/super-admin/ckp/assessment" },
    { label: "Simulation scenarios", value: sims, icon: "🎬", href: "/super-admin/studio/simulations" },
    { label: "Learning resources", value: resources, icon: "📚", href: "/admin/resources" },
    { label: "Knowledge objects", value: knowledge, icon: "🫀", href: "/super-admin/ckp/repository" },
    { label: "Packages", value: packages, icon: "📦", href: "/super-admin/studio/packages" },
    { label: "Publications", value: publications, icon: "🚦", href: "/competency-office/publishing" },
  ];
  const totalAssets = ASSETS.reduce((s, a) => s + a.value, 0);
  const assetTypes = ASSETS.filter(a => a.value > 0).length;

  const REPOSITORY: Mod[] = [
    { code: "CAP-001", icon: "🗄️", label: "Asset Repository", desc: "Browse, filter and search the governed index of every competency asset — one header over all 12 source types.", href: "/super-admin/studio/assets/browser" },
    { code: "CAP-002", icon: "🏷️", label: "Metadata & Classification", desc: "Tags, taxonomy and classification across all asset types.", href: "/super-admin/metadata" },
    { code: "CAP-007", icon: "🔗", label: "Relationship Engine", desc: "Prerequisite, equivalency and dependency links between assets.", href: "/super-admin/studio/dependencies" },
    { code: "CAP-008", icon: "🗺️", label: "Clinical Knowledge Mapping", desc: "Map assets to clinical knowledge, standards and the knowledge graph.", href: "/super-admin/studio/mapping" },
  ];
  const VERSION_GOV: Mod[] = [
    { code: "CAP-003", icon: "🧾", label: "Version Control", desc: "Semantic versions, change requests and immutable publication history.", href: "/competency-office/publishing" },
    { code: "CAP-009", icon: "♻️", label: "Lifecycle Management", desc: "Author → review → approve → publish → active → revise → archive.", href: "/competency-office/lifecycle-state" },
    { code: "CAP-015", icon: "⚖️", label: "Governance Engine", desc: "Review boards, approvals, e-sign-off and audit across assets.", href: "/competency-office/review-board" },
  ];
  const PUBLISH_DIST: Mod[] = [
    { code: "CAP-004", icon: "🚦", label: "Publishing Engine", desc: "Governed release of assets to production with rollback.", href: "/competency-office/publishing" },
    { code: "CAP-005", icon: "🛰️", label: "Distribution Engine", desc: "Distribute published assets to workspaces via packages and the marketplace.", href: "/super-admin/studio/marketplace" },
    { code: "CAP-010", icon: "🧩", label: "Reuse Engine", desc: "Clone, template and reuse assets enterprise-wide.", href: "/super-admin/studio/templates" },
    { code: "CAP-013", icon: "📥", label: "Import / Export", desc: "Import authored documents and export asset bundles.", href: "/super-admin/studio/import" },
    { code: "CAP-012", icon: "🌐", label: "Translation & Localisation", desc: "Track asset translations into target locales — coverage, status and translators.", href: "/super-admin/studio/translations" },
  ];
  const SEARCH_AI: Mod[] = [
    { code: "CAP-006", icon: "🔍", label: "Search & Discovery", desc: "Hybrid keyword + vector asset search — semantic recall over the whole repository.", href: "/super-admin/studio/assets/search" },
    { code: "CAP-011", icon: "✨", label: "AI Asset Intelligence", desc: "AI recommendations, duplicate detection and quality scoring on the governed gateway.", href: "/super-admin/assistant" },
    { code: "CAP-014", icon: "📈", label: "Asset Analytics", desc: "Utilisation, adoption, quality and coverage analytics across assets.", href: "/competency-office/analytics" },
    { code: "CAP-016", icon: "🔧", label: "Configuration Engine", desc: "No-code platform configuration and asset-type registry.", href: "/super-admin/platform-ops/configuration" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CAP-000 · Competency Asset Platform</p>
          <h1 className="text-xl font-bold text-gray-900">Asset Repository</h1>
          <p className="text-gray-500 text-sm mt-0.5">The single source of truth — every competency asset, governed once and reused everywhere across the ecosystem.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/super-admin/studio/assets/browser" className="text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg px-3 py-2">Browse assets →</Link>
          <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
        </div>
      </div>

      {/* Repository summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-gray-900">{totalAssets}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Total assets</p></div>
        <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-gray-900">{assetTypes}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Asset types</p></div>
        <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-teal-600">{publications}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Published</p></div>
      </div>

      {/* Managed asset catalogue */}
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Managed assets</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-7">
        {ASSETS.map(a => (
          <Link key={a.label} href={a.href} className="bg-white rounded-xl border border-gray-100 p-3.5 hover:border-teal-200 transition-colors">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{a.icon}</span><p className="text-lg font-bold text-gray-900">{a.value}</p></div>
            <p className="text-[10px] text-gray-500 font-medium">{a.label}</p>
          </Link>
        ))}
      </div>

      <Layer title="Repository, Metadata & Relationships · CAP-001/002/007/008" mods={REPOSITORY} />
      <Layer title="Version, Lifecycle & Governance · CAP-003/009/015" mods={VERSION_GOV} />
      <Layer title="Publishing, Distribution & Reuse · CAP-004/005/010/012/013" mods={PUBLISH_DIST} />
      <Layer title="Search, AI, Analytics & Configuration · CAP-006/011/014/016" mods={SEARCH_AI} />

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">One repository, many surfaces.</span> CAP unifies the assets the Competency &amp; Assessment Studios author and the Competency Office governs — the counts above are live from each real store. A single unified asset-object model, semantic/vector search and localisation are the deeper next-phase re-platform described in the CAP reference architecture.
        </p>
      </div>
    </div>
  );
}
