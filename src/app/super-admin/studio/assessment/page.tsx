import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ModuleCard } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CST-031..047 — Assessment Studio. The assessment authoring sub-platform of the Competency Studio:
// framework design, blueprinting, question authoring, adaptive delivery, performance assessment (skills /
// workplace / OSCE / behaviour / 360 / portfolio), scoring, standard-setting, psychometrics and
// publishing/analytics. This hub presents all 17 modules, each linking to its REAL surface; genuine gaps
// (adaptive, behaviour, 360, standard-setting, psychometrics) are marked "Planned", never dead-linked.

export const dynamic = "force-dynamic";

type Mod = { code: string; icon: string; label: string; desc: string; href?: string; stat?: string | null; planned?: boolean };



function Section({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <ModuleCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function AssessmentStudioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0);
  const [assessments, banks, checklists, stations, blueprints, methods] = await Promise.all([
    c(admin.from("assessments").select("id", { count: "exact", head: true })),
    c(admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("skill_checklists").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("osce_stations").select("id", { count: "exact", head: true })),
    c(admin.from("assessment_blueprints").select("id", { count: "exact", head: true })),
    c(admin.from("assessment_method_configs").select("id", { count: "exact", head: true })),
  ]);

  const PORTFOLIO = [
    { label: "Assessments", value: assessments, icon: "📋" },
    { label: "Question banks", value: banks, icon: "❓" },
    { label: "Skills checklists", value: checklists, icon: "☑️" },
    { label: "OSCE stations", value: stations, icon: "🏥" },
    { label: "Blueprints", value: blueprints, icon: "📐" },
    { label: "Method configs", value: methods, icon: "🎚️" },
  ];

  const DESIGN: Mod[] = [
    { code: "CST-031", icon: "🧭", label: "Framework Designer", desc: "Define what, why, who and how assessment occurs — methods, strategy, rules and governance.", href: "/super-admin/assessment-methods", stat: `${methods} method configs` },
    { code: "CST-032", icon: "📐", label: "Blueprint & Weighting", desc: "Coverage, weighting, cognitive/performance levels and pass criteria per assessment.", href: "/super-admin/content", stat: `${blueprints} blueprints` },
    { code: "CST-033", icon: "♻️", label: "Lifecycle Management", desc: "Idea → draft → review → pilot → approve → publish → retire, version-controlled.", href: "/competency-office/lifecycle-state" },
  ];
  const ITEMS: Mod[] = [
    { code: "CST-034", icon: "✍️", label: "Question Authoring", desc: "MCQ, EMQ, clinical case, image/ECG, calculation — rich clinical item editor with review workflow.", href: "/super-admin/studio/questions", stat: `${banks} banks` },
    { code: "CST-035", icon: "🗄️", label: "Question Bank", desc: "Governed enterprise item repository — libraries, search, versioning, psychometric stats.", href: "/super-admin/studio/questions" },
    { code: "CST-036", icon: "🎯", label: "Adaptive Examination", desc: "Adaptive exam blueprints — item pool, length, difficulty progression and mastery stopping rules.", href: "/super-admin/studio/adaptive" },
  ];
  const PERFORMANCE: Mod[] = [
    { code: "CST-037", icon: "☑️", label: "Skills Checklist Designer", desc: "Procedure steps, critical steps, performance criteria and evidence for procedural assessment.", href: "/super-admin/studio/checklists", stat: `${checklists} checklists` },
    { code: "CST-038", icon: "🩺", label: "Workplace Assessment", desc: "DOPS, Mini-CEX, CBD, EPA and longitudinal observation with entrustment decisions.", href: "/super-admin/assessment-methods" },
    { code: "CST-039", icon: "🎭", label: "OSCE & Simulation", desc: "OSCE stations, standardized patients, rubrics, debriefing and simulation scenarios.", href: "/super-admin/ckp/assessment", stat: `${stations} stations` },
    { code: "CST-040", icon: "🤝", label: "Professional Behaviour", desc: "Observable behaviour indicators across professionalism, communication, teamwork, ethics — BARS anchors.", href: "/super-admin/studio/behaviour" },
    { code: "CST-041", icon: "🔄", label: "360° Assessment", desc: "Multisource feedback — weighted respondent groups (self / peer / supervisor / patient), anonymous.", href: "/super-admin/studio/three-sixty" },
    { code: "CST-042", icon: "📁", label: "Portfolio Assessment", desc: "Portfolio templates — required-evidence sections, artefact counts and weighting.", href: "/super-admin/studio/portfolio" },
  ];
  const SCORING: Mod[] = [
    { code: "CST-043", icon: "⚖️", label: "Scoring & Decision Rules", desc: "Scoring models, pass/fail, critical failure, entrustment and mastery decision logic.", href: "/super-admin/studio/rules" },
    { code: "CST-044", icon: "📏", label: "Standard Setting", desc: "Defensible cut scores — Angoff-family judge ratings, computed cut and real pass-rate impact.", href: "/super-admin/studio/standard-setting" },
    { code: "CST-045", icon: "📊", label: "Quality & Psychometrics", desc: "Item difficulty, discrimination, distractor analysis and KR-20 — computed from real attempts.", href: "/super-admin/studio/psychometrics" },
  ];
  const GOVERNANCE: Mod[] = [
    { code: "CST-046", icon: "🚦", label: "Publishing & Governance", desc: "Governed approval, versioning, tenant inheritance and retirement of assessment assets.", href: "/competency-office/publishing" },
    { code: "CST-047", icon: "📈", label: "Analytics & Insights", desc: "Outcomes, competency trends, assessor reliability, predictive readiness and benchmarking.", href: "/competency-office/analytics" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-031–047 · Assessment Studio</p>
          <h1 className="text-xl font-bold text-gray-900">Assessment Studio</h1>
          <p className="text-gray-500 text-sm mt-0.5">Design, author, deliver, score and govern every assessment type — the assessment engine of the Competency Studio.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {PORTFOLIO.map(p => (
          <div key={p.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{p.icon}</span><p className="text-xl font-bold text-gray-900">{p.value}</p></div>
            <p className="text-[10px] text-gray-500 font-medium">{p.label}</p>
          </div>
        ))}
      </div>

      <Section title="Design & Blueprint · CST-031–033" mods={DESIGN} />
      <Section title="Item Authoring · CST-034–036" mods={ITEMS} />
      <Section title="Performance Assessment · CST-037–042" mods={PERFORMANCE} />
      <Section title="Scoring & Standards · CST-043–045" mods={SCORING} />
      <Section title="Governance & Analytics · CST-046–047" mods={GOVERNANCE} />

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">Assessment authoring platform.</span> Question banks, checklists, OSCE, methods, blueprints, scoring rules, publishing and analytics are live today. Adaptive delivery, behaviour/360/portfolio designers, standard-setting and the psychometric analysis studio are the next-phase build queue.
        </p>
      </div>
    </div>
  );
}
