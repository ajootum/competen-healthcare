import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { StatTiles, Card } from "../reports/ui";

// Assessment Studio (replaces the "Templates & Tools" soon-row). The
// authoring and publishing centre for assessment assets — every count on this
// page is a live table count, every module card links to a real builder or
// view, and modules with no backing store are muted "soon" chips.

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", running: "bg-green-100 text-green-700",
  completed: "bg-indigo-100 text-indigo-700", cancelled: "bg-red-100 text-red-600",
  active: "bg-green-100 text-green-700", retired: "bg-gray-100 text-gray-400",
};

export default async function AssessmentStudioPage() {
  const { admin } = await requireAnalyticsAccess();

  const [
    { count: bankCount }, { count: questionCount }, { count: checklistCount }, { count: itemCount },
    { count: osceCount }, { count: caseCount }, { count: knowledgeCount }, { count: fwCount },
    { data: recentBanks }, { data: recentChecklists }, { data: recentOsce }, { data: recentCases }, { data: recentKnowledge },
    { data: caseStatuses }, { data: knowledgeStatuses },
  ] = await Promise.all([
    admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("questions").select("id", { count: "exact", head: true }).not("bank_id", "is", null),
    admin.from("skill_checklists").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("checklist_items").select("id", { count: "exact", head: true }),
    admin.from("osce_exams").select("id", { count: "exact", head: true }),
    admin.from("clinical_cases").select("id", { count: "exact", head: true }).neq("status", "retired"),
    admin.from("knowledge_objects").select("id", { count: "exact", head: true }).neq("status", "retired"),
    admin.from("frameworks").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("question_banks").select("name, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(3),
    admin.from("skill_checklists").select("name, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(3),
    admin.from("osce_exams").select("title, status, created_at").order("created_at", { ascending: false }).limit(3),
    admin.from("clinical_cases").select("title, status, created_at").neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("knowledge_objects").select("title, status, created_at").neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("clinical_cases").select("status").neq("status", "retired").limit(1000),
    admin.from("knowledge_objects").select("status").neq("status", "retired").limit(1000),
  ]);

  const totalAssets = (bankCount ?? 0) + (checklistCount ?? 0) + (osceCount ?? 0) + (caseCount ?? 0) + (knowledgeCount ?? 0);
  const statusAgg = new Map<string, number>();
  for (const r of [...(caseStatuses ?? []), ...(knowledgeStatuses ?? [])]) {
    statusAgg.set(r.status, (statusAgg.get(r.status) ?? 0) + 1);
  }
  const published = statusAgg.get("published") ?? 0;
  const drafts = statusAgg.get("draft") ?? 0;
  const inReview = statusAgg.get("in_review") ?? 0;

  type Recent = { name: string; type: string; status: string | null; at: string };
  const recent: Recent[] = [
    ...(recentBanks ?? []).map(r => ({ name: r.name, type: "Knowledge Test", status: null, at: r.created_at })),
    ...(recentChecklists ?? []).map(r => ({ name: r.name, type: "Checklist", status: null, at: r.created_at })),
    ...(recentOsce ?? []).map(r => ({ name: r.title, type: "OSCE Blueprint", status: r.status, at: r.created_at })),
    ...(recentCases ?? []).map(r => ({ name: r.title, type: "Simulation Case", status: r.status, at: r.created_at })),
    ...(recentKnowledge ?? []).map(r => ({ name: r.title, type: "Knowledge Object", status: r.status, at: r.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  const MODULES: { icon: string; name: string; desc: string; href?: string; count?: string; soon?: boolean }[] = [
    { icon: "📚", name: "Checklist Builder", desc: "Build skill and competency checklists — the master checklists every assessment method reuses.", href: "/assessor/studio/checklists", count: `${checklistCount ?? 0} checklists · ${itemCount ?? 0} items` },
    { icon: "✍️", name: "Assessment Builder", desc: "Create governed knowledge tests — MCQ banks with pass marks and validity.", href: "/assessor/studio/assessments", count: `${bankCount ?? 0} banks · ${questionCount ?? 0} questions` },
    { icon: "🩺", name: "OSCE Blueprint Studio", desc: "Design OSCE exams, stations and circuits in the OSCE Centre builder.", href: "/assessor/osce", count: `${osceCount ?? 0} blueprints` },
    { icon: "🧪", name: "Simulation Scenario Studio", desc: "Curated briefs, governed cases and the AI scenario designer.", href: "/assessor/simulation", count: `${caseCount ?? 0} governed cases` },
    { icon: "⚖️", name: "Rubrics & Scoring", desc: "The governed Benner scale, scoring methods and entrustment levels.", href: "/assessor/studio/rubrics" },
    { icon: "✨", name: "AI Assessment Generator", desc: "Claude drafts station material, scenarios and in-session guidance — you author the final asset.", href: "/assessor/studio/checklists" },
    { icon: "🕘", name: "Version Control", desc: "Framework versions, publication states and the content change trail.", href: "/assessor/studio/versions", count: `${fwCount ?? 0} frameworks` },
    { icon: "🖇️", name: "Evidence Template Builder", desc: "No backing store yet — evidence requirements live on competencies.", soon: true },
    { icon: "✅", name: "Review & Approval", desc: "Framework lifecycle governance runs in the platform Studio (super-admin).", soon: true },
    { icon: "📣", name: "Publishing Centre", desc: "Knowledge/case publishing runs in the platform Studio (super-admin).", soon: true },
  ];

  const QUICK = [
    { icon: "📚", label: "New Checklist", href: "/assessor/studio/checklists" },
    { icon: "✍️", label: "New Knowledge Test", href: "/assessor/studio/assessments" },
    { icon: "🩺", label: "New OSCE Blueprint", href: "/assessor/osce" },
    { icon: "✨", label: "AI Scenario Draft", href: "/assessor/simulation" },
  ];

  const ECOSYSTEM = [
    ["📥", "Assessment Inbox", "Uses published assessments", "/assessor/queue"],
    ["🖊️", "Evidence Validation", "Uses checklist criteria", "/assessor/logbook"],
    ["🩺", "OSCE Management", "Uses OSCE blueprints", "/assessor/osce"],
    ["🧪", "Simulation Centre", "Uses scenarios", "/assessor/simulation"],
    ["📊", "Analytics & Reports", "Feeds assessment analytics", "/assessor/reports"],
    ["🛂", "Competency Passports", "Publishes validated results", "/assessor/passports"],
  ] as const;

  return (
    <div className="max-w-[1100px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">🎛️ Assessment Studio</h1>
        <p className="text-gray-400 text-sm mt-0.5">Design, build and manage the assessment assets that power the entire assessment ecosystem.</p>
      </div>

      <StatTiles cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" tiles={[
        { label: "Total Assets", value: String(totalAssets), sub: "across 5 asset types" },
        { label: "Published", value: String(published), sub: "knowledge + cases" },
        { label: "In Review", value: String(inReview) },
        { label: "Drafts", value: String(drafts) },
        { label: "Checklist Items", value: String(itemCount ?? 0), alert: (itemCount ?? 0) === 0, sub: (itemCount ?? 0) === 0 ? "content gap — author now" : "governed criteria" },
        { label: "Question Bank", value: String(questionCount ?? 0), sub: "MCQ items" },
      ]} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4 mb-4">
        <div className="min-w-0">
          <Card title="Assessment Studio Modules">
            <div className="grid sm:grid-cols-2 gap-2">
              {MODULES.map(m => m.soon ? (
                <div key={m.name} className="border border-gray-100 rounded-lg px-3 py-2.5 opacity-60 select-none">
                  <p className="text-xs font-semibold text-gray-500">{m.icon} {m.name} <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5 ml-1">soon</span></p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
                </div>
              ) : (
                <Link key={m.name} href={m.href!} className="border border-gray-100 rounded-lg px-3 py-2.5 hover:border-indigo-300 transition-colors">
                  <p className="text-xs font-semibold text-gray-800">{m.icon} {m.name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
                  {m.count && <p className="text-[9px] text-indigo-500 mt-1">{m.count}</p>}
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Quick Actions">
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK.map(q => (
                <Link key={q.label} href={q.href} className="border border-gray-100 rounded-lg px-2 py-2.5 text-center hover:border-indigo-200 transition-colors">
                  <p className="text-base">{q.icon}</p>
                  <p className="text-[9px] font-semibold text-gray-600 leading-tight mt-0.5">{q.label}</p>
                </Link>
              ))}
            </div>
          </Card>
          <Card title="Recent Assets">
            {recent.length ? (
              <div className="space-y-1.5">
                {recent.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-gray-700 flex-1 truncate">{r.name}</span>
                    <span className="text-[9px] text-gray-400 shrink-0">{r.type}</span>
                    {r.status && <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${STATUS_CLS[r.status] ?? "bg-gray-100 text-gray-500"}`}>{r.status.replace("_", " ")}</span>}
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No assets authored yet.</p>}
          </Card>
        </div>
      </div>

      <Card title="Powers the Assessment Ecosystem" sub="publishing synchronises downstream automatically — these modules read the same governed tables">
        <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
          {ECOSYSTEM.map(([icon, t, sub, href], i) => (
            <div key={t} className="flex items-center gap-1.5 shrink-0">
              <Link href={href} className="rounded-lg border border-gray-100 bg-gray-50/60 hover:border-indigo-200 transition-colors px-2.5 py-2 w-[130px]">
                <p className="text-sm">{icon}</p>
                <p className="text-[10px] font-bold text-gray-800 leading-tight">{t}</p>
                <p className="text-[8px] text-gray-400 leading-tight mt-0.5">{sub}</p>
              </Link>
              {i < ECOSYSTEM.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: checklists and knowledge tests are authored here and consumed everywhere (cockpit criteria, audits, OSCE/AI grounding, quizzes).
        Evidence templates have no store; framework review/publishing lifecycle stays with platform governance in the super-admin Studio.
      </p>
    </div>
  );
}
